import { Hono } from 'hono';
import type { Grade } from 'ts-fsrs';
import type { Env, User } from '../types';
import { Layout } from '../components/layout';
import { localDate } from '../lib/time';
import { previewIntervals, type Scheduled } from '../lib/srs';
import { blankOut, diffChars, gradeAnswer, type GradeResult } from '../lib/grade';
import { clampResponseMs } from '../lib/quota';
import { DEFAULT_REVIEW_RATIOS, selectNextType } from '../lib/session';
import { planReasonText } from '../lib/plan-text';
import { parseExtraExamples, parseJsonList } from '../lib/word-meta';
import {
  ensureUnlocks,
  getCardForReview,
  getProgress,
  maybeSuspendLeech,
  maybeUnlockCloze,
  maybeUnlockListening,
  maybeUnlockRecall,
  nextDueReview,
  nextDueReviewByType,
  nextNewCard,
  nextPromotedCard,
  nextWarmupCard,
  saveReview,
  type Progress,
  type QueueCard,
  type ReviewSource,
} from '../db/review';
import {
  countDueByType,
  countReviewsSince,
  getTodayPlan,
  servedByTypeSince,
  updatePlanCompletion,
  type DailyPlanRow,
  type PlanProgress,
  type TodayPlan,
} from '../db/plan';
import {
  countWeakDue,
  countWeakDoneToday,
  listWeakness,
  nextWeakDueReview,
  weakWordIds,
  type WeaknessReport,
} from '../db/weak';

const review = new Hono<Env>();

type Stage = 'intro' | 'front' | 'back' | 'result';

review.get('/review', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const now = new Date();

  if (c.req.query('mode') === 'weak') {
    const ctx = await weakContext(c.env.DB, user, now);
    const card = await pickWeakNext(c.env.DB, user, ctx, now);

    return c.html(
      <Layout title="취약 단어" user={user}>
        <div id="review-root">
          {card ? (
            <Fragment
              fsrsParams={user.fsrs_params}
              card={card}
              stage={initialStage(card)}
              prog={ctx.prog}
              now={now}
              source="weak"
            />
          ) : (
            <WeakDone
              prog={ctx.prog}
              weakCount={ctx.report.all.length}
              weakDue={ctx.due}
              reviewLeft={ctx.reviewLeft}
            />
          )}
        </div>
      </Layout>
    );
  }

  try {
    await ensureUnlocks(c.env.DB, user.id, now, user.listening_enabled);
  } catch (err) {
    // 승급 복구 실패가 학습 화면을 막지 않게 한다. 다음 로드에서 다시 시도된다.
    console.error('ensureUnlocks failed', err);
  }

  const ctx = await planContext(c.env.DB, user, now);
  const picked = await pickNext(c.env.DB, user, ctx.row, ctx.progress, now);

  return c.html(
    <Layout title="학습" user={user}>
      <div id="review-root">
        {picked ? (
          <Fragment
            fsrsParams={user.fsrs_params}
            card={picked.card}
            stage={initialStage(picked.card)}
            prog={ctx.progress}
            plan={ctx.plan}
            wrapup={picked.wrapup}
            now={now}
          />
        ) : (
          <Done prog={ctx.progress} plan={ctx.plan} />
        )}
      </div>
    </Layout>
  );
});

/** 결과 화면에서 다음 카드로 */
review.post('/review/next', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const body = await c.req.parseBody();
  const source = parseSource(body['source']);

  const now = new Date();

  if (source === 'weak') {
    const ctx = await weakContext(c.env.DB, user, now);
    const next = await pickWeakNext(c.env.DB, user, ctx, now);

    return c.html(
      next ? (
        <Fragment
          fsrsParams={user.fsrs_params}
          card={next}
          stage={initialStage(next)}
          prog={ctx.prog}
          now={now}
          source="weak"
        />
      ) : (
        <WeakDone
          prog={ctx.prog}
          weakCount={ctx.report.all.length}
          weakDue={ctx.due}
          reviewLeft={ctx.reviewLeft}
        />
      )
    );
  }

  const ctx = await planContext(c.env.DB, user, now);
  const picked = await pickNext(c.env.DB, user, ctx.row, ctx.progress, now);

  return c.html(
    picked ? (
      <Fragment
        fsrsParams={user.fsrs_params}
        card={picked.card}
        stage={initialStage(picked.card)}
        prog={ctx.progress}
        plan={ctx.plan}
        wrapup={picked.wrapup}
        now={now}
        source={source}
      />
    ) : (
      <Done prog={ctx.progress} plan={ctx.plan} />
    )
  );
});

