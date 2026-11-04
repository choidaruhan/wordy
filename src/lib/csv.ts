export type SeedWord = {
  term: string;
  meaning: string;
  pos: string;
  example: string;
  example_ko: string;
};

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

const HEADER = ['term', 'meaning', 'pos', 'example', 'example_ko'];

export function parseWordCsv(text: string): SeedWord[] {
  let raw = text;
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  const rows = parseCsv(raw);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (header.join(',') !== HEADER.join(',')) {
    throw new Error(`CSV 헤더가 올바르지 않습니다: ${header.join(',')}`);
  }

  const out: SeedWord[] = [];
  for (const r of rows.slice(1)) {
    const [term, meaning, pos, example, exampleKo] = r.map((v) => (v ?? '').trim());
    if (!term || !meaning) continue;
    out.push({
      term,
      meaning,
      pos: pos ?? '',
      example: example ?? '',
      example_ko: exampleKo ?? '',
    });
  }
  return out;
}
