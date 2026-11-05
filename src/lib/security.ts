/** 상태 변경 요청의 출처를 검증한다. */

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export type MutationOriginInput = {
  requestUrl: string;
  origin?: string | null;
  referer?: string | null;
  secFetchSite?: string | null;
};

/**
 * 브라우저가 보낸 Origin/Referer/Sec-Fetch-Site로 same-origin 요청인지 판단한다.
 * - `Sec-Fetch-Site: cross-site`는 거부한다.
 * - Origin이 있으면 Origin을 우선한다.
 * - Origin이 없으면 Referer를 본다.
 * - 둘 다 없으면 non-browser 클라이언트로 보고 허용한다.
 *   (CSRF 폼은 브라우저가 Origin을 붙이므로 이 경우 차단된다.)
 */
export function isAllowedMutationOrigin(input: MutationOriginInput): boolean {
  if ((input.secFetchSite ?? '').toLowerCase() === 'cross-site') {
    return false;
  }

  const expected = originOf(input.requestUrl);
  if (!expected) return false;

  if (input.origin) {
    return originOf(input.origin) === expected;
  }

  if (input.referer) {
    return originOf(input.referer) === expected;
  }

  return true;
}