/** 신규 카드 소개 → 뜻 가리기 */
review.post('/review/:id/hide', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const card = await getCardForReview(c.env.DB, user.id, c.req.param('id'));
  if (!card) return c.text('카드를 찾을 수 없습니다.', 404);

  const body = await c.req.parseBody();
  const source = parseSource(body['source']);

  const now = new Date();
  const normalCtx = source === 'weak' ? null : await planContext(c.env.DB, user, now);
  const prog = normalCtx
    ? normalCtx.progress
    : (await weakContext(c.env.DB, user, now)).prog;

  return c.html(
    <Fragment
      fsrsParams={user.fsrs_params}
      card={card}
      stage="front"
      prog={prog}
      plan={normalCtx?.plan}
      now={now}
      source={source}
    />
  );
});

/** 앞면 → 뒷면(정답) */
review.post('/review/:id/reveal', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const card = await getCardForReview(c.env.DB, user.id, c.req.param('id'));
  if (!card) return c.text('카드를 찾을 수 없습니다.', 404);

  const body = await c.req.parseBody();
  const shownAt = typeof body['shown_at'] === 'string' ? body['shown_at'] : undefined;
  const source = parseSource(body['source']);

  const now = new Date();
  const responseMs = clampResponseMs(shownAt, now);
  const reviewKey = shownAt ? `${card.id}:${shownAt}` : null;
  const normalCtx = source === 'weak' ? null : await planContext(c.env.DB, user, now);
  const prog = normalCtx
    ? normalCtx.progress
    : (await weakContext(c.env.DB, user, now)).prog;

  return c.html(
    <Fragment
      fsrsParams={user.fsrs_params}
      card={card}
      stage="back"
      prog={prog}
      plan={normalCtx?.plan}
      now={now}
      responseMs={responseMs}
      reviewKey={reviewKey}
      source={source}
    />
  );
});

/** 한→영: 입력 채점 후 즉시 저장 */
review.post('/review/:id/answer', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const card = await getCardForReview(c.env.DB, user.id, c.req.param('id'));
  if (!card) return c.text('카드를 찾을 수 없습니다.', 404);
  if (
    card.card_type !== 'recall' &&
    card.card_type !== 'cloze' &&
    card.card_type !== 'listening'
  ) {
    return c.text('잘못된 요청입니다.', 400);
  }

  const body = await c.req.parseBody();
  // 듣기 카드의 "들리지 않아요"는 빈 답안으로 Again 처리한다.
  const answer = body['give_up'] ? '' : String(body['answer'] ?? '');
  const result = gradeAnswer(answer, card.term);
  const shownAt = typeof body['shown_at'] === 'string' ? body['shown_at'] : undefined;
  const source = parseSource(body['source']);

  const now = new Date();
  const today = localDate(now, user.tz_offset_min);
  const responseMs = clampResponseMs(shownAt, now);
  const reviewKey = shownAt ? `${card.id}:${shownAt}` : null;

  const saved = await saveReview(
    c.env.DB,
    user.id,
    card,
    (result.ok ? 3 : 1) as Grade,
    now,
    today,
    { answer, responseMs, source, reviewKey, fsrsParams: user.fsrs_params }
  );

  if (saved) {
    await afterSave(c.env.DB, user, card, saved, now);
    if (source === 'review') {
      await markPlanCompleted(c.env.DB, user, now);
    }
  }

  const normalCtx = source === 'weak' ? null : await planContext(c.env.DB, user, now);
  const prog = normalCtx
    ? normalCtx.progress
    : (await weakContext(c.env.DB, user, now)).prog;

  return c.html(
    <Fragment
      fsrsParams={user.fsrs_params}
      card={card}
      stage="result"
      prog={prog}
      plan={normalCtx?.plan}
      now={now}
      answer={answer}
      result={result}
      source={source}
    />
  );
});

