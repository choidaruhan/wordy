import { Hono } from 'hono';
import type { Grade } from 'ts-fsrs';
import type { Env, User } from '../types';
import { Layout } from '../components/layout';
import { localDate } from '../lib/time';
import { clampResponseMs } from '../lib/quota';
import { blankOut, diffChars, gradeAnswer, normalize, type GradeResult } from '../lib/grade';
import { ratingFromQuiz } from '../lib/rating';
import { shouldAskConfidence } from '../lib/confidence';
import {
  computeGradingReliability,
  RATING_MODEL_VERSION,
} from '../lib/rating-config';
import { formatSpan, type Scheduled } from '../lib/srs';
import {
  normalizePlayMode,
  PLAY_MODES,
  PLAY_MODE_DESCRIPTIONS,
  PLAY_MODE_LABELS,
  type PlayMode,
} from '../lib/play';
import {
  buildSessionPlan,
  type PolicyReason,
  type SessionPlan,
} from '../lib/learning-policy';
import { getTodayPlan, type TodayPlan } from '../db/plan';
import { planReasonText } from '../lib/plan-text';
import { parseExtraExamples, parseJsonList } from '../lib/word-meta';
import { countWeakDue, listWeakness, weakWordIds } from '../db/weak';
import { getLearningPulse, type LearningPulse } from '../db/report';
import {
  ensureUnlocks,
  getCardForReview,
  getMeaningChoices,
  getReviewIdByKey,
  maybeSuspendLeech,
  maybeUnlockCloze,
  maybeUnlockListening,
  maybeUnlockRecall,
  saveReview,
  updateReviewConfidence,
  type QueueCard,
} from '../db/review';
import {
  abandonActivePlaySessions,
  abandonPlaySession,
  answerWrapupItem,
  completePlaySession,
  countDeckNewCards,
  createPlaySession,
  getPlayPoolCounts,
  getPlaySession,
  getPlaySessionItem,
  getPlaySessionWrapupStats,
  getActivePlaySession,
  getTodayPlayStats,
  refreshPlaySessionStatus,
  serveNextPlayCard,
  type PlayPoolCounts,
  type PlaySessionRow,
  type WrapupStats,
} from '../db/play';

const play = new Hono<Env>();

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * 현재 사용자/모드에 맞는 세션 계획을 만든다.
 * session 모드는 session_size/new_per_session 을,
 * daily 모드는 daily_plans 의 남은 목표를 사용한다.
 */
async function buildPlayPlan(
  db: D1Database,
  user: User,
  mode: PlayMode,
  deckId: string | null,
  now: Date
): Promise<SessionPlan> {
  const nowIso = now.toISOString();
  const today = localDate(now, user.tz_offset_min, user.timezone);

  const [counts, stats] = await Promise.all([
    getPlayPoolCounts(db, user.id, nowIso),
    getTodayPlayStats(db, user.id, today),
  ]);

  let weakDueCount = 0;
  if (mode === 'weak') {
    const report = await listWeakness(db, user.id, now);
    weakDueCount = await countWeakDue(
      db,
      user.id,
      nowIso,
      weakWordIds(report)
    );
  }

  let deckNewCount = 0;
  if (mode === 'custom' && deckId) {
    deckNewCount = await countDeckNewCards(db, user.id, deckId);
  }

  let dailyPlan = null;
  if (user.learning_mode === 'daily') {
    const result = await getTodayPlan(db, user, now, true);
    const reviewTarget = result.plan.reviewTarget + result.plan.promotedTarget;
    const reviewDone = Math.max(
      0,
      reviewTarget - (result.progress.reviewLeft + result.progress.promotedLeft)
    );

    dailyPlan = {
      target: reviewTarget + result.plan.effectiveNew,
      done: result.plan.done,
      reviewTarget,
      reviewDone,
      effectiveNew: result.plan.effectiveNew,
      newDone: Math.max(
        0,
        result.plan.effectiveNew - result.progress.newLeft
      ),
      reason: result.plan.reason as PolicyReason,
    };
  }

  return buildSessionPlan({
    mode: user.learning_mode,
    kind: mode,
    sessionSize: user.session_size,
    newPerSession: user.new_per_session,
    dailyNew: user.daily_new,
    dailyReview: user.daily_review,
    newCardMode: user.new_card_mode,
    dueCount: counts.due,
    dueByType: counts.dueByType,
    newCount: counts.newCards,
    weakDueCount,
    deckNewCount,
    todayDone: stats.todayDone,
    todayNewDone: stats.todayNewDone,
    todayReviewDone: stats.todayReviewDone,
    overdue: counts.due,
    throughput7: stats.throughput7,
    adherence7: 1,
    dailyPlan,
  });
}


