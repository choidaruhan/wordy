import { Hono } from 'hono';
import type { Grade } from 'ts-fsrs';
import type { Env, User } from '../types';
import { Layout } from '../components/layout';
import { localDate } from '../lib/time';
import { previewIntervals, type CardRow } from '../lib/srs';
import { blankOut, diffChars, gradeAnswer, type GradeResult } from '../lib/grade';
import {
  getCardForReview,
  getProgress,
  maybeSuspendLeech,
  maybeUnlockCloze,
  maybeUnlockRecall,
  nextDueReview,
  nextNewCard,
  nextPromotedCard,
  saveReview,
  type Progress,
  type QueueCard,
} from '../db/review';

const review = new Hono<Env>();

type Stage = 'intro' | 'front' | 'back' | 'result';

review.get('/review', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const now = new Date();
  const prog = await progressFor(c.env.DB, user, now);
  const card = await pickNext(c.env.DB, user, prog, now);

  return c.html(
    <Layout title="학습" user={user}>
      <div id="review-root">
        {card ? <Fragment card={card} stage={initialStage(card)} prog={prog} now={now} /> : <Done prog={prog} />}
      </div>
    </Layout>
  );
});

/** 결과 화면에서 다음 카드로 */
review.post('/review/next', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const now = new Date();
  const prog = await progressFor(c.env.DB, user, now);
  const next = await pickNext(c.env.DB, user, prog, now);

  return c.html(
    next ? <Fragment card={next} stage={initialStage(next)} prog={prog} now={now} /> : <Done prog={prog} />
  );
});

/** 신규 카드 소개 → 뜻 가리기 */
review.post('/review/:id/hide', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const card = await getCardForReview(c.env.DB, user.id, c.req.param('id'));
  if (!card) return c.text('카드를 찾을 수 없습니다.', 404);

  const now = new Date();
  const prog = await progressFor(c.env.DB, user, now);

  return c.html(<Fragment card={card} stage="front" prog={prog} now={now} />);
});

/** 앞면 → 뒷면(정답) */
review.post('/review/:id/reveal', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const card = await getCardForReview(c.env.DB, user.id, c.req.param('id'));
  if (!card) return c.text('카드를 찾을 수 없습니다.', 404);

  const now = new Date();
  const prog = await progressFor(c.env.DB, user, now);

  return c.html(<Fragment card={card} stage="back" prog={prog} now={now} />);
});

/** 한→영: 입력 채점 후 즉시 저장 */
review.post('/review/:id/answer', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const card = await getCardForReview(c.env.DB, user.id, c.req.param('id'));
  if (!card) return c.text('카드를 찾을 수 없습니다.', 404);
  if (card.card_type !== 'recall' && card.card_type !== 'cloze') {
    return c.text('잘못된 요청입니다.', 400);
  }

  const body = await c.req.parseBody();
  const answer = String(body['answer'] ?? '');
  const result = gradeAnswer(answer, card.term);

  const now = new Date();
  const today = localDate(now, user.tz_offset_min);

  const saved = await saveReview(
    c.env.DB,
    user.id,
    card,
    (result.ok ? 3 : 1) as Grade,
    now,
    today
  );

  if (saved) {
    await maybeUnlockRecall(c.env.DB, user.id, card, saved, now);
    await maybeUnlockCloze(c.env.DB, user.id, card, saved, now);
    await maybeSuspendLeech(c.env.DB, user.id, card, saved);
  }

  const prog = await progressFor(c.env.DB, user, now);

  return c.html(
    <Fragment
      card={card}
      stage="result"
      prog={prog}
      now={now}
      answer={answer}
      result={result}
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

  const saved = await saveReview(c.env.DB, user.id, card, rating as Grade, now, today);

  if (saved) {
    await maybeUnlockRecall(c.env.DB, user.id, card, saved, now);
    await maybeUnlockCloze(c.env.DB, user.id, card, saved, now);
    await maybeSuspendLeech(c.env.DB, user.id, card, saved);
  }

  const prog = await progressFor(c.env.DB, user, now);
  const next = await pickNext(c.env.DB, user, prog, now);

  return c.html(
    next ? <Fragment card={next} stage={initialStage(next)} prog={prog} now={now} /> : <Done prog={prog} />
  );
});

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
    user.daily_new
  );
}

async function pickNext(
  db: D1Database,
  user: User,
  prog: Progress,
  now: Date
): Promise<QueueCard | null> {
  const due = await nextDueReview(db, user.id, now.toISOString());
  if (due) return due;

  // 승급된 카드(한→영 / 빈칸)는 신규 쿼터와 무관하게 먼저 보여준다
  const recall = await nextPromotedCard(db, user.id, now.toISOString());
  if (recall) return recall;

  if (prog.newLeft > 0) return nextNewCard(db, user.id);
  return null;
}

function Fragment(props: {
  card: QueueCard;
  stage: Stage;
  prog: Progress;
  now: Date;
  answer?: string;
  result?: GradeResult;
}) {
  const total = props.prog.done + props.prog.remaining;
  const pct = total > 0 ? Math.round((props.prog.done / total) * 100) : 0;

  return (
    <>
      <div class="flex items-baseline justify-between text-sm text-muted">
        <span>{props.prog.done}장 완료</span>
        <span>{props.prog.remaining}장 남음</span>
      </div>
      <div class="mt-2 h-[3px] w-full bg-line">
        <div class="h-[3px] bg-accent transition-[width]" style={`width:${pct}%`}></div>
      </div>

      <div class="mt-10">{CardView(props)}</div>
    </>
  );
}