/** 영→한: 평점 저장 → 다음 카드 */
review.post('/review/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const body = await c.req.parseBody();
  const rating = Number(body['rating']);

  if (![1, 2, 3, 4].includes(rating)) {
    return c.text('잘못된 평점입니다.', 400);
  }

  const card = await getCardForReview(c.env.DB, user.id, c.req.param('id'));
  if (!card) return c.text('카드를 찾을 수 없습니다.', 404);

  const now = new Date();
  const today = localDate(now, user.tz_offset_min);
  const requestedMs = Number(body['response_ms']);
  const responseMs = Number.isFinite(requestedMs) ? requestedMs : null;
  const source = parseSource(body['source']);
  const reviewKey =
    typeof body['review_key'] === 'string' ? body['review_key'] : null;

  const saved = await saveReview(c.env.DB, user.id, card, rating as Grade, now, today, {
    responseMs,
    source,
    reviewKey,
    fsrsParams: user.fsrs_params,
  });

  if (saved) {
    await afterSave(c.env.DB, user, card, saved, now);
    if (source === 'review') {
      await markPlanCompleted(c.env.DB, user, now);
    }
  }

  if (source === 'weak') {
    const ctx = await weakContext(c.env.DB, user, now);
    const next = await pickWeakNext(c.env.DB, user, ctx, now);

    return c.html(
      next ? (
        <Fragment
          fsrsParams={user.fsrs_params}
          card={next}
          stage={initialStage(next)}
          prog={ctx.prog}
          now={now}
          source="weak"
        />
      ) : (
        <WeakDone
          prog={ctx.prog}
          weakCount={ctx.report.all.length}
          weakDue={ctx.due}
          reviewLeft={ctx.reviewLeft}
        />
      )
    );
  }

  const ctx = await planContext(c.env.DB, user, now);
  const picked = await pickNext(c.env.DB, user, ctx.row, ctx.progress, now);

  return c.html(
    picked ? (
      <Fragment
        fsrsParams={user.fsrs_params}
        card={picked.card}
        stage={initialStage(picked.card)}
        prog={ctx.progress}
        plan={ctx.plan}
        wrapup={picked.wrapup}
        now={now}
        source={source}
      />
    ) : (
      <Done prog={ctx.progress} plan={ctx.plan} />
    )
  );
});

function parseSource(value: unknown): ReviewSource {
  return value === 'weak' ? 'weak' : 'review';
}

function initialStage(card: QueueCard): Stage {
  if (card.card_type !== 'recognition') return 'front';
  return card.reps === 0 ? 'intro' : 'front';
}

async function progressFor(db: D1Database, user: User, now: Date): Promise<Progress> {
  return getProgress(
    db,
    user.id,
    localDate(now, user.tz_offset_min),
    now.toISOString(),
    user.daily_new,
    user.daily_review
  );
}

type WeakContext = {
  report: WeaknessReport;
  ids: string[];
  due: number;
  done: number;
  reviewLeft: number;
  prog: Progress;
};

async function weakContext(
  db: D1Database,
  user: User,
  now: Date
): Promise<WeakContext> {
  const normal = await progressFor(db, user, now);
  const report = await listWeakness(db, user.id, now);
  const ids = weakWordIds(report);
  const today = localDate(now, user.tz_offset_min);

  const [due, done] = await Promise.all([
    countWeakDue(db, user.id, now.toISOString(), ids),
    countWeakDoneToday(db, user.id, today),
  ]);

  const remaining = Math.min(due, normal.reviewLeft);

  return {
    report,
    ids,
    due,
    done,
    reviewLeft: normal.reviewLeft,
    prog: {
      done,
      remaining,
      reviewLeft: normal.reviewLeft,
      promotedLeft: 0,
      newLeft: 0,
      reviewDone: 0,
      newDone: 0,
      dueReview: due,
      promotedDue: 0,
      newAvailable: 0,
    },
  };
}

async function pickWeakNext(
  db: D1Database,
  user: User,
  ctx: WeakContext,
  now: Date
): Promise<QueueCard | null> {
  if (ctx.reviewLeft <= 0) return null;
  return nextWeakDueReview(db, user.id, now.toISOString(), ctx.ids);
}

async function markPlanCompleted(
  db: D1Database,
  user: User,
  now: Date
): Promise<void> {
  try {
    await updatePlanCompletion(
      db,
      user.id,
      localDate(now, user.tz_offset_min),
      now
    );
  } catch (err) {
    // 계획 완료 표시 실패가 이미 저장된 리뷰 응답을 막지 않게 한다.
    console.error('updatePlanCompletion failed', err);
  }
}

async function afterSave(
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
    // 승급·격리 실패가 이미 저장된 리뷰를 되돌리거나 응답을 막지 않게 한다.
    console.error('post-review task failed', err);
  }
}

type PlanContext = {
  plan: TodayPlan;
  row: DailyPlanRow;
  progress: PlanProgress;
};

async function planContext(
  db: D1Database,
  user: User,
  now: Date
): Promise<PlanContext> {
  const result = await getTodayPlan(db, user, now, true);
  if (!result.row) throw new Error('오늘 계획을 만들 수 없습니다.');
  return { plan: result.plan, row: result.row, progress: result.progress };
}

