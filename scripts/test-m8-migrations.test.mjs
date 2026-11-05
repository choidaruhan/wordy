import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

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
];

function migrationSql(name) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
}

function apply(db, name) {
  db.exec(migrationSql(name));
}

function seedExistingPlaySession(db) {
  const now = '2026-11-05T01:00:00.000Z';
  const today = '2026-11-05';

  db.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)'
  ).run('u1', 'u1@test.local', now);

  db.prepare(
    'INSERT INTO daily_plans (user_id, local_date, base_new, effective_new, review_target, promoted_target, due_count, estimated_minutes, reason, created_at) VALUES (?, ?, 10, 4, 0, 0, 0, 5, ?, ?)'
  ).run('u1', today, 'no_backlog', now);

  db.prepare(
    'INSERT INTO decks (id, user_id, name, created_at) VALUES (?, ?, ?, ?)'
  ).run('d1', 'u1', '테스트', now);

  db.prepare(
    'INSERT INTO words (id, deck_id, term, meaning, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('w1', 'd1', 'test', '테스트', now);

  db.prepare(
    `INSERT INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
     VALUES (?, ?, ?, 'recognition', ?, 'new', ?)`
  ).run('c1', 'w1', 'u1', now, now);

  db.prepare(
    `INSERT INTO play_sessions (id, user_id, mode, target_size, answered, correct, started_at)
     VALUES (?, ?, 'quick', 5, 0, 0, ?)`
  ).run('s1', 'u1', now);

  db.prepare(
    `INSERT INTO reviews (
       id, card_id, user_id, rating, local_date, reviewed_at,
       reps_before, prev_state, is_correct, session_id
     ) VALUES (?, ?, ?, 3, ?, ?, 0, 'new', 1, ?)`
  ).run('r1', 'c1', 'u1', today, now, 's1');
}

test('M8 migrations: 기존 사용자/세션 데이터를 보존하고 상태를 백필한다', () => {
  const db = new DatabaseSync(':memory:');

  for (const name of MIGRATIONS) apply(db, name);
  seedExistingPlaySession(db);

  apply(db, '0013_learning_mode.sql');
  apply(db, '0014_play_session_state.sql');
  apply(db, '0015_play_session_items.sql');

  const user = db
    .prepare('SELECT learning_mode, last_unlock_check_at FROM users WHERE id = ?')
    .get('u1');
  assert.equal(user.learning_mode, 'daily');
  assert.equal(user.last_unlock_check_at, null);

  const session = db
    .prepare(
      `SELECT status, review_target, new_target, weak_target, policy,
              policy_reason, last_activity_at, expires_at, answered, correct
         FROM play_sessions WHERE id = ?`
    )
    .get('s1');

  assert.equal(session.status, 'active');
  assert.equal(session.review_target, 5);
  assert.equal(session.new_target, 0);
  assert.equal(session.weak_target, 0);
  assert.equal(session.policy, 'session');
  assert.equal(session.last_activity_at, '2026-11-05T01:00:00.000Z');
  assert.match(session.expires_at, /Z$/);
  assert.equal(session.answered, 1);
  assert.equal(session.correct, 1);

  const items = db.prepare('SELECT COUNT(*) AS n FROM play_session_items').get();
  assert.equal(items.n, 0);

  const indexes = db.prepare("PRAGMA index_list('play_sessions')").all();
  assert.ok(indexes.some((index) => index.name === 'idx_play_sessions_status'));
});

test('M8 migrations: 취약/커스텀 세션은 해당 버킷으로 백필한다', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) apply(db, name);

  const now = '2026-11-05T01:00:00.000Z';
  db.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)'
  ).run('u1', 'u1@test.local', now);
  db.prepare(
    `INSERT INTO play_sessions (id, user_id, mode, target_size, answered, correct, started_at)
     VALUES (?, ?, 'weak', 5, 0, 0, ?)`
  ).run('s-weak', 'u1', now);
  db.prepare(
    `INSERT INTO play_sessions (id, user_id, mode, target_size, answered, correct, started_at)
     VALUES (?, ?, 'custom', 3, 0, 0, ?)`
  ).run('s-custom', 'u1', now);

  apply(db, '0013_learning_mode.sql');
  apply(db, '0014_play_session_state.sql');
  apply(db, '0015_play_session_items.sql');

  const weak = db
    .prepare('SELECT review_target, new_target, weak_target FROM play_sessions WHERE id = ?')
    .get('s-weak');
  assert.deepEqual(
    [weak.review_target, weak.new_target, weak.weak_target],
    [0, 0, 5]
  );

  const custom = db
    .prepare('SELECT review_target, new_target, weak_target FROM play_sessions WHERE id = ?')
    .get('s-custom');
  assert.deepEqual(
    [custom.review_target, custom.new_target, custom.weak_target],
    [0, 3, 0]
  );
});

