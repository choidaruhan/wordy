import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout } from '../components/layout';
import { formatSpan } from '../lib/srs';
import { listHardWords, resumeCard, saveMnemonic } from '../db/review';
import {
  countWeakDue,
  listObservingWords,
  listStaleWords,
  listWeakness,
  weakWordIds,
  type ObservingWord,
  type StaleWord,
  type WeaknessReport,
  type WeakWord,
} from '../db/weak';

const hard = new Hono<Env>();

type Tab = 'weak' | 'observing' | 'leech';

const DIRECTION_LABEL: Record<string, string> = {
  recognition: '영→한',
  recall: '한→영',
  cloze: '빈칸',
  listening: '듣기',
};

hard.get('/hard', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const tab: Tab =
    c.req.query('tab') === 'observing'
      ? 'observing'
      : c.req.query('tab') === 'leech'
        ? 'leech'
        : 'weak';

  const now = new Date();
  const [report, observingRaw, leech] = await Promise.all([
    listWeakness(c.env.DB, user.id, now),
    listObservingWords(c.env.DB, user.id),
    listHardWords(c.env.DB, user.id),
  ]);

  const weakIds = new Set(report.all.map((w) => w.wordId));
  const observing = observingRaw.filter((w) => !weakIds.has(w.wordId));
  const stale = tab === 'weak' ? await listStaleWords(c.env.DB, user.id, now) : [];
  const weakDue =
    tab === 'weak'
      ? await countWeakDue(c.env.DB, user.id, now.toISOString(), weakWordIds(report))
      : 0;

  return c.html(
    <Layout title="취약 단어" user={user}>
      <div class="flex items-baseline justify-between">
        <h1 class="text-2xl font-semibold">취약 단어</h1>
        <span class="text-sm text-muted">{report.all.length}개</span>
      </div>
      <p class="mt-2 max-w-xl text-sm leading-6 text-muted">
        최근 성과가 나쁜 단어를 모읍니다. 격리된 단어는 연상법을 적은 뒤 학습에 다시 포함할 수
        있습니다.
      </p>

      <nav class="mt-6 flex gap-1 border-b border-line">
        <TabLink href="/hard?tab=weak" active={tab === 'weak'} label={`취약 ${report.all.length}`} />
        <TabLink
          href="/hard?tab=observing"
          active={tab === 'observing'}
          label={`관찰 중 ${observing.length}`}
        />
        <TabLink href="/hard?tab=leech" active={tab === 'leech'} label={`격리 ${leech.length}`} />
      </nav>

      {tab === 'weak' ? (
        <WeakList report={report} stale={stale} weakDue={weakDue} now={now} />
      ) : null}
      {tab === 'observing' ? <ObservingList words={observing} now={now} /> : null}
      {tab === 'leech' ? <LeechList words={leech} /> : null}
    </Layout>
  );
});

function TabLink(props: { href: string; active: boolean; label: string }) {
  return (
    <a
      href={props.href}
      class={`border-b-2 px-4 py-3 text-sm ${
        props.active
          ? 'border-accent-text text-accent-text'
          : 'border-transparent text-muted hover:text-ink'
      }`}
    >
      {props.label}
    </a>
  );
}

