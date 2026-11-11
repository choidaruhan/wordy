/** D1 기반 고정 윈도우 요청 제한. */

export type RateLimitScope = 'ip' | 'user';

export type RateLimitPolicy = {
  key: string;
  scope: RateLimitScope;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  count: number;
  remaining: number;
  retryAfter: number;
  windowStart: number;
};

/** 경로/메서드별 제한 정책. null이면 제한하지 않는다. */
export function rateLimitPolicy(
  method: string,
  path: string
): RateLimitPolicy | null {
  const m = method.toUpperCase();

  if (path.startsWith('/auth/')) {
    return { key: 'auth', scope: 'ip', limit: 10, windowSeconds: 60 };
  }

  if (m === 'POST' && path === '/words') {
    return { key: 'words-add', scope: 'user', limit: 120, windowSeconds: 60 };
  }
  if (m === 'POST' && /^\/words\/[^/]+\/delete$/.test(path)) {
    return { key: 'words-delete', scope: 'user', limit: 60, windowSeconds: 60 };
  }
  if (m === 'POST' && path === '/quiz/answer') {
    return { key: 'quiz-answer', scope: 'user', limit: 240, windowSeconds: 60 };
  }
  if (m === 'POST' && path === '/quiz/next') {
    return { key: 'quiz-next', scope: 'user', limit: 240, windowSeconds: 60 };
  }
  if (m === 'POST' && path === '/logout') {
    return { key: 'logout', scope: 'user', limit: 30, windowSeconds: 60 };
  }

  return null;
}

export function rateLimitWindowStart(
  now: Date,
  windowSeconds: number
): number {
  const seconds = Math.floor(now.getTime() / 1000);
  return Math.floor(seconds / windowSeconds) * windowSeconds;
}

export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
  now: Date = new Date()
): Promise<RateLimitResult> {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const windowStart = rateLimitWindowStart(now, windowSeconds);

  await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count)
       VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE
           WHEN rate_limits.window_start = excluded.window_start
           THEN rate_limits.count + 1
           ELSE 1
         END,
         window_start = excluded.window_start`
    )
    .bind(key, windowStart)
    .run();

  const row = await db
    .prepare('SELECT window_start, count FROM rate_limits WHERE key = ?')
    .bind(key)
    .first<{ window_start: number; count: number }>();

  const count = row?.count ?? 1;
  const start = row?.window_start ?? windowStart;
  const retryAfter = Math.max(1, start + windowSeconds - nowSeconds);

  return {
    allowed: count <= limit,
    count,
    remaining: Math.max(0, limit - count),
    retryAfter,
    windowStart: start,
  };
}