async function pickNext(
  db: D1Database,
  user: User,
  plan: DailyPlanRow,
  progress: PlanProgress,
  now: Date
): Promise<{ card: QueueCard; wrapup: boolean } | null> {
  if (progress.remaining <= 0) {
    // 마무리: 계획 완료 후 최근 Again 카드를 최대 5장까지 한 번 더 꺼낸다.
    if (plan.completed_at) {
      const wrapupDone = await countReviewsSince(db, user.id, plan.completed_at);
      if (wrapupDone < 5) {
        const since = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
        const card = await nextWarmupCard(db, user.id, now.toISOString(), since);
        if (card) return { card, wrapup: true };
      }
    }
    return null;
  }

  // 워밍업: 계획 초반 5장은 최근 Again을 받은 due 카드를 먼저 보여준다.
  if (progress.done < 5) {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const warmup = await nextWarmupCard(db, user.id, now.toISOString(), since);
    if (warmup) return { card: warmup, wrapup: false };
  }

  // 복습 → 승급 → 신규. 복습 블록은 유형 비율을 맞춘다.
  if (progress.reviewLeft > 0) {
    const [dueCounts, servedCounts] = await Promise.all([
      countDueByType(db, user.id, now.toISOString()),
      servedByTypeSince(db, user.id, plan.created_at),
    ]);

    const ratios = user.listening_enabled
      ? { ...DEFAULT_REVIEW_RATIOS, listening: 0.1 }
      : DEFAULT_REVIEW_RATIOS;
    const type = selectNextType(ratios, dueCounts, servedCounts);
    if (type) {
      const card = await nextDueReviewByType(db, user.id, now.toISOString(), type);
      if (card) return { card, wrapup: false };
    }

    // 유형 선택이 실패하면(동시 처리 등) 아무 due 카드나 사용한다.
    const fallback = await nextDueReview(db, user.id, now.toISOString());
    if (fallback) return { card: fallback, wrapup: false };
  }

  if (progress.promotedLeft > 0) {
    const promoted = await nextPromotedCard(db, user.id, now.toISOString());
    if (promoted) return { card: promoted, wrapup: false };
  }

  if (progress.newLeft > 0) {
    const card = await nextNewCard(db, user.id);
    if (card) return { card, wrapup: false };
  }

  return null;
}

function Fragment(props: {
  card: QueueCard;
  stage: Stage;
  prog: { done: number; remaining: number };
  plan?: TodayPlan;
  wrapup?: boolean;
  fsrsParams?: number[] | null;
  now: Date;
  answer?: string;
  result?: GradeResult;
  responseMs?: number | null;
  reviewKey?: string | null;
  source?: ReviewSource;
}) {
  const total = props.prog.done + props.prog.remaining;
  const pct = total > 0 ? Math.round((props.prog.done / total) * 100) : 0;
  const source = props.source ?? 'review';

  return (
    <>
      {props.plan ? <PlanSummary plan={props.plan} /> : null}
      {props.wrapup ? (
        <p class="mb-2 text-xs font-medium text-accent">마무리 복습</p>
      ) : null}

      <div class="flex items-baseline justify-between text-sm text-muted">
        <span>{props.prog.done}장 완료</span>
        <span>{props.prog.remaining}장 남음</span>
      </div>
      <div class="mt-2 h-[3px] w-full bg-line">
        <div class="h-[3px] bg-accent transition-[width]" style={`width:${pct}%`}></div>
      </div>

      <div class="mt-10">{CardView({ ...props, source })}</div>
    </>
  );
}

function PlanSummary(props: { plan: TodayPlan }) {
  const reason = planReasonText(props.plan);

  return (
    <div class="mb-4 border-b border-line pb-3">
      <p class="text-xs leading-5 text-muted">
        오늘 계획: 복습 {props.plan.reviewTarget} · 승급 {props.plan.promotedTarget} · 신규{' '}
        {props.plan.effectiveNew}
        {props.plan.estimatedMinutes > 0 ? ` · 예상 ${props.plan.estimatedMinutes}분` : ''}
      </p>
      {reason ? <p class="mt-1 text-xs leading-5 text-muted">{reason}</p> : null}
    </div>
  );
}

function CardView(props: {
  card: QueueCard;
  stage: Stage;
  prog: { done: number; remaining: number };
  fsrsParams?: number[] | null;
  now: Date;
  answer?: string;
  result?: GradeResult;
  responseMs?: number | null;
  reviewKey?: string | null;
  source: ReviewSource;
}) {
  const type = props.card.card_type;
  const shownAt = props.now.toISOString();

  if (type === 'recall' || type === 'cloze' || type === 'listening') {
    if (props.stage === 'result') {
      return (
        <ProductionResult
          card={props.card}
          answer={props.answer ?? ''}
          result={props.result!}
          source={props.source}
        />
      );
    }
    if (type === 'listening') {
      return (
        <ListeningPrompt card={props.card} shownAt={shownAt} source={props.source} />
      );
    }
    return type === 'cloze' ? (
      <ClozePrompt card={props.card} shownAt={shownAt} source={props.source} />
    ) : (
      <RecallPrompt card={props.card} shownAt={shownAt} source={props.source} />
    );
  }

  return <RecognitionCard {...props} shownAt={shownAt} />;
}