function WeakList(props: {
  report: WeaknessReport;
  stale: StaleWord[];
  weakDue: number;
  now: Date;
}) {
  const shown = props.report.all.slice(0, 200);

  return (
    <>
      {props.report.all.length === 0 ? (
        <p class="mt-8 border-t border-line pt-6 text-sm leading-6 text-muted">
          아직 취약 단어가 없습니다. 복습이 5회 이상 쌓이면 최근 정답률로 자동 분류됩니다.
        </p>
      ) : (
        <>
          {props.weakDue > 0 ? (
            <a
              href="/review?mode=weak"
              class="mt-5 inline-block rounded-xl bg-accent px-5 py-3 text-sm font-medium text-white hover:bg-accent-strong"
            >
              취약 단어 연습 ({props.weakDue}장)
            </a>
          ) : (
            <p class="mt-5 text-sm text-muted">
              오늘 기한이 도래한 취약 단어가 없습니다. 내일 다시 확인하세요.
            </p>
          )}

          <ul class="mt-4">
            {shown.map((w) => (
              <WeakItem word={w} now={props.now} />
            ))}
          </ul>
          {props.report.all.length > shown.length ? (
            <p class="mt-3 text-xs text-muted">
              상위 {shown.length}개만 표시합니다. 정확한 분류는 계속 학습하면서 갱신됩니다.
            </p>
          ) : null}
        </>
      )}

      {props.stale.length > 0 ? (
        <section class="mt-10 border-t border-line pt-6">
          <h2 class="text-base font-semibold">재확인 필요</h2>
          <p class="mt-1 text-sm leading-6 text-muted">
            90일 이상 복습하지 않아 취약 판정에서 제외한 단어입니다. 복습이 다시 시작되면
            자동으로 평가합니다.
          </p>
          <ul class="mt-3">
            {props.stale.map((s) => (
              <li class="flex items-baseline justify-between gap-4 border-b border-line py-3">
                <span class="min-w-0">
                  <span class="font-word text-base">{s.term}</span>
                  <span class="ml-2 text-sm text-muted">{s.meaning}</span>
                </span>
                <span class="shrink-0 text-xs text-muted">
                  {formatAgo(s.lastReviewedAt, props.now)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function WeakItem(props: { word: WeakWord; now: Date }) {
  const w = props.word;

  return (
    <li class="border-b border-line py-5">
      <div class="flex items-baseline justify-between gap-4">
        <div class="min-w-0">
          <span class="font-word text-lg">{w.term}</span>
          <span class="ml-2 text-sm text-muted">{w.meaning}</span>
        </div>
        <span
          class={`shrink-0 rounded-full px-2 py-1 text-xs ${
            w.status === 'weak' ? 'bg-danger-soft text-danger' : 'bg-mark-soft text-ink'
          }`}
        >
          {w.status === 'weak' ? '취약' : '주의'}
        </span>
      </div>

      <p class="mt-1 text-sm leading-6 text-muted">
        {DIRECTION_LABEL[w.direction] ?? w.direction} · 최근 {w.recentN}회 중{' '}
        {w.recentErrors}회 오답 · 누적 놓침 {w.lapses}회 ·{' '}
        {formatAgo(w.lastReviewedAt, props.now)}
        {w.quizWrongs > 0 ? ` · 퀴즈 오답 ${w.quizWrongs}회` : ''}
      </p>

      {w.example ? <p class="mt-1 text-sm leading-6 text-muted">{w.example}</p> : null}
      {w.note ? <p class="mt-1 text-sm leading-6 text-muted">연상법: {w.note}</p> : null}
    </li>
  );
}

function ObservingList(props: { words: ObservingWord[]; now: Date }) {
  if (props.words.length === 0) {
    return (
      <p class="mt-8 border-t border-line pt-6 text-sm leading-6 text-muted">
        아직 관찰 중인 단어가 없습니다. 복습이 1~4회 쌓인 단어가 여기에 모입니다.
      </p>
    );
  }

  return (
    <>
      <p class="mt-6 text-sm leading-6 text-muted">
        최근 리뷰가 5회 미만이라 아직 취약 여부를 판단하지 않습니다.
      </p>
      <ul class="mt-3">
        {props.words.map((w) => (
          <li class="flex items-baseline justify-between gap-4 border-b border-line py-3">
            <span class="min-w-0">
              <span class="font-word text-base">{w.term}</span>
              <span class="ml-2 text-sm text-muted">{w.meaning}</span>
            </span>
            <span class="shrink-0 text-xs text-muted">
              {w.reps}회 · {formatAgo(w.lastReviewedAt, props.now)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function LeechList(props: {
  words: {
    card_id: string;
    term: string;
    meaning: string;
    example: string | null;
    note: string | null;
    lapses: number;
  }[];
}) {
  if (props.words.length === 0) {
    return (
      <p class="mt-8 border-t border-line pt-6 text-sm leading-6 text-muted">
        아직 격리된 단어가 없습니다. 8번 이상 틀린 단어가 생기면 여기로 모입니다.
      </p>
    );
  }

  return (
    <>
      <p class="mt-6 text-sm leading-6 text-muted">
        8번 이상 틀려서 학습 큐에서 잠시 뺀 단어입니다. 연상법을 적어두면 다음 복습 때 함께
        나옵니다.
      </p>
      <ul class="mt-3">
        {props.words.map((w) => (
          <li class="border-b border-line py-5">
            <div class="flex items-baseline justify-between gap-4">
              <div class="min-w-0">
                <span class="font-word text-lg">{w.term}</span>
                <span class="ml-2 text-sm text-muted">{w.meaning}</span>
              </div>
              <span class="shrink-0 text-xs text-muted">{w.lapses}회 틀림</span>
            </div>

            {w.example ? (
              <p class="mt-1 text-sm leading-6 text-muted">{w.example}</p>
            ) : null}

            <form method="post" action={`/hard/${w.card_id}/note`} class="mt-3 flex gap-2">
              <input
                name="note"
                value={w.note ?? ''}
                maxlength={200}
                placeholder="연상법을 적어보세요"
                class="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-3 text-sm placeholder:text-muted/70"
              />
              <button
                type="submit"
                class="rounded-xl border border-line bg-surface px-4 py-3 text-sm hover:border-accent-text"
              >
                저장
              </button>
            </form>

            <form method="post" action={`/hard/${w.card_id}/resume`} class="mt-2">
              <button type="submit" class="text-xs text-accent-text hover:underline">
                다시 학습에 포함
              </button>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}

function formatAgo(iso: string | null, now: Date): string {
  if (!iso) return '기록 없음';
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  if (ms < 60_000) return '방금';
  return `${formatSpan(ms)} 전`;
}

hard.post('/hard/:cardId/note', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const body = await c.req.parseBody();
  await saveMnemonic(c.env.DB, user.id, c.req.param('cardId'), String(body['note'] ?? ''));

  return c.redirect('/hard?tab=leech');
});

hard.post('/hard/:cardId/resume', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  await resumeCard(c.env.DB, user.id, c.req.param('cardId'));

  return c.redirect('/hard?tab=leech');
});

export default hard;