play.get('/play', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const now = new Date();
  try {
    await ensureUnlocks(c.env.DB, user.id, now, user.listening_enabled);
  } catch (err) {
    // 승급 복구 실패가 플레이 화면을 막지 않게 한다.
    console.error('ensureUnlocks failed', err);
  }

  const nowIso = now.toISOString();
  const [counts, plan, weakDue, activeFound, pulse] = await Promise.all([
    getPlayPoolCounts(c.env.DB, user.id, nowIso),
    user.learning_mode === 'daily'
      ? getTodayPlan(c.env.DB, user, now, true).then((result) => result.plan)
      : Promise.resolve(null),
    listWeakness(c.env.DB, user.id, now).then((report) =>
      countWeakDue(c.env.DB, user.id, nowIso, weakWordIds(report))
    ),
    getActivePlaySession(c.env.DB, user.id),
    getLearningPulse(c.env.DB, user, now, user.daily_review),
  ]);
  const refreshed = activeFound
    ? await refreshPlaySessionStatus(c.env.DB, user.id, activeFound.id, now)
    : null;
  const activeSession = refreshed?.status === 'active' ? refreshed : null;
  const notice =
    c.req.query('done') === '1'
      ? 'done'
      : c.req.query('empty') === '1'
        ? 'empty'
        : c.req.query('intent') === 'weak'
          ? 'weak'
          : null;

  return c.html(
    <Layout title="플레이" user={user}>
      <PlayHome
        user={user}
        counts={counts}
        plan={plan}
        weakDue={weakDue}
        activeSession={activeSession}
        pulse={pulse}
        notice={notice}
      />
    </Layout>
  );
});

play.post('/play/start', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const body = await c.req.parseBody();
  const mode = normalizePlayMode(body['mode'], user.listening_enabled);
  const deckId =
    mode === 'custom' && typeof body['deck_id'] === 'string'
      ? body['deck_id']
      : null;
  const now = new Date();
  try {
    await ensureUnlocks(c.env.DB, user.id, now, user.listening_enabled);
  } catch (err) {
    console.error('ensureUnlocks failed', err);
  }

  const plan = await buildPlayPlan(c.env.DB, user, mode, deckId, now);

  if (plan.targetSize <= 0) {
    return c.redirect(plan.reason === 'goal_done' ? '/play?done=1' : '/play?empty=1');
  }

  // 이어서 하지 않고 새로 시작하는 선택이므로, 남아 있던 세션은 정리한다.
  await abandonActivePlaySessions(c.env.DB, user.id, now);

  const session = await createPlaySession(
    c.env.DB,
    user.id,
    mode,
    {
      targetSize: plan.targetSize,
      reviewTarget: plan.reviewTarget,
      newTarget: plan.newTarget,
      weakTarget: plan.weakTarget,
      policy: plan.mode,
      reason: plan.reason,
    },
    now,
    deckId
  );

  return c.redirect(`/play/${session.id}`);
});

play.get('/play/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const now = new Date();
  const found = await getPlaySession(c.env.DB, user.id, c.req.param('id'));
  if (!found) return c.notFound();

  const session =
    (await refreshPlaySessionStatus(c.env.DB, user.id, found.id, now)) ?? found;

  if (session.status !== 'active') {
    const wrapupStats = await getPlaySessionWrapupStats(
      c.env.DB,
      user.id,
      session.id
    );
    return c.html(
      <Layout title="플레이 결과" user={user}>
        <div id="play-root">
          <PlayResult session={session} wrapupStats={wrapupStats} />
        </div>
      </Layout>
    );
  }

  const served = await serveNextPlayCard(c.env.DB, user.id, session, now);

  if (!served) {
    await completePlaySession(c.env.DB, user.id, session.id, now);
    const done = await getPlaySession(c.env.DB, user.id, session.id);
    const wrapupStats = await getPlaySessionWrapupStats(
      c.env.DB,
      user.id,
      session.id
    );
    return c.html(
      <Layout title="플레이 결과" user={user}>
        <div id="play-root">
          <PlayResult session={done ?? session} wrapupStats={wrapupStats} />
        </div>
      </Layout>
    );
  }

  const choices = await choicesFor(c.env.DB, user.id, served.card);

  return c.html(
    <Layout title="플레이" user={user}>
      <div id="play-root">
        <PlayQuestion
          session={session}
          card={served.card}
          choices={choices}
          itemId={served.item.id}
          shownAt={served.item.served_at}
          wrapup={served.item.kind === 'wrapup'}
          now={now}
        />
      </div>
    </Layout>
  );
});

play.get('/play/:id/result', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const session = await getPlaySession(c.env.DB, user.id, c.req.param('id'));
  if (!session) return c.notFound();
  if (session.status === 'active') return c.redirect(`/play/${session.id}`);
  const wrapupStats = await getPlaySessionWrapupStats(
    c.env.DB,
    user.id,
    session.id
  );

  return c.html(
    <Layout title="플레이 결과" user={user}>
      <div id="play-root">
        <PlayResult session={session} wrapupStats={wrapupStats} />
      </div>
    </Layout>
  );
});

play.post('/play/:id/abandon', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const session = await getPlaySession(c.env.DB, user.id, c.req.param('id'));
  if (!session) return c.notFound();

  if (session.status === 'active') {
    await abandonPlaySession(c.env.DB, user.id, session.id);
  }

  return c.redirect(`/play/${session.id}`);
});

