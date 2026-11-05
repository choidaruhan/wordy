import {
  SELECT_CARD,
  getCardForReview,
  type QueueCard,
} from './review';
import { listWeakness, weakWordIds } from './weak';
import {
  modeCardTypes,
  normalizePlayMode,
  type PlayMode,
} from '../lib/play';

export type PlaySessionRow = {
  id: string;
  user_id: string;
  mode: string;
  target_size: number;
  answered: number;
  correct: number;
  started_at: string;
  completed_at: string | null;
  deck_id: string | null;
  status: string;
  review_target: number;
  new_target: number;
  weak_target: number;
  policy: string;
  policy_reason: string | null;
  last_activity_at: string | null;
  expires_at: string | null;
};

export type PlaySessionPlan = {
  targetSize: number;
  reviewTarget: number;
  newTarget: number;
  weakTarget: number;
  policy: string;
  reason: string;
};

export type PlayPoolCounts = {
  due: number;
  newCards: number;
  dueByType: Record<string, number>;
};

export type PlayTodayStats = {
  todayDone: number;
  todayNewDone: number;
  todayReviewDone: number;
  throughput7: number;
};

export type PlayBucket = 'review' | 'new' | 'weak' | 'custom_new';

export type PlayItemRow = {
  id: string;
  session_id: string;
  card_id: string;
  position: number;
  bucket: string;
  kind: string;
  served_at: string;
  answered_at: string | null;
  review_id: string | null;
  correct: number | null;
};

export type PlayCardSelection = {
  card: QueueCard;
  bucket: PlayBucket;
};

export type PlayServedCard = {
  card: QueueCard;
  item: PlayItemRow;
};

const SESSION_COLS = `
  s.id, s.user_id, s.mode, s.target_size,
  COALESCE(v.answered, 0) AS answered,
  COALESCE(v.correct, 0) AS correct,
  s.started_at, s.completed_at, s.deck_id, s.status,
  s.review_target, s.new_target, s.weak_target, s.policy, s.policy_reason,
  s.last_activity_at, s.expires_at
`;

/**
 * 복습 대기 카드.
 * - learning/review/relearning 은 due_at 이 지나야 한다.
 * - 승급된 new 카드(recall/cloze/listening)도 첫 학습을 위해 포함한다.
 * - 새 recognition 카드는 여기 포함하지 않는다.
 */
const DUE_CARD_STATE = `
  (
    state IN ('learning','review','relearning')
    OR (state = 'new' AND card_type != 'recognition')
  )
`;

const SESSION_DAYS_MS = 24 * 60 * 60 * 1000;
const ABANDON_AFTER_MS = 6 * 60 * 60 * 1000;

function placeholders(count: number): string {
  return new Array(count).fill('?').join(',');
}

function nonNegativeInt(value: number): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('UNIQUE constraint failed');
}

