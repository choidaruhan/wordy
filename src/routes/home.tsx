import { Hono } from 'hono';
import type { Env, Stats, User } from '../types';
import { Layout } from '../components/layout';
import { getStats, listDecks } from '../db/queries';

const home = new Hono<Env>();

home.get('/', async (c) => {
  const user = c.get('user');

  if (!user) {
    return c.html(
      <Layout title="Wordy" user={null}>
        <section class="pt-6">
          <h1 class="font-word text-[2.6rem] leading-[1.2] tracking-tight">
            뜻을 가리고,
            <br />
            꺼내 보세요.
          </h1>
          <p class="mt-6 max-w-[34rem] text-[15px] leading-7 text-muted">
            단어장을 다시 읽는 것은 공부가 아닙니다. 기억에서 꺼내는 순간에만 남습니다.
            하루 10분, 오늘 볼 카드만큼만.
          </p>
          <a
            href="/login"
            class="mt-8 inline-block rounded bg-accent px-6 py-3 text-sm font-medium text-white hover:opacity-90"
          >
            시작하기
          </a>
        </section>

        <section class="mt-16 border-t border-line pt-8">
          <dl class="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div>
              <dt class="text-sm font-medium">꺼내는 연습</dt>
              <dd class="mt-1 text-sm leading-6 text-muted">
                뜻을 먼저 가리고 스스로 답하게 합니다.
              </dd>
            </div>
            <div>
              <dt class="text-sm font-medium">잊을 때쯤 다시</dt>
              <dd class="mt-1 text-sm leading-6 text-muted">
                FSRS가 카드마다 다음 복습일을 정합니다.
              </dd>
            </div>
            <div>
              <dt class="text-sm font-medium">한→영까지</dt>
              <dd class="mt-1 text-sm leading-6 text-muted">
                뜻을 아는 단계에서 쓸 수 있는 단계로 넘어갑니다.
              </dd>
            </div>
          </dl>
        </section>
      </Layout>
    );
  }

  const [stats, decks] = await Promise.all([
    getStats(c.env.DB, user.id),
    listDecks(c.env.DB, user.id),
  ]);

  return c.html(
    <Dashboard user={user} name={user.display_name ?? user.email} stats={stats} decks={decks} />
  );
});

function Dashboard(props: {
  user: User;
  name: string;
  stats: Stats;
  decks: { id: string; name: string; word_count: number }[];
}) {
  return (
    <Layout title="오늘" user={props.user}>
      <p class="text-sm text-muted">{props.name}</p>

      <section class="mt-6 border border-line border-b-2 border-b-line bg-surface px-6 py-8">
        <p class="text-xs text-muted">오늘 볼 카드</p>
        <p class="mt-2 font-word text-5xl tracking-tight">
          {props.stats.due}
          <span class="ml-1 text-lg text-muted">장</span>
        </p>

        {props.stats.due > 0 ? (
          <a
            href="/review"
            class="mt-6 inline-block rounded bg-accent px-6 py-3 text-sm font-medium text-white hover:opacity-90"
          >
            학습 시작
          </a>
        ) : (
          <p class="mt-6 text-sm text-muted">오늘 몫은 다 했습니다.</p>
        )}
      </section>

      <dl class="mt-8 grid grid-cols-3 gap-px border border-line bg-line">
        <Stat label="전체 단어" value={props.stats.total} />
        <Stat label="단어장" value={props.stats.decks} />
        <Stat label="외운 단어" value={props.stats.learned} />
      </dl>

      {props.stats.hard > 0 ? (
        <a
          href="/hard"
          class="mt-4 flex items-baseline justify-between border border-line bg-surface px-4 py-3 text-sm hover:border-accent"
        >
          <span>어려운 단어</span>
          <span class="text-muted">{props.stats.hard}개 · 연상법 적기</span>
        </a>
      ) : null}

      <a
        href="/quiz"
        class="mt-4 flex items-baseline justify-between border border-line bg-surface px-4 py-3 text-sm hover:border-accent"
      >
        <span>객관식 테스트</span>
        <span class="text-muted">지금 기억 확인</span>
      </a>

      <div class="mt-10 flex items-baseline justify-between">
        <h2 class="text-sm font-semibold">단어장</h2>
        <a href="/decks" class="text-sm text-accent hover:underline">
          관리
        </a>
      </div>

      {props.decks.length === 0 ? (
        <p class="mt-3 border-t border-line pt-4 text-sm leading-6 text-muted">
          아직 단어장이 없습니다.{' '}
          <a href="/decks" class="text-accent hover:underline">
            기본 단어 1,000개로 시작하기
          </a>
        </p>
      ) : (
        <ul class="mt-1">
          {props.decks.map((d) => (
            <li class="flex items-baseline justify-between border-b border-line py-3">
              <a href={`/decks/${d.id}`} class="text-[15px] hover:text-accent">
                {d.name}
              </a>
              <span class="text-sm text-muted">{d.word_count}개</span>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
}

function Stat(props: { label: string; value: number }) {
  return (
    <div class="bg-surface px-4 py-5">
      <dt class="text-xs text-muted">{props.label}</dt>
      <dd class="mt-1 font-word text-2xl">{props.value}</dd>
    </div>
  );
}

export default home;