play.post('/play/:id/answer', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const now = new Date();
  const found = await getPlaySession(c.env.DB, user.id, c.req.param('id'));
  if (!found) return c.notFound();

  const session =
    (await refreshPlaySessionStatus(c.env.DB, user.id, found.id, now)) ?? found;
  if (session.status !== 'active') {
    const wrapupStats = await getPlaySessionWrapupStats(
      c.env.DB,
      user.id,
      session.id
    );
    return c.html(<PlayResult session={session} wrapupStats={wrapupStats} />);
  }

  const body = await c.req.parseBody();
  const itemId = String(body['session_item_id'] ?? '');
  const item = await getPlaySessionItem(
    c.env.DB,
    user.id,
    session.id,
    itemId
  );

  if (!item || (item.kind !== 'prompt' && item.kind !== 'wrapup')) {
    return c.text('문제를 찾을 수 없습니다.', 404);
  }
  if (item.answered_at) {
    return c.text('이미 처리된 문제입니다.', 409);
  }
  if (item.card_id !== String(body['card_id'] ?? '')) {
    return c.text('문제가 일치하지 않습니다.', 400);
  }

  const card = await getCardForReview(c.env.DB, user.id, item.card_id);
  if (!card) return c.text('카드를 찾을 수 없습니다.', 404);

  const today = localDate(now, user.tz_offset_min, user.timezone);
  const responseMs = clampResponseMs(item.served_at, now);
  const reviewKey = item.id;
  const promptStartedAt =
    card.card_type === 'listening'
      ? isoOrNull(body['prompt_started_at']) ?? item.served_at
      : item.served_at;
  const firstInputAt = isoOrNull(body['first_input_at']);
  const rawConfidence = Number(body['confidence']);
  const confidence =
    Number.isFinite(rawConfidence) && rawConfidence >= 0 && rawConfidence <= 2
      ? Math.trunc(rawConfidence)
      : null;

  let correct = false;
  let rating: Grade = 1;
  let answer: string | null = null;
  let result: GradeResult | null = null;
  let chosen: string | null = null;
  let gradingSource: 'self' | 'server' = 'server';

  if (card.card_type === 'recognition') {
    chosen = String(body['choice'] ?? '').trim();
    const fallbackRating = Number(body['rating']);

    if (chosen) {
      correct = normalize(chosen) === normalize(card.meaning);
      answer = chosen;
      rating = ratingFromQuiz({
        correct,
        responseMs,
        cardType: card.card_type,
      });
    } else {
      rating = ([1, 2, 3, 4].includes(fallbackRating) ? fallbackRating : 1) as Grade;
      correct = rating >= 2;
      gradingSource = 'self';
    }
  } else {
    const input = body['give_up'] ? '' : String(body['answer'] ?? '');
    result = gradeAnswer(input, card.term);
    answer = input;
    correct = result.ok;
    rating = ratingFromQuiz({
      correct: result.ok,
      typo: result.typo,
      responseMs,
      cardType: card.card_type,
    });
  }

  if (item.kind === 'wrapup') {
    const updated = await answerWrapupItem(
      c.env.DB,
      user.id,
      session.id,
      item.id,
      correct,
      now
    );
    if (!updated) {
      return c.text('이미 처리된 문제입니다.', 409);
    }

    return c.html(
      <PlayFeedback
        session={session}
        card={card}
        correct={correct}
        answer={answer}
        chosen={chosen}
        result={result}
        saved={null}
        reviewId={null}
        confidencePrompt={false}
        wrapup
        now={now}
      />
    );
  }

  const source = session.mode === 'weak' ? 'weak' : 'review';

  const saved = await saveReview(c.env.DB, user.id, card, rating, now, today, {
    answer,
    responseMs,
    source,
    reviewKey,
    sessionId: session.id,
    gradingSource,
    fsrsParams: user.fsrs_params,
    promptStartedAt,
    firstInputAt,
    confidence,
    gradingReliability: computeGradingReliability({
      correct,
      typo: result?.typo ?? false,
      responseMs,
      cardType: card.card_type,
      confidence,
    }),
    ratingModelVersion: RATING_MODEL_VERSION,
  });

  if (!saved) {
    return c.text('이미 처리된 문제입니다.', 409);
  }

  await afterSavePlay(c.env.DB, user, card, saved, now);

  const reviewId = await getReviewIdByKey(c.env.DB, user.id, reviewKey);
  const questionNumber = session.answered + 1;
  const confidencePrompt =
    reviewId != null &&
    shouldAskConfidence(user.confidence_mode, questionNumber);

  return c.html(
    <PlayFeedback
      session={session}
      card={card}
      correct={correct}
      answer={answer}
      chosen={chosen}
      result={result}
      saved={saved}
      reviewId={reviewId}
      confidencePrompt={confidencePrompt}
      wrapup={false}
      now={now}
    />
  );
});

play.post('/play/:id/confidence', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const session = await getPlaySession(c.env.DB, user.id, c.req.param('id'));
  if (!session) return c.notFound();

  const body = await c.req.parseBody();
  const reviewId = String(body['review_id'] ?? '');
  const confidence = Number(body['confidence']);

  if (
    !reviewId ||
    !Number.isInteger(confidence) ||
    confidence < 0 ||
    confidence > 2
  ) {
    return c.text('잘못된 요청입니다.', 400);
  }

  const updated = await updateReviewConfidence(
    c.env.DB,
    user.id,
    session.id,
    reviewId,
    confidence
  );

  if (!updated) return c.text('리뷰를 찾을 수 없습니다.', 404);

  return c.html(
    <p class="py-3 text-center text-xs text-success">
      확신도를 기록했습니다.
    </p>
  );
});

