#!/usr/bin/env node
/** migrations/*.sql 파일명이 0001부터 빠짐없이 이어지는지 검사한다. */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'migrations';
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.error('마이그레이션 파일이 없습니다.');
  process.exit(1);
}

let failed = false;

files.forEach((name, index) => {
  const expected = String(index + 1).padStart(4, '0');
  const actual = name.slice(0, 4);
  if (actual !== expected) {
    failed = true;
    console.error(
      `마이그레이션 순서 오류: ${name} (기대: ${expected}_*.sql)`
    );
  }
});

if (failed) {
  process.exit(1);
}

console.log(`마이그레이션 순서 OK: ${files.length}개 (${files[0]} ~ ${files.at(-1)})`);
