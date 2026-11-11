import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout } from '../components/layout';
import { addVocab, deleteVocab, listVocab } from '../db/vocab';

const words = new Hono<Env>();

function Notice(props: { kind: 'created' | 'updated' | 'deleted' | 'error' }) {
  const text =
    props.kind === 'created'
      ? '단어를 추가했습니다.'
      : props.kind === 'updated'
        ? '이미 있는 단어라 뜻을 업데이트했습니다.'
        : props.kind === 'deleted'
          ? '단어를 삭제했습니다.'
          : '단어와 뜻을 모두 입력해 주세요.';

  const tone =
    props.kind === 'error'
      ? 'border-danger/30 bg-danger-soft text-danger'
      : 'border-success/30 bg-success-soft text-success';

  return (
    <p class={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${tone}`}>
      {text}
    </p>
  );
}

words.get('/words', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const items = await listVocab(c.env.DB, user.id);
  const state = c.req.query('state');

  return c.html(
    <Layout title="단어" user={user} active="words">
      <div class="flex items-baseline justify-between gap-3">
        <h1 class="text-2xl font-extrabold tracking-tight">단어</h1>
        <p class="text-sm font-semibold text-muted">{items.length}개</p>
      </div>

      {state === 'created' ||
      state === 'updated' ||
      state === 'deleted' ||
      state === 'error' ? (
        <Notice kind={state} />
      ) : null}

      <form
        method="post"
        action="/words"
        class="mt-5 rounded-2xl border border-line bg-surface p-4 shadow-card"
      >
        <label class="block">
          <span class="text-xs font-bold text-muted">영어 단어</span>
          <input
            name="term"
            required
            maxlength={120}
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            autofocus
            placeholder="context"
            class="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base font-semibold outline-none focus:border-accent-text"
          />
        </label>

        <label class="mt-3 block">
          <span class="text-xs font-bold text-muted">뜻</span>
          <input
            name="meaning"
            required
            maxlength={500}
            autocomplete="off"
            placeholder="문맥, 전후관계; 배경, 상황"
            class="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base outline-none focus:border-accent-text"
          />
        </label>

        <button
          type="submit"
          class="mt-4 w-full rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white shadow-brand hover:bg-accent-strong"
        >
          추가
        </button>
      </form>

      {items.length === 0 ? (
        <div class="mt-6 rounded-2xl border border-dashed border-line-strong bg-surface px-5 py-10 text-center">
          <p class="text-sm font-semibold">아직 단어가 없습니다.</p>
          <p class="mt-1 text-xs leading-5 text-muted">
            위에 첫 단어를 추가하면 바로 퀴즈를 시작할 수 있습니다.
          </p>
        </div>
      ) : (
        <ul class="mt-6 space-y-2">
          {items.map((item) => (
            <li class="flex items-start justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
              <div class="min-w-0">
                <p class="font-word text-base break-words">{item.term}</p>
                <p class="mt-0.5 text-sm leading-5 text-muted break-words">
                  {item.meaning}
                </p>
              </div>
              <form method="post" action={`/words/${item.id}/delete`}>
                <button
                  type="submit"
                  class="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-danger-soft hover:text-danger"
                >
                  삭제
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <div class="mt-8 text-center">
        <a
          href="/"
          class="inline-flex rounded-2xl border border-line bg-surface px-5 py-3 text-sm font-bold hover:border-accent-text"
        >
          퀴즈 시작
        </a>
      </div>
    </Layout>
  );
});

words.post('/words', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const body = await c.req.parseBody();
  const term = typeof body['term'] === 'string' ? body['term'].trim() : '';
  const meaning =
    typeof body['meaning'] === 'string' ? body['meaning'].trim() : '';

  if (!term || !meaning) {
    return c.redirect('/words?state=error');
  }

  const result = await addVocab(
    c.env.DB,
    user.id,
    term.slice(0, 120),
    meaning.slice(0, 500)
  );

  return c.redirect(`/words?state=${result}`);
});

words.post('/words/:id/delete', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  await deleteVocab(c.env.DB, user.id, c.req.param('id'));
  return c.redirect('/words?state=deleted');
});

export default words;
