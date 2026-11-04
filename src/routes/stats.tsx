import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout } from '../components/layout';
import { localDate } from '../lib/time';
import { countOn, dailyStats, learnedCount, rangeSummary, streak } from '../db/stats';

const stats = new Hono<Env>();

const CHART_DAYS = 14;

stats.get('/stats', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const now = new Date();
  const today = localDate(now, user.tz_offset_min);
  const dates = lastNDates(today, CHART_DAYS);
  const from30 = lastNDates(today, 30)[0];

  const [daily, summary, todayCount, learned, streakDays] = await Promise.all([
    dailyStats(c.env.DB, user.id, dates[0]),
    rangeSummary(c.env.DB, user.id, from30),
    countOn(c.env.DB, user.id, today),
    learnedCount(c.env.DB, user.id),
    streak(c.env.DB, user.id, today),
  ]);

  const byDate = new Map(daily.map((d) => [d.date, d]));
  const maxTotal = Math.max(1, ...daily.map((d) => d.total));
  const accuracy = summary.total > 0 ? Math.round((summary.correct / summary.total) * 100) : 0;

  return c.html(
    <Layout title="통계" user={user}>
      <h1 class="text-xl font-semibold">통계</h1>

      <dl class="mt-6 grid grid-cols-2 gap-px border border-line bg-line">
        <Cell label="오늘 학습" value={`${todayCount}`} unit="장" />
        <Cell label="연속 학습" value={`${streakDays}`} unit="일" />
        <Cell label="정답률 (30일)" value={`${accuracy}`} unit="%" />
        <Cell label="외운 단어" value={`${learned}`} unit="개" />
      </dl>

      <section class="mt-10">
        <div class="flex items-baseline justify-between">
          <h2 class="text-sm font-semibold">최근 {CHART_DAYS}일</h2>
          <span class="text-xs text-muted">총 {summary.total}장</span>
        </div>

        <div class="mt-4 flex items-end gap-1">
          {dates.map((date) => {
            const d = byDate.get(date);
            const total = d?.total ?? 0;
            const height = total > 0 ? Math.max(6, Math.round((total / maxTotal) * 100)) : 2;
            const day = Number(date.slice(8, 10));

            return (
              <div class="flex flex-1 flex-col items-center gap-1.5">
                <div
                  class="flex h-28 w-full items-end"
                  title={`${date} · ${total}장`}
                >
                  <div
                    class={`w-full rounded-sm ${total > 0 ? 'bg-accent' : 'bg-line'}`}
                    style={`height:${height}%`}
                  ></div>
                </div>
                <span class="text-[10px] tabular-nums text-muted">{day}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section class="mt-10 border-t border-line pt-6">
        <h2 class="text-sm font-semibold">카드</h2>
        <p class="mt-1 text-sm leading-6 text-muted">
          카드는 단어가 아니라 <span class="text-ink">학습 상태</span>입니다. 한 단어가
          영→한, 한→영, 빈칸 카드를 각각 가질 수 있습니다.
        </p>
        <a href="/hard" class="mt-4 inline-block text-sm text-accent hover:underline">
          어려운 단어 보기
        </a>
      </section>
    </Layout>
  );
});

function Cell(props: { label: string; value: string; unit: string }) {
  return (
    <div class="bg-surface px-4 py-5">
      <dt class="text-xs text-muted">{props.label}</dt>
      <dd class="mt-1 font-word text-2xl">
        {props.value}
        <span class="ml-1 text-sm text-muted">{props.unit}</span>
      </dd>
    </div>
  );
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
