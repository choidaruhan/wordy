import { Hono } from 'hono';
import type { Env, Stats, User } from '../types';
import { Layout } from '../components/layout';
import { getStats, listDecks } from '../db/queries';
import { getTodayPlan, type TodayPlan } from '../db/plan';
import { planReasonText } from '../lib/plan-text';

const home = new Hono<Env>();

home.get('/', async (c) => {
  const user = c.get('user');

  if (!user) {
    return c.html(
      <Layout title="Wordy" user={null}>
        <section class="pt-6">
          <p class="text-xs font-medium tracking-widest text-accent-text uppercase">
            간격 반복 · FSRS
          </p>
          <h1 class="mt-4 font-word text-4xl leading-tight tracking-tight sm:text-5xl">
            뜻을 가리고,
            <br />
            꺼내 보세요.
          </h1>
          <p class="mt-6 max-w-xl text-base leading-7 text-muted">
            단어장을 다시 읽는 것은 공부가 아닙니다. 기억에서 꺼내는 순간에만 남습니다.
            하루 10분, 오늘 볼 카드만큼만.
          </p>
          <div class="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="/login"
              class="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-6 py-3 text-sm font-medium text-white hover:bg-accent-strong"
            >
              시작하기
            </a>
            <a href="/login" class="text-sm text-muted hover:text-ink">
              이미 계정이 있다면 로그인
            </a>
          </div>
        </section>

        <section class="mt-12 rounded-lg border border-line border-b-2 bg-surface shadow-card">
          <div class="px-6 py-10 text-center sm:px-10 sm:py-12">
            <p class="text-xs text-muted">뜻을 떠올려 보세요</p>
            <p class="mt-4 font-word text-4xl leading-tight tracking-tight sm:text-5xl">
              ubiquitous
            </p>
            <p class="mt-1 text-sm text-muted">/juːˈbɪkwɪtəs/</p>
          </div>
          <details class="border-t border-line">
            <summary class="summary-clean cursor-pointer px-6 py-4 text-center text-sm font-medium hover:text-accent-text">
              뜻 보기
              <span class="ml-2 text-xs font-normal text-muted">Space</span>
            </summary>
            <div class="border-t border-line bg-paper px-6 py-5 text-center">
              <p class="text-lg">어디에나 있는</p>
              <p class="mt-1 font-word text-sm leading-6 text-muted">
                Smartphones are ubiquitous these days.
              </p>
              <p class="mt-3 text-xs text-muted">
                로그인하면 오늘 볼 카드만큼만 복습합니다.
              </p>
            </div>
          </details>
        </section>

        <section class="mt-12 border-t border-line pt-8">
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

  const now = new Date();
  const [stats, decks, todayPlan] = await Promise.all([
    getStats(c.env.DB, user.id),
    listDecks(c.env.DB, user.id),
    getTodayPlan(c.env.DB, user, now, false),
  ]);

  return c.html(
    <Dashboard
      user={user}
      name={user.display_name ?? user.email}
      stats={stats}
      plan={todayPlan.plan}
      decks={decks}
      now={now}
    />
  );
});

function Dashboard(props: {
  user: User;
  name: string;
  stats: Stats;
  plan: TodayPlan;
  decks: { id: string; name: string; word_count: number }[];
  now: Date;
}) {
  const remainingDue = Math.max(0, props.plan.dueCount - props.plan.reviewTarget);
  const reason = planReasonText(props.plan);
  const total = props.plan.done + props.plan.remaining;
  const pct = total > 0 ? Math.round((props.plan.done / total) * 100) : 0;

  const actions = [
    { href: '/hard?tab=weak', title: '취약 단어', meta: '오답 분석 · 취약 연습' },
    ...(props.stats.hard > 0
      ? [
          {
            href: '/hard?tab=leech',
            title: '격리된 단어',
            meta: `${props.stats.hard}개 · 연상법 적기`,
          },
        ]
      : []),
    { href: '/quiz', title: '객관식 테스트', meta: '지금 기억 확인' },
  ];

  return (
    <Layout title="오늘" user={props.user}>
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">오늘</h1>
          <p class="mt-1 text-sm text-muted">
            {props.name}님 · {formatToday(props.now, props.user.tz_offset_min)}
          </p>
        </div>
        {props.plan.completed ? (
          <span class="rounded-full bg-accent-soft px-2 py-1 text-xs text-accent-text">계획 완료</span>
        ) : null}
      </div>

      <section class="mt-6 overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        <div class="px-6 pt-6 pb-5">
          <div class="flex items-baseline justify-between gap-3">
            <p class="text-xs font-medium tracking-widest text-muted uppercase">
              오늘의 학습
            </p>
            {props.plan.estimatedMinutes > 0 ? (
              <span class="text-xs text-muted">예상 {props.plan.estimatedMinutes}분</span>
            ) : null}
          </div>

          <p class="mt-3 font-word text-5xl tracking-tight">
            {props.plan.remaining}
            <span class="ml-1 text-lg text-muted">장</span>
          </p>
          <p class="mt-1 text-sm text-muted">
            {props.plan.done}장 완료 · {props.plan.remaining}장 남음
          </p>

          <div class="mt-4 h-1 overflow-hidden rounded-full bg-line">
            <div
              class="h-1 rounded-full bg-accent transition-[width]"
              style={`width:${pct}%`}
            ></div>
          </div>
        </div>

        <dl class="grid grid-cols-3 gap-px border-y border-line bg-line">
          <PlanCell label="복습" value={props.plan.reviewTarget} />
          <PlanCell label="승급" value={props.plan.promotedTarget} />
          <PlanCell label="신규" value={props.plan.effectiveNew} />
        </dl>

        <div class="px-6 py-5">
          {props.plan.completed ? (
            <p class="text-sm text-accent-text">오늘 계획을 완료했습니다.</p>
          ) : null}

          {reason ? (
            <p class="rounded-xl border border-mark/60 bg-mark-soft px-4 py-3 text-xs leading-5 text-ink">
              {reason}
            </p>
          ) : null}

          {props.plan.remaining > 0 ? (
            <a
              href="/review"
              class="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-medium text-white hover:bg-accent-strong"
            >
              학습 시작
            </a>
          ) : !props.plan.completed ? (
            <p class="mt-1 text-sm text-muted">오늘 몫은 다 했습니다.</p>
          ) : null}

          {remainingDue > 0 ? (
            <p class="mt-3 text-xs leading-5 text-muted">
              복습 상한 때문에 남은 {remainingDue}장은 내일로 넘깁니다.
            </p>
          ) : null}
        </div>
      </section>

      <dl class="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-card">
        <Stat label="전체 단어" value={props.stats.total} />
        <Stat label="단어장" value={props.stats.decks} />
        <Stat label="외운 단어" value={props.stats.learned} />
      </dl>

      <section class="mt-8">
        <h2 class="text-base font-semibold">연습</h2>
        <div class="mt-2 overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          {actions.map((action) => (
            <a
              href={action.href}
              class="group flex min-h-11 items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0 hover:bg-paper"
            >
              <span class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span class="text-sm font-medium">{action.title}</span>
                <span class="text-xs text-muted">{action.meta}</span>
              </span>
              <Chevron />
            </a>
          ))}
        </div>
      </section>

      <div class="mt-8 flex items-baseline justify-between">
        <h2 class="text-base font-semibold">단어장</h2>
        <a href="/decks" class="text-sm text-accent-text hover:underline">
          관리
        </a>
      </div>

      {props.decks.length === 0 ? (
        <p class="mt-3 rounded-lg border border-dashed border-line-strong bg-surface px-4 py-5 text-sm leading-6 text-muted">
          아직 단어장이 없습니다.{' '}
          <a href="/decks" class="text-accent-text hover:underline">
            기본 단어 1,000개로 시작하기
          </a>
        </p>
      ) : (
        <ul class="mt-1">
          {props.decks.map((d) => (
            <li class="flex items-baseline justify-between border-b border-line py-3">
              <a href={`/decks/${d.id}`} class="text-base hover:text-accent-text">
                {d.name}
              </a>
              <span class="text-sm text-muted">{d.word_count.toLocaleString('ko-KR')}개</span>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
}

function PlanCell(props: { label: string; value: number }) {
  return (
    <div class="bg-surface px-3 py-4 text-center">
      <dt class="text-xs text-muted">{props.label}</dt>
      <dd class="mt-1 font-word text-2xl">{props.value}</dd>
    </div>
  );
}

function Stat(props: { label: string; value: number }) {
  return (
    <div class="bg-surface px-4 py-5">
      <dt class="text-xs text-muted">{props.label}</dt>
      <dd class="mt-1 font-word text-2xl">{props.value.toLocaleString('ko-KR')}</dd>
    </div>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-4 w-4 shrink-0 text-line-strong group-hover:text-accent-text"
      aria-hidden="true"
    >
      <path d="m8 5 5 5-5 5" />
    </svg>
  );
}

function formatToday(now: Date, tzOffsetMin: number): string {
  const local = new Date(now.getTime() + tzOffsetMin * 60_000);
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(local);
}

export default home;
