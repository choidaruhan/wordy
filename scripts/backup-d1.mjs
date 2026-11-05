#!/usr/bin/env node
/**
 * D1 백업 스크립트.
 *
 *   npm run db:backup            # 원격 wordy-db
 *   npm run db:backup:local      # 로컬 D1
 *   npm run db:backup -- --out-dir /secure/wordy
 */

import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const local = args.includes('--local');
const database = valueAfter('--database') ?? 'wordy-db';
const outDir = valueAfter('--out-dir') ?? 'backups';
const mode = local ? 'local' : 'remote';
const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-')
  .replace('T', '_')
  .slice(0, 19);
const output = join(outDir, `wordy-${mode}-${stamp}.sql`);

mkdirSync(outDir, { recursive: true });

console.log(`D1 ${mode} 백업: ${database} → ${output}`);

const result = spawnSync(
  'npx',
  [
    'wrangler',
    'd1',
    'export',
    database,
    local ? '--local' : '--remote',
    '--output',
    output,
    '-y',
  ],
  { stdio: 'inherit' }
);

if (result.status !== 0) {
  console.error('백업에 실패했습니다.');
  process.exit(result.status ?? 1);
}

const size = statSync(output).size;
console.log('');
console.log(`백업 완료: ${output}`);
console.log(`크기: ${(size / 1024).toFixed(1)} KB`);
console.log('');
console.log('복구 리허설:');
console.log(`  npm run db:restore:drill -- --file ${output}`);
