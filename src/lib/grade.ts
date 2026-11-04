/** 입력 답안과 정답을 비교한다. 오타는 단어 길이에 따라 관대하게 허용. */

export type GradeResult = {
  ok: boolean;
  typo: boolean;
  distance: number;
};

export function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

/**
 * 정답이 여러 개면 `/` 로 구분한다. 예: "ubiquitous / omnipresent"
 * 오타 허용 거리: 8자 이상 2, 5~7자 1, 4자 이하 0
 */
export function gradeAnswer(input: string, answer: string): GradeResult {
  const a = normalize(input);
  const candidates = answer
    .split('/')
    .map(normalize)
    .filter((c) => c.length > 0);

  if (a.length === 0 || candidates.length === 0) {
    return { ok: false, typo: false, distance: Math.max(a.length, 1) };
  }

  let best = Infinity;
  let bestLength = 0;

  for (const c of candidates) {
    if (c === a) return { ok: true, typo: false, distance: 0 };
    const d = levenshtein(a, c);
    if (d < best) {
      best = d;
      bestLength = c.length;
    }
  }

  const allowed = bestLength >= 8 ? 2 : bestLength >= 5 ? 1 : 0;
  if (best <= allowed) return { ok: true, typo: true, distance: best };

  return { ok: false, typo: false, distance: best };
}

/** 글자 단위 비교 (표시용) */
export function diffChars(input: string, answer: string): { ch: string; ok: boolean }[] {
  const a = normalize(input);
  const b = normalize(answer);
  const len = Math.max(a.length, b.length);
  const out: { ch: string; ok: boolean }[] = [];

  for (let i = 0; i < len; i++) {
    out.push({ ch: b[i] ?? '', ok: a[i] === b[i] });
  }
  return out;
}

/** 예문에서 정답 단어를 가린다. 매칭되는 형태가 없으면 null */
export function blankOut(example: string | null, term: string): string | null {
  if (!example) return null;

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'gi');
  if (!re.test(example)) return null;

  return example.replace(re, '____');
}
