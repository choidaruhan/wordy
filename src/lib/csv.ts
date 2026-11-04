import type { WordRow } from '../types';
import { parseExtraExamples, parseJsonList, parsePipeList } from './word-meta';

export type CsvExample = {
  sentence: string;
  translation: string;
};

export type SeedWord = {
  term: string;
  meaning: string;
  pos: string;
  example: string;
  example_ko: string;
  category: string;
  level: string;
  pronunciation: string;
  audio_url: string;
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  extraExamples: CsvExample[];
};

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

/** 따옴표, 이스케이프된 따옴표(""), 필드 내 줄바꿈을 지원하는 최소 CSV 파서 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
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
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

export function parseWordCsv(text: string): SeedWord[] {
  let raw = text;
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  const rows = parseCsv(raw);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());

  if (
    header.length < REQUIRED_HEADER.length ||
    header.slice(0, REQUIRED_HEADER.length).join(',') !== REQUIRED_HEADER.join(',')
  ) {
    throw new Error(
      `CSV 헤더가 올바르지 않습니다. 앞 5개는 ${REQUIRED_HEADER.join(',')} 여야 합니다: ${header.join(',')}`
    );
  }

  const optional = new Set(OPTIONAL_HEADER);
  for (const name of header.slice(REQUIRED_HEADER.length)) {
    if (!name || !optional.has(name)) {
      throw new Error(`알 수 없는 CSV 컬럼입니다: ${name}`);
    }
  }

  const column = (name: string) => header.indexOf(name);
  const read = (row: string[], name: string) => {
    const index = column(name);
    return index >= 0 ? (row[index] ?? '').trim() : '';
  };

  const out: SeedWord[] = [];

  for (const row of rows.slice(1)) {
    const term = read(row, 'term');
    const meaning = read(row, 'meaning');
    if (!term || !meaning) continue;

    const extraExamples: CsvExample[] = [];
    for (const suffix of ['2', '3']) {
      const sentence = read(row, `example_${suffix}`);
      if (!sentence) continue;
      extraExamples.push({
        sentence,
        translation: read(row, `example_${suffix}_ko`),
      });
    }

    out.push({
      term,
      meaning,
      pos: read(row, 'pos'),
      example: read(row, 'example'),
      example_ko: read(row, 'example_ko'),
      category: read(row, 'category'),
      level: read(row, 'level'),
      pronunciation: read(row, 'pronunciation'),
      audio_url: read(row, 'audio_url'),
      collocations: parsePipeList(read(row, 'collocations')),
      synonyms: parsePipeList(read(row, 'synonyms')),
      antonyms: parsePipeList(read(row, 'antonyms')),
      extraExamples,
    });
  }

  return out;
}

export function csvField(value: string | null | undefined): string {
  const text = (value ?? '').replace(/\r?\n/g, ' ');
  return `"${text.replace(/"/g, '""')}"`;
}

export function listToCsvField(values: string[]): string {
  return values.join('|');
}

const FULL_HEADER = [
  ...REQUIRED_HEADER,
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

/** 단어장을 CSV로 내보낸다. 기본은 5컬럼, full이면 확장 컬럼 포함. */
export function buildDeckCsv(words: WordRow[], full: boolean): string {
  const lines = [(full ? FULL_HEADER : REQUIRED_HEADER).join(',')];

  for (const w of words) {
    const base = [w.term, w.meaning, w.pos, w.example, w.example_ko];

    if (!full) {
      lines.push(base.map(csvField).join(','));
      continue;
    }

    const extras = parseExtraExamples(w.extra_examples_raw);
    const extra2 = extras[0];
    const extra3 = extras[1];

    lines.push(
      [
        ...base,
        w.category,
        w.level,
        w.pronunciation,
        w.audio_url,
        listToCsvField(parseJsonList(w.collocations)),
        listToCsvField(parseJsonList(w.synonyms)),
        listToCsvField(parseJsonList(w.antonyms)),
        extra2?.sentence ?? null,
        extra2?.translation ?? null,
        extra3?.sentence ?? null,
        extra3?.translation ?? null,
      ]
        .map(csvField)
        .join(',')
    );
  }

  // 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다. 우리 임포터는 BOM을 무시한다.
  return '\uFEFF' + lines.join('\n') + '\n';
}
