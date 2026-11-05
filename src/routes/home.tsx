import { Hono } from 'hono';
import type { Env, User } from '../types';
import { Layout } from '../components/layout';
import { listDecks } from '../db/queries';
import { getPlayPoolCounts, type PlayPoolCounts } from '../db/play';
import { streak } from '../db/stats';
import { localDate } from '../lib/time';

const home = new Hono<Env>();

type IconName = 'check' | 'flame' | 'chevron';

function Icon(props: { name: IconName }) {
  if (props.name === 'check') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="m5 12 5 5L20 7" />
      </svg>
    );
  }
  if (props.name === 'flame') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="M12 22c4 0 7-2.7 7-6.5 0-3-1.8-5-3.5-6.8C13.8 6.9 13 5 13 2c-2.8 1.2-4.5 3.8-4.5 6.2 0 1.2.4 2.2 1 3.1-.9.2-1.7-.2-2.3-.9C6.3 11.8 5 13.4 5 15.5 5 19.3 8 22 12 22Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

home.get('/', async (c) => {
  const user = c.get('user');

  if (!user) {
    return c.html(
      <Layout
        title="Wordy"
        user={null}
        description="다시 읽는 것은 공부가 아닙니다. 기억에서 꺼내는 순간에만 남습니다. 하루 10분, 오늘 볼 카드만큼만."
      >
        <section class="pt-4 text-center">
          <div class="relative mx-auto h-12 w-14">
            <div class="absolute top-1 left-1 h-9 w-12 -rotate-12 rounded-tl-2xl rounded-tr-lg rounded-br-2xl rounded-bl-lg bg-accent opacity-80"></div>
            <div class="absolute top-1 left-1 h-9 w-12 rotate-6 rounded-tl-lg rounded-tr-2xl rounded-br-lg rounded-bl-2xl bg-accent shadow-brand"></div>
            <span class="absolute inset-0 grid place-items-center text-sm font-extrabold text-white">W</span>
          </div>

          <h1 class="mt-5 text-4xl leading-tight font-extrabold tracking-tight break-keep sm:text-5xl">
            외우지 말고,
            <br />
            꺼내세요.
          </h1>
          <p class="mx-auto mt-4 max-w-md text-base leading-7 text-muted">
            다시 읽는 것은 공부가 아닙니다. 기억에서 꺼내는 순간에만 남습니다.
            하루 10분, 오늘 볼 카드만큼만.
          </p>

          <div class="mt-8 flex flex-col items-center gap-3">
            <a
              href="/login"
              class="flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-4 text-sm font-bold text-white shadow-brand transition hover:bg-accent-strong active:scale-95"
            >
              학습 시작
              <Icon name="chevron" />
            </a>
            <a href="/login" class="text-xs font-semibold text-muted hover:text-accent-text">
              이미 계정이 있다면 로그인
            </a>
          </div>
        </section>

        <section class="relative mt-12">
          <div class="absolute inset-x-8 top-4 h-40 -rotate-6 rounded-2xl border border-line bg-accent-soft/70"></div>
          <div class="absolute inset-x-8 top-4 h-40 rotate-3 rounded-2xl border border-line bg-white/70"></div>
          <div class="relative rounded-2xl border border-line bg-surface shadow-card">
            <div class="px-6 py-10 text-center sm:px-10 sm:py-12">
              <p class="text-xs font-semibold text-muted">뜻을 떠올려 보세요</p>
              <p class="mt-4 text-4xl leading-tight font-extrabold tracking-tight sm:text-5xl">
                ubiquitous
              </p>
              <p class="mt-1 text-sm text-muted">/juːˈbɪkwɪtəs/</p>
            </div>
            <details class="border-t border-line">
              <summary class="summary-clean cursor-pointer px-6 py-4 text-center text-sm font-bold text-accent-text">
                뜻 보기
                <span class="ml-2 text-xs font-normal text-muted">Space</span>
              </summary>
              <div class="border-t border-line bg-paper px-6 py-5 text-center">
                <p class="text-lg font-semibold">어디에나 있는</p>
                <p class="mt-1 text-sm leading-6 text-muted">
                  Smartphones are ubiquitous these days.
                </p>
                <p class="mt-3 text-xs text-muted">
                  로그인하면 오늘 볼 카드만큼만 복습합니다.
                </p>
              </div>
            </details>
          </div>
        </section>

        <section class="mt-12 grid gap-3 sm:grid-cols-3">
          {[
            ['꺼내는 연습', '뜻을 먼저 가리고 스스로 답하게 합니다.'],
            ['잊을 때쯤 다시', 'FSRS가 카드마다 다음 복습일을 정합니다.'],
            ['한→영까지', '뜻을 아는 단계에서 쓸 수 있는 단계로 넘어갑니다.'],
          ].map(([title, body]) => (
            <div class="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <span class="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-accent-text">
                <Icon name="check" />
              </span>
              <p class="mt-3 text-sm font-bold">{title}</p>
              <p class="mt-1 text-xs leading-5 text-muted">{body}</p>
            </div>
          ))}
        </section>
      </Layout>
    );
  }

  const now = new Date();
  const today = localDate(now, user.tz_offset_min, user.timezone);
  const seeded = c.req.query('seeded') === '1';
  const [decks, pool, streakDays] = await Promise.all([
    listDecks(c.env.DB, user.id),
    getPlayPoolCounts(c.env.DB, user.id, now.toISOString()),
    streak(c.env.DB, user.id, today),
  ]);

  return c.html(
    <Dashboard
      user={user}
      name={user.display_name ?? user.email}
      now={now}
      decks={decks}
      pool={pool}
      streakDays={streakDays}
      seeded={seeded}
    />
  );
});

