import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const bundleDir = mkdtempSync(join(tmpdir(), 'wordy-rate-limit-'));
buildSync({
  entryPoints: ['src/lib/rate-limit.ts'],
  outdir: bundleDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});

const {
  checkRateLimit,
  rateLimitPolicy,
  rateLimitWindowStart,
} = await import(pathToFileURL(join(bundleDir, 'rate-limit.js')).href);

test.after(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    readFileSync(
      new URL('../migrations/0020_rate_limits.sql', import.meta.url),
      'utf8'
    )
  );
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
          };
        },
      };
    },
  };
}

test('rate-limit: 고정 윈도우에서 제한하고 다음 윈도우에 초기화한다', async () => {
  const db = freshDb();
  const database = d1(db);
  const now = new Date('2026-11-05T12:00:30.000Z');

  const first = await checkRateLimit(database, 'k', 2, 60, now);
  assert.equal(first.allowed, true);
  assert.equal(first.count, 1);
  assert.equal(first.remaining, 1);

  const second = await checkRateLimit(database, 'k', 2, 60, now);
  assert.equal(second.allowed, true);
  assert.equal(second.count, 2);

  const third = await checkRateLimit(database, 'k', 2, 60, now);
  assert.equal(third.allowed, false);
  assert.equal(third.count, 3);
  assert.equal(third.retryAfter, 30);

  const nextWindow = await checkRateLimit(
    database,
    'k',
    2,
    60,
    new Date('2026-11-05T12:01:00.000Z')
  );
  assert.equal(nextWindow.allowed, true);
  assert.equal(nextWindow.count, 1);
});

test('rate-limit: 키가 다르면 독립적으로 센다', async () => {
  const db = freshDb();
  const database = d1(db);
  const now = new Date('2026-11-05T12:00:00.000Z');

  await checkRateLimit(database, 'a', 1, 60, now);
  await checkRateLimit(database, 'a', 1, 60, now);
  const b = await checkRateLimit(database, 'b', 1, 60, now);

  assert.equal(b.allowed, true);
  assert.equal(b.count, 1);
});

test('rate-limit: 경로별 정책을 매핑한다', () => {
  assert.deepEqual(rateLimitPolicy('POST', '/auth/dev'), {
    key: 'auth',
    scope: 'ip',
    limit: 10,
    windowSeconds: 60,
  });
  assert.equal(rateLimitPolicy('POST', '/words')?.key, 'words-add');
  assert.equal(rateLimitPolicy('POST', '/words/w1/delete')?.key, 'words-delete');
  assert.equal(rateLimitPolicy('POST', '/quiz/answer')?.key, 'quiz-answer');
  assert.equal(rateLimitPolicy('POST', '/quiz/next')?.key, 'quiz-next');
  assert.equal(rateLimitPolicy('POST', '/logout')?.key, 'logout');

  assert.equal(rateLimitPolicy('GET', '/'), null);
  assert.equal(rateLimitPolicy('GET', '/words'), null);
  assert.equal(rateLimitPolicy('POST', '/unknown'), null);
});

test('rate-limit: 윈도우 시작 시각을 계산한다', () => {
  const start = rateLimitWindowStart(
    new Date('2026-11-05T12:00:30.000Z'),
    60
  );
  const end = rateLimitWindowStart(
    new Date('2026-11-05T12:00:59.999Z'),
    60
  );
  assert.equal(start, end);
  assert.equal(start % 60, 0);
});
