export type ExtraExample = {
  sentence: string;
  translation: string | null;
};

/** DB의 JSON 배열 문자열을 안전하게 파싱한다. 실패하면 파이프 구분으로 대체. */
export function parseJsonList(value: string | null | undefined): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  } catch {
    // fall through
  }

  return parsePipeList(value);
}

export function parsePipeList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function serializeJsonList(values: string[] | null | undefined): string | null {
  const list = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return list.length > 0 ? JSON.stringify(list) : null;
}

/**
 * `word_examples`를 GROUP_CONCAT으로 가져온 문자열을 파싱한다.
 * 형식: `sentence<TAB>translation` 줄들을 개행으로 연결.
 */
export function parseExtraExamples(raw: string | null | undefined): ExtraExample[] {
  if (!raw) return [];

  return raw
    .split('\n')
    .map((line) => {
      const [sentence = '', translation = ''] = line.split('\t');
      return {
        sentence: sentence.trim(),
        translation: translation.trim() || null,
      };
    })
    .filter((item) => item.sentence.length > 0);
}

export function listOrNull(values: string[]): string | null {
  return values.length > 0 ? values.join('|') : null;
}
