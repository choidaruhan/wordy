/** 사용자 로컬 기준 'YYYY-MM-DD' */
export function localDate(
  d: Date,
  tzOffsetMin: number,
  timezone?: string | null
): string {
  if (timezone) {
    try {
      return formatDateInZone(d, timezone);
    } catch {
      // 잘못된 IANA 시간대는 오프셋으로 폴백한다.
    }
  }

  return new Date(d.getTime() + tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

/** IANA 시간대가 런타임에서 유효한지 확인한다. */
export function isValidTimeZone(timezone: string): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function formatDateInZone(d: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  const year = value('year');
  const month = value('month');
  const day = value('day');

  if (!year || !month || !day) {
    throw new Error('날짜를 계산할 수 없습니다.');
  }

  return `${year}-${month}-${day}`;
}

/** 복습 예정 시각을 사람이 읽는 말로 */
export function formatDue(iso: string | null): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return '오늘';
  const days = Math.round(diff / 86_400_000);
  if (days <= 0) return '오늘';
  if (days === 1) return '내일';
  if (days < 30) return `${days}일 뒤`;
  if (days < 365) return `${Math.round(days / 30)}개월 뒤`;
  return `${Math.round(days / 365)}년 뒤`;
}