function CardView(props: {
  card: QueueCard;
  stage: Stage;
  prog: Progress;
  now: Date;
  answer?: string;
  result?: GradeResult;
}) {
  const type = props.card.card_type;

  if (type === 'recall' || type === 'cloze') {
    if (props.stage === 'result') {
      return (
        <ProductionResult card={props.card} answer={props.answer ?? ''} result={props.result!} />
      );
    }
    return type === 'cloze' ? (
      <ClozePrompt card={props.card} />
    ) : (
      <RecallPrompt card={props.card} />
    );
  }

  return <RecognitionCard {...props} />;
}

function RecognitionCard(props: { card: QueueCard; stage: Stage; now: Date }) {
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

        <SpeakButton term={card.term} />
      </div>

      {stage === 'intro' ? <IntroBody card={card} /> : null}
      {stage === 'front' ? <FrontBody card={card} /> : null}
      {stage === 'back' ? <BackBody card={card} now={props.now} /> : null}
    </article>
  );
}

function RecallPrompt(props: { card: QueueCard }) {
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

function ClozePrompt(props: { card: QueueCard }) {
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

function ProductionResult(props: { card: QueueCard; answer: string; result: GradeResult }) {
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

        {card.example ? (
          <div class="mt-4">
            <p class="font-word text-[15px] leading-6">{card.example}</p>
            {card.example_ko ? (
              <p class="mt-1 text-sm leading-6 text-muted">{card.example_ko}</p>
            ) : null}
          </div>
        ) : null}

        {card.note ? <Mnemonic note={card.note} /> : null}
      </div>

      <div class="border-t border-line px-6 py-5 sm:px-10">
        <button
          type="button"
          hx-post="/review/next"
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

function IntroBody(props: { card: QueueCard }) {
  return (
    <>
      <div class="border-t border-line px-6 py-6 sm:px-10">
        <p class="text-xs text-muted">뜻</p>
        <p class="mt-1 text-lg">{props.card.meaning}</p>

        {props.card.example ? (
          <div class="mt-5">
            <p class="text-xs text-muted">예문</p>
            <p class="mt-1 font-word text-[15px] leading-6">{props.card.example}</p>
            {props.card.example_ko ? (
              <p class="mt-1 text-sm leading-6 text-muted">{props.card.example_ko}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div class="border-t border-line px-6 py-5 sm:px-10">
        <button
          type="button"
          data-act="hide"
          hx-post={`/review/${props.card.id}/hide`}
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

function FrontBody(props: { card: QueueCard }) {
  return (
    <div class="border-t border-line px-6 py-8 text-center sm:px-10">
      <button
        type="button"
        data-act="reveal"
        hx-post={`/review/${props.card.id}/reveal`}
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

function BackBody(props: { card: QueueCard; now: Date }) {
  const preview = previewIntervals(props.card, props.now);
  const isNew = props.card.reps === 0;

  return (
    <>
      <div class="border-t border-line px-6 py-6 sm:px-10">
        <p class="text-lg">{props.card.meaning}</p>

        {props.card.example ? (
          <div class="mt-5">
            <p class="font-word text-[15px] leading-6">{props.card.example}</p>
            {props.card.example_ko ? (
              <p class="mt-1 text-sm leading-6 text-muted">{props.card.example_ko}</p>
            ) : null}
          </div>
        ) : null}

        {props.card.note ? <Mnemonic note={props.card.note} /> : null}
      </div>

      <div class="border-t border-line px-6 py-5 sm:px-10">
        <div class={isNew ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2 sm:grid-cols-4'}>
          <RateButton cardId={props.card.id} rating={1} label="다시" preview={preview[1]} tone="again" />
          {isNew ? null : (
            <RateButton cardId={props.card.id} rating={2} label="어려움" preview={preview[2]} tone="hard" />
          )}
          <RateButton cardId={props.card.id} rating={3} label="알맞음" preview={preview[3]} tone="good" />
          <RateButton cardId={props.card.id} rating={4} label="쉬움" preview={preview[4]} tone="easy" />
        </div>
        <p class="mt-3 text-center text-xs text-muted">{isNew ? '1 · 3 · 4' : '1 · 2 · 3 · 4'}</p>
      </div>
    </>
  );
}

function RateButton(props: {
  cardId: string;
  rating: number;
  label: string;
  preview: string;
  tone: 'again' | 'hard' | 'good' | 'easy';
}) {
  const tones: Record<string, string> = {
    again: 'border-danger/40 text-danger hover:bg-danger/5',
    hard: 'border-line text-muted hover:border-ink/30',
    good: 'border-accent bg-accent text-white hover:opacity-90',
    easy: 'border-accent/40 text-accent hover:bg-accent-soft',
  };

  return (
    <button
      type="button"
      data-act="rate"
      data-rating={String(props.rating)}
      hx-post={`/review/${props.cardId}`}
      hx-vals={JSON.stringify({ rating: props.rating })}
      hx-target="#review-root"
      hx-swap="innerHTML"
      class={`rounded border px-3 py-3 text-center transition-colors ${tones[props.tone]}`}
    >
      <span class="block text-sm font-medium">{props.label}</span>
      <span class={`block text-xs ${props.tone === 'good' ? 'text-white/70' : 'text-muted'}`}>
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

function Done(props: { prog: Progress }) {
  return (
    <div class="mt-6 text-center">
      <p class="font-word text-3xl tracking-tight">오늘은 다 했어요</p>
      <p class="mt-4 text-sm leading-6 text-muted">
        오늘 {props.prog.done}장을 복습했습니다. 남은 카드는 없습니다.
      </p>
      <a
        href="/"
        class="mt-8 inline-block rounded border border-line px-6 py-3 text-sm hover:border-accent"
      >
        대시보드로
      </a>
    </div>
  );
}

export default review;
