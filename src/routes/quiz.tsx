import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout } from '../components/layout';
import {
  abandonQuiz,
  answerQuestion,
  countAnswered,
  createQuiz,
  getActiveSession,
  getNextQuestion,
  getResult,
  getSession,
  type QuizQuestion,
  type QuizResult,
  type QuizSession,
} from '../db/quiz';

const quiz = new Hono<Env>();

quiz.get('/quiz', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const active = await getActiveSession(c.env.DB, user.id);
  const error = c.req.query('error');

  return c.html(
    <Layout title="객관식 테스트" user={user}>
      <h1 class="text-2xl font-extrabold tracking-tight">객관식 테스트</h1>
      <p class="mt-2 max-w-xl text-sm leading-6 text-muted">
        지금 얼마나 기억하는지 확인합니다. 결과는 학습 일정에 영향을 주지 않습니다.
      </p>

      {error === 'words' ? (
        <p class="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          단어가 4개 이상 있어야 테스트를 만들 수 있습니다.
        </p>
      ) : null}

      {active ? (
        <div class="mt-6 border border-line bg-surface px-4 py-3 text-sm">
          <p>진행 중인 테스트가 있습니다.</p>
          <a href="/quiz/session" class="mt-2 inline-block text-accent-text hover:underline">
            이어서 하기
          </a>
        </div>
      ) : null}

      <form method="post" action="/quiz/start" class="mt-8 border-t border-line pt-6">
        <p class="text-sm font-medium">문제 수</p>
        <div class="mt-3 flex gap-2">
          <label class="flex-1 cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
            <input type="radio" name="count" value="10" checked class="sr-only" />
            10문제
          </label>
          <label class="flex-1 cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
            <input type="radio" name="count" value="20" class="sr-only" />
            20문제
          </label>
        </div>

        <button
          type="submit"
          class="mt-6 w-full rounded-xl bg-accent shadow-brand px-5 py-3 text-sm font-medium text-white hover:bg-accent-strong"
        >
          테스트 시작
        </button>
      </form>
    </Layout>
  );
});

quiz.post('/quiz/start', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const body = await c.req.parseBody();
  const count = Number(body['count']) === 20 ? 20 : 10;

  const sessionId = await createQuiz(c.env.DB, user.id, count);
  if (!sessionId) return c.redirect('/quiz?error=words');

  return c.redirect('/quiz/session');
});

quiz.post('/quiz/abandon', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  await abandonQuiz(c.env.DB, user.id);
  return c.redirect('/quiz');
});

/** 틀린 단어만 모아 새 테스트를 만든다. */
quiz.post('/quiz/retry', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const body = await c.req.parseBody();
  const sessionId = String(body['sessionId'] ?? '');
  const session = await getSession(c.env.DB, user.id, sessionId);
  if (!session) return c.text('세션을 찾을 수 없습니다.', 404);

  const result = await getResult(c.env.DB, session.id);
  const wordIds = result.wrong.map((word) => word.wordId);
  if (wordIds.length === 0) return c.redirect('/quiz');

  const retryId = await createQuiz(c.env.DB, user.id, wordIds.length, wordIds);
  if (!retryId) return c.redirect('/quiz?error=words');

  return c.redirect('/quiz/session');
});

quiz.get('/quiz/session', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const session = await getActiveSession(c.env.DB, user.id);
  if (!session) return c.redirect('/quiz');

  const content = await contentFor(c.env.DB, session);

  return c.html(
    <Layout title="테스트" user={user} hideNav>
      <div id="quiz-root">{content}</div>
    </Layout>
  );
});

quiz.post('/quiz/answer', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const body = await c.req.parseBody();
  const questionId = String(body['questionId'] ?? '');
  const choice = Number(body['choice']);

  if (!questionId || !Number.isInteger(choice)) {
    return c.text('잘못된 요청입니다.', 400);
  }

  const answered = await answerQuestion(c.env.DB, user.id, questionId, choice);

  // 이미 처리된 문제면 조용히 다음 화면으로 넘긴다
  if (!answered) {
    const active = await getActiveSession(c.env.DB, user.id);
    if (!active) return c.redirect('/quiz');
    return c.html(await contentFor(c.env.DB, active));
  }

  const session = await getSession(c.env.DB, user.id, answered.question.session_id);
  if (!session) return c.text('세션을 찾을 수 없습니다.', 404);

  const done = await countAnswered(c.env.DB, session.id);

  return c.html(
    <Feedback
      question={answered.question}
      correct={answered.correct}
      chosenIndex={choice}
      session={session}
      done={done}
    />
  );
});

