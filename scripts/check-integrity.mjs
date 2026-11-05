#!/usr/bin/env node
/**
 * 로컬 D1 무결성 점검 CLI.
 *
 *   npm run check:integrity
 *   npm run check:integrity -- --db .wrangler/.../xxxx.sqlite
 *   npm run check:integrity -- --user <userId>
 *
 * 원격 D1은 `wrangler d1 execute`로 같은 점검 SQL을 실행하거나
 * 별도 관리자 경로를 추가해 사용한다.
 */

import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const args = process.argv.slice(2);
const dbArg = valueAfter('--db');
const userArg = valueAfter('--user');

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (name.endsWith('.sqlite') && name !== 'metadata.sqlite') out.push(path);
  }
  return out;
}

function findLocalDb() {
  const root = '.wrangler/state/v3/d1';
  let best = null;

  for (const file of walk(root)) {
    try {
      const db = new DatabaseSync(file);
      const row = db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get();
      db.close();
      if (!best || row.n > best.n) best = { file, n: row.n };
    } catch {
      // D1 메타데이터가 없는 sqlite 파일은 건너뛴다.
    }
  }

  return best?.file ?? null;
}

function d1(db) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              return db.prepare(sql).get(...params) ?? null;
            },
            async all() {
              return { results: db.prepare(sql).all(...params) };
            },
          };
        },
      };
    },
  };
}

function status(ok) {
  return ok ? 'OK' : 'FAIL';
}

async function main() {
  const dbPath = dbArg ?? findLocalDb();
  if (!dbPath) {
    console.error('로컬 D1 sqlite 파일을 찾지 못했습니다. --db로 지정하세요.');
    process.exit(1);
  }

  const bundleDir = mkdtempSync(join(tmpdir(), 'wordy-integrity-cli-'));
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

  const db = new DatabaseSync(dbPath);
  const users = db
    .prepare('SELECT id, email FROM users ORDER BY created_at')
    .all();

  const targets = userArg
    ? users.filter((user) => user.id === userArg)
    : users.length > 0
      ? users
      : [{ id: '', email: '(no users)' }];

  console.log(`DB: ${dbPath}`);
  console.log(`사용자: ${targets.length}명`);

  let failed = false;

  for (const user of targets) {
    const report = await checkIntegrity(d1(db), user.id);
    if (!report.ok) failed = true;

    console.log('');
    console.log(`${status(report.ok)}  ${user.email} (${user.id || 'global'})`);

    for (const check of report.checks) {
      if (check.count === 0) continue;
      const mark = check.severity === 'error' ? '✗' : 'ℹ';
      console.log(
        `  ${mark} ${check.label}: ${check.count}건` +
          (check.sampleIds.length > 0
            ? ` (sample: ${check.sampleIds.join(', ')})`
            : '')
      );
    }

    if (report.checks.every((check) => check.count === 0)) {
      console.log('  이상 없음');
    }
  }

  db.close();
  rmSync(bundleDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