export async function createPlaySession(
  db: D1Database,
  userId: string,
  mode: string,
  plan: PlaySessionPlan,
  now: Date = new Date(),
  deckId: string | null = null
): Promise<PlaySessionRow> {
  const id = crypto.randomUUID();
  const normalizedMode = normalizePlayMode(mode);
  const targetSize = nonNegativeInt(plan.targetSize);
  const reviewTarget = nonNegativeInt(plan.reviewTarget);
  const newTarget = nonNegativeInt(plan.newTarget);
  const weakTarget = nonNegativeInt(plan.weakTarget);
  const policy = plan.policy === 'daily' ? 'daily' : 'session';
  const startedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS_MS).toISOString();

  await db
    .prepare(
      `INSERT INTO play_sessions (
         id, user_id, mode, target_size, review_target, new_target, weak_target,
         policy, policy_reason, status, started_at, last_activity_at, expires_at, deck_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
    )
    .bind(
      id,
      userId,
      normalizedMode,
      targetSize,
      reviewTarget,
      newTarget,
      weakTarget,
      policy,
      plan.reason,
      startedAt,
      startedAt,
      expiresAt,
      deckId
    )
    .run();

  return {
    id,
    user_id: userId,
    mode: normalizedMode,
    target_size: targetSize,
    answered: 0,
    correct: 0,
    started_at: startedAt,
    completed_at: null,
    deck_id: deckId,
    status: 'active',
    review_target: reviewTarget,
    new_target: newTarget,
    weak_target: weakTarget,
    policy,
    policy_reason: plan.reason,
    last_activity_at: startedAt,
    expires_at: expiresAt,
  };
}

export async function getPlaySession(
  db: D1Database,
  userId: string,
  sessionId: string
): Promise<PlaySessionRow | null> {
  return db
    .prepare(
      `SELECT ${SESSION_COLS}
         FROM play_sessions s
         LEFT JOIN play_session_stats v ON v.session_id = s.id
        WHERE s.id = ? AND s.user_id = ?`
    )
    .bind(sessionId, userId)
    .first<PlaySessionRow>();
}

/** 마지막으로 남아 있는 진행 중 세션. 이어하기 카드에 사용한다. */
export async function getActivePlaySession(
  db: D1Database,
  userId: string
): Promise<PlaySessionRow | null> {
  return db
    .prepare(
      `SELECT ${SESSION_COLS}
         FROM play_sessions s
         LEFT JOIN play_session_stats v ON v.session_id = s.id
        WHERE s.user_id = ? AND s.status = 'active'
          AND (
            COALESCE(v.answered, 0) < s.target_size
            OR EXISTS (
              SELECT 1 FROM play_session_items i
               WHERE i.session_id = s.id
                 AND i.kind = 'wrapup'
                 AND i.answered_at IS NULL
            )
            OR EXISTS (
              SELECT 1 FROM play_session_items p
               WHERE p.session_id = s.id
                 AND p.kind = 'prompt'
                 AND p.answered_at IS NOT NULL
                 AND p.correct = 0
                 AND NOT EXISTS (
                   SELECT 1 FROM play_session_items w
                    WHERE w.session_id = p.session_id
                      AND w.card_id = p.card_id
                      AND w.kind = 'wrapup'
                 )
            )
          )
        ORDER BY s.started_at DESC
        LIMIT 1`
    )
    .bind(userId)
    .first<PlaySessionRow>();
}

export async function getPlayPoolCounts(
  db: D1Database,
  userId: string,
  nowIso: string
): Promise<PlayPoolCounts> {
  const [dueRow, typeRows, newRow] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM cards
          WHERE user_id = ? AND suspended = 0
            AND ${DUE_CARD_STATE}
            AND due_at <= ?`
      )
      .bind(userId, nowIso)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT card_type, COUNT(*) AS n FROM cards
          WHERE user_id = ? AND suspended = 0
            AND ${DUE_CARD_STATE}
            AND due_at <= ?
          GROUP BY card_type`
      )
      .bind(userId, nowIso)
      .all<{ card_type: string; n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM cards
          WHERE user_id = ? AND suspended = 0
            AND state = 'new' AND card_type = 'recognition'`
      )
      .bind(userId)
      .first<{ n: number }>(),
  ]);

  const dueByType: Record<string, number> = {};
  for (const row of typeRows.results) dueByType[row.card_type] = row.n;

  return {
    due: dueRow?.n ?? 0,
    newCards: newRow?.n ?? 0,
    dueByType,
  };
}

/** 정책 계산에 필요한 오늘 진행/7일 처리량. */
export async function getTodayPlayStats(
  db: D1Database,
  userId: string,
  today: string
): Promise<PlayTodayStats> {
  const from = new Date(`${today}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 6);
  const fromDate = from.toISOString().slice(0, 10);

  const [done, newDone, last7] = await Promise.all([
    db
      .prepare('SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND local_date = ?')
      .bind(userId, today)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM reviews
          WHERE user_id = ? AND local_date = ?
            AND reps_before = 0 AND question_type = 'recognition'`
      )
      .bind(userId, today)
      .first<{ n: number }>(),
    db
      .prepare('SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND local_date >= ?')
      .bind(userId, fromDate)
      .first<{ n: number }>(),
  ]);

  const todayDone = done?.n ?? 0;
  const todayNewDone = newDone?.n ?? 0;

  return {
    todayDone,
    todayNewDone,
    todayReviewDone: Math.max(0, todayDone - todayNewDone),
    throughput7: (last7?.n ?? 0) / 7,
  };
}