play.post('/play/:id/next', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const now = new Date();
  const found = await getPlaySession(c.env.DB, user.id, c.req.param('id'));
  if (!found) return c.notFound();

  const session =
    (await refreshPlaySessionStatus(c.env.DB, user.id, found.id, now)) ?? found;

  if (session.status !== 'active') {
    const wrapupStats = await getPlaySessionWrapupStats(
      c.env.DB,
      user.id,
      session.id
    );
    return c.html(
      <PlayResult session={session} wrapupStats={wrapupStats} />
    );
  }

  const served = await serveNextPlayCard(c.env.DB, user.id, session, now);

  if (!served) {
    await completePlaySession(c.env.DB, user.id, session.id, now);
    const done = await getPlaySession(c.env.DB, user.id, session.id);
    const wrapupStats = await getPlaySessionWrapupStats(
      c.env.DB,
      user.id,
      session.id
    );
    return c.html(
      <PlayResult session={done ?? session} wrapupStats={wrapupStats} />
    );
  }

  const choices = await choicesFor(c.env.DB, user.id, served.card);

  return c.html(
    <PlayQuestion
      session={session}
      card={served.card}
      choices={choices}
      itemId={served.item.id}
      shownAt={served.item.served_at}
      wrapup={served.item.kind === 'wrapup'}
      now={now}
    />
  );
});

async function choicesFor(
  db: D1Database,
  userId: string,
  card: QueueCard
): Promise<string[] | null> {
  if (card.card_type !== 'recognition') return null;
  const choices = await getMeaningChoices(db, userId, card.word_id, card.meaning);
  return choices.length >= 2 ? choices : null;
}

async function afterSavePlay(
  db: D1Database,
  user: User,
  card: QueueCard,
  saved: Scheduled,
  now: Date
): Promise<void> {
  try {
    await maybeUnlockRecall(db, user.id, card, saved, now);
    await maybeUnlockCloze(db, user.id, card, saved, now);
    await maybeUnlockListening(db, user.id, card, saved, now, user.listening_enabled);
    await maybeSuspendLeech(db, user.id, card, saved);
  } catch (err) {
    // 승급·격리 실패가 이미 저장된 리뷰를 막지 않게 한다.
    console.error('play post-review task failed', err);
  }
}

function DailyPlanCard(props: { plan: TodayPlan; sessionSize: number }) {
  const target =
    props.plan.reviewTarget +
    props.plan.promotedTarget +
    props.plan.effectiveNew;
  const done = Math.min(props.plan.done, target);
  const pct = target > 0 ? Math.round((done / target) * 100) : 100;
  const completed = props.plan.completed || target === 0;
  const reason = planReasonText({
    baseNew: props.plan.baseNew,
    effectiveNew: props.plan.effectiveNew,
    reason: props.plan.reason,
  });
  const sessionTarget = Math.min(props.sessionSize, props.plan.remaining);

  return (
    <section class="mt-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div class="flex items-baseline justify-between gap-3">
        <p class="text-xs font-bold tracking-widest text-muted uppercase">
          오늘 목표
        </p>
        <span class="text-xs text-muted">
          {done} / {target}
        </span>
      </div>

      <p class="mt-3 text-3xl leading-none font-extrabold tracking-tight">
        {completed ? '완료' : `${props.plan.remaining}장 남음`}
      </p>

      <div
        class="mt-3 h-2 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-label="오늘 목표 진행률"
        aria-valuemin={0}
        aria-valuemax={Math.max(1, target)}
        aria-valuenow={Math.min(done, Math.max(1, target))}
      >
        <div
          class="h-2 rounded-full bg-accent transition-[width]"
          style={`width:${pct}%`}
        ></div>
      </div>

      <p class="mt-3 text-xs leading-5 text-muted">
        복습 {props.plan.reviewTarget} · 승급 {props.plan.promotedTarget} · 신규{' '}
        {props.plan.effectiveNew}
        {props.plan.estimatedMinutes > 0
          ? ` · 예상 ${props.plan.estimatedMinutes}분`
          : ''}
      </p>
      {reason ? <p class="mt-1 text-xs leading-5 text-muted">{reason}</p> : null}

      {!completed && sessionTarget > 0 ? (
        <form method="post" action="/play/start" class="mt-4">
          <input type="hidden" name="mode" value="quick" />
          <button
            type="submit"
            class="w-full rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white shadow-brand hover:bg-accent-strong"
          >
            오늘 목표 이어서 · {sessionTarget}문제
          </button>
        </form>
      ) : (
        <p class="mt-4 rounded-xl bg-accent-soft px-4 py-3 text-center text-sm font-semibold text-accent-text">
          {completed ? '오늘 목표를 완료했습니다.' : '지금 풀 수 있는 문제가 없습니다.'}
        </p>
      )}
    </section>
  );
}

