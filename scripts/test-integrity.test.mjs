import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildSync } from 'esbuild';

const bundleDir = mkdtempSync(join(tmpdir(), 'wordy-integrity-'));
buildSync({
  entryPoints: ['src/db/integrity.ts'],
  outdir: bundleDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});

const { checkIntegrity } = await import(
  pathToFileURL(join(bundleDir, 'integrity.js')).href
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

/** checkIntegrity가 쓰는 first/all만 구현한 최소 D1 어댑터. */
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

function seedValid(db) {
  const now = '2026-11-05T01:00:00.000Z';
  db.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)'
  ).run('u1', 'u1@test.local', now);
  db.prepare(
    'INSERT INTO decks (id, user_id, name, created_at) VALUES (?, ?, ?, ?)'
  ).run('d1', 'u1', '테스트', now);
  db.prepare(
    'INSERT INTO words (id, deck_id, term, meaning, pos, example, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('w1', 'd1', 'test', '테스트', 'n', 'This is a test.', now);
  db.prepare(
    `INSERT INTO cards (
       id, word_id, user_id, card_type, due_at, state, stability, difficulty,
       scheduled_days, learning_steps, reps, lapses, last_reviewed_at, suspended, created_at
     ) VALUES (?, ?, ?, 'recognition', ?, 'review', 10, 5, 10, 0, 5, 0, ?, 0, ?)`
  ).run('c1', 'w1', 'u1', '2026-11-05T00:00:00.000Z', now, now);

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

  db.prepare(
    `INSERT INTO reviews (
       id, card_id, user_id, rating, local_date, reviewed_at,
       elapsed_days, scheduled_days, reps_before, prev_state,
       question_type, is_correct, grading_source, response_ms,
       review_key, source, session_id, next_state, next_due_at
     ) VALUES (?, ?, ?, 3, ?, ?, 10, 10, 4, 'review',
               'recognition', 1, 'server', 3000,
               'i1', 'review', 's1', 'review', ?)`
  ).run(
    'r1',
    'c1',
    'u1',
    '2026-11-05',
    now,
    '2026-11-05T00:00:00.000Z'
  );

  return now;
}

test('integrity: 정상 데이터는 ok=true 이고 승급 후보는 info 로 분리한다', async () => {
  const db = freshDb();
  seedValid(db);

  // 오답 마무리 item은 리뷰가 없어도 정상이다.
  db.prepare(
    `INSERT INTO play_session_items (
       id, session_id, card_id, position, bucket, kind, served_at, answered_at, correct
     ) VALUES ('i-wrap', 's1', 'c1', 2, 'wrapup', 'wrapup', ?, ?, 1)`
  ).run('2026-11-05T01:10:00.000Z', '2026-11-05T01:11:00.000Z');

  const report = await checkIntegrity(d1(db), 'u1');
  assert.equal(report.ok, true);

  const byKey = new Map(report.checks.map((check) => [check.key, check]));
  assert.equal(byKey.get('card_review_mismatch').count, 0);
  assert.equal(byKey.get('session_item_missing_review').count, 0);
  assert.equal(byKey.get('session_item_review_mismatch').count, 0);
  assert.equal(byKey.get('unlock_candidates').count, 1);
  assert.equal(byKey.get('unlock_candidates').severity, 'info');
});

test('integrity: 카드/리뷰 불일치와 세션 문항 누락을 찾는다', async () => {
  const db = freshDb();
  const now = seedValid(db);

  // 최신 리뷰가 카드 상태와 다른 상태를 가리킨다.
  db.prepare(
    `INSERT INTO reviews (
       id, card_id, user_id, rating, local_date, reviewed_at,
       elapsed_days, scheduled_days, reps_before, prev_state,
       question_type, is_correct, grading_source, response_ms,
       review_key, source, next_state, next_due_at
     ) VALUES ('r2', 'c1', 'u1', 1, '2026-11-05', '2026-11-05T02:00:00.000Z',
               1, 1, 5, 'review', 'recognition', 0, 'server', 3000,
               'r2-key', 'review', 'relearning', '2026-11-05T02:10:00.000Z')`
  ).run();

  // 답변 표시만 있고 리뷰가 없는 문항
  db.prepare(
    `INSERT INTO play_sessions (
       id, user_id, mode, target_size, review_target, new_target, weak_target,
       policy, policy_reason, status, started_at, last_activity_at, expires_at
     ) VALUES ('s2', 'u1', 'quick', 1, 1, 0, 0, 'session', 'session', 'active', ?, ?, ?)`
  ).run(now, now, '2026-11-06T01:00:00.000Z');
  db.prepare(
    `INSERT INTO play_session_items (
       id, session_id, card_id, position, bucket, kind, served_at, answered_at
     ) VALUES ('i2', 's2', 'c1', 1, 'review', 'prompt', ?, ?)`
  ).run(now, now);

  const report = await checkIntegrity(d1(db), 'u1');
  assert.equal(report.ok, false);

  const byKey = new Map(report.checks.map((check) => [check.key, check]));
  assert.equal(byKey.get('card_review_mismatch').count, 1);
  assert.equal(byKey.get('session_item_missing_review').count, 1);
});

test('integrity: 고아 리뷰와 예문을 찾는다', async () => {
  const db = freshDb();
  seedValid(db);
  db.exec('PRAGMA foreign_keys = OFF');

  db.prepare(
    `INSERT INTO reviews (
       id, card_id, user_id, rating, local_date, reviewed_at,
       reps_before, prev_state, next_state, next_due_at
     ) VALUES ('orphan-r', 'missing-card', 'u1', 3, '2026-11-05',
               '2026-11-05T03:00:00.000Z', 0, 'new', 'review', '2026-11-06T00:00:00.000Z')`
  ).run();

  db.prepare(
    `INSERT INTO word_examples (id, word_id, sentence, created_at)
     VALUES ('orphan-e', 'missing-word', 'orphan', ?)`
  ).run('2026-11-05T03:00:00.000Z');

  const report = await checkIntegrity(d1(db), 'u1');
  const byKey = new Map(report.checks.map((check) => [check.key, check]));
  assert.equal(byKey.get('orphan_reviews').count, 1);
  assert.equal(byKey.get('orphan_word_examples').count, 1);
  assert.equal(report.ok, false);
});