/** custom 모드에서 사용할 단어장의 새 recognition 수. */
export async function countDeckNewCards(
  db: D1Database,
  userId: string,
  deckId: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM cards c
         JOIN words w ON w.id = c.word_id
        WHERE c.user_id = ? AND c.suspended = 0
          AND c.state = 'new' AND c.card_type = 'recognition'
          AND w.deck_id = ?`
    )
    .bind(userId, deckId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function countNewServed(
  db: D1Database,
  userId: string,
  sessionId: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM reviews
        WHERE user_id = ? AND session_id = ?
          AND reps_before = 0 AND question_type = 'recognition'`
    )
    .bind(userId, sessionId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function pickNewCard(
  db: D1Database,
  userId: string,
  sessionId: string,
  deckId: string | null = null
): Promise<QueueCard | null> {
  const deckFilter = deckId ? 'AND w.deck_id = ?' : '';
  const binds = deckId ? [userId, deckId, sessionId] : [userId, sessionId];
  // custom 은 최근에 추가한 단어부터, 그 외는 오래된 새 단어부터 낸다.
  const order = deckId ? 'DESC' : 'ASC';

  return db
    .prepare(
      `${SELECT_CARD}
        WHERE c.user_id = ? AND c.suspended = 0
          AND c.state = 'new' AND c.card_type = 'recognition'
          ${deckFilter}
          AND NOT EXISTS (
            SELECT 1 FROM reviews r
             WHERE r.session_id = ? AND r.card_id = c.id
          )
        ORDER BY c.created_at ${order}
        LIMIT 1`
    )
    .bind(...binds)
    .first<QueueCard>();
}

/**
 * 세션의 다음 카드 후보 1장과 버킷.
 * quick 은 due → new 순서를 섞고, 특정 모드는 해당 유형의 due 만 낸다.
 * 같은 세션에서 이미 리뷰한 카드는 제외한다.
 */
async function selectNextPlayCard(
  db: D1Database,
  userId: string,
  session: PlaySessionRow,
  now: Date
): Promise<PlayCardSelection | null> {
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const mode: PlayMode = normalizePlayMode(session.mode);
  const types = modeCardTypes(mode);
  const targetSize = Math.max(0, session.target_size);

  if (session.answered >= targetSize) return null;

  const servedNew =
    mode === 'quick' || mode === 'custom'
      ? await countNewServed(db, userId, session.id)
      : 0;
  const reviewServed = Math.max(0, session.answered - servedNew);

  let weakFilter = '';
  const weakBinds: string[] = [];
  if (mode === 'weak') {
    if (session.answered >= Math.max(0, session.weak_target)) return null;
    const report = await listWeakness(db, userId, now);
    const ids = weakWordIds(report);
    if (ids.length === 0) return null;
    weakFilter = ` AND c.word_id IN (${placeholders(ids.length)})`;
    weakBinds.push(...ids);
  }

  // 커스텀 모드는 지정한 단어장의 새 단어만, 최근에 추가한 것부터 낸다.
  if (mode === 'custom') {
    if (!session.deck_id) return null;
    if (servedNew >= Math.max(0, session.new_target)) return null;
    const card = await pickNewCard(db, userId, session.id, session.deck_id);
    return card ? { card, bucket: 'custom_new' } : null;
  }

  // 특정 유형 모드는 복습 목표를 넘기지 않는다.
  if (mode !== 'quick') {
    if (session.answered >= Math.max(0, session.review_target)) return null;
  }

  const newAllowed =
    mode === 'quick' && servedNew < Math.max(0, session.new_target);
  const reviewAllowed =
    mode === 'quick' ? reviewServed < Math.max(0, session.review_target) : true;

  // 복습이 충분한 날에도 3번째 문제부터 새 단어를 섞는다.
  if (newAllowed && session.answered >= 2) {
    const fresh = await pickNewCard(db, userId, session.id);
    if (fresh) return { card: fresh, bucket: 'new' };
  }

  const typeFilter = types
    ? ` AND c.card_type IN (${placeholders(types.length)})`
    : '';
  const binds: unknown[] = [
    userId,
    nowIso,
    session.id,
    since,
    ...(types ?? []),
    ...weakBinds,
  ];

  if (reviewAllowed) {
    const due = await db
      .prepare(
        `${SELECT_CARD}
          WHERE c.user_id = ? AND c.suspended = 0
            AND ${DUE_CARD_STATE}
            AND c.due_at <= ?
            AND NOT EXISTS (
              SELECT 1 FROM reviews r
               WHERE r.session_id = ? AND r.card_id = c.id
            )
            AND (c.last_reviewed_at IS NULL OR c.last_reviewed_at < ?)
            ${typeFilter}
            ${weakFilter}
          ORDER BY c.due_at ASC
          LIMIT 1`
      )
      .bind(...binds)
      .first<QueueCard>();

    if (due) {
      return { card: due, bucket: mode === 'weak' ? 'weak' : 'review' };
    }
  }

  // 특정 모드(철자/빈칸/듣기/취약)는 새 단어를 억지로 넣지 않는다.
  if (mode !== 'quick') return null;

  // due가 없으면 새 단어로 한 판을 채운다.
  if (!newAllowed) return null;
  const fresh = await pickNewCard(db, userId, session.id);
  return fresh ? { card: fresh, bucket: 'new' } : null;
}

/** 호환용: 카드만 필요한 호출자(테스트 등)를 위한 래퍼. */
export async function nextPlayCard(
  db: D1Database,
  userId: string,
  session: PlaySessionRow,
  now: Date
): Promise<QueueCard | null> {
  const selection = await selectNextPlayCard(db, userId, session, now);
  return selection?.card ?? null;
}

async function getPendingPlayItem(
  db: D1Database,
  userId: string,
  sessionId: string,
  kind: 'prompt' | 'wrapup' = 'prompt'
): Promise<PlayItemRow | null> {
  return db
    .prepare(
      `SELECT i.*
         FROM play_session_items i
         JOIN play_sessions s ON s.id = i.session_id
        WHERE i.session_id = ? AND s.user_id = ?
          AND i.answered_at IS NULL AND i.kind = ?
        ORDER BY i.position DESC
        LIMIT 1`
    )
    .bind(sessionId, userId, kind)
    .first<PlayItemRow>();
}

export async function getPlaySessionItem(
  db: D1Database,
  userId: string,
  sessionId: string,
  itemId: string
): Promise<PlayItemRow | null> {
  return db
    .prepare(
      `SELECT i.*
         FROM play_session_items i
         JOIN play_sessions s ON s.id = i.session_id
        WHERE i.id = ? AND i.session_id = ? AND s.user_id = ?`
    )
    .bind(itemId, sessionId, userId)
    .first<PlayItemRow>();
}

async function insertPlayItem(
  db: D1Database,
  sessionId: string,
  cardId: string,
  bucket: PlayBucket,
  now: Date
): Promise<PlayItemRow> {
  const id = crypto.randomUUID();
  const servedAt = now.toISOString();

  await db
    .prepare(
      `INSERT INTO play_session_items (
         id, session_id, card_id, position, bucket, kind, served_at
       ) VALUES (
         ?, ?, ?,
         COALESCE((SELECT MAX(position) FROM play_session_items WHERE session_id = ?), 0) + 1,
         ?, 'prompt', ?
       )`
    )
    .bind(id, sessionId, cardId, sessionId, bucket, servedAt)
    .run();

  return {
    id,
    session_id: sessionId,
    card_id: cardId,
    position: 0,
    bucket,
    kind: 'prompt',
    served_at: servedAt,
    answered_at: null,
    review_id: null,
    correct: null,
  };
}

async function ensureWrapupItems(
  db: D1Database,
  sessionId: string,
  now: Date
): Promise<void> {
  const existing = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM play_session_items
        WHERE session_id = ? AND kind = 'wrapup'`
    )
    .bind(sessionId)
    .first<{ n: number }>();

  const remaining = Math.max(0, 2 - (existing?.n ?? 0));
  if (remaining === 0) return;

  await db
    .prepare(
      `INSERT OR IGNORE INTO play_session_items (
         id, session_id, card_id, position, bucket, kind, served_at
       )
       SELECT lower(hex(randomblob(16))),
              p.session_id,
              p.card_id,
              (SELECT COALESCE(MAX(position), 0)
                 FROM play_session_items
                WHERE session_id = p.session_id) + 1,
              'wrapup',
              'wrapup',
              ?
         FROM play_session_items p
        WHERE p.session_id = ?
          AND p.kind = 'prompt'
          AND p.answered_at IS NOT NULL
          AND p.correct = 0
          AND NOT EXISTS (
            SELECT 1 FROM play_session_items w
             WHERE w.session_id = p.session_id
               AND w.card_id = p.card_id
               AND w.kind = 'wrapup'
          )
        ORDER BY p.position DESC
        LIMIT ?`
    )
    .bind(now.toISOString(), sessionId, remaining)
    .run();
}

/**
 * 다음 문제를 “출제”한다.
 * 1) 미답변 오답 마무리 item
 * 2) 미답변 prompt item
 * 3) 메인 목표 미달이면 다음 카드
 * 4) 메인 목표 달성이면 오답 마무리 item 생성/출제
 */
export async function serveNextPlayCard(
  db: D1Database,
  userId: string,
  session: PlaySessionRow,
  now: Date
): Promise<PlayServedCard | null> {
  const pendingWrap = await getPendingPlayItem(db, userId, session.id, 'wrapup');
  if (pendingWrap) {
    const card = await getCardForReview(db, userId, pendingWrap.card_id);
    if (card) return { card, item: pendingWrap };
  }

  const pending = await getPendingPlayItem(db, userId, session.id, 'prompt');
  if (pending) {
    const card = await getCardForReview(db, userId, pending.card_id);
    if (card) return { card, item: pending };
  }

  if (session.answered >= session.target_size) {
    await ensureWrapupItems(db, session.id, now);
    const wrap = await getPendingPlayItem(db, userId, session.id, 'wrapup');
    if (wrap) {
      const card = await getCardForReview(db, userId, wrap.card_id);
      if (card) return { card, item: wrap };
    }
    return null;
  }

  const selection = await selectNextPlayCard(db, userId, session, now);
  if (!selection) return null;

  try {
    const item = await insertPlayItem(
      db,
      session.id,
      selection.card.id,
      selection.bucket,
      now
    );
    return { card: selection.card, item };
  } catch (err) {
    // 두 탭이 동시에 다음 문제를 요청한 경우: 한쪽만 item 을 만들고,
    // 진 쪽은 상대가 만든 pending item 을 재사용한다.
    if (isUniqueViolation(err)) {
      const after = await getPendingPlayItem(db, userId, session.id);
      if (after) {
        const card = await getCardForReview(db, userId, after.card_id);
        if (card) return { card, item: after };
      }
    }
    throw err;
  }
}

/** 오답 마무리 답변. reviews를 만들지 않고 item만 갱신한다. */
export async function answerWrapupItem(
  db: D1Database,
  userId: string,
  sessionId: string,
  itemId: string,
  correct: boolean,
  now: Date = new Date()
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE play_session_items
          SET answered_at = ?, correct = ?
        WHERE id = ? AND session_id = ? AND kind = 'wrapup'
          AND answered_at IS NULL
          AND EXISTS (
            SELECT 1 FROM play_sessions s
             WHERE s.id = play_session_items.session_id AND s.user_id = ?
          )`
    )
    .bind(now.toISOString(), correct ? 1 : 0, itemId, sessionId, userId)
    .run();

  return (res.meta.changes ?? 0) > 0;
}

