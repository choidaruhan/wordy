/** 사용자 로컬 기준 'YYYY-MM-DD' */
export function localDate(d: Date, tzOffsetMin: number): string {
  return new Date(d.getTime() + tzOffsetMin * 60_000).toISOString().slice(0, 10);
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