quiz.post('/quiz/next', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const body = await c.req.parseBody();
  const sessionId = String(body['sessionId'] ?? '');
  const session = await getSession(c.env.DB, user.id, sessionId);
  if (!session) return c.text('세션을 찾을 수 없습니다.', 404);

  return c.html(await contentFor(c.env.DB, session));
});

async function contentFor(db: D1Database, session: QuizSession): Promise<any> {
  if (session.completed_at) {
    return (
      <ResultView result={await getResult(db, session.id)} sessionId={session.id} />
    );
  }

  const question = await getNextQuestion(db, session.id);
  if (!question) {
    return (
      <ResultView result={await getResult(db, session.id)} sessionId={session.id} />
    );
  }

  const done = await countAnswered(db, session.id);
  return <QuestionView question={question} session={session} done={done} />;
}

function Progress(props: {
  current: number;
  answered: number;
  total: number;
  correct: number;
  sessionId: string;
}) {
  const pct =
    props.total > 0 ? Math.round((props.answered / props.total) * 100) : 0;

  return (
    <>
      <div class="flex items-baseline justify-between gap-3 text-sm text-muted">
        <span>
          {props.current} / {props.total}
        </span>
        <span class="flex items-baseline gap-3">
          <span>{props.correct}개 정답</span>
          <form
            method="post"
            action="/quiz/abandon"
            onsubmit="return confirm('테스트를 그만둘까요? 지금까지의 응답은 결과에 남지 않습니다.')"
          >
            <button type="submit" class="text-xs text-muted hover:text-danger">
              그만두기
            </button>
          </form>
        </span>
      </div>
      <div
        class="mt-2 h-1 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-label="테스트 진행률"
        aria-valuemin={0}
        aria-valuemax={props.total}
        aria-valuenow={props.answered}
      >
        <div class="h-1 rounded-full bg-accent" style={`width:${pct}%`}></div>
      </div>
    </>
  );
}

function QuestionView(props: { question: QuizQuestion; session: QuizSession; done: number }) {
  const current = Math.min(props.done + 1, props.session.total);

  return (
    <>
      <Progress
        current={current}
        answered={props.done}
        total={props.session.total}
        correct={props.session.correct}
        sessionId={props.session.id}
      />

      <article class="mt-8 rounded-2xl border border-line bg-surface shadow-card">
        <div class="px-6 py-10 text-center sm:px-10 sm:py-14">
          <p class="text-xs text-muted">이 단어의 뜻은?</p>
          <p class="mt-3 font-word text-4xl leading-tight tracking-tight sm:text-5xl">
            {props.question.term}
          </p>
        </div>
      </article>

      <div class="mt-4 space-y-2">
        {props.question.options.map((option, index) => (
          <button
            type="button"
            data-choice={String(index + 1)}
            data-qid={props.question.id}
            hx-post="/quiz/answer"
            hx-vals={JSON.stringify({ questionId: props.question.id, choice: index })}
            hx-target="#quiz-root"
            hx-swap="innerHTML"
            hx-disabled-elt=".quiz-option"
            class="quiz-option flex w-full items-baseline gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm hover:border-accent-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span class="text-xs text-muted">{index + 1}</span>
            <span>{option}</span>
          </button>
        ))}
      </div>

      <p class="mt-3 text-center text-xs text-muted">1 · 2 · 3 · 4</p>
    </>
  );
}