function PlayHome(props: {
  user: User;
  counts: PlayPoolCounts;
  plan: TodayPlan | null;
  weakDue: number;
  activeSession: PlaySessionRow | null;
  pulse: LearningPulse;
  notice: 'done' | 'empty' | 'weak' | null;
}) {
  const available = props.counts.due + props.counts.newCards;
  const dailyMode = props.user.learning_mode === 'daily';
  const accuracyText =
    props.pulse.recentAccuracy == null
      ? '표본 부족'
      : `${Math.round(props.pulse.recentAccuracy * 100)}%`;

  const modeCount = (mode: PlayMode): number => {
    if (mode === 'quick') return available;
    if (mode === 'typing') {
      return (
        (props.counts.dueByType['recall'] ?? 0) +
        (props.counts.dueByType['cloze'] ?? 0)
      );
    }
    if (mode === 'cloze') return props.counts.dueByType['cloze'] ?? 0;
    if (mode === 'listening') return props.counts.dueByType['listening'] ?? 0;
    if (mode === 'weak') return props.weakDue;
    return 0;
  };

  return (
    <>
      <p class="text-xs font-bold tracking-widest text-accent-text uppercase">Play</p>
      <h1 class="mt-1 text-2xl font-extrabold tracking-tight">심심할 때 한 판</h1>
      <p class="mt-1 text-sm text-muted">
        {dailyMode
          ? '오늘 목표 안에서, 지금 풀 수 있는 문제만큼.'
          : '하루 목표 없이, 지금 풀 수 있는 문제만큼 가볍게.'}
      </p>

      {props.pulse.message ? (
        <div
          class={`mt-4 rounded-xl px-4 py-3 text-sm leading-6 ${
            props.pulse.level === 'high_load'
              ? 'bg-danger-soft text-danger'
              : 'bg-mark-soft text-ink'
          }`}
        >
          {props.pulse.message}
        </div>
      ) : null}

      <p class="mt-2 text-xs text-muted">
        최근 정확도 {accuracyText} · 오늘 {props.pulse.todayReviews}문제 · 최근 7일{' '}
        {props.pulse.studyDays7}일 학습
      </p>

      {props.activeSession ? (
        <section class="mt-5 rounded-2xl border border-accent/40 bg-accent-soft p-4">
          <div class="flex items-baseline justify-between gap-3">
            <p class="text-xs font-bold tracking-widest text-accent-text uppercase">
              이어서
            </p>
            <span class="text-xs text-muted">
              {props.activeSession.answered} / {props.activeSession.target_size}
            </span>
          </div>
          <p class="mt-2 text-sm font-bold">
            {PLAY_MODE_LABELS[normalizePlayMode(props.activeSession.mode)]} ·{' '}
            {props.activeSession.answered >= props.activeSession.target_size
              ? '오답 다시 보기'
              : `${Math.max(
                  0,
                  props.activeSession.target_size - props.activeSession.answered
                )}문제 남음`}
          </p>
          <a
            href={`/play/${props.activeSession.id}`}
            class="mt-3 flex w-full items-center justify-center rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white shadow-brand hover:bg-accent-strong"
          >
            이어서 하기
          </a>
          <form
            method="post"
            action={`/play/${props.activeSession.id}/abandon`}
            class="mt-2 text-center"
            onsubmit="return confirm('진행 중인 한 판을 그만둘까요?')"
          >
            <button type="submit" class="text-xs text-muted hover:text-danger">
              그만두기
            </button>
          </form>
        </section>
      ) : null}

      {dailyMode && props.plan ? (
        <DailyPlanCard plan={props.plan} sessionSize={props.user.session_size} />
      ) : null}

      <p class="mt-4 text-sm text-muted">
        복습 대기 {props.counts.due} · 새 단어 {props.counts.newCards}
      </p>

      {props.notice === 'done' ? (
        <p class="mt-6 rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-5 text-sm leading-6 text-muted">
          오늘 목표를 완료했습니다. 내일 다시 이어서 학습하세요.
        </p>
      ) : null}

      {props.notice === 'empty' || (available === 0 && props.notice === null) ? (
        <p class="mt-6 rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-5 text-sm leading-6 text-muted">
          지금 풀 문제가 없습니다. 단어장에서 새 단어를 추가해 보세요.
        </p>
      ) : null}

      {props.notice === 'weak' ? (
        <div class="mt-6 rounded-2xl border border-accent/40 bg-accent-soft px-4 py-5">
          <p class="text-sm font-bold text-accent-text">취약 단어 연습</p>
          <p class="mt-1 text-xs leading-5 text-muted">
            기한이 도래한 취약 단어만 모아서 풉니다.
          </p>
          <form method="post" action="/play/start" class="mt-3">
            <input type="hidden" name="mode" value="weak" />
            <button
              type="submit"
              disabled={props.weakDue === 0}
              class="rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white shadow-brand hover:bg-accent-strong disabled:opacity-40"
            >
              취약 연습 시작
            </button>
          </form>
        </div>
      ) : null}

      <div class="mt-6 grid gap-2">
        {PLAY_MODES.map((mode) => {
          const count = modeCount(mode);
          const listeningOff =
            mode === 'listening' && !props.user.listening_enabled;
          const disabled = listeningOff || count === 0;
          const countLabel = listeningOff
            ? '설정에서 켜기'
            : count === 0
              ? '지금 없음'
              : `${count}개`;
          return (
            <form method="post" action="/play/start">
              <input type="hidden" name="mode" value={mode} />
              <button
                type="submit"
                disabled={disabled}
                class="flex w-full items-baseline justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-4 text-left shadow-card hover:border-accent-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
              >
                <span>
                  <span class="block text-sm font-bold">{PLAY_MODE_LABELS[mode]}</span>
                  <span class="mt-0.5 block text-xs text-muted">
                    {PLAY_MODE_DESCRIPTIONS[mode]}
                  </span>
                </span>
                <span class="text-xs text-muted">{countLabel}</span>
              </button>
            </form>
          );
        })}
      </div>

      <a
        href="/quiz"
        class="mt-3 flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-4 shadow-card transition hover:border-accent-text"
      >
        <span>
          <span class="block text-sm font-bold">객관식 테스트</span>
          <span class="mt-0.5 block text-xs text-muted">
            지금 기억 확인 · 학습 일정에 영향 없음
          </span>
        </span>
        <span class="flex shrink-0 items-center gap-1 text-xs font-semibold text-accent-text">
          시작
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4 w-4"
            aria-hidden="true"
          >
            <path d="m9 5 7 7-7 7" />
          </svg>
        </span>
      </a>

      <p class="mt-6 text-xs leading-5 text-muted">
        한 판은 {props.user.session_size}문제입니다. 설정에서 바꿀 수 있습니다.
      </p>
    </>
  );
}