export type WrapupStats = {
  total: number;
  correct: number;
};

export async function getPlaySessionWrapupStats(
  db: D1Database,
  userId: string,
  sessionId: string
): Promise<WrapupStats> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(i.correct), 0) AS correct
         FROM play_session_items i
         JOIN play_sessions s ON s.id = i.session_id
        WHERE i.session_id = ? AND s.user_id = ?
          AND i.kind = 'wrapup' AND i.answered_at IS NOT NULL`
    )
    .bind(sessionId, userId)
    .first<{ total: number; correct: number }>();

  return { total: row?.total ?? 0, correct: row?.correct ?? 0 };
}

/**
 * active 세션의 시간 경과 상태를 반영한다.
 * - 목표 달성 → completed
 * - expires_at 경과 → expired
 * - 6시간 무활동 → abandoned
 */
export async function refreshPlaySessionStatus(
  db: D1Database,
  userId: string,
  sessionId: string,
  now: Date = new Date()
): Promise<PlaySessionRow | null> {
  let session = await getPlaySession(db, userId, sessionId);
  if (!session || session.status !== 'active') return session;

  const expiresAt = session.expires_at
    ? Date.parse(session.expires_at)
    : NaN;
  if (Number.isFinite(expiresAt) && expiresAt < now.getTime()) {
    await setPlaySessionStatus(db, userId, sessionId, 'expired');
    return getPlaySession(db, userId, sessionId);
  }

  const lastAt = session.last_activity_at
    ? Date.parse(session.last_activity_at)
    : Date.parse(session.started_at);
  if (Number.isFinite(lastAt) && now.getTime() - lastAt > ABANDON_AFTER_MS) {
    await setPlaySessionStatus(db, userId, sessionId, 'abandoned');
    return getPlaySession(db, userId, sessionId);
  }

  return session;
}

async function setPlaySessionStatus(
  db: D1Database,
  userId: string,
  sessionId: string,
  status: 'abandoned' | 'expired'
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE play_sessions
          SET status = ?, last_activity_at = ?
        WHERE id = ? AND user_id = ? AND status = 'active'`
    )
    .bind(status, now, sessionId, userId)
    .run();
}