function RecognitionCard(props: {
  card: QueueCard;
  stage: Stage;
  now: Date;
  shownAt: string;
  responseMs?: number | null;
  reviewKey?: string | null;
  fsrsParams?: number[] | null;
  source: ReviewSource;
}) {
  const { card, stage } = props;

  return (
    <article class="rounded-sm border border-line border-b-2 border-b-line bg-surface">
      <div class="px-6 py-12 text-center sm:px-10 sm:py-16">
        <p class="text-xs text-muted">
          {stage === 'intro' ? '새 단어' : stage === 'back' ? '정답' : '뜻을 떠올려 보세요'}
        </p>

        <p class="mt-4 font-word text-[2.5rem] leading-tight tracking-tight sm:text-[3rem]">
          {card.term}
        </p>

        {card.pronunciation ? (
          <p class="mt-1 text-sm text-muted">{card.pronunciation}</p>
        ) : null}

        <SpeakButton term={card.term} />
      </div>

      {stage === 'intro' ? <IntroBody card={card} source={props.source} /> : null}
      {stage === 'front' ? (
        <FrontBody card={card} shownAt={props.shownAt} source={props.source} />
      ) : null}
      {stage === 'back' ? (
        <BackBody
          card={card}
          now={props.now}
          responseMs={props.responseMs ?? null}
          reviewKey={props.reviewKey ?? null}
          fsrsParams={props.fsrsParams}
          source={props.source}
        />
      ) : null}
    </article>
  );
}

function RecallPrompt(props: { card: QueueCard; shownAt: string; source: ReviewSource }) {
  const blanked = blankOut(props.card.example, props.card.term);

  return (
    <article class="rounded-sm border border-line border-b-2 border-b-line bg-surface">
      <div class="px-6 py-12 text-center sm:px-10 sm:py-14">
        <p class="text-xs text-muted">뜻을 보고 영어로 쓰세요</p>
        <p class="mt-4 text-2xl leading-snug">{props.card.meaning}</p>

        {blanked ? <p class="mt-4 font-word text-sm leading-6 text-muted">{blanked}</p> : null}
      </div>

      <form
        hx-post={`/review/${props.card.id}/answer`}
        hx-target="#review-root"
        hx-swap="innerHTML"
        hx-disabled-elt="find button"
        class="border-t border-line px-6 py-6 sm:px-10"
      >
        <input type="hidden" name="shown_at" value={props.shownAt} />
        <input type="hidden" name="source" value={props.source} />
        <input
          name="answer"
          type="text"
          data-autofocus
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          placeholder="영어 단어"
          class="w-full rounded border border-line bg-surface px-3 py-3 text-center font-word text-lg placeholder:font-sans placeholder:text-sm placeholder:text-muted/70"
        />
        <button
          type="submit"
          class="mt-3 w-full rounded bg-accent px-4 py-3 text-sm font-medium text-white hover:opacity-90"
        >
          확인
        </button>
      </form>
    </article>
  );
}

function ClozePrompt(props: { card: QueueCard; shownAt: string; source: ReviewSource }) {
  const blanked = blankOut(props.card.example, props.card.term);

  return (
    <article class="rounded-sm border border-line border-b-2 border-b-line bg-surface">
      <div class="px-6 py-12 text-center sm:px-10 sm:py-14">
        <p class="text-xs text-muted">빈칸에 들어갈 단어를 쓰세요</p>

        {blanked ? (
          <BlankedSentence text={blanked} />
        ) : (
          <p class="mt-5 text-2xl leading-snug">{props.card.meaning}</p>
        )}

        <details class="mt-6 text-left sm:inline-block">
          <summary class="cursor-pointer text-xs text-muted underline-offset-4 hover:text-accent hover:underline">
            힌트: 뜻 보기
          </summary>
          <p class="mt-2 text-sm">{props.card.meaning}</p>
        </details>
      </div>

      <form
        hx-post={`/review/${props.card.id}/answer`}
        hx-target="#review-root"
        hx-swap="innerHTML"
        hx-disabled-elt="find button"
        class="border-t border-line px-6 py-6 sm:px-10"
      >
        <input type="hidden" name="shown_at" value={props.shownAt} />
        <input type="hidden" name="source" value={props.source} />
        <input
          name="answer"
          type="text"
          data-autofocus
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          placeholder="빈칸에 들어갈 단어"
          class="w-full rounded border border-line bg-surface px-3 py-3 text-center font-word text-lg placeholder:font-sans placeholder:text-sm placeholder:text-muted/70"
        />
        <button
          type="submit"
          class="mt-3 w-full rounded bg-accent px-4 py-3 text-sm font-medium text-white hover:opacity-90"
        >
          확인
        </button>
      </form>
    </article>
  );
}