function PlayQuestion(props: {
  session: PlaySessionRow;
  card: QueueCard;
  choices: string[] | null;
  itemId: string;
  shownAt: string;
  wrapup: boolean;
  now: Date;
}) {
  const mode = normalizePlayMode(props.session.mode);
  const current = Math.min(props.session.answered + 1, props.session.target_size);

  return (
    <>
      <div class="flex items-baseline justify-between gap-3 text-sm text-muted">
        <span>
          {props.wrapup ? '오답 다시 보기' : PLAY_MODE_LABELS[mode]} · {current}{' '}
          / {props.session.target_size}
        </span>
        <form
          method="post"
          action={`/play/${props.session.id}/abandon`}
          onsubmit="return confirm('한 판을 그만둘까요? 지금까지 푼 기록은 저장됩니다.')"
        >
          <button type="submit" class="text-xs text-muted hover:text-danger">
            그만두기
          </button>
        </form>
      </div>
      <div
        class="mt-2 h-1 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-label="한 판 진행률"
        aria-valuemin={0}
        aria-valuemax={props.session.target_size}
        aria-valuenow={props.session.answered}
      >
        <div
          class="h-1 rounded-full bg-accent transition-[width]"
          style={`width:${Math.round((props.session.answered / props.session.target_size) * 100)}%`}
        ></div>
      </div>

      <article class="mt-6 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <div class="px-6 py-10 text-center sm:px-10 sm:py-12">
          <p class="text-xs text-muted">{questionHint(props.card)}</p>

          {props.card.card_type === 'listening' ? (
            <>
              <button
                type="button"
                data-speak={props.card.term}
                class="mt-6 inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent-soft px-6 py-4 text-base font-medium text-accent-text"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
                </svg>
                발음 듣기
              </button>
              <p class="mt-3 text-xs text-muted">다시 들으려면 버튼을 누르세요</p>
              <p data-tts-note hidden class="mt-3 text-sm leading-6 text-danger">
                이 기기에서는 듣기를 지원하지 않습니다. “들리지 않아요”로 정답을
                확인하세요.
              </p>
            </>
          ) : props.card.card_type === 'recall' ? (
            <>
              <p class="mt-4 text-2xl leading-snug">{props.card.meaning}</p>
              {blankOut(props.card.example, props.card.term) ? (
                <p class="mt-4 font-word text-sm leading-6 text-muted">
                  {blankOut(props.card.example, props.card.term)}
                </p>
              ) : null}
            </>
          ) : props.card.card_type === 'cloze' ? (
            <>
              <p class="mt-4 font-word text-xl leading-8">
                {blankOut(props.card.example, props.card.term) ?? props.card.meaning}
              </p>
              <details class="mt-4 text-left sm:inline-block">
                <summary class="cursor-pointer text-xs text-muted">힌트: 뜻 보기</summary>
                <p class="mt-2 text-sm">{props.card.meaning}</p>
              </details>
            </>
          ) : (
            <>
              <p class="mt-4 font-word text-4xl leading-tight tracking-tight sm:text-5xl">
                {props.card.term}
              </p>
              {props.card.pronunciation ? (
                <p class="mt-1 text-sm text-muted">{props.card.pronunciation}</p>
              ) : null}
            </>
          )}
        </div>

        <form
          hx-post={`/play/${props.session.id}/answer`}
          hx-target="#play-root"
          hx-swap="innerHTML"
          hx-disabled-elt="find button"
          class="border-t border-line px-6 py-6 sm:px-10"
        >
          <input type="hidden" name="card_id" value={props.card.id} />
          <input type="hidden" name="session_item_id" value={props.itemId} />
          <input type="hidden" name="shown_at" value={props.shownAt} />
          <input type="hidden" name="first_input_at" value="" />
          {props.card.card_type === 'listening' ? (
            <input type="hidden" name="prompt_started_at" value="" />
          ) : null}

          {props.card.card_type === 'recognition' ? (
            props.choices ? (
              <>
                <div class="grid gap-2">
                  {props.choices.map((choice, index) => (
                    <button
                      type="submit"
                      name="choice"
                      value={choice}
                      data-choice={String(index + 1)}
                      class="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-paper px-4 py-3 text-left text-sm hover:border-accent-text"
                    >
                      <span class="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-xs text-muted">
                        {index + 1}
                      </span>
                      <span>{choice}</span>
                    </button>
                  ))}
                </div>
                <p class="mt-3 text-center text-xs text-muted">1 · 2 · 3 · 4</p>
              </>
            ) : (
              <>
                <p class="text-center text-sm font-medium">뜻이 떠올랐나요?</p>
                <div class="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="submit"
                    name="rating"
                    value="3"
                    data-choice="3"
                    class="rounded-xl border border-accent bg-accent px-4 py-3 text-sm font-medium text-white"
                  >
                    알겠어요
                  </button>
                  <button
                    type="submit"
                    name="rating"
                    value="1"
                    data-choice="1"
                    class="rounded-xl border border-danger/40 px-4 py-3 text-sm font-medium text-danger"
                  >
                    모르겠어요
                  </button>
                </div>
              </>
            )
          ) : (
            <>
              <input
                name="answer"
                type="text"
                data-autofocus
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck={false}
                placeholder={
                  props.card.card_type === 'cloze'
                    ? '빈칸에 들어갈 단어'
                    : props.card.card_type === 'listening'
                      ? '듣고 영어로 쓰세요'
                      : '영어 단어'
                }
                class="w-full rounded-xl border border-line bg-surface px-3 py-3 text-center font-word text-lg"
              />
              <button
                type="submit"
                class="mt-3 w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white"
              >
                확인
              </button>
              {props.card.card_type === 'listening' ? (
                <button
                  type="submit"
                  name="give_up"
                  value="1"
                  class="mt-2 w-full text-xs text-muted hover:text-danger"
                >
                  들리지 않아요
                </button>
              ) : null}
            </>
          )}
        </form>
      </article>
    </>
  );
}

