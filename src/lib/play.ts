/** 하루 목표 없는 플레이 세션의 순수 규칙. */

export type PlayMode = 'quick' | 'typing' | 'cloze' | 'listening' | 'weak' | 'custom';

export const PLAY_MODE_LABELS: Record<PlayMode, string> = {
  quick: '바로 시작',
  typing: '철자 도전',
  cloze: '빈칸 퀴즈',
  listening: '듣기 퀴즈',
  weak: '취약 집중',
  custom: '새 단어 연습',
};

export const PLAY_MODE_DESCRIPTIONS: Record<PlayMode, string> = {
  quick: '뜻·철자·빈칸을 섞어서',
  typing: '뜻을 보고 영어로 쓰기',
  cloze: '문장 속 빈칸 채우기',
  listening: '발음 듣고 철자 쓰기',
  weak: '자주 틀린 단어만',
  custom: '이 단어장의 새 단어만',
};

export const PLAY_MODES: PlayMode[] = [
  'quick',
  'typing',
  'cloze',
  'listening',
  'weak',
];

export const DEFAULT_SESSION_SIZE = 5;
export const DEFAULT_NEW_PER_SESSION = 2;
export const MAX_SESSION_SIZE = 20;
export const MAX_NEW_PER_SESSION = 10;

export function normalizePlayMode(value: unknown, listeningEnabled = true): PlayMode {
  const mode = String(value ?? '');
  if (mode === 'typing' || mode === 'cloze' || mode === 'weak' || mode === 'custom') {
    return mode;
  }
  if (mode === 'listening') return listeningEnabled ? 'listening' : 'quick';
  return 'quick';
}

export function clampSessionSize(value: unknown, fallback = DEFAULT_SESSION_SIZE): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_SESSION_SIZE, Math.max(1, n));
}

export function clampNewPerSession(
  value: unknown,
  fallback = DEFAULT_NEW_PER_SESSION
): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(MAX_NEW_PER_SESSION, n);
}

/** 모드별로 사용할 카드 유형. null이면 전체 유형. */
export function modeCardTypes(mode: PlayMode): string[] | null {
  if (mode === 'typing') return ['recall', 'cloze'];
  if (mode === 'cloze') return ['cloze'];
  if (mode === 'listening') return ['listening'];
  return null;
}

export function isCustomMode(mode: PlayMode): boolean {
  return mode === 'custom';
}


