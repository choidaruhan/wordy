import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildSync } from 'esbuild';

const bundleDir = mkdtempSync(join(tmpdir(), 'wordy-mastery-'));
buildSync({
  entryPoints: ['src/db/mastery.ts'],
  outdir: bundleDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});

const { getMasteryCounts, masteredCount } = await import(
  pathToFileURL(join(bundleDir, 'mastery.js')).href
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
  };
}

const NOW = '2026-11-05T01:00:00.000Z';

function seed(db) {
  db.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)'
  ).run('u1', 'u1@test.local', NOW);
  db.prepare(
    'INSERT INTO decks (id, user_id, name, created_at) VALUES (?, ?, ?, ?)'
  ).run('d1', 'u1', '테스트', NOW);
}

function word(db, id, term) {
  db.prepare(
    'INSERT INTO words (id, deck_id, term, meaning, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, 'd1', term, term, NOW);
}

function card(
  db,
  {
    id,
    wordId,
    type = 'recognition',
    state = 'new',
    scheduledDays = 0,
    reps = 0,
  }
) {
  db.prepare(
    `INSERT INTO cards (
       id, word_id, user_id, card_type, due_at, state, stability, difficulty,
       scheduled_days, learning_steps, reps, lapses, created_at
     ) VALUES (?, ?, 'u1', ?, ?, ?, 10, 5, ?, 0, ?, 0, ?)`
  ).run(id, wordId, type, NOW, state, scheduledDays, reps, NOW);
}

function review(db, id, cardId, rating = 3, reviewedAt = '2026-11-01T00:00:00.000Z') {
  db.prepare(
    `INSERT INTO reviews (
       id, card_id, user_id, rating, local_date, reviewed_at,
       reps_before, prev_state, question_type, is_correct
     ) VALUES (?, ?, 'u1', ?, '2026-11-01', ?, 5, 'review', 'recognition', ?)`
  ).run(id, cardId, rating, reviewedAt, rating >= 2 ? 1 : 0);
}

function seedWords(db) {
  word(db, 'w_new', 'new');
  card(db, { id: 'c_new', wordId: 'w_new' });

  word(db, 'w_learning', 'learning');
  card(db, {
    id: 'c_learning',
    wordId: 'w_learning',
    state: 'learning',
    reps: 1,
  });

  word(db, 'w_familiar', 'familiar');
  card(db, {
    id: 'c_familiar',
    wordId: 'w_familiar',
    state: 'review',
    scheduledDays: 10,
    reps: 5,
  });

  word(db, 'w_known', 'known');
  card(db, {
    id: 'c_known_r',
    wordId: 'w_known',
    state: 'review',
    scheduledDays: 30,
    reps: 5,
  });
  card(db, {
    id: 'c_known_p',
    wordId: 'w_known',
    type: 'recall',
    state: 'review',
    scheduledDays: 10,
    reps: 5,
  });

  word(db, 'w_mastered', 'mastered');
  card(db, {
    id: 'c_mastered_r',
    wordId: 'w_mastered',
    state: 'review',
    scheduledDays: 70,
    reps: 5,
  });
  card(db, {
    id: 'c_mastered_recall',
    wordId: 'w_mastered',
    type: 'recall',
    state: 'review',
    scheduledDays: 30,
    reps: 5,
  });
  card(db, {
    id: 'c_mastered_cloze',
    wordId: 'w_mastered',
    type: 'cloze',
    state: 'review',
    scheduledDays: 30,
    reps: 5,
  });
  review(db, 'rv_mastered_recall', 'c_mastered_recall');
  review(db, 'rv_mastered_cloze', 'c_mastered_cloze');

  word(db, 'w_known_no_prod', 'known_no_prod');
  card(db, {
    id: 'c_known_no_prod',
    wordId: 'w_known_no_prod',
    state: 'review',
    scheduledDays: 30,
    reps: 5,
  });

  word(db, 'w_mastered_missing', 'mastered_missing');
  card(db, {
    id: 'c_missing_r',
    wordId: 'w_mastered_missing',
    state: 'review',
    scheduledDays: 70,
    reps: 5,
  });
  card(db, {
    id: 'c_missing_recall',
    wordId: 'w_mastered_missing',
    type: 'recall',
    state: 'review',
    scheduledDays: 30,
    reps: 5,
  });
  card(db, {
    id: 'c_missing_cloze',
    wordId: 'w_mastered_missing',
    type: 'cloze',
    state: 'review',
    scheduledDays: 30,
    reps: 5,
  });
  review(db, 'rv_missing_recall', 'c_missing_recall');
}

test('mastery: new/learning/familiar/known/mastered를 분류한다', async () => {
  const db = freshDb();
  seed(db);
  seedWords(db);

  const counts = await getMasteryCounts(d1(db), 'u1');
  assert.deepEqual(counts, {
    total: 7,
    new: 1,
    learning: 1,
    familiar: 2,
    known: 2,
    mastered: 1,
  });
  assert.equal(await masteredCount(d1(db), 'u1'), 1);
});

test('mastery: 생산형 카드가 없으면 known/mastered가 아니다', async () => {
  const db = freshDb();
  seed(db);
  seedWords(db);

  const row = db
    .prepare('SELECT mastery FROM word_mastery WHERE word_id = ?')
    .get('w_known_no_prod');
  assert.equal(row.mastery, 'familiar');
});

test('mastery: 생산형 카드 중 하나라도 최근 성공이 없으면 mastered가 아니다', async () => {
  const db = freshDb();
  seed(db);
  seedWords(db);

  const row = db
    .prepare('SELECT mastery FROM word_mastery WHERE word_id = ?')
    .get('w_mastered_missing');
  assert.equal(row.mastery, 'known');
});

test('mastery: 다른 사용자의 단어는 집계하지 않는다', async () => {
  const db = freshDb();
  seed(db);
  seedWords(db);
  db.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)'
  ).run('u2', 'u2@test.local', NOW);

  const counts = await getMasteryCounts(d1(db), 'u2');
  assert.equal(counts.total, 0);
  assert.equal(await masteredCount(d1(db), 'u2'), 0);
});
