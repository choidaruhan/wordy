#!/usr/bin/env node
/**
 * D1 백업 복구 리허설.
 *
 *   npm run db:restore:drill
 *   npm run db:restore:drill -- --remote
 *   npm run db:restore:drill -- --file backups/wordy-local-....sql
 *
 * 실제 DB는 건드리지 않는다. 백업 SQL을 임시 SQLite에 복원한 뒤
 * PRAGMA integrity_check와 앱 무결성 점검을 실행한다.
 */

import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';

const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
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

function count(db, table) {
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  } catch {
    return null;
  }
}

const remote = args.includes('--remote');
const database = valueAfter('--database') ?? 'wordy-db';
const inputFile = valueAfter('--file');
const tempDir = mkdtempSync(join(tmpdir(), 'wordy-restore-drill-'));

let backupFile = inputFile;

try {
  if (!backupFile) {
    backupFile = join(tempDir, `wordy-${remote ? 'remote' : 'local'}-drill.sql`);
    console.log(
      `백업 생성: ${database} (${remote ? 'remote' : 'local'}) → ${backupFile}`
    );
    const exportResult = spawnSync(
      'npx',
      [
        'wrangler',
        'd1',
        'export',
        database,
        remote ? '--remote' : '--local',
        '--output',
        backupFile,
        '-y',
      ],
      { stdio: 'inherit' }
    );
    if (exportResult.status !== 0) {
      throw new Error('백업 export에 실패했습니다.');
    }
  }

  const backupSize = statSync(backupFile).size;
  console.log(`백업 파일: ${backupFile} (${(backupSize / 1024).toFixed(1)} KB)`);

  const restorePath = join(tempDir, 'restore.sqlite');
  const db = new DatabaseSync(restorePath);

  console.log('임시 DB에 복원 중...');
  db.exec(readFileSync(backupFile, 'utf8'));

  const integrityRows = db.prepare('PRAGMA integrity_check').all();
  const integrityOk =
    integrityRows.length > 0 &&
    String(Object.values(integrityRows[0])[0]).toLowerCase() === 'ok';
  console.log(`PRAGMA integrity_check: ${integrityOk ? 'ok' : 'FAIL'}`);

  const tables = [
    'users',
    'decks',
    'words',
    'cards',
    'reviews',
    'play_sessions',
    'play_session_items',
    'daily_plans',
    'quiz_sessions',
  ];
  const counts = {};
  for (const table of tables) counts[table] = count(db, table);
  console.log(
    Object.entries(counts)
      .map(([table, n]) => `${table}=${n ?? 'n/a'}`)
      .join(' · ')
  );

  const existingTables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name)
  );
  const requiredTables = [
    'users',
    'decks',
    'words',
    'cards',
    'reviews',
    'play_session_items',
    'word_examples',
    'quiz_questions',
  ];
  const missingTables = requiredTables.filter(
    (table) => !existingTables.has(table)
  );

  let failed = !integrityOk;

  if (missingTables.length > 0) {
    console.log('');
    console.log(
      `앱 무결성 점검: 이전 스키마 백업이라 건너뜁니다 (없는 테이블: ${missingTables.join(', ')})`
    );
  } else {
    const bundleDir = join(tempDir, 'bundle');
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

    const users = db
      .prepare('SELECT id, email FROM users ORDER BY created_at')
      .all();
    const targets =
      users.length > 0 ? users : [{ id: '', email: '(no users)' }];

    console.log('');
    console.log('앱 무결성 점검:');

    for (const user of targets) {
      const report = await checkIntegrity(d1(db), user.id);
      if (!report.ok) failed = true;
      console.log(`  ${report.ok ? 'OK' : 'FAIL'}  ${user.email}`);
      for (const check of report.checks) {
        if (check.count === 0) continue;
        const mark = check.severity === 'error' ? '✗' : 'ℹ';
        console.log(
          `    ${mark} ${check.label}: ${check.count}건` +
            (check.sampleIds.length > 0
              ? ` (sample: ${check.sampleIds.join(', ')})`
              : '')
        );
      }
    }
  }

  db.close();
  console.log('');
  console.log(failed ? '복구 리허설 실패' : '복구 리허설 성공');
  process.exitCode = failed ? 1 : 0;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  // 생성한 백업 파일과 임시 복원 DB를 함께 정리한다.
  rmSync(tempDir, { recursive: true, force: true });
}
