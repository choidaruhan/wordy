import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout } from '../components/layout';
import {
  addVocab,
  deleteVocab,
  filterVocab,
  getVocabById,
  listVocab,
  updateVocab,
} from '../db/vocab';

const words = new Hono<Env>();

type EditItem = { id: string; term: string; meaning: string };

function Notice(props: {
  kind: 'created' | 'updated' | 'edited' | 'deleted' | 'error';
}) {
  const text =
    props.kind === 'created'
      ? '단어를 추가했습니다.'
      : props.kind === 'updated'
        ? '이미 있는 단어라 뜻을 업데이트했습니다.'
        : props.kind === 'edited'
          ? '단어를 수정했습니다.'
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

function Field(props: {
  label: string;
  name: string;
  value?: string;
  placeholder?: string;
  maxlength: number;
  autoFocus?: boolean;
  filter?: boolean;
}) {
  return (
    <label class="block">
      <span class="text-xs font-bold text-muted">{props.label}</span>
      <input
        name={props.name}
        required
        maxlength={props.maxlength}
        value={props.value ?? ''}
        placeholder={props.placeholder}
        autocomplete="off"
        spellcheck={false}
        autofocus={props.autoFocus}
        hx-get={props.filter ? '/words/filter' : undefined}
        hx-trigger={props.filter ? 'input changed delay:150ms' : undefined}
        hx-target={props.filter ? '#word-list' : undefined}
        hx-swap={props.filter ? 'innerHTML' : undefined}
        hx-sync={props.filter ? 'this:replace' : undefined}
        class="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base outline-none focus:border-accent-text"
      />
    </label>
  );
}

function WordList(props: { items: EditItem[]; query: string }) {
  const q = props.query.trim().slice(0, 120);
  const exact = q
    ? props.items.some((item) => item.term.toLowerCase() === q.toLowerCase())
    : false;

  if (props.items.length === 0) {
    return (
      <div class="mt-6 rounded-2xl border border-dashed border-line-strong bg-surface px-5 py-10 text-center">
        <p class="text-sm font-semibold">
          {q ? `‘${q}’로 시작하는 단어가 없습니다.` : '아직 단어가 없습니다.'}
        </p>
        <p class="mt-1 text-xs leading-5 text-muted">
          {q
            ? '위에서 새 단어로 추가할 수 있습니다.'
            : '위에 첫 단어를 추가하면 바로 퀴즈를 시작할 수 있습니다.'}
        </p>
      </div>
    );
  }

  return (
    <div class="mt-6">
      {exact ? (
        <p class="mb-2 rounded-xl border border-streak/30 bg-streak-soft px-4 py-3 text-sm font-semibold text-ink">
          이미 등록된 단어입니다. 아래에서 수정하세요.
        </p>
      ) : null}
      {q ? (
        <p class="mb-2 text-xs font-semibold text-muted">
          ‘{q}’로 시작하는 단어 {props.items.length}개
        </p>
      ) : null}
      <ul class="space-y-2">
        {props.items.map((item) => (
          <li class="flex items-start justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
            <div class="min-w-0">
              <p class="font-word text-base break-words">{item.term}</p>
              <p class="mt-0.5 text-sm leading-5 text-muted break-words">
                {item.meaning}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <a
                href={`/words/${item.id}/edit`}
                class="rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-accent-soft hover:text-accent-text"
              >
                수정
              </a>
              <form method="post" action={`/words/${item.id}/delete`}>
                <button
                  type="submit"
                  class="rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-danger-soft hover:text-danger"
                >
                  삭제
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditPage(props: { item: EditItem; duplicate?: boolean }) {
  return (
    <>
      <a
        href="/words"
        class="text-xs font-semibold text-muted hover:text-accent-text"
      >
        ← 단어 목록
      </a>
      <h1 class="mt-2 text-2xl font-extrabold tracking-tight">단어 수정</h1>

      {props.duplicate ? (
        <p class="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
          같은 단어가 이미 있습니다. 다른 표제어를 쓰거나 기존 단어를 수정하세요.
        </p>
      ) : null}

      <form
        method="post"
        action={`/words/${props.item.id}`}
        class="mt-5 rounded-2xl border border-line bg-surface p-4 shadow-card"
      >
        <Field
          label="영어 단어"
          name="term"
          value={props.item.term}
          placeholder="context"
          maxlength={120}
          autoFocus
        />
        <div class="mt-3">
          <Field
            label="뜻"
            name="meaning"
            value={props.item.meaning}
            placeholder="문맥, 전후관계; 배경, 상황"
            maxlength={500}
          />
        </div>

        <div class="mt-4 flex gap-2">
          <button
            type="submit"
            class="flex-1 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white shadow-brand hover:bg-accent-strong"
          >
            저장
          </button>
          <a
            href="/words"
            class="flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm font-bold hover:border-accent-text"
          >
            취소
          </a>
        </div>
      </form>
    </>
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
      state === 'edited' ||
      state === 'deleted' ||
      state === 'error' ? (
        <Notice kind={state} />
      ) : null}

      <form
        method="post"
        action="/words"
        class="mt-5 rounded-2xl border border-line bg-surface p-4 shadow-card"
      >
        <Field
          label="영어 단어"
          name="term"
          placeholder="context"
          maxlength={120}
          autoFocus
          filter
        />
        <p class="mt-1 text-xs text-muted">
          입력하면 아래 목록이 그 철자로 시작하는 단어만 보입니다.
        </p>
        <div class="mt-3">
          <Field
            label="뜻"
            name="meaning"
            placeholder="문맥, 전후관계; 배경, 상황"
            maxlength={500}
          />
        </div>

        <button
          type="submit"
          class="mt-4 w-full rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white shadow-brand hover:bg-accent-strong"
        >
          추가
        </button>
      </form>

      <div id="word-list">
        <WordList items={items} query="" />
      </div>

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

words.get('/words/filter', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('', 401);

  const query = c.req.query('term') ?? '';
  const items = await filterVocab(c.env.DB, user.id, query);

  return c.html(<WordList items={items} query={query} />);
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

words.get('/words/:id/edit', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const item = await getVocabById(c.env.DB, user.id, c.req.param('id'));
  if (!item) return c.notFound();

  return c.html(
    <Layout title="단어 수정" user={user} active="words">
      <EditPage item={item} />
    </Layout>
  );
});

words.post('/words/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const term = typeof body['term'] === 'string' ? body['term'].trim() : '';
  const meaning =
    typeof body['meaning'] === 'string' ? body['meaning'].trim() : '';

  if (!term || !meaning) {
    return c.redirect(`/words/${id}/edit`);
  }

  const result = await updateVocab(
    c.env.DB,
    user.id,
    id,
    term.slice(0, 120),
    meaning.slice(0, 500)
  );

  if (result === 'missing') return c.notFound();
  if (result === 'duplicate') {
    return c.html(
      <Layout title="단어 수정" user={user} active="words">
        <EditPage
          item={{ id, term: term.slice(0, 120), meaning: meaning.slice(0, 500) }}
          duplicate
        />
      </Layout>,
      409
    );
  }

  return c.redirect('/words?state=edited');
});

words.post('/words/:id/delete', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  await deleteVocab(c.env.DB, user.id, c.req.param('id'));
  return c.redirect('/words?state=deleted');
});

export default words;