function ListeningPrompt(props: {
  card: QueueCard;
  shownAt: string;
  source: ReviewSource;
}) {
  return (
    <article class="rounded-sm border border-line border-b-2 border-b-line bg-surface">
      <div class="px-6 py-12 text-center sm:px-10 sm:py-14">
        <p class="text-xs text-muted">듣고 철자를 입력하세요</p>

        <button
          type="button"
          data-speak={props.card.term}
          class="mt-6 inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent-soft px-6 py-4 text-base font-medium text-accent hover:opacity-90"
        >
          🔊 발음 듣기
        </button>
        <p class="mt-3 text-xs text-muted">다시 들으려면 버튼을 누르세요</p>

        <p data-tts-note hidden class="mt-3 text-sm leading-6 text-danger">
          이 기기에서는 듣기를 지원하지 않습니다. “들리지 않아요”로 정답을 확인하세요.
        </p>
      </div>

      <form
        hx-post={`/review/${props.card.id}/answer`}
        hx-target="#review-root"
        hx-swap="innerHTML"
        hx-disabled-elt="find button"
        class="border-t border-line px-6 py-6 sm:px-10"
      >
        <input type="hidden" name="shown_at" value={props.shownAt} />
        <input type="hidden" name="source" value={props.source} />
        <input
          name="answer"
          type="text"
          data-autofocus
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          placeholder="듣고 영어로 쓰세요"
          class="w-full rounded border border-line bg-surface px-3 py-3 text-center font-word text-lg placeholder:font-sans placeholder:text-sm placeholder:text-muted/70"
        />
        <button
          type="submit"
          class="mt-3 w-full rounded bg-accent px-4 py-3 text-sm font-medium text-white hover:opacity-90"
        >
          확인
        </button>
        <button
          type="submit"
          name="give_up"
          value="1"
          class="mt-2 w-full text-xs text-muted hover:text-danger"
        >
          들리지 않아요
        </button>
      </form>
    </article>
  );
}

function BlankedSentence(props: { text: string }) {
  const parts = props.text.split('____');

  return (
    <p class="mt-5 font-word text-xl leading-8 tracking-tight sm:text-2xl sm:leading-9">
      {parts.map((part, i) => (
        <>
          {part}
          {i < parts.length - 1 ? (
            <span class="mx-1 inline-block min-w-[3.5rem] border-b-2 border-accent/40 align-baseline">
              &nbsp;
            </span>
          ) : null}
        </>
      ))}
    </p>
  );
}

function ProductionResult(props: {
  card: QueueCard;
  answer: string;
  result: GradeResult;
  source: ReviewSource;
}) {
  const { card, result } = props;
  const chars = diffChars(props.answer, card.term);

  return (
    <article class="rounded-sm border border-line border-b-2 border-b-line bg-surface">
      <div class="px-6 py-10 text-center sm:px-10">
        {result.ok ? (
          <p class="text-sm font-medium text-accent">{result.typo ? '정답 (철자 확인)' : '정답'}</p>
        ) : (
          <p class="text-sm font-medium text-danger">오답</p>
        )}

        <p class="mt-4 font-word text-[2rem] leading-tight tracking-tight sm:text-[2.5rem]">
          {chars.map((c) => (
            <span class={c.ok ? '' : 'text-danger underline decoration-danger/40 underline-offset-4'}>
              {c.ch}
            </span>
          ))}
        </p>

        <SpeakButton term={card.term} />
      </div>

      <div class="border-t border-line px-6 py-6 sm:px-10">
        <p class="text-xs text-muted">내 답</p>
        <p class="mt-1 font-word text-[15px]">{props.answer.trim() || '(입력 없음)'}</p>

        <p class="mt-4 text-xs text-muted">뜻</p>
        <p class="mt-1">{card.meaning}</p>

        <div class="mt-4">
          <WordContext card={card} />
        </div>

        {card.note ? <Mnemonic note={card.note} /> : null}
      </div>

      <div class="border-t border-line px-6 py-5 sm:px-10">
        <button
          type="button"
          hx-post="/review/next"
          hx-vals={JSON.stringify({ source: props.source })}
          hx-target="#review-root"
          hx-swap="innerHTML"
          data-act="next"
          class="w-full rounded bg-accent px-4 py-3 text-sm font-medium text-white hover:opacity-90"
        >
          계속
        </button>
      </div>
    </article>
  );
}

