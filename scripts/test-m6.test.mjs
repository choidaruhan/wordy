import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildSync } from 'esbuild';

// Node ESM은 extensionless import를 해석하지 못한다. 앱과 같은 번들러 설정으로 묶어서 테스트한다.
const bundleDir = mkdtempSync(join(tmpdir(), 'wordy-m6-'));
buildSync({
  entryPoints: [
    'src/db/review.ts',
    'src/db/stats.ts',
    'src/db/weak.ts',
    'src/db/plan.ts',
    'src/db/queries.ts',
    'src/lib/csv.ts',
    'src/lib/word-meta.ts',
    'src/lib/srs.ts',
  ],
  outdir: bundleDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});

const { saveReview, getProgress, ensureUnlocks } = await import(
  pathToFileURL(join(bundleDir, 'db/review.js')).href
);
const { learnedCount, dailyStats, rangeSummary } = await import(
  pathToFileURL(join(bundleDir, 'db/stats.js')).href
);
const {
  listWeakness,
  listObservingWords,
  listStaleWords,
  weakWordIds,
  countWeakDue,
  nextWeakDueReview,
  countWeakDoneToday,
} = await import(pathToFileURL(join(bundleDir, 'db/weak.js')).href);
const {
  getTodayPlan,
  updatePlanCompletion,
  countDueByType,
  servedByTypeSince,
} = await import(pathToFileURL(join(bundleDir, 'db/plan.js')).href);
const { importSeed, listWords, addWord } = await import(
  pathToFileURL(join(bundleDir, 'db/queries.js')).href
);
const { parseWordCsv, buildDeckCsv } = await import(
  pathToFileURL(join(bundleDir, 'lib/csv.js')).href
);
const { parseJsonList, parseExtraExamples } = await import(
  pathToFileURL(join(bundleDir, 'lib/word-meta.js')).href
);
const {
  parseFsrsParams,
  schedule,
  previewIntervals,
  FSRS_PARAM_LENGTH,
} = await import(pathToFileURL(join(bundleDir, 'lib/srs.js')).href);

test.after(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});

const MIGRATIONS = [
  '0001_init.sql',
  '0002_card_learning_steps.sql',
  '0003_quiz.sql',
  '0004_review_instrumentation.sql',
  '0005_review_idempotency.sql',
  '0006_daily_plans.sql',
  '0007_words_metadata.sql',
  '0008_user_preferences.sql',
  '0009_fsrs_params.sql',
];

function migrationSql(name) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
}

function freshDb(upTo = MIGRATIONS.length) {
  const db = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS.slice(0, upTo)) db.exec(migrationSql(name));
  return db;
}

/** D1Database의 최소 어댑터. batch는 트랜잭션으로 실행한다. */
function d1(db) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const info = db.prepare(sql).run(...args);
              return { meta: { changes: Number(info.changes) } };
            },
            async first() {
              return db.prepare(sql).get(...args) ?? null;
            },
            async all() {
              return { results: db.prepare(sql).all(...args) };
            },
          };
        },
      };
    },
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const stmt of stmts) results.push(await stmt.run());
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

function testUser(overrides = {}) {
  return {
    id: 'u1',
    email: 'u1@test.local',
    display_name: null,
    tz_offset_min: 540,
    daily_new: 10,
    daily_review: 200,
    new_card_mode: 'auto',
    ...overrides,
  };
}

function seedUser(db, id = 'u1') {
  db.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)'
  ).run(id, `${id}@test.local`, '2026-11-01T00:00:00.000Z');
}

function seedDeck(db, id = 'd1', userId = 'u1') {
  db.prepare(
    'INSERT INTO decks (id, user_id, name, created_at) VALUES (?, ?, ?, ?)'
  ).run(id, userId, '테스트', '2026-11-01T00:00:00.000Z');
}

