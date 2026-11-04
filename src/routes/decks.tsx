import { Hono } from 'hono';
import type { Env, WordRow } from '../types';
import { Layout } from '../components/layout';
import { formatDue } from '../lib/time';
import { buildDeckCsv, parseWordCsv } from '../lib/csv';
import { parseExtraExamples, parseJsonList } from '../lib/word-meta';
import {
  addWord,
  createDeck,
  deleteDeck,
  deleteWord,
  getDeck,
  listDecks,
  listWords,
  importSeed,
} from '../db/queries';

const SEEDS = [
  {
    slug: 'basic-1000',
    name: '기본 단어 1,000',
    description: '명사·동사·형용사·부사·구동사',
    file: '/seeds/basic-1000.csv',
  },
  {
    slug: 'function-100',
    name: '기능어 100',
    description: '관사·대명사·전치사·접속사·조동사',
    file: '/seeds/function-100.csv',
  },
];

const decks = new Hono<Env>();

decks.get('/decks', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const list = await listDecks(c.env.DB, user.id);

  return c.html(
    <Layout title="단어장" user={user}>
      <h1 class="text-xl font-semibold">단어장</h1>

      <form method="post" action="/decks" class="mt-6 flex gap-2">
        <input
          name="name"
          required
          maxlength={60}
          placeholder="새 단어장 이름"
          class="min-w-0 flex-1 rounded border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70"
        />
        <button type="submit" class="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          만들기
        </button>
      </form>

      {list.length === 0 ? (
        <p class="mt-8 border-t border-line pt-6 text-sm leading-6 text-muted">
          단어장이 없습니다. 아래에서 기본 단어로 시작하세요.
        </p>
      ) : (
        <ul class="mt-8">
          {list.map((d) => (
            <li class="flex items-baseline justify-between gap-4 border-b border-line py-3">
              <a href={`/decks/${d.id}`} class="text-[15px] hover:text-accent">
                {d.name}
              </a>
              <div class="flex shrink-0 items-baseline gap-4 text-sm text-muted">
                <span>{d.word_count}개</span>
                <button
                  hx-delete={`/decks/${d.id}`}
                  hx-confirm="단어장과 안의 단어를 모두 삭제할까요?"
                  class="text-xs hover:text-danger"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section class="mt-12 border-t border-line pt-6">
        <h2 class="text-sm font-semibold">기본 콘텐츠</h2>
        <p class="mt-1 text-sm leading-6 text-muted">
          바로 추가해서 시작할 수 있는 단어 세트입니다. 예문과 해석이 함께 들어 있습니다.
        </p>
        <ul class="mt-4 space-y-2">
          {SEEDS.map((seed) => (
            <li class="flex items-center justify-between gap-4 border border-line bg-surface px-4 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">{seed.name}</p>
                <p class="mt-0.5 text-xs text-muted">{seed.description}</p>
              </div>
              <form method="post" action={`/seeds/${seed.slug}`} class="shrink-0">
                <button
                  type="submit"
                  class="rounded border border-line px-3 py-1.5 text-sm hover:border-accent"
                >
                  추가
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
});

decks.post('/decks', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const body = await c.req.parseBody();
  const name = String(body['name'] ?? '').trim();
  if (!name) return c.redirect('/decks');

  const id = await createDeck(c.env.DB, user.id, name);
  return c.redirect(`/decks/${id}`);
});

decks.get('/decks/:id', async (c) => {  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const deck = await getDeck(c.env.DB, user.id, c.req.param('id'));
  if (!deck) return c.notFound();

  const words = await listWords(c.env.DB, deck.id);

  return c.html(
    <Layout title={deck.name} user={user}>
      <div class="flex items-baseline justify-between gap-4">
        <h1 class="text-xl font-semibold">{deck.name}</h1>
        <div class="flex shrink-0 items-baseline gap-3 text-sm text-muted">
          <span>{words.length}개</span>
          <a href={`/decks/${deck.id}/export`} class="text-accent hover:underline">
            내보내기
          </a>
          <a href={`/decks/${deck.id}/export?full=1`} class="text-accent hover:underline">
            전체
          </a>
        </div>
      </div>

      <form
        hx-post={`/decks/${deck.id}/words`}
        hx-target="#words"
        hx-swap="beforeend"
        {...({
          'hx-on::after-request':
            "if(event.detail.successful&&event.detail.xhr.getResponseHeader('X-Added'))this.reset()",
        } as any)}
        class="mt-6 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
      >
        <input
          name="term"
          required
          autocomplete="off"
          placeholder="단어"
          class="rounded border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70"
        />
        <input
          name="meaning"
          required
          autocomplete="off"
          placeholder="뜻"
          class="rounded border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70"
        />
        <button type="submit" class="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          추가
        </button>
        <input
          name="example"
          autocomplete="off"
          placeholder="예문 (선택)"
          class="rounded border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70 sm:col-span-3"
        />
        <span id="form-msg" class="text-sm text-danger sm:col-span-3"></span>
      </form>

      <ul id="words" class="mt-8">
        {words.map((w) => (
          <WordRowView w={w} />
        ))}
      </ul>
    </Layout>
  );
});

decks.get('/decks/:id/export', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const deck = await getDeck(c.env.DB, user.id, c.req.param('id'));
  if (!deck) return c.notFound();

  const words = await listWords(c.env.DB, deck.id);
  const body = buildDeckCsv(words, c.req.query('full') === '1');
  const asciiName = deck.name
    .replace(/[^A-Za-z0-9\-. ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  const fallback = asciiName || `deck-${deck.id.slice(0, 8)}`;

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header(
    'Content-Disposition',
    `attachment; filename="wordy-${fallback}.csv"; filename*=UTF-8''${encodeURIComponent(`wordy-${deck.name}.csv`)}`
  );

  return c.body(body);
});

decks.post('/decks/:id/words', async (c) => {  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const deck = await getDeck(c.env.DB, user.id, c.req.param('id'));
  if (!deck) return c.text('단어장을 찾을 수 없습니다.', 404);

  const body = await c.req.parseBody();
  const term = String(body['term'] ?? '').trim();
  const meaning = String(body['meaning'] ?? '').trim();
  const example = String(body['example'] ?? '').trim();

  if (!term || !meaning) {
    return c.html(<Msg text="단어와 뜻을 모두 입력해 주세요." />);
  }

  try {
    const id = await addWord(c.env.DB, user.id, deck.id, { term, meaning, example });

    const row: WordRow = {
      id,
      term,
      meaning,
      pos: null,
      example: example || null,
      example_ko: null,
      category: null,
      level: null,
      pronunciation: null,
      audio_url: null,
      collocations: null,
      synonyms: null,
      antonyms: null,
      extra_examples_raw: null,
      due_at: new Date().toISOString(),
      state: 'new',
    };

    c.header('X-Added', '1');
    return c.html(
      <>
        <WordRowView w={row} />
        <Msg text="" />
      </>
    );
  } catch {
    return c.html(<Msg text="이미 있는 단어입니다." />);
  }
});

decks.delete('/words/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('', 401);

  await deleteWord(c.env.DB, user.id, c.req.param('id'));
  return c.body(null, 200);
});

decks.delete('/decks/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('', 401);

  await deleteDeck(c.env.DB, user.id, c.req.param('id'));
  c.header('HX-Redirect', '/decks');
  return c.body(null, 200);
});

decks.post('/seeds/:slug', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const seed = SEEDS.find((s) => s.slug === c.req.param('slug'));
  if (!seed) return c.notFound();

  const res = await c.env.ASSETS.fetch(new Request(new URL(seed.file, c.req.url)));
  if (!res.ok) return c.text('기본 단어장 파일을 읽을 수 없습니다.', 500);

  const words = parseWordCsv(await res.text());
  const { deckId } = await importSeed(c.env.DB, user.id, seed.name, words);

  return c.redirect(`/decks/${deckId}`);
});

function WordRowView(props: { w: WordRow }) {
  const w = props.w;
  const collocations = parseJsonList(w.collocations);
  const synonyms = parseJsonList(w.synonyms);
  const antonyms = parseJsonList(w.antonyms);
  const extras = parseExtraExamples(w.extra_examples_raw);
  const hasDetails = extras.length > 0 || collocations.length > 0 || synonyms.length > 0 || antonyms.length > 0;

  return (
    <li id={`word-${w.id}`} class="flex items-baseline justify-between gap-4 border-b border-line py-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <span class="font-word text-[17px]">{w.term}</span>
          {w.pronunciation ? (
            <span class="text-xs text-muted">{w.pronunciation}</span>
          ) : null}
          <span class="text-sm text-muted">{w.meaning}</span>
          {w.level ? (
            <span class="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">
              {w.level}
            </span>
          ) : null}
          {w.category ? (
            <span class="text-[10px] text-muted">{w.category}</span>
          ) : null}
        </div>
        {w.example ? (
          <p class="mt-1 font-word text-sm leading-5 text-muted">{w.example}</p>
        ) : null}
        {w.example_ko ? (
          <p class="text-xs leading-5 text-muted">{w.example_ko}</p>
        ) : null}
        {hasDetails ? (
          <details class="mt-1">
            <summary class="cursor-pointer text-xs text-muted hover:text-accent">
              예문·표현 더 보기
            </summary>
            <div class="mt-1 space-y-1 text-sm leading-5 text-muted">
              {extras.map((example) => (
                <p>
                  <span class="font-word">{example.sentence}</span>
                  {example.translation ? <span> — {example.translation}</span> : null}
                </p>
              ))}
              {collocations.length > 0 ? (
                <p>함께 쓰는 표현: {collocations.join(' · ')}</p>
              ) : null}
              {synonyms.length > 0 ? <p>유의어: {synonyms.join(', ')}</p> : null}
              {antonyms.length > 0 ? <p>반의어: {antonyms.join(', ')}</p> : null}
            </div>
          </details>
        ) : null}
      </div>
      <div class="flex shrink-0 items-baseline gap-3 text-xs text-muted">
        <span>{formatDue(w.due_at)}</span>
        <button
          hx-delete={`/words/${w.id}`}
          hx-target={`#word-${w.id}`}
          hx-swap="outerHTML"
          hx-confirm="이 단어를 삭제할까요?"
          class="hover:text-danger"
        >
          삭제
        </button>
      </div>
    </li>
  );
}

function Msg(props: { text: string }) {
  return (
    <span id="form-msg" hx-swap-oob="true" class="text-sm text-danger sm:col-span-3">
      {props.text}
    </span>
  );
}

export default decks;