test('M8 migrations: 0021 word_mastery 뷰를 만든다', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) apply(db, name);

  apply(db, '0021_word_mastery.sql');

  const views = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'view'")
    .all();
  assert.ok(views.some((view) => view.name === 'word_mastery'));
});

test('M8 migrations: 0020 rate_limits 테이블을 만든다', () => {
  const db = new DatabaseSync(':memory:');
  apply(db, '0020_rate_limits.sql');

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all();
  assert.ok(tables.some((table) => table.name === 'rate_limits'));

  const indexes = db.prepare("PRAGMA index_list('rate_limits')").all();
  assert.ok(indexes.some((index) => index.name === 'idx_rate_limits_window'));
});

test('M8 migrations: 0019 confidence_mode 기본값을 추가한다', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) apply(db, name);

  db.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)'
  ).run('u1', 'u1@test.local', '2026-11-05T01:00:00.000Z');

  apply(db, '0019_confidence_mode.sql');

  assert.equal(
    db.prepare('SELECT confidence_mode FROM users WHERE id = ?').get('u1')
      .confidence_mode,
    'sample'
  );
});

test('M8 migrations: 0018 IANA 시간대를 백필한다', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) apply(db, name);

  const now = '2026-11-05T01:00:00.000Z';
  for (const [id, offset] of [
    ['u-kst', 540],
    ['u-utc', 0],
    ['u-other', 60],
  ]) {
    db.prepare(
      'INSERT INTO users (id, email, tz_offset_min, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, `${id}@test.local`, offset, now);
  }

  apply(db, '0018_users_timezone.sql');

  assert.equal(
    db.prepare('SELECT timezone FROM users WHERE id = ?').get('u-kst').timezone,
    'Asia/Seoul'
  );
  assert.equal(
    db.prepare('SELECT timezone FROM users WHERE id = ?').get('u-utc').timezone,
    'UTC'
  );
  assert.equal(
    db.prepare('SELECT timezone FROM users WHERE id = ?').get('u-other').timezone,
    null
  );
});

test('M8 migrations: 0017 평점 신호 컬럼을 추가한다', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) apply(db, name);

  apply(db, '0017_review_rating_signals.sql');

  const columns = db.prepare("PRAGMA table_info('reviews')").all();
  const names = new Set(columns.map((column) => column.name));

  for (const name of [
    'prompt_started_at',
    'first_input_at',
    'confidence',
    'rating_model_version',
    'grading_reliability',
  ]) {
    assert.ok(names.has(name), `${name} column missing`);
  }
});

test('M8 migrations: 0016 이 item 을 백필하고 트리거/뷰를 만든다', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) apply(db, name);
  seedExistingPlaySession(db);

  apply(db, '0013_learning_mode.sql');
  apply(db, '0014_play_session_state.sql');
  apply(db, '0015_play_session_items.sql');
  apply(db, '0016_play_session_triggers.sql');

  const stats = db
    .prepare(
      'SELECT answered, correct FROM play_session_stats WHERE session_id = ?'
    )
    .get('s1');
  assert.equal(stats.answered, 1);
  assert.equal(stats.correct, 1);

  const item = db
    .prepare(
      'SELECT answered_at, review_id, correct FROM play_session_items WHERE session_id = ?'
    )
    .get('s1');
  assert.ok(item.answered_at);
  assert.equal(item.review_id, 'r1');
  assert.equal(item.correct, 1);

  // 미답변 item 이 없는 세션 리뷰는 트리거가 막는다.
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO reviews (
             id, card_id, user_id, rating, local_date, reviewed_at,
             reps_before, prev_state, is_correct, session_id
           ) VALUES ('r2', 'c1', 'u1', 3, '2026-11-05', '2026-11-05T02:00:00.000Z',
                     1, 'learning', 1, 's1')`
        )
        .run(),
    /PLAY_SESSION_ITEM_NOT_FOUND/
  );

  const triggers = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
    .all();
  assert.ok(
    triggers.some((trigger) => trigger.name === 'trg_reviews_require_play_item')
  );
});

test('M8 migrations: 완료된 세션은 completed 로 백필하고 만료 시각을 만든다', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) apply(db, name);
  seedExistingPlaySession(db);

  db.prepare("UPDATE play_sessions SET completed_at = '2026-11-05T02:00:00.000Z' WHERE id = 's1'").run();

  apply(db, '0013_learning_mode.sql');
  apply(db, '0014_play_session_state.sql');
  apply(db, '0015_play_session_items.sql');

  const session = db
    .prepare('SELECT status, last_activity_at, expires_at FROM play_sessions WHERE id = ?')
    .get('s1');
  assert.equal(session.status, 'completed');
  assert.equal(session.last_activity_at, '2026-11-05T02:00:00.000Z');
  assert.match(session.expires_at, /Z$/);
});
