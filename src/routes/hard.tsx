import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout } from '../components/layout';
import { listHardWords, resumeCard, saveMnemonic } from '../db/review';

const hard = new Hono<Env>();

hard.get('/hard', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const words = await listHardWords(c.env.DB, user.id);

  return c.html(
    <Layout title="어려운 단어" user={user}>
      <div class="flex items-baseline justify-between">
        <h1 class="text-xl font-semibold">어려운 단어</h1>
        <span class="text-sm text-muted">{words.length}개</span>
      </div>
      <p class="mt-2 text-sm leading-6 text-muted">
        8번 이상 틀려서 학습 큐에서 잠시 뺀 단어입니다. 연상법을 적어두면 다음 복습 때 함께 나옵니다.
      </p>

      {words.length === 0 ? (
        <p class="mt-8 border-t border-line pt-6 text-sm text-muted">
          아직 없습니다. 계속 틀리는 단어가 생기면 여기로 모입니다.
        </p>
      ) : (
        <ul class="mt-6">
          {words.map((w) => (
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
                  class="min-w-0 flex-1 rounded border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70"
                />
                <button
                  type="submit"
                  class="rounded border border-line bg-surface px-4 py-2 text-sm hover:border-accent"
                >
                  저장
                </button>
              </form>

              <form method="post" action={`/hard/${w.card_id}/resume`} class="mt-2">
                <button type="submit" class="text-xs text-accent hover:underline">
                  다시 학습에 포함
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
});

hard.post('/hard/:cardId/note', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const body = await c.req.parseBody();
  await saveMnemonic(c.env.DB, user.id, c.req.param('cardId'), String(body['note'] ?? ''));

  return c.redirect('/hard');
});

hard.post('/hard/:cardId/resume', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  await resumeCard(c.env.DB, user.id, c.req.param('cardId'));

  return c.redirect('/hard');
});

export default hard;
