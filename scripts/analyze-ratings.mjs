#!/usr/bin/env node
/**
 * 로컬 D1 리뷰 로그로 평점 캘리브레이션을 출력한다.
 *
 *   npm run analyze:ratings
 *   npm run analyze:ratings -- --user <userId>
 *   npm run analyze:ratings -- --json
 *   npm run analyze:ratings -- --db <sqlite-path>
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const args = process.argv.slice(2);

function hasFlag(flag) {
  return args.includes(flag);
}

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

function pct(value) {
  return value == null ? '-' : `${Math.round(value * 100)}%`;
}

function ms(value) {
  return value == null ? '-' : `${(value / 1000).toFixed(1)}s`;
}

function reliability(value) {
  return value == null ? '-' : value.toFixed(2);
}

function printRow(row) {
  return [
    row.label,
    row.total,
    row.withNext,
    row.success,
    pct(row.successRate),
    ms(row.p50ResponseMs),
    ms(row.p90ResponseMs),
    reliability(row.avgReliability),
  ].join(' | ');
}

async function main() {
  const dbPath = valueAfter('--db') ?? findLocalDb();
  if (!dbPath) {
    console.error('로컬 D1 sqlite 파일을 찾지 못했습니다. --db로 지정하세요.');
    process.exit(1);
  }

  const userArg = valueAfter('--user');
  const bundleDir = mkdtempSync(join(tmpdir(), 'wordy-rating-analysis-'));
  buildSync({
    entryPoints: ['src/lib/rating-analysis.ts'],
    outdir: bundleDir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });

  const { analyzeReviews } = await import(
    pathToFileURL(join(bundleDir, 'rating-analysis.js')).href
  );

  const db = new DatabaseSync(dbPath);
  const rows = db
    .prepare(
      `WITH ordered AS (
         SELECT id, card_id, question_type, rating, response_ms,
                grading_reliability, reviewed_at, elapsed_days,
                LEAD(rating) OVER (
                  PARTITION BY card_id ORDER BY reviewed_at
                ) AS next_rating,
                LEAD(elapsed_days) OVER (
                  PARTITION BY card_id ORDER BY reviewed_at
                ) AS next_elapsed_days
           FROM reviews
          WHERE (? IS NULL OR user_id = ?)
       )
       SELECT * FROM ordered ORDER BY reviewed_at`
    )
    .all(userArg ?? null, userArg ?? null);

  const reviews = rows.map((row) => ({
    cardId: row.card_id,
    cardType: row.question_type ?? 'unknown',
    rating: Number(row.rating),
    responseMs: row.response_ms,
    gradingReliability: row.grading_reliability,
    reviewedAt: row.reviewed_at,
    nextRating: row.next_rating,
    nextElapsedDays: row.next_elapsed_days,
  }));

  const analysis = analyzeReviews(reviews);

  if (hasFlag('--json')) {
    console.log(JSON.stringify({ db: dbPath, user: userArg ?? 'all', analysis }, null, 2));
    db.close();
    rmSync(bundleDir, { recursive: true, force: true });
    return;
  }

  console.log('# 평점 캘리브레이션');
  console.log('');
  console.log(`DB: ${dbPath}`);
  console.log(`사용자: ${userArg ?? '전체'}`);
  console.log(
    `리뷰 ${analysis.totalReviews} · 다음 리뷰 있음 ${analysis.withNext} · 카드 ${analysis.distinctCards}`
  );
  console.log('');

  const header = [
    '구분',
    '표본',
    '다음 리뷰',
    '성공',
    '성공률',
    'p50',
    'p90',
    '신뢰도',
  ];

  console.log('');
  console.log('## 전체');
  console.log(`| ${header.join(' | ')} |`);
  console.log(`| ${header.map(() => '---').join(' | ')} |`);
  console.log(`| ${printRow(analysis.overall)} |`);

  console.log('');
  console.log('## 평점별');
  console.log(`| ${header.join(' | ')} |`);
  console.log(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of analysis.byRating) {
    console.log(`| ${printRow(row)} |`);
  }

  console.log('');
  console.log('## 카드 유형별');
  console.log(`| ${header.join(' | ')} |`);
  console.log(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of analysis.byType) {
    console.log(`| ${printRow(row)} |`);
  }

  console.log('');
  console.log('## 유형 × 평점 (표본 5 이상)');
  console.log(`| ${header.join(' | ')} |`);
  console.log(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of analysis.byTypeRating.filter((row) => row.total >= 5)) {
    console.log(`| ${printRow(row)} |`);
  }

  console.log('');
  console.log('## 신뢰도 구간별');
  console.log(`| ${header.join(' | ')} |`);
  console.log(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of analysis.byReliability) {
    console.log(`| ${printRow(row)} |`);
  }

  console.log('');
  console.log('## 장기 유지율');
  console.log('| 구간 | 표본 | 성공 | 유지율 |');
  console.log('| --- | --- | --- | --- |');
  for (const row of analysis.retention) {
    console.log(
      `| ${row.windowDays}일 이상 | ${row.total} | ${row.success} | ${pct(row.rate)} |`
    );
  }

  db.close();
  rmSync(bundleDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
