import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout } from '../components/layout';
import {
  countVocab,
  getVocabById,
  randomQuizCard,
  type QuizCard,
} from '../db/vocab';

const quiz = new Hono<Env>();

function readIndex(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(999_999, Math.trunc(n)) : 1;
}

function Empty(props: { words: number }) {
  return (
    <div class="rounded-3xl border border-line bg-surface p-8 text-center shadow-card">
      <p class="text-4xl">📝</p>
      <h1 class="mt-4 text-xl font-extrabold tracking-tight">
        {props.words === 0 ? '단어를 먼저 등록하세요' : '단어가 하나 더 필요해요'}
      </h1>
      <p class="mt-2 text-sm leading-6 text-muted">
        {props.words === 0
          ? '영어 단어와 뜻, 두 칸만 입력하면 끝입니다.'
          : '보기를 만들려면 뜻이 다른 단어가 최소 2개 있어야 합니다.'}
      </p>
      <a
        href="/words"
        class="mt-6 inline-flex rounded-2xl bg-accent px-5 py-3 text-sm font-bold text-white shadow-brand hover:bg-accent-strong"
      >
        단어 등록하기
      </a>
    </div>
  );
}

function Question(props: { card: QuizCard; index: number }) {
  return (
    <div>
      <div class="flex items-baseline justify-between">
        <p class="text-xs font-bold tracking-widest text-accent-text uppercase">
          Quiz
        </p>
        <p class="text-xs font-semibold text-muted">{props.index}번째</p>
      </div>

      <div class="mt-4 rounded-3xl border border-line bg-surface px-5 py-12 text-center shadow-card">
        <p class="text-xs font-semibold text-muted">뜻을 고르세요</p>
        <p class="font-word mt-3 text-4xl leading-tight break-words sm:text-5xl">
          {props.card.term}
        </p>
      </div>

      <div class="mt-4 grid gap-2">
        {props.card.choices.map((choice, i) => (
          <button
            type="button"
            data-choice={i + 1}
            hx-post="/quiz/answer"
            hx-vals={JSON.stringify({
              word_id: props.card.id,
              choice,
              n: props.index,
            })}
            hx-target="#quiz"
            hx-swap="innerHTML"
            class="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left text-sm font-semibold shadow-card hover:border-accent-text hover:bg-accent-soft/40"
          >
            <span class="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-paper text-xs font-bold text-muted">
              {i + 1}
            </span>
            <span class="min-w-0">{choice}</span>
          </button>
        ))}
      </div>

      <p class="mt-4 text-center text-xs text-muted">
        키보드 1~4로 선택
      </p>
    </div>
  );
}

function Feedback(props: {
  card: { id: string; term: string; meaning: string };
  choice: string;
  correct: boolean;
  index: number;
}) {
  return (
    <div>
      <div
        class={
          props.correct
            ? 'rounded-3xl border border-success/30 bg-success-soft p-6 text-center'
            : 'rounded-3xl border border-danger/30 bg-danger-soft p-6 text-center'
        }
      >
        <p
          class={
            props.correct
              ? 'text-sm font-extrabold text-success'
              : 'text-sm font-extrabold text-danger'
          }
        >
          {props.correct ? '정답' : '아쉬워요'}
        </p>
        <p class="font-word mt-3 text-3xl break-words">{props.card.term}</p>
        <p class="mt-2 text-lg font-bold break-words">{props.card.meaning}</p>
        {!props.correct ? (
          <p class="mt-3 text-xs text-muted">내 답: {props.choice}</p>
        ) : null}
      </div>

      <button
        type="button"
        data-next
        autofocus
        hx-post="/quiz/next"
        hx-vals={JSON.stringify({ n: props.index + 1, not: props.card.id })}
        hx-target="#quiz"
        hx-swap="innerHTML"
        class="mt-4 w-full rounded-2xl bg-accent px-5 py-3.5 text-sm font-bold text-white shadow-brand hover:bg-accent-strong"
      >
        다음
        <span class="ml-2 text-xs font-normal text-white/70">Enter</span>
      </button>
    </div>
  );
}

quiz.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const [counts, card] = await Promise.all([
    countVocab(c.env.DB, user.id),
    randomQuizCard(c.env.DB, user.id),
  ]);

  return c.html(
    <Layout title="퀴즈" user={user} active="quiz">
      <div id="quiz">
        {card ? (
          <Question card={card} index={1} />
        ) : (
          <Empty words={counts.words} />
        )}
      </div>
    </Layout>
  );
});

quiz.post('/quiz/answer', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const body = await c.req.parseBody();
  const wordId = typeof body['word_id'] === 'string' ? body['word_id'] : '';
  const choice = typeof body['choice'] === 'string' ? body['choice'] : '';
  const index = readIndex(body['n']);

  if (!wordId || !choice) {
    return c.text('잘못된 요청입니다.', 400);
  }

  const word = await getVocabById(c.env.DB, user.id, wordId);
  if (!word) {
    return c.text('단어를 찾을 수 없습니다.', 404);
  }

  return c.html(
    <Feedback
      card={word}
      choice={choice}
      correct={choice === word.meaning}
      index={index}
    />
  );
});

quiz.post('/quiz/next', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const body = await c.req.parseBody();
  const index = readIndex(body['n']);
  const exclude = typeof body['not'] === 'string' ? body['not'] : null;

  const [counts, card] = await Promise.all([
    countVocab(c.env.DB, user.id),
    randomQuizCard(c.env.DB, user.id, exclude),
  ]);

  return c.html(
    card ? <Question card={card} index={index} /> : <Empty words={counts.words} />
  );
});

export default quiz;