function seedWord(
  db,
  { id, deckId = 'd1', term = 'test', meaning = '테스트', pos = 'n', example = null, exampleKo = null }
) {
  db.prepare(
    `INSERT INTO words (id, deck_id, term, meaning, pos, example, example_ko, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, deckId, term, meaning, pos, example, exampleKo, '2026-11-01T00:00:00.000Z');
}

function seedCard(
  db,
  {
    id,
    wordId,
    userId = 'u1',
    type = 'recognition',
    dueAt = '2026-11-04T00:00:00.000Z',
    state = 'new',
    stability = 0,
    difficulty = 0,
    scheduledDays = 0,
    reps = 0,
    lapses = 0,
    lastReviewedAt = null,
    suspended = 0,
  }
) {
  db.prepare(
    `INSERT INTO cards (
       id, word_id, user_id, card_type, due_at, state, stability, difficulty,
       scheduled_days, learning_steps, reps, lapses, last_reviewed_at, suspended, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
  ).run(
    id,
    wordId,
    userId,
    type,
    dueAt,
    state,
    stability,
    difficulty,
    scheduledDays,
    reps,
    lapses,
    lastReviewedAt,
    suspended,
    '2026-11-01T00:00:00.000Z'
  );
}

function seedReview(
  db,
  {
    id,
    cardId,
    userId = 'u1',
    rating = 3,
    localDate = '2026-11-04',
    reviewedAt,
    repsBefore = 5,
    prevState = 'review',
    questionType = null,
    source = null,
  }
) {
  if (questionType) {
    db.prepare(
      `INSERT INTO reviews (
         id, card_id, user_id, rating, local_date, reviewed_at,
         elapsed_days, scheduled_days, reps_before, prev_state, question_type, source
       ) VALUES (?, ?, ?, ?, ?, ?, 5, 10, ?, ?, ?, ?)`
    ).run(
      id,
      cardId,
      userId,
      rating,
      localDate,
      reviewedAt,
      repsBefore,
      prevState,
      questionType,
      source ?? 'review'
    );
    return;
  }

  db.prepare(
    `INSERT INTO reviews (
       id, card_id, user_id, rating, local_date, reviewed_at,
       elapsed_days, scheduled_days, reps_before, prev_state
     ) VALUES (?, ?, ?, ?, ?, ?, 5, 10, ?, ?)`
  ).run(id, cardId, userId, rating, localDate, reviewedAt, repsBefore, prevState);
}

function seedManyReviews(db, cardId, ratings, base = '2026-11-04T00') {
  ratings.forEach((rating, i) => {
    const minute = String(i).padStart(2, '0');
    seedReview(db, {
      id: `${cardId}-r${i}`,
      cardId,
      rating,
      questionType: 'recognition',
      reviewedAt: `${base}:${minute}:00Z`,
    });
  });
}

function seedQuizWrongs(db, userId, wordId, count) {
  const sessionId = `qs-${wordId}`;
  db.prepare(
    'INSERT INTO quiz_sessions (id, user_id, total, correct, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    sessionId,
    userId,
    count,
    0,
    '2026-11-03T00:00:00.000Z',
    '2026-11-03T00:10:00.000Z'
  );

  for (let i = 0; i < count; i++) {
    db.prepare(
      `INSERT INTO quiz_questions
         (id, session_id, word_id, position, options, answer_index, chosen_index, is_correct, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `qq-${wordId}-${i}`,
      sessionId,
      wordId,
      i,
      '["a","b"]',
      0,
      1,
      0,
      '2026-11-03T00:05:00.000Z'
    );
  }
}

function getCard(db, cardId) {
  return db
    .prepare(
      `SELECT c.*, w.term, w.meaning, w.pos, w.example, w.example_ko, w.note
         FROM cards c
         JOIN words w ON w.id = c.word_id
        WHERE c.id = ?`
    )
    .get(cardId);
}

function count(db, sql, ...args) {
  return db.prepare(sql).get(...args)?.n ?? 0;
}

test('0004: 기존 리뷰를 보존하고 계측 컬럼을 백필한다', () => {
  const db = freshDb(3);
  seedUser(db);
  seedDeck(db);
  seedWord(db, { id: 'w1', term: 'test' });
  seedWord(db, { id: 'w2', term: 'in', pos: 'prep' });
  seedCard(db, { id: 'c1', wordId: 'w1' });
  seedCard(db, { id: 'c2', wordId: 'w2', type: 'recall' });

  seedReview(db, { id: 'r1', cardId: 'c1', rating: 1, reviewedAt: '2026-11-04T00:00:01.000Z' });
  seedReview(db, { id: 'r2', cardId: 'c1', rating: 2, reviewedAt: '2026-11-04T00:00:02.000Z' });
  seedReview(db, { id: 'r3', cardId: 'c1', rating: 3, reviewedAt: '2026-11-04T00:00:03.000Z' });
  seedReview(db, { id: 'r4', cardId: 'c2', rating: 4, reviewedAt: '2026-11-04T00:00:04.000Z' });

  const before = count(db, 'SELECT COUNT(*) AS n FROM reviews');
  assert.equal(before, 4);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM words'), 2);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM cards'), 2);

  db.exec(migrationSql('0004_review_instrumentation.sql'));

  const after = count(db, 'SELECT COUNT(*) AS n FROM reviews');
  assert.equal(after, 4);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM words'), 2);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM cards'), 2);

  const rows = db
    .prepare(
      `SELECT id, rating, is_correct, question_type, grading_source, attempt_seq, source
         FROM reviews ORDER BY reviewed_at`
    )
    .all();

  assert.deepEqual(
    rows.map((r) => [r.id, r.is_correct]),
    [
      ['r1', 0],
      ['r2', 1],
      ['r3', 1],
      ['r4', 1],
    ]
  );
  assert.equal(rows[0].question_type, 'recognition');
  assert.equal(rows[0].grading_source, 'self');
  assert.equal(rows[3].question_type, 'recall');
  assert.equal(rows[3].grading_source, 'server');
  assert.deepEqual(rows.map((r) => r.attempt_seq), [1, 2, 3, 1]);
  assert.ok(rows.every((r) => r.source === 'review'));

  const indexes = db.prepare(`PRAGMA index_list('reviews')`).all();
  assert.ok(indexes.some((i) => i.name === 'ux_reviews_card_date_attempt'));

  db.exec(migrationSql('0005_review_idempotency.sql'));
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM reviews WHERE review_key IS NULL'), 4);

  const idempotencyIndexes = db.prepare(`PRAGMA index_list('reviews')`).all();
  assert.ok(idempotencyIndexes.some((i) => i.name === 'ux_reviews_user_review_key'));
});

test('saveReview: 카드 상태와 리뷰 로그를 원자적으로 저장하고 중복을 막는다', async () => {
  const db = freshDb();
  const database = d1(db);
  seedUser(db);
  seedDeck(db);
  seedWord(db, { id: 'w1', term: 'abandon', meaning: '포기하다' });
  seedCard(db, { id: 'c1', wordId: 'w1' });

  const before = getCard(db, 'c1');
  const now = new Date('2026-11-04T12:00:00.000Z');

  const saved = await saveReview(database, 'u1', before, 3, now, '2026-11-04', {
    responseMs: 1234,
  });

  assert.ok(saved);

  const card = getCard(db, 'c1');
  assert.equal(card.reps, 1);
  assert.equal(card.state, saved.state);
  assert.equal(card.due_at, saved.due_at);
  assert.equal(card.last_reviewed_at, now.toISOString());

  const reviews = db
    .prepare(
      `SELECT rating, is_correct, question_type, grading_source, response_ms,
              attempt_seq, source, next_state, next_due_at
         FROM reviews ORDER BY reviewed_at`
    )
    .all();

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].rating, 3);
  assert.equal(reviews[0].is_correct, 1);
  assert.equal(reviews[0].question_type, 'recognition');
  assert.equal(reviews[0].grading_source, 'self');
  assert.equal(reviews[0].response_ms, 1234);
  assert.equal(reviews[0].attempt_seq, 1);
  assert.equal(reviews[0].source, 'review');
  assert.equal(reviews[0].next_state, saved.state);
  assert.equal(reviews[0].next_due_at, saved.due_at);

  // 같은 카드 row(reps=0)로 재시도 → UPDATE 0행, INSERT 0행
  const duplicate = await saveReview(database, 'u1', before, 3, now, '2026-11-04');
  assert.equal(duplicate, null);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM reviews'), 1);
  assert.equal(getCard(db, 'c1').reps, 1);

  // 같은 날짜의 정상 재시도는 attempt_seq가 2가 된다
  const current = getCard(db, 'c1');
  await saveReview(database, 'u1', current, 3, new Date(now.getTime() + 60_000), '2026-11-04');
  const seqs = db
    .prepare('SELECT attempt_seq FROM reviews WHERE card_id = ? ORDER BY reviewed_at')
    .all('c1');
  assert.deepEqual(seqs.map((r) => r.attempt_seq), [1, 2]);
});

test('saveReview: 같은 review_key 재전송은 카드 상태를 다시 바꾸지 않는다', async () => {
  const db = freshDb();
  const database = d1(db);
  seedUser(db);
  seedDeck(db);
  seedWord(db, { id: 'w1', term: 'idempotent' });
  seedCard(db, { id: 'c1', wordId: 'w1' });

  const now = new Date('2026-11-04T12:00:00.000Z');
  const first = await saveReview(database, 'u1', getCard(db, 'c1'), 3, now, '2026-11-04', {
    reviewKey: 'c1:prompt-1',
  });
  assert.ok(first);

  const cardAfterFirst = getCard(db, 'c1');
  const second = await saveReview(
    database,
    'u1',
    cardAfterFirst,
    3,
    new Date(now.getTime() + 60_000),
    '2026-11-04',
    { reviewKey: 'c1:prompt-1' }
  );

  assert.equal(second, null);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM reviews'), 1);
  assert.equal(getCard(db, 'c1').reps, cardAfterFirst.reps);
});

test('saveReview: Hard는 정답, Again은 오답, weak source를 구분한다', async () => {
  const db = freshDb();
  const database = d1(db);
  seedUser(db);
  seedDeck(db);

  seedWord(db, { id: 'w1', term: 'hard', meaning: '어려운' });
  seedCard(db, { id: 'c1', wordId: 'w1' });
  await saveReview(database, 'u1', getCard(db, 'c1'), 2, new Date('2026-11-04T12:00:00Z'), '2026-11-04');

  seedWord(db, { id: 'w2', term: 'again', meaning: '다시' });
  seedCard(db, { id: 'c2', wordId: 'w2' });
  await saveReview(database, 'u1', getCard(db, 'c2'), 1, new Date('2026-11-04T12:00:00Z'), '2026-11-04');

  seedWord(db, { id: 'w3', term: 'weak', meaning: '취약' });
  seedCard(db, { id: 'c3', wordId: 'w3' });
  await saveReview(database, 'u1', getCard(db, 'c3'), 3, new Date('2026-11-04T12:00:00Z'), '2026-11-04', {
    source: 'weak',
  });

  const rows = db
    .prepare('SELECT card_id, is_correct, source FROM reviews ORDER BY card_id')
    .all();
  assert.deepEqual(
    rows.map((r) => [r.card_id, r.is_correct, r.source]),
    [
      ['c1', 1, 'review'],
      ['c2', 0, 'review'],
      ['c3', 1, 'weak'],
    ]
  );
});

test('getProgress: daily_review 상한과 승급/신규 쿼터를 분리한다', async () => {
  const db = freshDb();
  const database = d1(db);
  seedUser(db);
  seedDeck(db);

  for (let i = 1; i <= 3; i++) {
    seedWord(db, { id: `wr${i}`, term: `review${i}` });
    seedCard(db, {
      id: `cr${i}`,
      wordId: `wr${i}`,
      state: 'review',
      dueAt: '2026-11-04T00:00:00.000Z',
      scheduledDays: 10,
      reps: 5,
    });
  }

  for (let i = 1; i <= 2; i++) {
    seedWord(db, { id: `wp${i}`, term: `promoted${i}` });
    seedCard(db, {
      id: `cp${i}`,
      wordId: `wp${i}`,
      type: 'recall',
      dueAt: '2026-11-04T00:00:00.000Z',
    });
  }

  for (let i = 1; i <= 5; i++) {
    seedWord(db, { id: `wn${i}`, term: `new${i}` });
    seedCard(db, { id: `cn${i}`, wordId: `wn${i}`, dueAt: '2026-11-04T00:00:00.000Z' });
  }

  // 오늘 리뷰 4건: 신규 소개 2건 + 일반 복습 2건
  seedReview(db, {
    id: 'a1',
    cardId: 'cn1',
    repsBefore: 0,
    questionType: 'recognition',
    reviewedAt: '2026-11-04T01:00:00Z',
  });
  seedReview(db, {
    id: 'a2',
    cardId: 'cn2',
    repsBefore: 0,
    questionType: 'recognition',
    reviewedAt: '2026-11-04T01:01:00Z',
  });
  seedReview(db, {
    id: 'a3',
    cardId: 'cr1',
    repsBefore: 5,
    questionType: 'recognition',
    reviewedAt: '2026-11-04T01:02:00Z',
  });
  seedReview(db, {
    id: 'a4',
    cardId: 'cr1',
    repsBefore: 6,
    questionType: 'recognition',
    reviewedAt: '2026-11-04T01:03:00Z',
  });

  const p = await getProgress(database, 'u1', '2026-11-04', '2026-11-04T12:00:00.000Z', 5, 4);
  assert.equal(p.done, 4);
  assert.equal(p.reviewLeft, 2);
  assert.equal(p.promotedLeft, 0);
  assert.equal(p.newLeft, 3);
  assert.equal(p.remaining, 5);

  const p2 = await getProgress(database, 'u1', '2026-11-04', '2026-11-04T12:00:00.000Z', 1, 10);
  assert.equal(p2.reviewLeft, 8);
  assert.equal(p2.promotedLeft, 2);
  assert.equal(p2.newLeft, 0);
  assert.equal(p2.remaining, 5);
});

test('stats: Hard를 정답으로, Again만 오답으로 집계한다', async () => {
  const db = freshDb();
  const database = d1(db);
  seedUser(db);
  seedDeck(db);
  seedWord(db, { id: 'w1', term: 'stats' });
  seedCard(db, { id: 'c1', wordId: 'w1', state: 'review', reps: 5 });

  seedReview(db, {
    id: 'r1',
    cardId: 'c1',
    rating: 1,
    questionType: 'recognition',
    reviewedAt: '2026-11-04T01:00:00Z',
  });
  seedReview(db, {
    id: 'r2',
    cardId: 'c1',
    rating: 2,
    questionType: 'recognition',
    reviewedAt: '2026-11-04T01:01:00Z',
  });
  seedReview(db, {
    id: 'r3',
    cardId: 'c1',
    rating: 3,
    questionType: 'recognition',
    reviewedAt: '2026-11-04T01:02:00Z',
  });
  seedReview(db, {
    id: 'r4',
    cardId: 'c1',
    rating: 4,
    questionType: 'recognition',
    reviewedAt: '2026-11-04T01:03:00Z',
  });

  const daily = await dailyStats(database, 'u1', '2026-11-04');
  assert.equal(daily.length, 1);
  assert.equal(daily[0].date, '2026-11-04');
  assert.equal(daily[0].total, 4);
  assert.equal(daily[0].correct, 3);

  const summary = await rangeSummary(database, 'u1', '2026-11-04');
  assert.equal(summary.total, 4);
  assert.equal(summary.correct, 3);
});

test('learnedCount: 카드 수가 아니라 고유 단어 수를 센다', async () => {
  const db = freshDb();
  const database = d1(db);
  seedUser(db);
  seedDeck(db);

  // w1: recognition 21 + recall 7 → Known
  seedWord(db, { id: 'w1', term: 'known' });
  seedCard(db, { id: 'w1r', wordId: 'w1', state: 'review', scheduledDays: 21, reps: 5 });
  seedCard(db, { id: 'w1p', wordId: 'w1', type: 'recall', state: 'review', scheduledDays: 7, reps: 5 });

  // w2: recognition만 → 생산형 카드 없음, 제외
  seedWord(db, { id: 'w2', term: 'recognition-only' });
  seedCard(db, { id: 'w2r', wordId: 'w2', state: 'review', scheduledDays: 21, reps: 5 });

  // w3: recognition 21 + recall 7 + cloze 21 → 단어 1개로 카운트
  seedWord(db, { id: 'w3', term: 'mastered' });
  seedCard(db, { id: 'w3r', wordId: 'w3', state: 'review', scheduledDays: 21, reps: 5 });
  seedCard(db, { id: 'w3p', wordId: 'w3', type: 'recall', state: 'review', scheduledDays: 7, reps: 5 });
  seedCard(db, { id: 'w3c', wordId: 'w3', type: 'cloze', state: 'review', scheduledDays: 21, reps: 5 });

  // w4: recognition 20 → 제외
  seedWord(db, { id: 'w4', term: 'almost' });
  seedCard(db, { id: 'w4r', wordId: 'w4', state: 'review', scheduledDays: 20, reps: 5 });
  seedCard(db, { id: 'w4p', wordId: 'w4', type: 'recall', state: 'review', scheduledDays: 30, reps: 5 });

  // w5: 생산형 카드가 7일 미만 → 제외
  seedWord(db, { id: 'w5', term: 'early' });
  seedCard(db, { id: 'w5r', wordId: 'w5', state: 'review', scheduledDays: 21, reps: 5 });
  seedCard(db, { id: 'w5p', wordId: 'w5', type: 'recall', state: 'review', scheduledDays: 6, reps: 5 });

  assert.equal(await learnedCount(database, 'u1'), 2);
});

test('weak: 취약/주의/관찰/격리를 분류하고 due 연습 대상을 찾는다', async () => {
  const db = freshDb();
  const database = d1(db);
  seedUser(db);
  seedDeck(db);

  // weak
  seedWord(db, { id: 'w_weak', term: 'weakword', meaning: '취약한' });
  seedCard(db, {
    id: 'c_weak',
    wordId: 'w_weak',
    state: 'review',
    reps: 20,
    stability: 2,
    lapses: 5,
    scheduledDays: 10,
    lastReviewedAt: '2026-11-04T00:19:00.000Z',
  });
  seedManyReviews(db, 'c_weak', Array.from({ length: 20 }, (_, i) => (i < 14 ? 1 : 3)));

  // attention
  seedWord(db, { id: 'w_att', term: 'attentionword', meaning: '주의' });
  seedCard(db, {
    id: 'c_att',
    wordId: 'w_att',
    state: 'review',
    reps: 20,
    stability: 10,
    lapses: 0,
    scheduledDays: 10,
    lastReviewedAt: '2026-11-04T00:19:00.000Z',
  });
  seedManyReviews(db, 'c_att', Array.from({ length: 20 }, (_, i) => (i < 13 ? 1 : 3)));

  // good
  seedWord(db, { id: 'w_good', term: 'goodword', meaning: '좋은' });
  seedCard(db, {
    id: 'c_good',
    wordId: 'w_good',
    state: 'review',
    reps: 20,
    stability: 30,
    lapses: 0,
    scheduledDays: 10,
    lastReviewedAt: '2026-11-04T00:19:00.000Z',
  });
  seedManyReviews(db, 'c_good', Array.from({ length: 20 }, (_, i) => (i === 0 ? 1 : 3)));

  // observing
  seedWord(db, { id: 'w_obs', term: 'observeword', meaning: '관찰' });
  seedCard(db, {
    id: 'c_obs',
    wordId: 'w_obs',
    state: 'learning',
    reps: 3,
    stability: 1,
    lapses: 0,
    lastReviewedAt: '2026-11-04T00:02:00.000Z',
  });
  seedManyReviews(db, 'c_obs', [1, 3, 3]);

  // stale
  seedWord(db, { id: 'w_stale', term: 'staleword', meaning: '오래된' });
  seedCard(db, {
    id: 'c_stale',
    wordId: 'w_stale',
    state: 'review',
    reps: 20,
    stability: 10,
    lapses: 0,
    scheduledDays: 10,
    lastReviewedAt: '2026-07-01T00:19:00.000Z',
  });
  seedManyReviews(
    db,
    'c_stale',
    Array.from({ length: 20 }, (_, i) => (i === 0 ? 1 : 3)),
    '2026-07-01T00'
  );

  // quiz boost
  seedWord(db, { id: 'w_quiz', term: 'quizword', meaning: '퀴즈' });
  seedCard(db, {
    id: 'c_quiz',
    wordId: 'w_quiz',
    state: 'review',
    reps: 20,
    stability: 10,
    lapses: 0,
    scheduledDays: 10,
    lastReviewedAt: '2026-11-04T00:19:00.000Z',
  });
  seedManyReviews(db, 'c_quiz', Array.from({ length: 20 }, (_, i) => (i < 4 ? 1 : 3)));
  seedQuizWrongs(db, 'u1', 'w_quiz', 5);

  // 두 방향 중 더 약한 쪽을 대표로 선택
  seedWord(db, { id: 'w_max', term: 'maxword', meaning: '최댓값' });
  seedCard(db, {
    id: 'c_max_rec',
    wordId: 'w_max',
    state: 'review',
    reps: 20,
    stability: 2,
    lapses: 5,
    scheduledDays: 10,
    lastReviewedAt: '2026-11-04T00:19:00.000Z',
  });
  seedCard(db, {
    id: 'c_max_recall',
    wordId: 'w_max',
    type: 'recall',
    state: 'review',
    reps: 20,
    stability: 10,
    lapses: 0,
    scheduledDays: 10,
    lastReviewedAt: '2026-11-04T00:19:00.000Z',
  });
  seedManyReviews(db, 'c_max_rec', Array.from({ length: 20 }, (_, i) => (i < 14 ? 1 : 3)));
  seedManyReviews(db, 'c_max_recall', Array.from({ length: 20 }, (_, i) => (i < 13 ? 1 : 3)));

  // leech
  seedWord(db, { id: 'w_leech', term: 'leechword', meaning: '격리' });
  seedCard(db, {
    id: 'c_leech',
    wordId: 'w_leech',
    state: 'review',
    reps: 20,
    stability: 2,
    lapses: 9,
    suspended: 1,
    lastReviewedAt: '2026-11-04T00:19:00.000Z',
  });
  seedManyReviews(db, 'c_leech', Array.from({ length: 20 }, (_, i) => (i < 14 ? 1 : 3)));

  const now = new Date('2026-11-04T12:00:00.000Z');
  const report = await listWeakness(database, 'u1', now);

  assert.deepEqual(
    report.all.map((w) => w.wordId).sort(),
    ['w_att', 'w_max', 'w_quiz', 'w_weak']
  );
  assert.deepEqual(
    report.weak.map((w) => w.wordId).sort(),
    ['w_max', 'w_weak']
  );
  assert.deepEqual(
    report.attention.map((w) => w.wordId).sort(),
    ['w_att', 'w_quiz']
  );

  const max = report.all.find((w) => w.wordId === 'w_max');
  assert.equal(max.direction, 'recognition');
  assert.equal(max.status, 'weak');

  const quiz = report.all.find((w) => w.wordId === 'w_quiz');
  assert.equal(quiz.quizWrongs, 5);
  assert.equal(quiz.status, 'attention');

  const observing = await listObservingWords(database, 'u1');
  assert.deepEqual(observing.map((w) => w.wordId), ['w_obs']);

  const stale = await listStaleWords(database, 'u1', now);
  assert.deepEqual(stale.map((w) => w.wordId), ['w_stale']);

  const ids = weakWordIds(report);
  assert.equal(await countWeakDue(database, 'u1', now.toISOString(), ids), 5);

  const next = await nextWeakDueReview(database, 'u1', now.toISOString(), ids);
  assert.ok(next);
  assert.ok(['w_weak', 'w_att', 'w_quiz', 'w_max'].includes(next.word_id));

  assert.equal(await countWeakDoneToday(database, 'u1', '2026-11-04'), 0);
  seedReview(db, {
    id: 'weak-done-1',
    cardId: 'c_weak',
    rating: 3,
    questionType: 'recognition',
    source: 'weak',
    reviewedAt: '2026-11-04T01:00:00Z',
  });
  assert.equal(await countWeakDoneToday(database, 'u1', '2026-11-04'), 1);
});

test('plan: 오늘 계획을 미리보고 스냅샷으로 고정하며 완료를 기록한다', async () => {
  const db = freshDb();
  const database = d1(db);
  seedUser(db);
  seedDeck(db);
  const user = testUser();
  const now = new Date('2026-11-04T12:00:00.000Z');

  for (let i = 1; i <= 3; i++) {
    seedWord(db, { id: `wr${i}`, term: `review${i}` });
    seedCard(db, {
      id: `cr${i}`,
      wordId: `wr${i}`,
      state: 'review',
      reps: 5,
      dueAt: '2026-11-04T00:00:00.000Z',
      scheduledDays: 10,
      lastReviewedAt: '2026-11-01T00:00:00.000Z',
    });
  }

  for (let i = 1; i <= 2; i++) {
    seedWord(db, { id: `wp${i}`, term: `promoted${i}` });
    seedCard(db, {
      id: `cp${i}`,
      wordId: `wp${i}`,
      type: 'recall',
      dueAt: '2026-11-04T00:00:00.000Z',
    });
  }

  for (let i = 1; i <= 5; i++) {
    seedWord(db, { id: `wn${i}`, term: `new${i}` });
    seedCard(db, { id: `cn${i}`, wordId: `wn${i}`, dueAt: '2026-11-04T00:00:00.000Z' });
  }

  const preview = await getTodayPlan(database, user, now, false);
  assert.equal(preview.row, null);
  assert.equal(preview.plan.active, false);
  assert.equal(preview.plan.reviewTarget, 3);
  assert.equal(preview.plan.promotedTarget, 2);
  assert.equal(preview.plan.effectiveNew, 5);
  assert.equal(preview.plan.dueCount, 3);
  assert.equal(preview.plan.remaining, 10);
  assert.ok(preview.plan.estimatedMinutes > 0);

  const created = await getTodayPlan(database, user, now, true);
  assert.ok(created.row);
  assert.equal(created.plan.active, true);
  assert.equal(created.row.base_new, 10);
  assert.equal(created.row.effective_new, 5);
  assert.equal(created.row.review_target, 3);
  assert.equal(created.row.promoted_target, 2);
  assert.equal(created.row.due_count, 3);

  const alsoCreated = await getTodayPlan(database, user, now, true);
  assert.equal(alsoCreated.row.created_at, created.row.created_at);

  assert.deepEqual(await countDueByType(database, 'u1', now.toISOString()), {
    recognition: 3,
  });

  const createdAt = created.row.created_at;

  seedReview(db, {
    id: 'plan-new-1',
    cardId: 'cn1',
    repsBefore: 0,
    questionType: 'recognition',
    source: 'review',
    reviewedAt: '2026-11-04T12:00:10.000Z',
  });
  seedReview(db, {
    id: 'plan-review-1',
    cardId: 'cr1',
    repsBefore: 5,
    questionType: 'recognition',
    source: 'review',
    reviewedAt: '2026-11-04T12:00:11.000Z',
  });

  const partial = await getTodayPlan(
    database,
    user,
    new Date('2026-11-04T12:01:00.000Z'),
    false
  );
  assert.equal(partial.plan.done, 2);
  assert.equal(partial.plan.remaining, 8);
  assert.equal(partial.plan.completed, false);
  assert.equal(partial.progress.reviewLeft, 2);
  assert.equal(partial.progress.promotedLeft, 2);
  assert.equal(partial.progress.newLeft, 4);

  assert.deepEqual(await servedByTypeSince(database, 'u1', createdAt), {
    recognition: 1,
  });

  for (let i = 0; i < 8; i++) {
    seedReview(db, {
      id: `plan-extra-${i}`,
      cardId: 'cr1',
      repsBefore: 5,
      questionType: 'recognition',
      source: 'review',
      reviewedAt: `2026-11-04T12:00:${String(20 + i).padStart(2, '0')}.000Z`,
    });
  }

  const doneNow = new Date('2026-11-04T12:02:00.000Z');
  const completed = await getTodayPlan(database, user, doneNow, false);
  assert.equal(completed.plan.done, 10);
  assert.equal(completed.plan.remaining, 0);
  assert.equal(completed.plan.completed, true);

  await updatePlanCompletion(database, 'u1', '2026-11-04', doneNow);
  const stored = db
    .prepare('SELECT completed_at FROM daily_plans WHERE user_id = ? AND local_date = ?')
    .get('u1', '2026-11-04');
  assert.ok(stored.completed_at);
});

const FULL_CSV = `term,meaning,pos,example,example_ko,category,level,pronunciation,collocations,synonyms,antonyms,example_2,example_2_ko,example_3,example_3_ko
ubiquitous,어디에나 있는,adj,"Smartphones are ubiquitous.","요즘 스마트폰은 어디에나 있다.",일상생활,B2,/juːˈbɪkwɪtəs/,"ubiquitous technology|ubiquitous presence",omnipresent,rare,"Phones are ubiquitous.","휴대폰은 어디에나 있다.","It is ubiquitous.","그것은 어디에나 있다."`;

test('csv: 5컬럼과 확장 컬럼을 모두 파싱한다', () => {
  const basic = `term,meaning,pos,example,example_ko
ubiquitous,어디에나 있는,adj,"Smartphones are ubiquitous.","요즘 스마트폰은 어디에나 있다."`;

  const basicWord = parseWordCsv(basic)[0];
  assert.equal(basicWord.term, 'ubiquitous');
  assert.equal(basicWord.category, '');
  assert.deepEqual(basicWord.collocations, []);
  assert.deepEqual(basicWord.extraExamples, []);

  const word = parseWordCsv(FULL_CSV)[0];
  assert.equal(word.category, '일상생활');
  assert.equal(word.level, 'B2');
  assert.equal(word.pronunciation, '/juːˈbɪkwɪtəs/');
  assert.deepEqual(word.collocations, ['ubiquitous technology', 'ubiquitous presence']);
  assert.deepEqual(word.synonyms, ['omnipresent']);
  assert.deepEqual(word.antonyms, ['rare']);
  assert.deepEqual(
    word.extraExamples.map((e) => e.sentence).sort(),
    ['It is ubiquitous.', 'Phones are ubiquitous.'].sort()
  );
});

test('csv: 알 수 없는 컬럼은 거부한다', () => {
  assert.throws(
    () =>
      parseWordCsv(`term,meaning,pos,example,example_ko,unknown
a,뜻,n,,,x`),
    /알 수 없는 CSV 컬럼/
  );
});

test('word-meta: JSON/파이프 목록과 추가 예문을 파싱한다', () => {
  assert.deepEqual(parseJsonList('["a","b"]'), ['a', 'b']);
  assert.deepEqual(parseJsonList('a|b'), ['a', 'b']);
  assert.deepEqual(parseJsonList(null), []);

  assert.deepEqual(parseExtraExamples('One\t하나\nTwo\t'), [
    { sentence: 'One', translation: '하나' },
    { sentence: 'Two', translation: null },
  ]);
});

test('csv: importSeed가 메타데이터와 추가 예문을 저장하고 내보낸다', async () => {
  const db = freshDb();
  const database = d1(db);
  seedUser(db);

  const words = parseWordCsv(FULL_CSV);
  const imported = await importSeed(database, 'u1', '확장 단어장', words);
  const deckId = imported.deckId;
  assert.equal(imported.count, 1);

  const list = await listWords(database, deckId);
  assert.equal(list.length, 1);
  assert.equal(list[0].category, '일상생활');
  assert.equal(list[0].level, 'B2');
  assert.equal(list[0].pronunciation, '/juːˈbɪkwɪtəs/');
  assert.deepEqual(parseJsonList(list[0].collocations), [
    'ubiquitous technology',
    'ubiquitous presence',
  ]);
  assert.deepEqual(
    parseExtraExamples(list[0].extra_examples_raw).map((e) => e.sentence).sort(),
    ['It is ubiquitous.', 'Phones are ubiquitous.'].sort()
  );

  assert.equal(
    count(db, 'SELECT COUNT(*) AS n FROM word_examples WHERE word_id = ?', list[0].id),
    2
  );

  const basicCsv = buildDeckCsv(list, false);
  assert.ok(basicCsv.includes('term,meaning,pos,example,example_ko\n'));
  assert.ok(!basicCsv.includes('category'));

  const fullCsv = buildDeckCsv(list, true);
  const round = parseWordCsv(fullCsv)[0];
  assert.equal(round.category, '일상생활');
  assert.deepEqual(round.collocations, ['ubiquitous technology', 'ubiquitous presence']);
  assert.deepEqual(
    round.extraExamples.map((e) => e.sentence).sort(),
    ['It is ubiquitous.', 'Phones are ubiquitous.'].sort()
  );
});

test('fsrs: 21개 가중치만 파싱하고 잘못된 값은 거부한다', () => {
  const weights = Array.from({ length: 21 }, (_, i) => (i === 0 ? 0.3 : 1.2));
  assert.equal(FSRS_PARAM_LENGTH, 21);
  assert.deepEqual(parseFsrsParams(JSON.stringify(weights)), weights);
  assert.deepEqual(parseFsrsParams(weights), weights);

  assert.equal(parseFsrsParams('not-json'), null);
  assert.equal(parseFsrsParams(JSON.stringify(weights.slice(0, 20))), null);
  assert.equal(parseFsrsParams(JSON.stringify([...weights.slice(0, 20), 'x'])), null);
  assert.equal(parseFsrsParams(null), null);
});

test('fsrs: 사용자 파라미터로 스케줄과 미리보기를 계산한다', () => {
  const now = new Date('2026-11-04T12:00:00.000Z');
  const row = {
    id: 'c1',
    stability: 10,
    difficulty: 5,
    scheduled_days: 10,
    learning_steps: 0,
    reps: 5,
    lapses: 0,
    state: 'review',
    due_at: '2026-11-04T00:00:00.000Z',
    last_reviewed_at: '2026-10-25T00:00:00.000Z',
  };
  const custom = Array.from({ length: 21 }, (_, i) => (i === 0 ? 0.3 : 1.2));

  const preview = previewIntervals(row, now, custom);
  assert.deepEqual(Object.keys(preview), ['1', '2', '3', '4']);

  const scheduled = schedule(row, now, 3, custom);
  assert.ok(Number.isFinite(scheduled.stability));
  assert.ok(Number.isFinite(scheduled.difficulty));
  assert.ok(scheduled.due_at);
});

test('ensureUnlocks: listening_enabled일 때만 듣기 카드를 만든다', async () => {
  const db = freshDb();
  const database = d1(db);
  seedUser(db);
  seedDeck(db);
  seedWord(db, { id: 'w_listen', term: 'listen', pos: 'v', example: 'Listen carefully.' });
  seedCard(db, {
    id: 'c_listen',
    wordId: 'w_listen',
    state: 'review',
    scheduledDays: 14,
    stability: 10,
    reps: 5,
    lastReviewedAt: '2026-11-01T00:00:00.000Z',
  });

  const now = new Date('2026-11-04T12:00:00.000Z');

  await ensureUnlocks(database, 'u1', now, false);
  assert.equal(
    count(db, "SELECT COUNT(*) AS n FROM cards WHERE card_type = 'listening'"),
    0
  );

  await ensureUnlocks(database, 'u1', now, true);
  assert.equal(
    count(db, "SELECT COUNT(*) AS n FROM cards WHERE card_type = 'listening'"),
    1
  );

  await ensureUnlocks(database, 'u1', now, true);
  assert.equal(
    count(db, "SELECT COUNT(*) AS n FROM cards WHERE card_type = 'listening'"),
    1
  );
});

test('saveReview: listening 카드는 question_type/grading_source를 기록한다', async () => {
  const db = freshDb();
  const database = d1(db);
  seedUser(db);
  seedDeck(db);
  seedWord(db, { id: 'w_listen', term: 'listen', meaning: '듣다' });
  seedCard(db, {
    id: 'c_listen',
    wordId: 'w_listen',
    type: 'listening',
    dueAt: '2026-11-04T00:00:00.000Z',
  });

  const now = new Date('2026-11-04T12:00:00.000Z');
  const saved = await saveReview(
    database,
    'u1',
    getCard(db, 'c_listen'),
    3,
    now,
    '2026-11-04',
    { responseMs: 2200, answer: 'listen' }
  );

  assert.ok(saved);
  const review = db
    .prepare(
      'SELECT question_type, grading_source, is_correct, answer, response_ms FROM reviews WHERE card_id = ?'
    )
    .get('c_listen');

  assert.equal(review.question_type, 'listening');
  assert.equal(review.grading_source, 'server');
  assert.equal(review.is_correct, 1);
  assert.equal(review.answer, 'listen');
  assert.equal(review.response_ms, 2200);
});

test('ensureUnlocks: 누락된 승급을 멱등적으로 복구한다', async () => {
  const db = freshDb();
  const database = d1(db);
  seedUser(db);
  seedDeck(db);

  // w1: recall + cloze 둘 다 가능
  seedWord(db, {
    id: 'w1',
    term: 'abandon',
    pos: 'v',
    example: 'They abandon the plan.',
  });
  seedCard(db, {
    id: 'c1',
    wordId: 'w1',
    state: 'review',
    scheduledDays: 4,
    stability: 8,
    reps: 5,
  });

  // w2: 기능어라 recall 제외, cloze는 가능
  seedWord(db, { id: 'w2', term: 'in', pos: 'prep', example: 'in the box' });
  seedCard(db, {
    id: 'c2',
    wordId: 'w2',
    state: 'review',
    scheduledDays: 5,
    stability: 8,
    reps: 5,
  });

  // w3: 조건 미달
  seedWord(db, { id: 'w3', term: 'test', pos: 'v', example: 'Nothing matches' });
  seedCard(db, {
    id: 'c3',
    wordId: 'w3',
    state: 'review',
    scheduledDays: 3,
    stability: 8,
    reps: 5,
  });

  // w4: recall만 가능
  seedWord(db, { id: 'w4', term: 'quit', pos: 'v', example: 'They quit it.' });
  seedCard(db, {
    id: 'c4',
    wordId: 'w4',
    state: 'review',
    scheduledDays: 5,
    stability: 6,
    reps: 5,
  });

  await ensureUnlocks(database, 'u1', new Date('2026-11-04T12:00:00.000Z'));

  const cards = db
    .prepare('SELECT word_id, card_type FROM cards WHERE card_type != ?')
    .all('recognition');
  const key = (r) => `${r.word_id}:${r.card_type}`;
  const set = new Set(cards.map(key));

  assert.ok(set.has('w1:recall'));
  assert.ok(set.has('w1:cloze'));
  assert.ok(!set.has('w2:recall'));
  assert.ok(set.has('w2:cloze'));
  assert.ok(!set.has('w3:recall'));
  assert.ok(!set.has('w3:cloze'));
  assert.ok(set.has('w4:recall'));
  assert.ok(!set.has('w4:cloze'));

  const before = cards.length;
  await ensureUnlocks(database, 'u1', new Date('2026-11-04T12:00:00.000Z'));
  const after = count(db, 'SELECT COUNT(*) AS n FROM cards WHERE card_type != ?', 'recognition');
  assert.equal(after, before);
});
