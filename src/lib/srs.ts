import {
  fsrs,
  generatorParameters,
  State,
  type Card,
  type FSRSParameters,
  type Grade,
} from 'ts-fsrs';

export type CardRow = {
  id: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: string;
  due_at: string;
  last_reviewed_at: string | null;
};

const STATE_BY_NAME: Record<string, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const NAME_BY_STATE: Record<number, string> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

export const FSRS_PARAM_LENGTH = 21;

const BASE_PARAMS: Partial<FSRSParameters> = {
  request_retention: 0.9,
  maximum_interval: 1095,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
};

const schedulerCache = new Map<string, ReturnType<typeof fsrs>>();

/** 사용자별 FSRS 가중치로 스케줄러를 만든다. 실패하면 기본값으로 돌아간다. */
function getScheduler(params?: number[] | null): ReturnType<typeof fsrs> {
  const valid = params && params.length === FSRS_PARAM_LENGTH ? params : null;
  const key = valid ? valid.join(',') : 'default';

  const cached = schedulerCache.get(key);
  if (cached) return cached;

  try {
    const scheduler = fsrs(
      generatorParameters(valid ? { ...BASE_PARAMS, w: valid } : BASE_PARAMS)
    );
    schedulerCache.set(key, scheduler);
    return scheduler;
  } catch {
    if (valid) return getScheduler(null);
    throw new Error('FSRS 스케줄러를 초기화할 수 없습니다.');
  }
}

/** DB에 저장된 JSON 문자열을 FSRS 가중치 배열로 파싱한다. 잘못된 값은 null. */
export function parseFsrsParams(value: unknown): number[] | null {
  if (!value) return null;

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed) || parsed.length !== FSRS_PARAM_LENGTH) return null;
    if (!parsed.every((item) => typeof item === 'number' && Number.isFinite(item))) {
      return null;
    }
    return parsed as number[];
  } catch {
    return null;
  }
}

export function rowToCard(row: CardRow): Card {
  return {
    due: new Date(row.due_at),
    stability: row.stability,
    difficulty: row.difficulty,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: STATE_BY_NAME[row.state] ?? State.New,
    last_review: row.last_reviewed_at ? new Date(row.last_reviewed_at) : undefined,
  };
}

export type Scheduled = {
  due_at: string;
  state: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  last_reviewed_at: string;
  elapsed_days: number;
};

export function schedule(
  row: CardRow,
  now: Date,
  rating: Grade,
  params?: number[] | null
): Scheduled {
  const out = getScheduler(params).next(rowToCard(row), now, rating);
  const c = out.card;

  const elapsed = row.last_reviewed_at
    ? Math.max(0, (now.getTime() - new Date(row.last_reviewed_at).getTime()) / 86_400_000)
    : 0;

  const scheduled =
    c.scheduled_days > 0
      ? c.scheduled_days
      : Math.max(0, (c.due.getTime() - now.getTime()) / 86_400_000);

  return {
    due_at: c.due.toISOString(),
    state: NAME_BY_STATE[c.state] ?? 'new',
    stability: c.stability,
    difficulty: c.difficulty,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    last_reviewed_at: now.toISOString(),
    elapsed_days: elapsed,
  };
}

/** 4개 버튼에 표시할 "다음 복습" 미리보기 */
export function previewIntervals(
  row: CardRow,
  now: Date,
  params?: number[] | null
): Record<1 | 2 | 3 | 4, string> {
  const out = {} as Record<1 | 2 | 3 | 4, string>;
  const scheduler = getScheduler(params);
  for (const r of [1, 2, 3, 4] as const) {
    const next = scheduler.next(rowToCard(row), now, r as Grade);
    out[r] = formatSpan(next.card.due.getTime() - now.getTime());
  }
  return out;
}

export function formatSpan(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return '1분';
  if (min < 60) return `${min}분`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}시간`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}일`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}개월`;
  return `${Math.round(months / 12)}년`;
}
