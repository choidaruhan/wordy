#!/usr/bin/env node
/**
 * 단어 시드 CSV 검수 스크립트
 *
 *   node scripts/check-seed.mjs public/seeds/basic-1000.csv
 *   node scripts/check-seed.mjs public/seeds/basic-1000.csv --expect 1000
 *
 * 검사 항목:
 *   - 헤더 일치, 컬럼 수 일치
 *   - term / meaning / example / example_ko 비어 있지 않음
 *   - term 중복 (대소문자 무시)
 *   - term 이 example 안에 실제로 들어 있는지
 *   - pos 값이 허용 목록에 있는지
 *   - UTF-8 BOM 여부
 */

import { readFileSync } from 'node:fs';

const REQUIRED_HEADER = ['term', 'meaning', 'pos', 'example', 'example_ko'];
const OPTIONAL_HEADER = [
  'category',
  'level',
  'pronunciation',
  'audio_url',
  'collocations',
  'synonyms',
  'antonyms',
  'example_2',
  'example_2_ko',
  'example_3',
  'example_3_ko',
];
const POS = new Set([
  'n', 'v', 'adj', 'adv', 'prep', 'conj', 'pron', 'det', 'num', 'modal', 'phr',
]);
const LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) ?? 'public/seeds/basic-1000.csv';
const expectIdx = args.indexOf('--expect');
const expected = expectIdx >= 0 ? Number(args[expectIdx + 1]) : null;

/** 최소 CSV 파서: 따옴표, 이스케이프된 따옴표(""), 필드 내 줄바꿈 지원 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // skip
    } else {
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

let raw;
try {
  raw = readFileSync(file, 'utf8');
} catch (err) {
  console.error(`✗ 파일을 읽을 수 없습니다: ${file}`);
  process.exit(1);
}

const warnings = [];
const errors = [];

if (raw.charCodeAt(0) === 0xfeff) {
  warnings.push('UTF-8 BOM 이 있습니다. 엑셀 저장 시 발생하며, 앱은 무시하지만 지우는 편이 좋습니다.');
  raw = raw.slice(1);
}

const rows = parseCsv(raw);
if (rows.length === 0) {
  console.error('✗ 파일이 비어 있습니다.');
  process.exit(1);
}

// 헤더: 앞 5개는 필수, 뒤에는 알려진 선택 컬럼만 허용
const header = rows[0].map((h) => h.trim().toLowerCase());

if (
  header.length < REQUIRED_HEADER.length ||
  header.slice(0, REQUIRED_HEADER.length).join(',') !== REQUIRED_HEADER.join(',')
) {
  errors.push(
    `헤더가 다릅니다.\n    기대(앞 5개): ${REQUIRED_HEADER.join(',')}\n    실제: ${header.join(',')}`
  );
}

for (const name of header.slice(REQUIRED_HEADER.length)) {
  if (!OPTIONAL_HEADER.includes(name)) {
    errors.push(`알 수 없는 컬럼입니다: "${name}"`);
  }
}

if (errors.length > 0) {
  console.log(`파일: ${file}`);
  console.log(`\n오류 ${errors.length}건`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}

const read = (row, name) => {
  const index = header.indexOf(name);
  return index >= 0 ? (row[index] ?? '').trim() : '';
};

const seen = new Map();
const data = rows.slice(1);

data.forEach((r, i) => {
  const line = i + 2; // 헤더가 1행
  if (r.length !== header.length) {
    errors.push(`L${line}: 컬럼 수 ${r.length}개 (기대 ${header.length}개) — ${JSON.stringify(r)}`);
    return;
  }

  const term = read(r, 'term');
  const meaning = read(r, 'meaning');
  const pos = read(r, 'pos');
  const example = read(r, 'example');
  const exampleKo = read(r, 'example_ko');
  const level = read(r, 'level');
  const category = read(r, 'category');

  if (!term) errors.push(`L${line}: term 이 비었습니다.`);
  if (!meaning) errors.push(`L${line}: meaning 이 비었습니다. (${term})`);
  if (!example) warnings.push(`L${line}: example 이 없습니다. (${term}) — cloze 카드 승급 불가`);
  if (!exampleKo) warnings.push(`L${line}: example_ko 가 없습니다. (${term})`);

  if (pos && !POS.has(pos)) {
    errors.push(`L${line}: pos "${pos}" 는 허용 값이 아닙니다. (${term})`);
  }

  if (level && !LEVELS.has(level)) {
    errors.push(`L${line}: level "${level}" 은 A1~C2 중 하나여야 합니다. (${term})`);
  }

  if (category && category.length > 30) {
    warnings.push(`L${line}: category 가 너무 깁니다. (${term})`);
  }

  for (const listName of ['collocations', 'synonyms', 'antonyms']) {
    const value = read(r, listName);
    if (value && value.split('|').some((part) => !part.trim())) {
      warnings.push(`L${line}: ${listName} 에 빈 항목이 있습니다. (${term})`);
    }
  }

  for (const suffix of ['2', '3']) {
    const extra = read(r, `example_${suffix}`);
    if (!extra) continue;
    const has = extra.toLowerCase().includes(term.toLowerCase());
    const stem = term.length > 4 ? term.slice(0, term.length - 1).toLowerCase() : null;
    if (!has && !(stem && extra.toLowerCase().includes(stem))) {
      warnings.push(`L${line}: example_${suffix} 안에 "${term}" 이 보이지 않습니다. → "${extra}"`);
    }
  }

  if (term) {
    const key = term.toLowerCase();
    if (seen.has(key)) {
      errors.push(`L${line}: term 중복 "${term}" (L${seen.get(key)} 에도 있음)`);
    } else {
      seen.set(key, line);
    }
  }

  if (term && example) {
    const has = example.toLowerCase().includes(term.toLowerCase());
    const stem = term.length > 4 ? term.slice(0, term.length - 1).toLowerCase() : null;
    if (!has && !(stem && example.toLowerCase().includes(stem))) {
      warnings.push(`L${line}: example 안에 "${term}" 이 보이지 않습니다. → "${example}"`);
    }
  }
});

// 보고
console.log(`파일: ${file}`);
console.log(`단어: ${data.length}개`);

if (expected !== null) {
  if (data.length === expected) {
    console.log(`목표: ${expected}개 ✓`);
  } else {
    console.log(`목표: ${expected}개 (남은 ${expected - data.length}개)`);
  }
}

const byPos = data.reduce((acc, r) => {
  const p = read(r, 'pos') || '(없음)';
  acc[p] = (acc[p] ?? 0) + 1;
  return acc;
}, {});
console.log('품사:', Object.entries(byPos).map(([k, v]) => `${k} ${v}`).join(' · '));

if (warnings.length) {
  console.log(`\n경고 ${warnings.length}건`);
  for (const w of warnings.slice(0, 20)) console.log(`  ! ${w}`);
  if (warnings.length > 20) console.log(`  ... 외 ${warnings.length - 20}건`);
}

if (errors.length) {
  console.log(`\n오류 ${errors.length}건`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}

console.log('\n✓ 오류 없음');
