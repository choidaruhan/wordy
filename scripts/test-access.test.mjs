import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildSync } from 'esbuild';

const bundleDir = mkdtempSync(join(tmpdir(), 'wordy-access-'));
buildSync({
  entryPoints: ['src/db/queries.ts', 'src/db/review.ts', 'src/db/play.ts'],
  outdir: bundleDir,
  outbase: 'src',
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});

const { getDeck, deleteWord } = await import(
  pathToFileURL(join(bundleDir, 'db/queries.js')).href
);
const { getCardForReview, saveMnemonic, resumeCard, saveReview } = await import(
  pathToFileURL(join(bundleDir, 'db/review.js')).href
);
const { getPlaySession, getPlaySessionItem, countDeckNewCards } = await import(
  pathToFileURL(join(bundleDir, 'db/play.js')).href
);

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
  '0010_play_sessions.sql',
  '0011_play_session_deck.sql',
  '0012_drop_play_score.sql',
  '0013_learning_mode.sql',
  '0014_play_session_state.sql',
  '0015_play_session_items.sql',
  '0016_play_session_triggers.sql',
  '0017_review_rating_signals.sql',
  '0018_users_timezone.sql',
  '0019_confidence_mode.sql',
  '0020_rate_limits.sql',
  '0021_word_mastery.sql',
];

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) {
    db.exec(
      readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
    );
  }
  return db;
}

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

function seed(db) {
  const now = '2026-11-05T01:00:00.000Z';
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(
    'u1',
    'u1@test.local',
    now
  );
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(
    'u2',
    'u2@test.local',
    now
  );
  for (const [id, userId] of [
    ['d1', 'u1'],
    ['d2', 'u2'],
  ]) {
    db.prepare(
      'INSERT INTO decks (id, user_id, name, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, userId, id, now);
  }

  const words = [
    ['w1', 'd1', 'one'],
    ['w2', 'd2', 'two'],
    ['w3', 'd1', 'three'],
  ];
  for (const [id, deckId, term] of words) {
    db.prepare(
      'INSERT INTO words (id, deck_id, term, meaning, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, deckId, term, term, now);
  }

  db.prepare(
    `INSERT INTO cards (
       id, word_id, user_id, card_type, due_at, state, stability, difficulty,
       scheduled_days, learning_steps, reps, lapses, last_reviewed_at, suspended, created_at
     ) VALUES ('c1', 'w1', 'u1', 'recognition', ?, 'review', 10, 5, 10, 0, 5, 2, ?, 1, ?)`
  ).run(now, now, now);
  db.prepare(
    `INSERT INTO cards (
       id, word_id, user_id, card_type, due_at, state, stability, difficulty,
       scheduled_days, learning_steps, reps, lapses, last_reviewed_at, suspended, created_at
     ) VALUES ('c2', 'w2', 'u2', 'recognition', ?, 'review', 10, 5, 10, 0, 5, 0, ?, 0, ?)`
  ).run(now, now, now);
  db.prepare(
    `INSERT INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
     VALUES ('c3', 'w3', 'u1', 'recognition', ?, 'new', ?)`
  ).run(now, now);

  db.prepare(
    `INSERT INTO play_sessions (
       id, user_id, mode, target_size, review_target, new_target, weak_target,
       policy, policy_reason, status, started_at, last_activity_at, expires_at
     ) VALUES ('s1', 'u1', 'quick', 1, 1, 0, 0, 'session', 'session', 'active', ?, ?, ?)`
  ).run(now, now, '2026-11-06T01:00:00.000Z');
  db.prepare(
    `INSERT INTO play_session_items (
       id, session_id, card_id, position, bucket, kind, served_at
     ) VALUES ('i1', 's1', 'c1', 1, 'review', 'prompt', ?)`
  ).run(now);
}

test('access: 다른 사용자의 단어장·카드·세션에 접근할 수 없다', async () => {
  const db = freshDb();
  const database = d1(db);
  seed(db);

  assert.ok(await getDeck(database, 'u1', 'd1'));
  assert.equal(await getDeck(database, 'u2', 'd1'), null);

  assert.ok(await getCardForReview(database, 'u1', 'c1'));
  assert.equal(await getCardForReview(database, 'u2', 'c1'), null);

  assert.ok(await getPlaySession(database, 'u1', 's1'));
  assert.equal(await getPlaySession(database, 'u2', 's1'), null);

  assert.ok(await getPlaySessionItem(database, 'u1', 's1', 'i1'));
  assert.equal(await getPlaySessionItem(database, 'u2', 's1', 'i1'), null);

  assert.equal(await countDeckNewCards(database, 'u1', 'd1'), 1);
  assert.equal(await countDeckNewCards(database, 'u2', 'd1'), 0);
});

test('access: 다른 사용자의 리소스를 변경할 수 없다', async () => {
  const db = freshDb();
  const database = d1(db);
  seed(db);
  const now = new Date('2026-11-05T12:00:00.000Z');

  await deleteWord(database, 'u2', 'w1');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM words WHERE id = ?').get('w1').n,
    1
  );

  await saveMnemonic(database, 'u2', 'c1', 'hacked');
  assert.equal(
    db.prepare('SELECT note FROM words WHERE id = ?').get('w1').note,
    null
  );

  await resumeCard(database, 'u2', 'c1');
  const card = db
    .prepare('SELECT suspended, lapses FROM cards WHERE id = ?')
    .get('c1');
  assert.equal(card.suspended, 1);
  assert.equal(card.lapses, 2);

  const row = await getCardForReview(database, 'u1', 'c1');
  const saved = await saveReview(
    database,
    'u2',
    row,
    3,
    now,
    '2026-11-05',
    { sessionId: 's1', reviewKey: 'u2-key' }
  );
  assert.equal(saved, null);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n,
    0
  );
});