function PlayFeedback(props: {
  session: PlaySessionRow;
  card: QueueCard;
  correct: boolean;
  answer: string | null;
  chosen: string | null;
  result: GradeResult | null;
  saved: Scheduled | null;
  reviewId: string | null;
  confidencePrompt: boolean;
  wrapup: boolean;
  now: Date;
}) {
  const next = props.saved
    ? formatSpan(new Date(props.saved.due_at).getTime() - props.now.getTime())
    : null;
  const chars = props.result ? diffChars(props.answer ?? '', props.card.term) : null;

  return (
    <article
      aria-live="polite"
      class="overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
    >
      <div class="px-6 py-10 text-center sm:px-10">
        {props.wrapup ? (
          <p class="mb-2 text-xs font-bold text-accent-text">오답 다시 보기</p>
        ) : null}
        <ResultMark ok={props.correct} />
        <p class={`mt-3 text-sm font-bold ${props.correct ? 'text-success' : 'text-danger'}`}>
          {props.correct ? (props.result?.typo ? '정답 (철자 확인)' : '정답!') : '오답'}
        </p>

        {chars ? (
          <p class="mt-4 font-word text-3xl leading-tight tracking-tight sm:text-4xl">
            {chars.map((char) => (
              <span
                class={
                  char.ok
                    ? ''
                    : 'text-danger underline decoration-danger/40 underline-offset-4'
                }
              >
                {char.ch}
              </span>
            ))}
          </p>
        ) : (
          <p class="mt-4 font-word text-3xl leading-tight tracking-tight sm:text-4xl">
            {props.card.term}
          </p>
        )}

        <SpeakButton term={props.card.term} />

        <p class="mt-2 text-lg">{props.card.meaning}</p>

        {!props.correct && (props.chosen || props.answer) ? (
          <p class="mt-2 text-sm text-muted">내 답: {props.chosen || props.answer}</p>
        ) : null}

        {next ? <p class="mt-3 text-xs text-muted">다음 복습 {next}</p> : null}
      </div>

      <div class="border-t border-line px-6 py-6 sm:px-10">
        <WordContext card={props.card} />
        {props.card.note ? <Mnemonic note={props.card.note} /> : null}
      </div>

      {props.confidencePrompt && props.reviewId ? (
        <div
          id="confidence-prompt"
          class="border-t border-line bg-paper px-6 py-5 sm:px-10"
        >
          <p class="text-center text-xs font-medium text-muted">
            이번 문제, 얼마나 확신했나요?
          </p>
          <div class="mt-3 grid grid-cols-3 gap-2">
            {([
              [0, '몰랐어요'],
              [1, '애매했어요'],
              [2, '확신했어요'],
            ] as const).map(([value, label]) => (
              <button
                type="button"
                hx-post={`/play/${props.session.id}/confidence`}
                hx-vals={JSON.stringify({
                  review_id: props.reviewId,
                  confidence: value,
                })}
                hx-target="#confidence-prompt"
                hx-swap="outerHTML"
                class="rounded-xl border border-line bg-surface px-2 py-2.5 text-xs hover:border-accent-text"
              >
                {label}
              </button>
            ))}
          </div>
          <p class="mt-2 text-center text-xs text-muted">
            선택하지 않고 계속해도 됩니다.
          </p>
        </div>
      ) : null}

      <div class="border-t border-line px-6 py-5 sm:px-10">
        <button
          type="button"
          hx-post={`/play/${props.session.id}/next`}
          hx-target="#play-root"
          hx-swap="innerHTML"
          data-act="next"
          class="w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white"
        >
          계속
        </button>
      </div>
    </article>
  );
}