export async function abandonPlaySession(
  db: D1Database,
  userId: string,
  sessionId: string,
  now: Date = new Date()
): Promise<void> {
  const nowIso = now.toISOString();
  await db
    .prepare(
      `UPDATE play_sessions
          SET status = 'abandoned', last_activity_at = ?
        WHERE id = ? AND user_id = ? AND status = 'active'`
    )
    .bind(nowIso, sessionId, userId)
    .run();
}

/** 새 한 판을 시작할 때, 남아 있던 진행 중 세션은 정리한다. */
export async function abandonActivePlaySessions(
  db: D1Database,
  userId: string,
  now: Date = new Date()
): Promise<void> {
  const nowIso = now.toISOString();
  await db
    .prepare(
      `UPDATE play_sessions
          SET status = 'abandoned', last_activity_at = ?
        WHERE user_id = ? AND status = 'active'`
    )
    .bind(nowIso, userId)
    .run();
}

export async function completePlaySession(
  db: D1Database,
  userId: string,
  sessionId: string,
  now: Date = new Date()
): Promise<void> {
  const nowIso = now.toISOString();
  await db
    .prepare(
      `UPDATE play_sessions
          SET completed_at = ?,
              status = 'completed',
              last_activity_at = ?
        WHERE id = ? AND user_id = ? AND completed_at IS NULL`
    )
    .bind(nowIso, nowIso, sessionId, userId)
    .run();
}
