import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildSync } from 'esbuild';

const bundleDir = mkdtempSync(join(tmpdir(), 'wordy-report-'));
buildSync({
  entryPoints: ['src/db/report.ts'],
  outdir: bundleDir,
  outbase: 'src',
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});

const { getLearningPulse, getWeeklyReport, bestStreak } = await import(
  pathToFileURL(join(bundleDir, 'db/report.js')).href
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

function seedBase(db) {
  const now = '2026-11-05T01:00:00.000Z';
  db.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)'
  ).run('u1', 'u1@test.local', now);
  db.prepare(
    'INSERT INTO decks (id, user_id, name, created_at) VALUES (?, ?, ?, ?)'
  ).run('d1', 'u1', '테스트', now);
  db.prepare(
    'INSERT INTO words (id, deck_id, term, meaning, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('w1', 'd1', 'test', '테스트', now);
  db.prepare(
    `INSERT INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
     VALUES ('c1', 'w1', 'u1', 'recognition', ?, 'review', ?)`
  ).run('2026-11-06T00:00:00.000Z', now);
}

let reviewIndex = 0;

function review(db, rating, localDate, reviewedAt) {
  reviewIndex += 1;
  db.prepare(
    `INSERT INTO reviews (
       id, card_id, user_id, rating, local_date, reviewed_at, reps_before, prev_state
     ) VALUES (?, 'c1', 'u1', ?, ?, ?, 5, 'review')`
  ).run(`r${reviewIndex}`, rating, localDate, reviewedAt);
}

function seedReviews(db) {
  // 오늘 20개: 15 정답, 5 오답
  for (let i = 0; i < 20; i++) {
    review(
      db,
      i < 15 ? 3 : 1,
      '2026-11-05',
      `2026-11-05T00:${String(i).padStart(2, '0')}:00.000Z`
    );
  }

  // 최근 7일 안의 학습일 2일 추가
  review(db, 3, '2026-11-04', '2026-11-04T01:00:00.000Z');
  review(db, 3, '2026-11-03', '2026-11-03T01:00:00.000Z');

  // 지난 주 10개: 전부 정답
  for (let i = 0; i < 10; i++) {
    review(
      db,
      3,
      '2026-10-26',
      `2026-10-26T01:${String(i).padStart(2, '0')}:00.000Z`
    );
  }
}

test('report: 학습 펄스가 정확도 하락과 학습일을 계산한다', async () => {
  const db = freshDb();
  seedBase(db);
  seedReviews(db);

  const pulse = await getLearningPulse(
    d1(db),
    { id: 'u1', tz_offset_min: 540, timezone: 'Asia/Seoul' },
    new Date('2026-11-05T12:00:00.000Z'),
    200
  );

  assert.equal(pulse.level, 'tired');
  assert.equal(pulse.todayReviews, 20);
  assert.equal(pulse.studyDays7, 3);
  assert.equal(pulse.recentAccuracy, 0.75);
  assert.equal(pulse.previousAccuracy, 1);
  assert.equal(pulse.accuracyDrop, 0.25);
});

test('report: 주간 리포트가 이번 주와 지난 주를 비교한다', async () => {
  const db = freshDb();
  seedBase(db);
  seedReviews(db);

  const report = await getWeeklyReport(d1(db), 'u1', '2026-11-05');
  assert.equal(report.current.reviews, 22);
  assert.equal(report.current.studyDays, 3);
  assert.equal(report.previous.reviews, 10);
  assert.equal(report.previous.studyDays, 1);
  assert.equal(report.reviewDelta, 12);
  assert.ok(report.accuracyDelta < 0);
});

test('report: 최장 연속 학습일을 계산한다', async () => {
  const db = freshDb();
  seedBase(db);
  seedReviews(db);

  assert.equal(await bestStreak(d1(db), 'u1'), 3);
});

test('report: 데이터가 없으면 안전한 기본값을 돌려준다', async () => {
  const db = freshDb();
  seedBase(db);

  const pulse = await getLearningPulse(
    d1(db),
    { id: 'u1', tz_offset_min: 540, timezone: 'Asia/Seoul' },
    new Date('2026-11-05T12:00:00.000Z'),
    200
  );
  assert.equal(pulse.level, 'ok');
  assert.equal(pulse.recentAccuracy, null);
  assert.equal(pulse.todayReviews, 0);

  const report = await getWeeklyReport(d1(db), 'u1', '2026-11-05');
  assert.equal(report.current.reviews, 0);
  assert.equal(report.previous.reviews, 0);

  assert.equal(await bestStreak(d1(db), 'u1'), 0);
});
