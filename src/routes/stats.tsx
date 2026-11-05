import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout } from '../components/layout';
import { localDate } from '../lib/time';
import { countOn, dailyStats, learnedCount, rangeSummary, streak } from '../db/stats';
import { getCompletion7 } from '../db/plan';

const stats = new Hono<Env>();

const CHART_DAYS = 14;

stats.get('/stats', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const now = new Date();
  const today = localDate(now, user.tz_offset_min);
  const dates = lastNDates(today, CHART_DAYS);
  const from7 = lastNDates(today, 7)[0];
  const from30 = lastNDates(today, 30)[0];

  const [daily, summary, todayCount, learned, streakDays, completion7] = await Promise.all([
    dailyStats(c.env.DB, user.id, dates[0]),
    rangeSummary(c.env.DB, user.id, from30),
    countOn(c.env.DB, user.id, today),
    learnedCount(c.env.DB, user.id),
    streak(c.env.DB, user.id, today),
    getCompletion7(c.env.DB, user.id, from7),
  ]);

  const byDate = new Map(daily.map((d) => [d.date, d]));
  const maxTotal = Math.max(1, ...daily.map((d) => d.total));
  const accuracy = summary.total > 0 ? Math.round((summary.correct / summary.total) * 100) : 0;

  return c.html(
    <Layout title="통계" user={user}>
      <h1 class="text-2xl font-semibold">통계</h1>

      <dl class="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-card">
        <Cell label="오늘 학습" value={todayCount} unit="장" />
        <Cell label="연속 학습" value={streakDays} unit="일" />
        <Cell label="정답률 (30일)" value={accuracy} unit="%" />
        <Cell label="외운 단어" value={learned} unit="개" />
      </dl>

      <p class="mt-2 text-xs leading-5 text-muted">
        정답률은 Again만 오답으로 계산합니다. Hard/Good/Easy는 정답입니다.
      </p>
      <p class="mt-1 text-xs leading-5 text-muted">
        최근 7일 계획 완료율{' '}
        {completion7.planned > 0
          ? `${completion7.completed}/${completion7.planned}일 (${Math.round(completion7.rate * 100)}%)`
          : '표본 부족'}
      </p>

      <section class="mt-10">
        <div class="flex items-baseline justify-between">
          <h2 class="text-base font-semibold">최근 {CHART_DAYS}일</h2>
          <span class="text-xs text-muted">총 {summary.total}장</span>
        </div>

        <div class="mt-4 flex items-end gap-1">
          {dates.map((date) => {
            const d = byDate.get(date);
            const total = d?.total ?? 0;
            const height = total > 0 ? Math.max(6, Math.round((total / maxTotal) * 100)) : 2;
            const day = Number(date.slice(8, 10));

            return (
              <div class="flex flex-1 flex-col items-center gap-2">
                <div
                  class="flex h-28 w-full items-end"
                  title={`${date} · ${total}장`}
                >
                  <div
                    class={`w-full rounded-sm ${total > 0 ? 'bg-accent' : 'bg-line'}`}
                    style={`height:${height}%`}
                  ></div>
                </div>
                <span class="text-xs tabular-nums text-muted">{day}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section class="mt-10 border-t border-line pt-6">
        <h2 class="text-base font-semibold">카드</h2>
        <p class="mt-1 text-sm leading-6 text-muted">
          카드는 단어가 아니라 <span class="text-ink">학습 상태</span>입니다. 한 단어가
          영→한, 한→영, 빈칸 카드를 각각 가질 수 있습니다.
        </p>
        <div class="mt-4 flex gap-4">
          <a href="/hard?tab=weak" class="text-sm text-accent-text hover:underline">
            취약 단어 보기
          </a>
          <a href="/hard?tab=leech" class="text-sm text-accent-text hover:underline">
            격리된 단어 보기
          </a>
        </div>
      </section>
    </Layout>
  );
});

function Cell(props: { label: string; value: number; unit: string }) {
  return (
    <div class="bg-surface px-4 py-5">
      <dt class="text-xs text-muted">{props.label}</dt>
      <dd class="mt-1 font-word text-2xl">
        {props.value.toLocaleString('ko-KR')}
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