function Feedback(props: {
  question: QuizQuestion;
  correct: boolean;
  chosenIndex: number;
  session: QuizSession;
  done: number;
}) {
  const current = Math.min(props.done, props.session.total);

  return (
    <>
      <Progress
        current={current}
        answered={props.done}
        total={props.session.total}
        correct={props.session.correct}
        sessionId={props.session.id}
      />

      <article
        aria-live="polite"
        class="mt-8 rounded-2xl border border-line bg-surface shadow-card"
      >
        <div class="px-6 py-10 text-center sm:px-10">
          <p class={`text-sm font-bold ${props.correct ? 'text-success' : 'text-danger'}`}>
            {props.correct ? '정답' : '오답'}
          </p>
          <p class="mt-3 font-word text-3xl leading-tight tracking-tight sm:text-4xl">
            {props.question.term}
          </p>
          <p class="mt-3 text-lg">{props.question.meaning}</p>
        </div>

        <div class="space-y-2 border-t border-line px-6 py-5 sm:px-10">
          {props.question.options.map((option, index) => {
            const isAnswer = index === props.question.answer_index;
            const isChosen = index === props.chosenIndex;
            const tone = isAnswer
              ? 'border-success/50 bg-success-soft text-success'
              : isChosen
                ? 'border-danger/40 bg-danger-soft text-danger'
                : 'border-line bg-surface text-muted';

            return (
              <div
                class={`flex items-baseline justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${tone}`}
              >
                <span class="flex min-w-0 items-baseline gap-3">
                  <span class="shrink-0 text-xs opacity-70">{index + 1}</span>
                  <span class={isAnswer || isChosen ? 'font-semibold' : ''}>
                    {option}
                  </span>
                </span>
                {isAnswer ? (
                  <span class="shrink-0 text-xs font-bold">정답</span>
                ) : isChosen ? (
                  <span class="shrink-0 text-xs font-bold">내 답</span>
                ) : null}
              </div>
            );
          })}
        </div>

        <div class="border-t border-line px-6 py-5 sm:px-10">
          <button
            type="button"
            data-act="quiz-next"
            hx-post="/quiz/next"
            hx-vals={JSON.stringify({ sessionId: props.session.id })}
            hx-target="#quiz-root"
            hx-swap="innerHTML"
            class="w-full rounded-xl bg-accent shadow-brand px-4 py-3 text-sm font-medium text-white hover:bg-accent-strong"
          >
            다음
          </button>
        </div>
      </article>
    </>
  );
}

function ResultView(props: { result: QuizResult; sessionId: string }) {
  const pct =
    props.result.total > 0 ? Math.round((props.result.correct / props.result.total) * 100) : 0;

  return (
    <div class="mt-2">
      <p class="text-xs text-muted">결과</p>
      <p class="mt-2 font-word text-5xl tracking-tight">
        {props.result.correct}
        <span class="ml-1 text-xl text-muted">/ {props.result.total}</span>
      </p>
      <p class="mt-2 text-sm text-muted">정답률 {pct}%</p>

      {props.result.wrong.length > 0 ? (
        <section class="mt-8 border-t border-line pt-5">
          <h2 class="text-base font-extrabold tracking-tight">틀린 단어 {props.result.wrong.length}개</h2>
          <ul class="mt-3 space-y-3">
            {props.result.wrong.map((w) => (
              <li class="text-sm">
                <span class="font-word text-base">{w.term}</span>
                <span class="ml-2 text-muted">{w.meaning}</span>
                {w.chosen ? (
                  <span class="ml-2 text-xs text-danger">내 답: {w.chosen}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p class="mt-8 border-t border-line pt-5 text-sm text-muted">전부 맞혔습니다.</p>
      )}

      <div class="mt-8 flex flex-wrap gap-2">
        {props.result.wrong.length > 0 ? (
          <form method="post" action="/quiz/retry">
            <input type="hidden" name="sessionId" value={props.sessionId} />
            <button
              type="submit"
              class="rounded-xl bg-accent px-5 py-3 text-sm font-bold text-white shadow-brand hover:bg-accent-strong"
            >
              틀린 것만 다시
            </button>
          </form>
        ) : null}
        <a
          href="/quiz"
          class="rounded-xl border border-line px-5 py-3 text-sm hover:border-accent-text"
        >
          새 테스트
        </a>
        <a
          href="/"
          class="rounded-xl border border-line px-5 py-3 text-sm hover:border-accent-text"
        >
          홈으로
        </a>
      </div>
    </div>
  );
}

export default quiz;
