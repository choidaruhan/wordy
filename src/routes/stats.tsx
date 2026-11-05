import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout } from '../components/layout';
import { localDate } from '../lib/time';
import { countOn, dailyStats, learnedCount, rangeSummary, streak } from '../db/stats';
import { getCompletion7 } from '../db/plan';
import { getMasteryCounts, type MasteryCounts } from '../db/mastery';
import {
  bestStreak,
  getLearningPulse,
  getWeeklyReport,
  type WeeklyReport,
} from '../db/report';

const stats = new Hono<Env>();

function Icon(props: { name: 'book' | 'flame' | 'clock' | 'check' | 'chevron' }) {
  if (props.name === 'book') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" />
        <path d="M8 7h8M8 11h8" />
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
  if (props.name === 'clock') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  if (props.name === 'check') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="m5 12 5 5L20 7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

const RANGES = [
  { key: '7', days: 7, label: '7일' },
  { key: '14', days: 14, label: '14일' },
  { key: '30', days: 30, label: '30일' },
];

stats.get('/stats', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const rangeKey = c.req.query('range') === '7' ? '7' : c.req.query('range') === '30' ? '30' : '14';
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];

  const now = new Date();
  const today = localDate(now, user.tz_offset_min, user.timezone);
  const dates = lastNDates(today, range.days);
  const from7 = lastNDates(today, 7)[0];

  const [daily, summary, todayCount, learned, streakDays, completion7, mastery, weekly, pulse, longest] = await Promise.all([
    dailyStats(c.env.DB, user.id, dates[0]),
    rangeSummary(c.env.DB, user.id, dates[0]),
    countOn(c.env.DB, user.id, today),
    learnedCount(c.env.DB, user.id),
    streak(c.env.DB, user.id, today),
    getCompletion7(c.env.DB, user.id, from7),
    getMasteryCounts(c.env.DB, user.id),
    getWeeklyReport(c.env.DB, user.id, today),
    getLearningPulse(c.env.DB, user, now, user.daily_review),
    bestStreak(c.env.DB, user.id),
  ]);

  const byDate = new Map(daily.map((d) => [d.date, d]));
  const maxTotal = Math.max(1, ...daily.map((d) => d.total));
  const accuracy = summary.total > 0 ? Math.round((summary.correct / summary.total) * 100) : 0;
  const ringOffset = Math.round(163 - (163 * accuracy) / 100);
  const totalReviews = daily.reduce((sum, day) => sum + day.total, 0);
  const average = Math.round((totalReviews / range.days) * 10) / 10;
  const best = dates.reduce(
    (acc, date) => {
      const total = byDate.get(date)?.total ?? 0;
      return total > acc.total ? { date, total } : acc;
    },
    { date: dates[0], total: 0 }
  );

  return c.html(
    <Layout title="내 기록" user={user}>
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-bold tracking-widest text-accent-text uppercase">Progress</p>
          <h1 class="mt-1 text-2xl font-extrabold tracking-tight">내 기록</h1>
        </div>
        <span class="inline-flex items-center gap-1 rounded-full bg-streak-soft px-3 py-1 text-xs font-bold text-streak">
          <Icon name="flame" />
          {streakDays}일
        </span>
      </div>

      {pulse.message ? (
        <div
          class={`mt-4 rounded-xl px-4 py-3 text-sm leading-6 ${
            pulse.level === 'high_load'
              ? 'bg-danger-soft text-danger'
              : 'bg-mark-soft text-ink'
          }`}
        >
          {pulse.message}
        </div>
      ) : null}

      <div class="mt-5 flex items-center justify-between gap-1 rounded-xl bg-line/60 p-1">
        {RANGES.map((item) => (
          <a
            href={`/stats?range=${item.key}`}
            class={`flex-1 rounded-lg py-1.5 text-center text-xs font-bold transition ${
              item.key === range.key
                ? 'bg-accent text-white shadow-sm'
                : 'text-muted hover:text-ink'
            }`}
          >
            {item.label}
          </a>
        ))}
      </div>

      <section class="mt-3 flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <div class="relative flex h-20 w-20 shrink-0 items-center justify-center">
          <svg viewBox="0 0 64 64" class="h-20 w-20 -rotate-90">
            <circle cx="32" cy="32" r="26" fill="none" stroke="var(--color-line)" stroke-width="5" />
            <circle
              cx="32"
              cy="32"
              r="26"
              fill="none"
              stroke="var(--color-success)"
              stroke-width="5"
              stroke-linecap="round"
              stroke-dasharray="163"
              stroke-dashoffset={String(ringOffset)}
            />
          </svg>
          <span class="absolute text-sm font-extrabold">{accuracy}%</span>
        </div>
        <div class="min-w-0">
          <p class="text-sm font-extrabold">정확도</p>
          <p class="mt-1 text-xs font-medium text-success">
            최근 {range.label} · {summary.total}장
          </p>
          <p class="mt-1 text-xs leading-5 text-muted">
            최근 정답률 기준입니다.
          </p>
        </div>
      </section>

      <dl class="mt-3 grid grid-cols-3 gap-2">
        <StatCard label="외운 단어" value={learned.toLocaleString('ko-KR')} tone="accent" icon="book" />
        <StatCard label="연속 학습" value={`${streakDays}일`} tone="streak" icon="flame" />
        <StatCard label="오늘 학습" value={`${todayCount}장`} tone="success" icon="check" />
      </dl>

      <MasterySection mastery={mastery} />

      <WeeklyReportSection report={weekly} bestStreak={longest} />

      <section class="mt-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <div class="flex items-baseline justify-between">
          <h2 class="text-sm font-extrabold">최근 {range.label}</h2>
          <span class="text-xs text-muted">총 {totalReviews}장</span>
        </div>
        <p class="mt-1 text-xs leading-5 text-muted">
          하루 평균 {average}장
          {best.total > 0
            ? ` · 최고 ${best.total}장 (${shortDate(best.date)})`
            : ''}
        </p>

        <div class="mt-4 flex items-end gap-1" role="group" aria-label="일별 학습량">
          {dates.map((date, index) => {
            const day = byDate.get(date);
            const total = day?.total ?? 0;
            const height = total > 0 ? Math.max(8, Math.round((total / maxTotal) * 100)) : 2;
            const dayNumber = Number(date.slice(8, 10));
            const showLabel = dates.length <= 14 || index % 5 === 0;

            return (
              <div class="flex flex-1 flex-col items-center gap-1.5">
                <div
                  class="flex h-24 w-full items-end"
                  title={`${date} · ${total}장`}
                  role="img"
                  aria-label={`${shortDate(date)} ${total}장`}
                >
                  <div
                    class={`w-full rounded-full ${total > 0 ? 'bg-accent' : 'bg-line'}`}
                    style={`height:${height}%`}
                  ></div>
                </div>
                <span class="text-xs font-medium text-muted">
                  {showLabel ? dayNumber : ''}
                </span>
                {dates.length <= 7 ? (
                  <span
                    aria-hidden="true"
                    class="text-xs font-semibold text-muted tabular-nums"
                  >
                    {total > 0 ? total : ''}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        <details class="mt-3 border-t border-line pt-3">
          <summary class="cursor-pointer text-xs text-muted hover:text-accent-text">
            일자별 기록 보기
          </summary>
          {totalReviews > 0 ? (
            <ul class="mt-2 divide-y divide-line">
              {[...dates].reverse().map((date) => {
                const total = byDate.get(date)?.total ?? 0;
                if (total === 0) return null;
                return (
                  <li class="flex items-baseline justify-between py-1.5 text-sm">
                    <span class="text-muted">{shortDate(date)}</span>
                    <span class="font-semibold">{total}장</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p class="mt-2 text-xs text-muted">이 기간에는 학습 기록이 없습니다.</p>
          )}
        </details>
      </section>

      <p class="mt-3 rounded-xl bg-accent-soft px-4 py-3 text-xs leading-5 text-accent-text">
        최근 7일 계획 완료율{' '}
        {completion7.planned > 0
          ? `${completion7.completed}/${completion7.planned}일 (${Math.round(completion7.rate * 100)}%)`
          : '표본이 아직 부족합니다.'}
      </p>

      <section class="mt-8">
        <h2 class="text-base font-extrabold tracking-tight">자주 보는 곳</h2>
        <div class="mt-2 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <a
            href="/decks"
            class="group flex min-h-12 items-center justify-between border-b border-line px-4 py-3 hover:bg-accent-soft/50"
          >
            <span class="flex items-baseline gap-3">
              <span class="text-sm font-bold">단어장</span>
              <span class="text-xs text-muted">검색 · 복습 예정 · 내보내기</span>
            </span>
            <span class="text-line-strong group-hover:text-accent-text">
              <Icon name="chevron" />
            </span>
          </a>
          <a
            href="/hard?tab=weak"
            class="group flex min-h-12 items-center justify-between border-b border-line px-4 py-3 hover:bg-accent-soft/50"
          >
            <span class="flex items-baseline gap-3">
              <span class="text-sm font-bold">취약 단어</span>
              <span class="text-xs text-muted">오답 분석 · 취약 연습</span>
            </span>
            <span class="text-line-strong group-hover:text-accent-text">
              <Icon name="chevron" />
            </span>
          </a>
          <a
            href="/hard?tab=leech"
            class="group flex min-h-12 items-center justify-between px-4 py-3 hover:bg-accent-soft/50"
          >
            <span class="flex items-baseline gap-3">
              <span class="text-sm font-bold">격리된 단어</span>
              <span class="text-xs text-muted">연상법 적기</span>
            </span>
            <span class="text-line-strong group-hover:text-accent-text">
              <Icon name="chevron" />
            </span>
          </a>
        </div>
      </section>

      <section class="mt-8 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <h2 class="text-sm font-extrabold">카드 이해하기</h2>
        <p class="mt-1 text-xs leading-5 text-muted">
          카드는 단어가 아니라 <span class="font-semibold text-ink">학습 상태</span>입니다. 한
          단어가 영→한, 한→영, 빈칸, 듣기 카드를 각각 가질 수 있습니다.
        </p>
      </section>

      <a
        href="/play"
        class="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3.5 text-sm font-bold text-white shadow-brand transition hover:bg-accent-strong active:scale-95"
      >
        오늘 학습 시작
        <Icon name="chevron" />
      </a>
    </Layout>
  );
});

function WeeklyReportSection(props: {
  report: WeeklyReport;
  bestStreak: number;
}) {
  const { current, previous, reviewDelta, accuracyDelta } = props.report;
  const pct = (value: number | null) =>
    value == null ? '-' : `${Math.round(value * 100)}%`;
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value}`;

  return (
    <section class="mt-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div class="flex items-baseline justify-between">
        <h2 class="text-sm font-extrabold">이번 주</h2>
        <span class="text-xs text-muted">{current.reviews}장</span>
      </div>

      <dl class="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <dt class="text-xs font-medium text-muted">학습일</dt>
          <dd class="mt-0.5 text-sm font-extrabold">{current.studyDays}일</dd>
        </div>
        <div>
          <dt class="text-xs font-medium text-muted">정확도</dt>
          <dd class="mt-0.5 text-sm font-extrabold">{pct(current.accuracy)}</dd>
        </div>
        <div>
          <dt class="text-xs font-medium text-muted">지난 주 대비</dt>
          <dd class="mt-0.5 text-sm font-extrabold">{signed(reviewDelta)}장</dd>
        </div>
      </dl>

      <p class="mt-2 text-xs leading-5 text-muted">
        지난 주 {previous.reviews}장 · 정확도 {pct(previous.accuracy)}
        {accuracyDelta != null
          ? ` (${accuracyDelta >= 0 ? '+' : ''}${Math.round(accuracyDelta * 100)}%p)`
          : ''}{' '}
        · 최장 연속 {props.bestStreak}일
      </p>
    </section>
  );
}

const MASTERY_STAGES: {
  key: 'mastered' | 'known' | 'familiar' | 'learning' | 'new';
  label: string;
  tone: string;
}[] = [
  { key: 'mastered', label: '마스터', tone: 'bg-success' },
  { key: 'known', label: '외운', tone: 'bg-accent' },
  { key: 'familiar', label: '익숙', tone: 'bg-streak' },
  { key: 'learning', label: '학습 중', tone: 'bg-mark' },
  { key: 'new', label: '새 단어', tone: 'bg-line-strong' },
];

function MasterySection(props: { mastery: MasteryCounts }) {
  const total = Math.max(1, props.mastery.total);

  return (
    <section class="mt-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div class="flex items-baseline justify-between">
        <h2 class="text-sm font-extrabold">숙련도</h2>
        <span class="text-xs text-muted">
          {props.mastery.total.toLocaleString('ko-KR')}단어
        </span>
      </div>

      <div
        class="mt-3 flex h-2 overflow-hidden rounded-full bg-line"
        role="img"
        aria-label="단어 숙련도 분포"
      >
        {MASTERY_STAGES.map((stage) => {
          const count = props.mastery[stage.key];
          return (
            <div
              class={stage.tone}
              style={`width:${(count / total) * 100}%`}
              title={`${stage.label} ${count}`}
            ></div>
          );
        })}
      </div>

      <dl class="mt-3 grid grid-cols-5 gap-1 text-center">
        {MASTERY_STAGES.map((stage) => (
          <div>
            <dt class="text-xs font-medium text-muted">{stage.label}</dt>
            <dd class="mt-0.5 text-sm font-extrabold">
              {props.mastery[stage.key].toLocaleString('ko-KR')}
            </dd>
          </div>
        ))}
      </dl>

      <p class="mt-2 text-xs leading-5 text-muted">
        마스터는 모든 생산형 카드가 안정되고 최근 90일 안에 성공한 단어입니다.
      </p>
    </section>
  );
}

function StatCard(props: {
  label: string;
  value: string;
  tone: 'accent' | 'streak' | 'success';
  icon: 'book' | 'flame' | 'check';
}) {
  const tones = {
    accent: 'bg-accent-soft text-accent-text',
    streak: 'bg-streak-soft text-streak',
    success: 'bg-success-soft text-success',
  };

  return (
    <div class="rounded-2xl border border-line bg-surface px-2 py-3 text-center shadow-card">
      <span class={`mx-auto grid h-8 w-8 place-items-center rounded-full ${tones[props.tone]}`}>
        <Icon name={props.icon} />
      </span>
      <dt class="mt-2 text-xs font-medium text-muted">{props.label}</dt>
      <dd class="mt-0.5 text-sm font-extrabold">{props.value}</dd>
    </div>
  );
}

function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}

function lastNDates(today: string, n: number): string[] {
  const base = new Date(`${today}T00:00:00Z`);
  const out: string[] = [];

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }

  return out;
}

export default stats;