function WordContext(props: { card: QueueCard; compact?: boolean }) {
  const extras = props.compact
    ? []
    : parseExtraExamples(props.card.extra_examples_raw).slice(0, 2);
  const collocations = props.compact ? [] : parseJsonList(props.card.collocations);
  const synonyms = props.compact ? [] : parseJsonList(props.card.synonyms);
  const antonyms = props.compact ? [] : parseJsonList(props.card.antonyms);
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
          <p class="mt-1 font-word text-[15px] leading-6">{props.card.example}</p>
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
                <p class="font-word text-[15px] leading-6">{example.sentence}</p>
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

function IntroBody(props: { card: QueueCard; source: ReviewSource }) {
  return (
    <>
      <div class="border-t border-line px-6 py-6 sm:px-10">
        <p class="text-xs text-muted">뜻</p>
        <p class="mt-1 text-lg">{props.card.meaning}</p>

        <div class="mt-5">
          <WordContext card={props.card} compact />
        </div>
      </div>

      <div class="border-t border-line px-6 py-5 sm:px-10">
        <button
          type="button"
          data-act="hide"
          hx-post={`/review/${props.card.id}/hide`}
          hx-vals={JSON.stringify({ source: props.source })}
          hx-target="#review-root"
          hx-swap="innerHTML"
          class="w-full rounded bg-accent px-4 py-3 text-sm font-medium text-white hover:opacity-90"
        >
          가리고 확인하기
        </button>
      </div>
    </>
  );
}

function FrontBody(props: { card: QueueCard; shownAt: string; source: ReviewSource }) {
  return (
    <div class="border-t border-line px-6 py-8 text-center sm:px-10">
      <button
        type="button"
        data-act="reveal"
        hx-post={`/review/${props.card.id}/reveal`}
        hx-vals={JSON.stringify({ shown_at: props.shownAt, source: props.source })}
        hx-target="#review-root"
        hx-swap="innerHTML"
        class="rounded border border-line px-6 py-3 text-sm font-medium hover:border-accent"
      >
        뜻 보기
      </button>
      <p class="mt-3 text-xs text-muted">Space</p>
    </div>
  );
}

function BackBody(props: {
  card: QueueCard;
  now: Date;
  responseMs: number | null;
  reviewKey: string | null;
  fsrsParams?: number[] | null;
  source: ReviewSource;
}) {
  const preview = previewIntervals(props.card, props.now, props.fsrsParams);
  const isNew = props.card.reps === 0;
  const easyVals: Record<string, unknown> = { rating: 4, source: props.source };
  if (props.responseMs != null) easyVals['response_ms'] = props.responseMs;
  if (props.reviewKey) easyVals['review_key'] = props.reviewKey;

  return (
    <>
      <div class="border-t border-line px-6 py-6 sm:px-10">
        <p class="text-lg">{props.card.meaning}</p>

        <div class="mt-5">
          <WordContext card={props.card} />
        </div>

        {props.card.note ? <Mnemonic note={props.card.note} /> : null}
      </div>

      <div class="border-t border-line px-6 py-5 sm:px-10">
        <p class="text-center text-sm font-medium">
          {isNew ? '방금 본 뜻이 기억나나요?' : '답을 보기 전에 뜻이 떠올랐나요?'}
        </p>
        <p class="mt-1 text-center text-xs leading-5 text-muted">
          {isNew
            ? '방금 본 뒤 바로 가렸을 때 기준입니다.'
            : '답을 본 뒤의 느낌이 아니라, 보기 전에 떠올린 기준입니다.'}
        </p>

        <div class={isNew ? 'mt-4 grid grid-cols-2 gap-2' : 'mt-4 grid grid-cols-3 gap-2'}>
          <RateButton
            cardId={props.card.id}
            rating={1}
            label="모름"
            preview={preview[1]}
            tone="again"
            responseMs={props.responseMs}
            reviewKey={props.reviewKey}
            source={props.source}
          />
          {isNew ? null : (
            <RateButton
              cardId={props.card.id}
              rating={2}
              label="늦게 떠오름"
              preview={preview[2]}
              tone="hard"
              responseMs={props.responseMs}
              reviewKey={props.reviewKey}
              source={props.source}
            />
          )}
          <RateButton
            cardId={props.card.id}
            rating={3}
            label="바로 떠오름"
            preview={preview[3]}
            tone="good"
            responseMs={props.responseMs}
            reviewKey={props.reviewKey}
            source={props.source}
          />
        </div>

        <button
          type="button"
          data-act="rate"
          data-rating="4"
          hx-post={`/review/${props.card.id}`}
          hx-vals={JSON.stringify(easyVals)}
          hx-target="#review-root"
          hx-swap="innerHTML"
          class="mt-3 w-full text-center text-xs text-muted underline-offset-4 hover:text-accent hover:underline"
        >
          아주 쉬웠어요 · 다음 복습 {preview[4]}
        </button>

        <p class="mt-2 text-center text-xs text-muted">{isNew ? '1 · 3 · 4' : '1 · 2 · 3 · 4'}</p>
      </div>
    </>
  );
}

function RateButton(props: {
  cardId: string;
  rating: number;
  label: string;
  preview: string;
  tone: 'again' | 'hard' | 'good';
  responseMs: number | null;
  reviewKey: string | null;
  source: ReviewSource;
}) {
  const tones: Record<string, string> = {
    again: 'border-danger/40 text-danger hover:bg-danger/5',
    hard: 'border-line text-muted hover:border-ink/30',
    good: 'border-accent bg-accent text-white hover:opacity-90',
  };

  const vals: Record<string, unknown> = { rating: props.rating, source: props.source };
  if (props.responseMs != null) vals['response_ms'] = props.responseMs;
  if (props.reviewKey) vals['review_key'] = props.reviewKey;

  return (
    <button
      type="button"
      data-act="rate"
      data-rating={String(props.rating)}
      hx-post={`/review/${props.cardId}`}
      hx-vals={JSON.stringify(vals)}
      hx-target="#review-root"
      hx-swap="innerHTML"
      class={`rounded border px-3 py-3 text-center transition-colors ${tones[props.tone]}`}
    >
      <span class="block text-sm font-medium leading-tight">{props.label}</span>
      <span class={`mt-0.5 block text-xs ${props.tone === 'good' ? 'text-white/70' : 'text-muted'}`}>
        {props.preview}
      </span>
    </button>
  );
}

function SpeakButton(props: { term: string }) {
  return (
    <button
      type="button"
      data-speak={props.term}
      class="mt-4 text-xs text-muted underline-offset-4 hover:text-accent hover:underline"
    >
      발음 듣기
    </button>
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

function WeakDone(props: {
  prog: { done: number; remaining: number };
  weakCount: number;
  weakDue: number;
  reviewLeft: number;
}) {
  const message =
    props.weakCount === 0
      ? '아직 취약 단어가 없습니다. 복습이 5회 이상 쌓이면 최근 정답률로 자동 분류됩니다.'
      : props.reviewLeft <= 0
        ? '오늘 복습 상한에 도달했습니다. 남은 취약 단어는 내일 복습합니다.'
        : props.weakDue === 0
          ? '오늘은 기한이 도래한 취약 단어가 없습니다. 내일 다시 확인하세요.'
          : '오늘 취약 단어 복습을 마쳤습니다.';

  return (
    <div class="mt-6 text-center">
      <p class="font-word text-3xl tracking-tight">취약 단어 연습</p>
      <p class="mt-4 text-sm leading-6 text-muted">{message}</p>
      <div class="mt-8 flex justify-center gap-2">
        <a
          href="/hard?tab=weak"
          class="rounded border border-line px-5 py-2.5 text-sm hover:border-accent"
        >
          취약 단어 목록
        </a>
        <a
          href="/"
          class="rounded border border-line px-5 py-2.5 text-sm hover:border-accent"
        >
          대시보드로
        </a>
      </div>
    </div>
  );
}

function Done(props: {
  prog: { done: number; remaining: number };
  plan?: TodayPlan;
}) {
  const remainingDue = props.plan
    ? Math.max(0, props.plan.dueCount - props.plan.reviewTarget)
    : 0;

  return (
    <div class="mt-6 text-center">
      <p class="font-word text-3xl tracking-tight">
        {props.plan?.completed ? '오늘 계획 완료' : '오늘은 다 했어요'}
      </p>
      <p class="mt-4 text-sm leading-6 text-muted">
        오늘 {props.prog.done}장을 복습했습니다.
      </p>
      {remainingDue > 0 ? (
        <p class="mt-2 text-sm leading-6 text-muted">
          복습 상한 때문에 남은 {remainingDue}장은 내일로 넘깁니다.
        </p>
      ) : null}
      <div class="mt-8 flex justify-center gap-2">
        <a
          href="/hard?tab=weak"
          class="rounded border border-line px-5 py-2.5 text-sm hover:border-accent"
        >
          취약 단어
        </a>
        <a
          href="/"
          class="rounded border border-line px-5 py-2.5 text-sm hover:border-accent"
        >
          대시보드로
        </a>
      </div>
    </div>
  );
}

export default review;