function Dashboard(props: {
  user: User;
  name: string;
  now: Date;
  decks: { id: string; name: string; word_count: number }[];
  pool: PlayPoolCounts;
  streakDays: number;
  seeded: boolean;
}) {
  if (props.decks.length === 0) {
    return <Onboarding user={props.user} name={props.name} now={props.now} />;
  }

  const available = props.pool.due + props.pool.newCards;
  const sessionSize = props.user.session_size;
  const hasCards = available > 0;

  return (
    <Layout title="Wordy" user={props.user}>
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-bold tracking-widest text-accent-text uppercase">Today</p>
          <h1 class="mt-1 text-2xl font-extrabold tracking-tight">오늘도 한 판</h1>
          <p class="mt-1 text-sm text-muted">
            {props.name}님 ·{' '}
            {formatToday(
              props.now,
              props.user.tz_offset_min,
              props.user.timezone
            )}
          </p>
        </div>
        <span class="inline-flex shrink-0 items-center gap-1 rounded-full bg-streak-soft px-3 py-1 text-xs font-bold text-streak">
          <Icon name="flame" />
          {props.streakDays}일
        </span>
      </div>

      {props.seeded ? (
        <p class="mt-4 rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-semibold text-success">
          단어장을 준비했습니다. 아래에서 바로 시작하세요.
        </p>
      ) : null}

      <section class="mt-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div class="flex items-baseline justify-between gap-3">
          <p class="text-xs font-bold tracking-widest text-muted uppercase">
            지금 풀 수 있는 문제
          </p>
          <span class="shrink-0 text-xs text-muted">한 판 {sessionSize}문제</span>
        </div>

        <p class="mt-3 text-4xl leading-none font-extrabold tracking-tight">
          {available.toLocaleString('ko-KR')}
          <span class="ml-1 text-base font-medium text-muted">개</span>
        </p>

        <div class="mt-3 grid grid-cols-2 gap-2">
          <div class="rounded-xl bg-accent-soft px-3 py-2">
            <p class="text-xs font-medium text-muted">복습 대기</p>
            <p class="mt-1 text-lg font-extrabold text-accent-text">
              {props.pool.due.toLocaleString('ko-KR')}
            </p>
          </div>
          <div class="rounded-xl bg-streak-soft px-3 py-2">
            <p class="text-xs font-medium text-muted">새 단어</p>
            <p class="mt-1 text-lg font-extrabold text-streak">
              {props.pool.newCards.toLocaleString('ko-KR')}
            </p>
          </div>
        </div>

        <form method="post" action="/play/start" class="mt-4">
          <input type="hidden" name="mode" value="quick" />
          <button
            type="submit"
            disabled={!hasCards}
            class="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3.5 text-sm font-bold text-white shadow-brand transition hover:bg-accent-strong active:scale-95 disabled:opacity-50"
          >
            바로 시작 · {sessionSize}문제
            <Icon name="chevron" />
          </button>
        </form>

        {hasCards ? (
          <p class="mt-2 text-center text-xs text-muted">
            복습과 새 단어를 섞어서 출제합니다.
          </p>
        ) : (
          <p class="mt-2 text-center text-xs leading-5 text-muted">
            아직 풀 문제가 없습니다.{' '}
            <a href="/decks" class="font-semibold text-accent-text hover:underline">
              단어장에서 새 단어를 추가하세요.
            </a>
          </p>
        )}
      </section>

      <section class="mt-6">
        <a
          href="/play"
          class="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-4 shadow-card transition hover:border-accent-text"
        >
          <span>
            <span class="block text-sm font-bold">다른 방식으로 풀기</span>
            <span class="mt-0.5 block text-xs text-muted">
              철자 · 빈칸 · 듣기 · 취약 · 객관식
            </span>
          </span>
          <span class="flex shrink-0 items-center gap-1 text-xs font-semibold text-accent-text">
            플레이
            <Icon name="chevron" />
          </span>
        </a>
      </section>

      <section class="mt-8">
        <div class="flex items-baseline justify-between">
          <h2 class="text-base font-extrabold tracking-tight">내 단어장</h2>
          <a href="/decks" class="text-sm font-semibold text-accent-text hover:underline">
            관리
          </a>
        </div>

        {props.decks.length === 0 ? (
          <p class="mt-3 rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-5 text-sm leading-6 text-muted">
            아직 단어장이 없습니다.{' '}
            <a href="/decks" class="font-semibold text-accent-text hover:underline">
              기본 단어 1,000개로 시작하기
            </a>
          </p>
        ) : (
          <ul class="mt-2 space-y-2">
            {props.decks.slice(0, 3).map((deck) => (
              <li class="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
                <a href={`/decks/${deck.id}`} class="min-w-0">
                  <span class="block text-sm font-bold hover:text-accent-text">
                    {deck.name}
                  </span>
                  <span class="mt-0.5 block text-xs text-muted">
                    {deck.word_count.toLocaleString('ko-KR')}개
                  </span>
                </a>
                <a
                  href={`/decks/${deck.id}`}
                  class="shrink-0 text-line-strong transition hover:text-accent-text"
                  aria-label={`${deck.name} 열기`}
                >
                  <Icon name="chevron" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Layout>
  );
}

function Onboarding(props: { user: User; name: string; now: Date }) {
  return (
    <Layout title="시작하기" user={props.user}>
      <p class="text-xs font-bold tracking-widest text-accent-text uppercase">Welcome</p>
      <h1 class="mt-1 text-2xl font-extrabold tracking-tight">
        {props.name}님, 시작해 볼까요?
      </h1>
      <p class="mt-1 text-sm text-muted">
        {formatToday(
          props.now,
          props.user.tz_offset_min,
          props.user.timezone
        )}{' '}
        · 단어장을 준비하면 바로 학습할 수 있습니다.
      </p>

      <section class="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <p class="text-xs font-bold tracking-widest text-muted uppercase">
          1단계 · 단어 준비
        </p>
        <h2 class="mt-2 text-lg font-extrabold tracking-tight">
          기본 단어장으로 바로 시작
        </h2>
        <p class="mt-1 text-sm leading-6 text-muted">
          명사·동사·형용사·부사·구동사 1,000개가 예문과 해석까지 준비되어 있습니다.
          추가하면 바로 한 판을 시작할 수 있습니다.
        </p>

        <form method="post" action="/seeds/basic-1000" class="mt-4">
          <input type="hidden" name="next" value="home" />
          <button
            type="submit"
            class="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3.5 text-sm font-bold text-white shadow-brand transition hover:bg-accent-strong active:scale-95"
          >
            기본 1,000단어로 시작
            <Icon name="chevron" />
          </button>
        </form>

        <div class="mt-2 grid grid-cols-2 gap-2">
          <form method="post" action="/seeds/function-100">
            <input type="hidden" name="next" value="home" />
            <button
              type="submit"
              class="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-xs font-semibold hover:border-accent-text"
            >
              기능어 100개
            </button>
          </form>
          <a
            href="/decks"
            class="flex items-center justify-center rounded-xl border border-line bg-surface px-3 py-2.5 text-xs font-semibold hover:border-accent-text"
          >
            직접 만들기
          </a>
        </div>

        <p class="mt-3 text-center text-xs text-muted">
          언제든지 단어장에서 추가하거나 삭제할 수 있습니다.
        </p>
      </section>

      <section class="mt-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h2 class="text-base font-extrabold tracking-tight">시작하는 방법</h2>
        <ol class="mt-3 space-y-3">
          {[
            ['단어 준비', '기본 단어장을 추가하거나 내 단어를 직접 넣습니다.'],
            ['한 판 시작', '홈의 “바로 시작”을 누르면 복습과 새 단어를 섞어 냅니다.'],
            ['잊을 때쯤 다시', 'FSRS가 카드마다 다음 복습일을 정합니다.'],
          ].map(([title, body], index) => (
            <li class="flex gap-3">
              <span class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-text">
                {index + 1}
              </span>
              <span>
                <span class="block text-sm font-bold">{title}</span>
                <span class="mt-0.5 block text-xs leading-5 text-muted">
                  {body}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <p class="mt-4 rounded-xl bg-paper px-4 py-3 text-xs leading-5 text-muted">
        하루 목표, 시간대, 듣기 설정은{' '}
        <a href="/settings" class="font-semibold text-accent-text hover:underline">
          설정
        </a>
        에서 바꿀 수 있습니다.
      </p>
    </Layout>
  );
}

function formatToday(
  now: Date,
  tzOffsetMin: number,
  timezone?: string | null
): string {
  const options: Intl.DateTimeFormatOptions = {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  };

  if (timezone) {
    try {
      return new Intl.DateTimeFormat('ko-KR', {
        ...options,
        timeZone: timezone,
      }).format(now);
    } catch {
      // fall through
    }
  }

  const local = new Date(now.getTime() + tzOffsetMin * 60_000);
  return new Intl.DateTimeFormat('ko-KR', {
    ...options,
    timeZone: 'UTC',
  }).format(local);
}

export default home;