function PlayResult(props: {
  session: PlaySessionRow;
  wrapupStats?: WrapupStats;
}) {
  const mode = normalizePlayMode(props.session.mode);
  const title =
    props.session.status === 'abandoned'
      ? '중단된 세션'
      : props.session.status === 'expired'
        ? '만료된 세션'
        : props.session.answered > 0
          ? '한 판 완료'
          : '풀 카드가 없어요';

  return (
    <div class="text-center">
      <p class="font-word text-3xl tracking-tight">{title}</p>

      {props.session.status === 'abandoned' || props.session.status === 'expired' ? (
        <p class="mt-3 text-sm leading-6 text-muted">
          {props.session.answered > 0
            ? `${props.session.correct} / ${props.session.answered} 정답`
            : props.session.status === 'expired'
              ? '세션이 만료되었습니다.'
              : '세션을 중단했습니다.'}
        </p>
      ) : props.session.answered > 0 ? (
        <p class="mt-3 text-sm text-muted">
          {props.session.correct} / {props.session.answered} 정답
        </p>
      ) : (
        <p class="mt-3 text-sm leading-6 text-muted">
          이 모드에 지금 풀 수 있는 카드가 없습니다. 복습 카드가 쌓이면 다시 열립니다.
        </p>
      )}

      {props.wrapupStats && props.wrapupStats.total > 0 ? (
        <p class="mt-1 text-xs text-muted">
          오답 다시 보기 {props.wrapupStats.correct} / {props.wrapupStats.total}
        </p>
      ) : null}

      <div class="mt-8 flex flex-col items-center gap-2">
        <form method="post" action="/play/start" class="w-full max-w-sm">
          <input type="hidden" name="mode" value={mode} />
          {props.session.deck_id ? (
            <input type="hidden" name="deck_id" value={props.session.deck_id} />
          ) : null}
          <button
            type="submit"
            class="w-full rounded-2xl bg-accent px-5 py-3.5 text-sm font-bold text-white shadow-brand"
          >
            {props.session.answered > 0 ? '한 판 더' : '그래도 한 판'}
          </button>
        </form>
        {props.session.answered === 0 ? (
          <form method="post" action="/play/start" class="w-full max-w-sm">
            <input type="hidden" name="mode" value="quick" />
            <button
              type="submit"
              class="w-full rounded-2xl border border-line bg-surface px-5 py-3.5 text-sm font-bold hover:border-accent-text"
            >
              바로 시작
            </button>
          </form>
        ) : null}
        <a href="/play" class="text-sm text-muted hover:text-accent-text">
          다른 모드
        </a>
        <a href="/" class="text-sm text-muted hover:text-accent-text">
          홈
        </a>
      </div>
    </div>
  );
}

function ResultMark(props: { ok: boolean }) {
  return (
    <div
      class={`mx-auto flex h-20 w-20 items-center justify-center rounded-full ${
        props.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
      }`}
    >
      {props.ok ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-10 w-10"
          aria-hidden="true"
        >
          <path d="m5 12 5 5L20 7" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          class="h-10 w-10"
          aria-hidden="true"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      )}
    </div>
  );
}

function SpeakButton(props: { term: string }) {
  return (
    <button
      type="button"
      data-speak={props.term}
      aria-label="발음 듣기"
      class="mx-auto mt-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent-text transition-colors hover:bg-accent/10"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-5 w-5"
        aria-hidden="true"
      >
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    </button>
  );
}

function WordContext(props: { card: QueueCard }) {
  const extras = parseExtraExamples(props.card.extra_examples_raw).slice(0, 2);
  const collocations = parseJsonList(props.card.collocations);
  const synonyms = parseJsonList(props.card.synonyms);
  const antonyms = parseJsonList(props.card.antonyms);
  const hasPrimary = Boolean(props.card.example);

  if (
    !hasPrimary &&
    extras.length === 0 &&
    collocations.length === 0 &&
    synonyms.length === 0 &&
    antonyms.length === 0
  ) {
    return null;
  }

  return (
    <div class="space-y-4">
      {hasPrimary ? (
        <div>
          <p class="text-xs text-muted">예문</p>
          <p class="mt-1 font-word text-base leading-6">{props.card.example}</p>
          {props.card.example_ko ? (
            <p class="mt-1 text-sm leading-6 text-muted">{props.card.example_ko}</p>
          ) : null}
        </div>
      ) : null}

      {extras.length > 0 ? (
        <div>
          <p class="text-xs text-muted">추가 예문</p>
          <div class="mt-1 space-y-2">
            {extras.map((example) => (
              <div>
                <p class="font-word text-base leading-6">{example.sentence}</p>
                {example.translation ? (
                  <p class="text-sm leading-6 text-muted">{example.translation}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {collocations.length > 0 ? (
        <div>
          <p class="text-xs text-muted">함께 쓰는 표현</p>
          <p class="mt-1 text-sm leading-6">{collocations.join(' · ')}</p>
        </div>
      ) : null}

      {synonyms.length > 0 || antonyms.length > 0 ? (
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm leading-6 text-muted">
          {synonyms.length > 0 ? <p>유의어: {synonyms.join(', ')}</p> : null}
          {antonyms.length > 0 ? <p>반의어: {antonyms.join(', ')}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Mnemonic(props: { note: string }) {
  return (
    <div class="mt-5 border-l-2 border-mark pl-3">
      <p class="text-xs text-muted">내가 적은 연상법</p>
      <p class="mt-1 text-sm leading-6">{props.note}</p>
    </div>
  );
}

function questionHint(card: QueueCard): string {
  if (card.card_type === 'recall') return '뜻을 보고 영어로 쓰세요';
  if (card.card_type === 'cloze') return '빈칸에 들어갈 단어를 쓰세요';
  if (card.card_type === 'listening') return '듣고 철자를 입력하세요';
  return '뜻을 고르세요';
}

export default play;
