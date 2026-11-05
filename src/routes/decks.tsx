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
  getWord,
  listDecks,
  listWords,
  listWordsPage,
  importSeed,
  updateWord,
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
      <h1 class="text-2xl font-extrabold tracking-tight">단어장</h1>

      <form
        method="post"
        action="/decks"
        class="mt-5 flex gap-2 rounded-2xl border border-line bg-surface p-3 shadow-card"
      >
        <input
          name="name"
          required
          maxlength={60}
          placeholder="새 단어장 이름"
          class="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-3 text-sm placeholder:text-muted/70"
        />
        <button type="submit" class="rounded-xl bg-accent shadow-brand px-4 py-3 text-sm font-bold text-white hover:bg-accent-strong">
          만들기
        </button>
      </form>

      {list.length === 0 ? (
        <p class="mt-5 rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-5 text-sm leading-6 text-muted">
          단어장이 없습니다. 아래에서 기본 단어로 시작하세요.
        </p>
      ) : (
        <ul class="mt-5 space-y-2">
          {list.map((d) => (
            <li class="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
              <a href={`/decks/${d.id}`} class="min-w-0">
                <span class="block text-sm font-bold hover:text-accent-text">{d.name}</span>
                <span class="mt-0.5 block text-xs text-muted">
                  {d.word_count.toLocaleString('ko-KR')}개
                </span>
              </a>
              <div class="flex shrink-0 items-center gap-3">
                <a
                  href={`/decks/${d.id}`}
                  class="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent-text"
                >
                  열기
                </a>
                <button
                  hx-delete={`/decks/${d.id}`}
                  hx-confirm="단어장과 안의 단어를 모두 삭제할까요?"
                  class="text-xs text-muted hover:text-danger"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section class="mt-10">
        <h2 class="text-base font-extrabold tracking-tight">기본 콘텐츠</h2>
        <p class="mt-1 text-sm leading-6 text-muted">
          바로 추가해서 시작할 수 있는 단어 세트입니다. 예문과 해석이 함께 들어 있습니다.
        </p>
        <ul class="mt-3 space-y-2">
          {SEEDS.map((seed) => (
            <li class="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
              <div class="min-w-0">
                <p class="text-sm font-bold">{seed.name}</p>
                <p class="mt-1 text-xs text-muted">{seed.description}</p>
              </div>
              <form method="post" action={`/seeds/${seed.slug}`} class="shrink-0">
                <button
                  type="submit"
                  class="min-h-11 rounded-xl bg-accent-soft px-4 py-2 text-sm font-bold text-accent-text hover:bg-accent/10"
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

decks.get('/decks/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const deck = await getDeck(c.env.DB, user.id, c.req.param('id'));
  if (!deck) return c.notFound();

  const query = (c.req.query('q') ?? '').trim().slice(0, 60);
  const requestedPage = Number(c.req.query('page'));
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const wordPage = await listWordsPage(c.env.DB, deck.id, { query, page });
  const countLabel = query
    ? `검색 ${wordPage.total.toLocaleString('ko-KR')}개 / 전체 ${wordPage.deckTotal.toLocaleString('ko-KR')}개`
    : `${wordPage.deckTotal.toLocaleString('ko-KR')}개`;

  return c.html(
    <Layout title={deck.name} user={user}>
      <div class="flex items-baseline justify-between gap-4">
        <h1 class="text-2xl font-extrabold tracking-tight">{deck.name}</h1>
        <div class="flex shrink-0 items-baseline gap-3 text-sm text-muted">
          <span id="word-count">{countLabel}</span>
          <a href={`/decks/${deck.id}/export`} class="font-semibold text-accent-text hover:underline">
            내보내기
          </a>
          <a href={`/decks/${deck.id}/export?full=1`} class="font-semibold text-accent-text hover:underline">
            전체
          </a>
        </div>
      </div>

      <form method="post" action="/play/start" class="mt-4">
        <input type="hidden" name="mode" value="custom" />
        <input type="hidden" name="deck_id" value={deck.id} />
        <button
          type="submit"
          class="w-full rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm font-semibold text-accent-text"
        >
          이 단어장의 새 단어로 한 판
        </button>
      </form>

      <form
        hx-post={`/decks/${deck.id}/words`}
        hx-target="#words"
        hx-swap="afterbegin"
        {...({
          'hx-on::after-request':
            "if(event.detail.successful&&event.detail.xhr.getResponseHeader('X-Added'))this.reset()",
        } as any)}
        class="mt-5 grid gap-2 rounded-2xl border border-line bg-surface p-3 shadow-card sm:grid-cols-[1fr_1fr_auto]"
      >
        <input
          name="term"
          required
          autocomplete="off"
          placeholder="단어"
          class="rounded-xl border border-line bg-surface px-3 py-3 text-sm placeholder:text-muted/70"
        />
        <input
          name="meaning"
          required
          autocomplete="off"
          placeholder="뜻"
          class="rounded-xl border border-line bg-surface px-3 py-3 text-sm placeholder:text-muted/70"
        />
        <button type="submit" class="rounded-xl bg-accent shadow-brand px-4 py-3 text-sm font-medium text-white hover:bg-accent-strong">
          추가
        </button>
        <input
          name="example"
          autocomplete="off"
          placeholder="예문 (선택)"
          class="rounded-xl border border-line bg-surface px-3 py-3 text-sm placeholder:text-muted/70 sm:col-span-3"
        />
        {query ? <input type="hidden" name="q" value={query} /> : null}
        {wordPage.deckTotal === 0 ? (
          <input type="hidden" name="empty" value="1" />
        ) : null}
        <span id="form-msg" class="text-sm text-danger sm:col-span-3"></span>
      </form>

      <form
        method="get"
        action={`/decks/${deck.id}`}
        class="mt-3 flex items-center gap-2 rounded-2xl border border-line bg-surface p-3 shadow-card"
      >
        <input
          name="q"
          value={query}
          autocomplete="off"
          placeholder="단어·뜻 검색"
          class="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm placeholder:text-muted/70"
        />
        <button
          type="submit"
          class="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold hover:border-accent-text"
        >
          검색
        </button>
        {query ? (
          <a
            href={`/decks/${deck.id}`}
            class="shrink-0 text-xs font-semibold text-muted hover:text-accent-text"
          >
            초기화
          </a>
        ) : null}
      </form>

      {query && wordPage.total === 0 ? (
        <p class="mt-8 rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-6 text-center text-sm leading-6 text-muted">
          “{query}” 검색 결과가 없습니다.
        </p>
      ) : wordPage.deckTotal === 0 ? (
        <p class="mt-8 rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-6 text-center text-sm leading-6 text-muted">
          단어가 없습니다. 위에서 첫 단어를 추가하세요.
        </p>
      ) : null}

      <ul id="words" class="mt-6">
        {wordPage.words.map((w) => (
          <WordRowView w={w} />
        ))}
      </ul>

      <Pagination
        deckId={deck.id}
        page={wordPage.page}
        totalPages={wordPage.totalPages}
        query={query}
      />
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

    // 첫 단어이거나 검색 중이면 목록·개수·빈 상태를 다시 계산한다.
    if (body['empty'] === '1' || typeof body['q'] === 'string') {
      c.header('HX-Refresh', 'true');
      return c.body(null, 200);
    }

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

decks.post('/words/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.text('로그인이 필요합니다.', 401);

  const wordId = c.req.param('id');
  const body = await c.req.parseBody();
  const term = String(body['term'] ?? '').trim();
  const meaning = String(body['meaning'] ?? '').trim();
  const example = String(body['example'] ?? '').trim();
  const exampleKo = String(body['example_ko'] ?? '').trim();
  const draft = { term, meaning, example, exampleKo };

  if (!term || !meaning) {
    const current = await getWord(c.env.DB, user.id, wordId);
    if (!current) return c.text('단어를 찾을 수 없습니다.', 404);
    return c.html(
      <WordRowView w={current} error="단어와 뜻을 모두 입력해 주세요." draft={draft} />
    );
  }

  try {
    const updated = await updateWord(c.env.DB, user.id, wordId, {
      term,
      meaning,
      example,
      exampleKo,
    });
    if (!updated) return c.text('단어를 찾을 수 없습니다.', 404);
  } catch {
    const current = await getWord(c.env.DB, user.id, wordId);
    if (!current) return c.text('단어를 찾을 수 없습니다.', 404);
    return c.html(
      <WordRowView w={current} error="이미 있는 단어입니다." draft={draft} />
    );
  }

  const updated = await getWord(c.env.DB, user.id, wordId);
  if (!updated) return c.text('단어를 찾을 수 없습니다.', 404);
  return c.html(<WordRowView w={updated} />);
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

  const body = await c.req.parseBody();
  const nextHome = body['next'] === 'home';

  const res = await c.env.ASSETS.fetch(new Request(new URL(seed.file, c.req.url)));
  if (!res.ok) return c.text('기본 단어장 파일을 읽을 수 없습니다.', 500);

  const words = parseWordCsv(await res.text());
  const { deckId } = await importSeed(c.env.DB, user.id, seed.name, words);

  return c.redirect(nextHome ? '/?seeded=1' : `/decks/${deckId}`);
});

function WordRowView(props: {
  w: WordRow;
  error?: string;
  draft?: { term: string; meaning: string; example: string; exampleKo: string };
}) {
  const w = props.w;
  const termValue = props.draft?.term ?? w.term;
  const meaningValue = props.draft?.meaning ?? w.meaning;
  const exampleValue = props.draft?.example ?? w.example ?? '';
  const exampleKoValue = props.draft?.exampleKo ?? w.example_ko ?? '';
  const collocations = parseJsonList(w.collocations);
  const synonyms = parseJsonList(w.synonyms);
  const antonyms = parseJsonList(w.antonyms);
  const extras = parseExtraExamples(w.extra_examples_raw);
  const hasDetails = extras.length > 0 || collocations.length > 0 || synonyms.length > 0 || antonyms.length > 0;

  return (
    <li id={`word-${w.id}`} class="border-b border-line py-3">
      <div class="flex items-baseline justify-between gap-4">
        <div class="min-w-0">
          <div class="flex flex-wrap items-baseline gap-x-2">
            <span class="font-word text-lg">{w.term}</span>
            {w.pronunciation ? (
              <span class="text-xs text-muted">{w.pronunciation}</span>
            ) : null}
            <span class="text-sm text-muted">{w.meaning}</span>
            {w.level ? (
              <span class="rounded-full bg-line px-2 py-1 text-xs font-semibold text-muted">
                {w.level}
              </span>
            ) : null}
            {w.category ? (
              <span class="text-xs text-muted">{w.category}</span>
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
              <summary class="cursor-pointer text-xs text-muted hover:text-accent-text">
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
      </div>

      <details open={Boolean(props.error)} class="mt-1">
        <summary class="cursor-pointer text-xs text-muted hover:text-accent-text">
          수정
        </summary>
        <form
          hx-post={`/words/${w.id}`}
          hx-target={`#word-${w.id}`}
          hx-swap="outerHTML"
          hx-disabled-elt="find button"
          class="mt-2 grid gap-2 rounded-xl border border-line bg-paper p-3 sm:grid-cols-2"
        >
          <input
            name="term"
            value={termValue}
            required
            autocomplete="off"
            placeholder="단어"
            class="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm placeholder:text-muted/70"
          />
          <input
            name="meaning"
            value={meaningValue}
            required
            autocomplete="off"
            placeholder="뜻"
            class="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm placeholder:text-muted/70"
          />
          <input
            name="example"
            value={exampleValue}
            autocomplete="off"
            placeholder="예문 (선택)"
            class="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm placeholder:text-muted/70 sm:col-span-2"
          />
          <input
            name="example_ko"
            value={exampleKoValue}
            autocomplete="off"
            placeholder="예문 해석 (선택)"
            class="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm placeholder:text-muted/70 sm:col-span-2"
          />
          {props.error ? (
            <p class="text-sm text-danger sm:col-span-2">{props.error}</p>
          ) : null}
          <div class="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              class="min-h-10 rounded-lg bg-accent px-4 py-2.5 text-xs font-bold text-white shadow-brand hover:bg-accent-strong"
            >
              저장
            </button>
          </div>
        </form>
      </details>
    </li>
  );
}

function Pagination(props: {
  deckId: string;
  page: number;
  totalPages: number;
  query: string;
}) {
  if (props.totalPages <= 1) return null;

  const href = (page: number): string => {
    const params = new URLSearchParams();
    if (props.query) params.set('q', props.query);
    params.set('page', String(page));
    return `/decks/${props.deckId}?${params.toString()}`;
  };

  const active =
    'rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent-text';
  const inactive =
    'rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-muted opacity-40';

  return (
    <nav class="mt-4 flex items-center justify-between gap-3" aria-label="페이지">
      {props.page > 1 ? (
        <a href={href(props.page - 1)} class={active}>
          이전
        </a>
      ) : (
        <span class={inactive}>이전</span>
      )}
      <span class="text-xs text-muted">
        {props.page} / {props.totalPages}
      </span>
      {props.page < props.totalPages ? (
        <a href={href(props.page + 1)} class={active}>
          다음
        </a>
      ) : (
        <span class={inactive}>다음</span>
      )}
    </nav>
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
