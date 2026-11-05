import { schedule, type CardRow, type Scheduled } from '../lib/srs';
import { blankOut, normalize } from '../lib/grade';
import { computeQuota, isCorrectRating } from '../lib/quota';
import type { Grade } from 'ts-fsrs';

export type QueueCard = CardRow & {
  word_id: string;
  card_type: string;
  term: string;
  meaning: string;
  pos: string | null;
  example: string | null;
  example_ko: string | null;
  note: string | null;
  category: string | null;
  level: string | null;
  pronunciation: string | null;
  audio_url: string | null;
  collocations: string | null;
  synonyms: string | null;
  antonyms: string | null;
  extra_examples_raw: string | null;
};

export type ReviewSource = 'review' | 'weak';

export type ReviewOptions = {
  answer?: string | null;
  responseMs?: number | null;
  source?: ReviewSource;
  gradingSource?: 'self' | 'server';
  reviewKey?: string | null;
  fsrsParams?: number[] | null;
};

const SELECT_CARD = `
  SELECT c.id, c.word_id, c.card_type, c.stability, c.difficulty, c.scheduled_days,
         c.learning_steps, c.reps, c.lapses, c.state, c.due_at, c.last_reviewed_at,
         w.term, w.meaning, w.pos, w.example, w.example_ko, w.note,
         w.category, w.level, w.pronunciation, w.audio_url,
         w.collocations, w.synonyms, w.antonyms,
         (
           SELECT GROUP_CONCAT(line, char(10))
             FROM (
               SELECT e.sentence || char(9) || COALESCE(e.translation, '') AS line
                 FROM word_examples e
                WHERE e.word_id = w.id
                ORDER BY e.created_at
             )
         ) AS extra_examples_raw
    FROM cards c
    JOIN words w ON w.id = c.word_id
`;

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('UNIQUE constraint failed');
}

/** 기한이 지난 복습 카드 1장 */
export async function nextDueReview(
  db: D1Database,
  userId: string,
  nowIso: string
): Promise<QueueCard | null> {
  return db
    .prepare(
      `${SELECT_CARD}
        WHERE c.user_id = ? AND c.suspended = 0
          AND c.state IN ('learning','review','relearning')
          AND c.due_at <= ?
        ORDER BY c.due_at ASC
        LIMIT 1`
    )
    .bind(userId, nowIso)
    .first<QueueCard>();
}

/** 기한이 지난 복습 카드 1장 (유형 지정) */
export async function nextDueReviewByType(
  db: D1Database,
  userId: string,
  nowIso: string,
  cardType: string
): Promise<QueueCard | null> {
  return db
    .prepare(
      `${SELECT_CARD}
        WHERE c.user_id = ? AND c.suspended = 0
          AND c.state IN ('learning','review','relearning')
          AND c.card_type = ?
          AND c.due_at <= ?
        ORDER BY c.due_at ASC
        LIMIT 1`
    )
    .bind(userId, cardType, nowIso)
    .first<QueueCard>();
}

/** 최근 24시간 안에 Again을 받은 due 카드. 세션 초반 워밍업용. */
export async function nextWarmupCard(
  db: D1Database,
  userId: string,
  nowIso: string,
  sinceIso: string
): Promise<QueueCard | null> {
  return db
    .prepare(
      `${SELECT_CARD}
        WHERE c.user_id = ? AND c.suspended = 0
          AND c.state IN ('learning','review','relearning')
          AND c.due_at <= ?
          AND EXISTS (
            SELECT 1 FROM reviews r
             WHERE r.card_id = c.id
               AND r.rating = 1
               AND r.reviewed_at >= ?
          )
        ORDER BY c.due_at ASC
        LIMIT 1`
    )
    .bind(userId, nowIso, sinceIso)
    .first<QueueCard>();
}

/** 아직 안 본 카드 1장 (신규 단어 소개용, 영→한만) */
export async function nextNewCard(db: D1Database, userId: string): Promise<QueueCard | null> {
  return db
    .prepare(
      `${SELECT_CARD}
        WHERE c.user_id = ? AND c.suspended = 0 AND c.state = 'new'
          AND c.card_type = 'recognition'
        ORDER BY c.created_at ASC
        LIMIT 1`
    )
    .bind(userId)
    .first<QueueCard>();
}

/** 승급된 카드 (한→영 / 빈칸 / 듣기). 신규 단어 쿼터를 쓰지 않는다 */
export async function nextPromotedCard(
  db: D1Database,
  userId: string,
  nowIso: string
): Promise<QueueCard | null> {
  return db
    .prepare(
      `${SELECT_CARD}
        WHERE c.user_id = ? AND c.suspended = 0 AND c.state = 'new'
          AND c.card_type IN ('recall','cloze','listening') AND c.due_at <= ?
        ORDER BY c.due_at ASC
        LIMIT 1`
    )
    .bind(userId, nowIso)
    .first<QueueCard>();
}

export async function getCardForReview(
  db: D1Database,
  userId: string,
  cardId: string
): Promise<QueueCard | null> {
  return db
    .prepare(`${SELECT_CARD} WHERE c.id = ? AND c.user_id = ?`)
    .bind(cardId, userId)
    .first<QueueCard>();
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 영→한 객관식 보기. 정답 뜻 + 사용자의 다른 단어 뜻 3개를 섞어서 돌려준다.
 * 보기가 2개 미만이면 객관식이 성립하지 않으므로 빈 배열을 돌려준다.
 */
export async function getMeaningChoices(
  db: D1Database,
  userId: string,
  wordId: string,
  meaning: string,
  count = 4
): Promise<string[]> {
  const answer = meaning.trim();
  if (!answer) return [];

  const { results } = await db
    .prepare(
      `SELECT meaning
         FROM (
           SELECT DISTINCT w.meaning AS meaning
             FROM words w
             JOIN decks d ON d.id = w.deck_id
            WHERE d.user_id = ?
              AND w.id <> ?
              AND w.meaning IS NOT NULL
              AND TRIM(w.meaning) <> ''
              AND w.meaning <> ?
         )
        ORDER BY RANDOM()
        LIMIT ?`
    )
    .bind(userId, wordId, answer, Math.max(0, count - 1))
    .all<{ meaning: string }>();

  const seen = new Set([normalize(answer)]);
  const options = [answer];

  for (const row of results) {
    const key = normalize(row.meaning);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(row.meaning);
    if (options.length >= count) break;
  }

  return options.length >= 2 ? shuffle(options) : [];
}

/**
 * 평점 저장. `reps` 조건으로 낙관적 락을 건다.
 * 카드 UPDATE와 리뷰 INSERT는 같은 batch(트랜잭션)에서 실행한다.
 * 이미 다른 요청이 처리했다면 null 을 돌려준다.
 */
export async function saveReview(
  db: D1Database,
  userId: string,
  row: CardRow & { card_type?: string },
  rating: Grade,
  now: Date,
  localDateStr: string,
  opts: ReviewOptions = {}
): Promise<Scheduled | null> {
  const s = schedule(row, now, rating, opts.fsrsParams);
  const questionType = row.card_type ?? null;
  const gradingSource =
    opts.gradingSource ?? (questionType === 'recognition' ? 'self' : 'server');
  const isCorrect = isCorrectRating(rating) ? 1 : 0;
  const source: ReviewSource = opts.source === 'weak' ? 'weak' : 'review';
  const answer = opts.answer ? opts.answer.slice(0, 200) : null;
  const responseMs =
    opts.responseMs == null
      ? null
      : Math.max(0, Math.min(300_000, Math.trunc(opts.responseMs)));
  const reviewKey = opts.reviewKey ?? null;

  // 같은 프롬프트의 재전송은 여기서 끝낸다. (unique index가 최종 방어선)
  if (reviewKey) {
    const existing = await db
      .prepare('SELECT 1 AS n FROM reviews WHERE user_id = ? AND review_key = ? LIMIT 1')
      .bind(userId, reviewKey)
      .first<{ n: number }>();
    if (existing) return null;
  }

  let batch: D1Result[];
  try {
    batch = await db.batch([
      db
        .prepare(
          `UPDATE cards
              SET due_at = ?, state = ?, stability = ?, difficulty = ?, scheduled_days = ?,
                  learning_steps = ?, reps = ?, lapses = ?, last_reviewed_at = ?
            WHERE id = ? AND user_id = ? AND reps = ?`
        )
        .bind(
          s.due_at,
          s.state,
          s.stability,
          s.difficulty,
          s.scheduled_days,
          s.learning_steps,
          s.reps,
          s.lapses,
          s.last_reviewed_at,
          row.id,
          userId,
          row.reps
        ),
      db
        .prepare(
          `INSERT INTO reviews (
             id, card_id, user_id, rating, local_date, reviewed_at,
             elapsed_days, scheduled_days, reps_before, prev_state,
             question_type, answer, is_correct, grading_source, response_ms,
             review_key, attempt_seq, source, next_state, next_due_at
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  ?, ?, ?, ?, ?, ?,
                  (SELECT COUNT(*) + 1 FROM reviews WHERE card_id = ? AND local_date = ?),
                  ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM cards
               WHERE id = ? AND user_id = ? AND last_reviewed_at = ?
            )`
        )
        .bind(
          crypto.randomUUID(),
          row.id,
          userId,
          rating,
          localDateStr,
          s.last_reviewed_at,
          s.elapsed_days,
          s.scheduled_days,
          row.reps,
          row.state,
          questionType,
          answer,
          isCorrect,
          gradingSource,
          responseMs,
          reviewKey,
          row.id,
          localDateStr,
          source,
          s.state,
          s.due_at,
          row.id,
          userId,
          s.last_reviewed_at
        ),
    ]);
  } catch (err) {
    // 같은 리뷰가 동시에 들어온 경우: batch 전체가 롤백됐으므로 중복으로 처리한다.
    if (isUniqueViolation(err)) return null;
    throw err;
  }

  const [cardResult, reviewResult] = batch;

  if ((cardResult.meta.changes ?? 0) === 0) return null;

  // UPDATE와 INSERT는 같은 batch다. 여기까지 왔는데 로그가 없으면 데이터 사고다.
  if ((reviewResult.meta.changes ?? 0) === 0) {
    throw new Error('리뷰 로그 저장에 실패했습니다.');
  }

  return s;
}

const LEECH_THRESHOLD = 8;
const RECALL_UNLOCK_DAYS = 4;
const CLOZE_UNLOCK_STABILITY = 7;
const LISTENING_UNLOCK_DAYS = 14;

/**
 * 기능어는 뜻→영어가 모호하다. 예: "~안에" → in / on / at
 * 개별 단어 recall 대신 문맥(cloze)으로 검증해야 하므로 승급 대상에서 제외한다.
 */
const FUNCTION_POS = new Set(['det', 'pron', 'prep', 'conj', 'modal']);

/**
 * 영→한 카드가 충분히 익으면 한→영 카드를 만든다.
 * 기능어는 답이 모호하므로 제외한다. 이미 있으면 아무 일도 하지 않는다.
 */
export async function maybeUnlockRecall(
  db: D1Database,
  userId: string,
  card: QueueCard,
  next: Scheduled,
  now: Date
): Promise<boolean> {
  if (card.card_type !== 'recognition') return false;
  if (card.pos && FUNCTION_POS.has(card.pos)) return false;
  if (next.state !== 'review' || next.scheduled_days < RECALL_UNLOCK_DAYS) return false;

  const nowIso = now.toISOString();
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
       VALUES (?, ?, ?, 'recall', ?, 'new', ?)`
    )
    .bind(crypto.randomUUID(), card.word_id, userId, nowIso, nowIso)
    .run();

  return (res.meta.changes ?? 0) > 0;
}

/**
 * 예문에서 단어를 가릴 수 있고 기억이 충분히 안정되면 빈칸 카드를 만든다.
 * 예문에 기본형이 없으면(굴절 등) 만들지 않는다.
 */
export async function maybeUnlockCloze(
  db: D1Database,
  userId: string,
  card: QueueCard,
  next: Scheduled,
  now: Date
): Promise<boolean> {
  if (card.card_type !== 'recognition') return false;
  if (!card.example) return false;
  if (blankOut(card.example, card.term) === null) return false;
  if (next.state !== 'review' || next.stability < CLOZE_UNLOCK_STABILITY) return false;

  const nowIso = now.toISOString();
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
       VALUES (?, ?, ?, 'cloze', ?, 'new', ?)`
    )
    .bind(crypto.randomUUID(), card.word_id, userId, nowIso, nowIso)
    .run();

  return (res.meta.changes ?? 0) > 0;
}

/**
 * 사용자가 듣기를 켠 경우, 충분히 안정된 영→한 카드에 듣기 카드를 만든다.
 * 듣기 카드는 단어를 보여주지 않고 TTS 음성만 들려준다.
 */
export async function maybeUnlockListening(
  db: D1Database,
  userId: string,
  card: QueueCard,
  next: Scheduled,
  now: Date,
  enabled: boolean
): Promise<boolean> {
  if (!enabled) return false;
  if (card.card_type !== 'recognition') return false;
  if (next.state !== 'review' || next.scheduled_days < LISTENING_UNLOCK_DAYS) return false;

  const nowIso = now.toISOString();
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
       VALUES (?, ?, ?, 'listening', ?, 'new', ?)`
    )
    .bind(crypto.randomUUID(), card.word_id, userId, nowIso, nowIso)
    .run();

  return (res.meta.changes ?? 0) > 0;
}

/**
 * 승급 누락 복구. `/review` 로드 시 호출한다.
 * 조건을 만족하지만 카드가 없는 단어를 찾아 멱등적으로 생성한다.
 */
export async function ensureUnlocks(
  db: D1Database,
  userId: string,
  now: Date = new Date(),
  listeningEnabled = false
): Promise<number> {
  const [recall, cloze, listening] = await Promise.all([
    db
      .prepare(
        `SELECT c.word_id
           FROM cards c
           JOIN words w ON w.id = c.word_id
          WHERE c.user_id = ?
            AND c.card_type = 'recognition'
            AND c.state = 'review'
            AND c.scheduled_days >= ?
            AND (w.pos IS NULL OR w.pos NOT IN ('det','pron','prep','conj','modal'))
            AND NOT EXISTS (
              SELECT 1 FROM cards x
               WHERE x.word_id = c.word_id AND x.card_type = 'recall'
            )
          LIMIT 50`
      )
      .bind(userId, RECALL_UNLOCK_DAYS)
      .all<{ word_id: string }>(),
    db
      .prepare(
        `SELECT c.word_id, w.term, w.example
           FROM cards c
           JOIN words w ON w.id = c.word_id
          WHERE c.user_id = ?
            AND c.card_type = 'recognition'
            AND c.state = 'review'
            AND c.stability >= ?
            AND w.example IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM cards x
               WHERE x.word_id = c.word_id AND x.card_type = 'cloze'
            )
          LIMIT 50`
      )
      .bind(userId, CLOZE_UNLOCK_STABILITY)
      .all<{ word_id: string; term: string; example: string }>(),
    listeningEnabled
      ? db
          .prepare(
            `SELECT c.word_id
               FROM cards c
              WHERE c.user_id = ?
                AND c.card_type = 'recognition'
                AND c.state = 'review'
                AND c.scheduled_days >= ?
                AND NOT EXISTS (
                  SELECT 1 FROM cards x
                   WHERE x.word_id = c.word_id AND x.card_type = 'listening'
                )
              LIMIT 50`
          )
          .bind(userId, LISTENING_UNLOCK_DAYS)
          .all<{ word_id: string }>()
      : Promise.resolve({ results: [] as { word_id: string }[] }),
  ]);

  const nowIso = now.toISOString();
  const stmts: D1PreparedStatement[] = [];

  for (const row of recall.results) {
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
           VALUES (?, ?, ?, 'recall', ?, 'new', ?)`
        )
        .bind(crypto.randomUUID(), row.word_id, userId, nowIso, nowIso)
    );
  }

  for (const row of cloze.results) {
    if (blankOut(row.example, row.term) === null) continue;
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
           VALUES (?, ?, ?, 'cloze', ?, 'new', ?)`
        )
        .bind(crypto.randomUUID(), row.word_id, userId, nowIso, nowIso)
    );
  }

  for (const row of listening.results) {
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
           VALUES (?, ?, ?, 'listening', ?, 'new', ?)`
        )
        .bind(crypto.randomUUID(), row.word_id, userId, nowIso, nowIso)
    );
  }

  if (stmts.length === 0) return 0;

  for (const chunk of chunked(stmts, 50)) {
    await db.batch(chunk);
  }

  return stmts.length;
}

/** 계속 틀리는 카드는 큐에서 빼고 '어려운 단어'로 보낸다 */
export async function maybeSuspendLeech(
  db: D1Database,
  userId: string,
  card: QueueCard,
  next: Scheduled
): Promise<boolean> {
  if (next.lapses < LEECH_THRESHOLD) return false;

  const res = await db
    .prepare('UPDATE cards SET suspended = 1 WHERE id = ? AND user_id = ? AND suspended = 0')
    .bind(card.id, userId)
    .run();

  return (res.meta.changes ?? 0) > 0;
}

export type Progress = {
  done: number;
  remaining: number;
  reviewLeft: number;
  promotedLeft: number;
  newLeft: number;
  reviewDone: number;
  newDone: number;
  dueReview: number;
  promotedDue: number;
  newAvailable: number;
};

/** 오늘 진행률 = 오늘 한 카드 + 남은 카드. daily_review 상한을 반영한다. */
export async function getProgress(
  db: D1Database,
  userId: string,
  today: string,
  nowIso: string,
  dailyNew: number,
  dailyReview: number
): Promise<Progress> {
  const [done, newDone, due, promoted, newCards] = await Promise.all([
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
      .prepare(
        `SELECT COUNT(*) AS n FROM cards
          WHERE user_id = ? AND suspended = 0
            AND state IN ('learning','review','relearning')
            AND due_at <= ?`
      )
      .bind(userId, nowIso)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM cards
          WHERE user_id = ? AND suspended = 0 AND state = 'new'
            AND card_type IN ('recall','cloze','listening')
            AND due_at <= ?`
      )
      .bind(userId, nowIso)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM cards
          WHERE user_id = ? AND suspended = 0 AND state = 'new'
            AND card_type = 'recognition'`
      )
      .bind(userId)
      .first<{ n: number }>(),
  ]);

  const doneCount = done?.n ?? 0;
  const q = computeQuota({
    dailyNew,
    dailyReview,
    done: doneCount,
    newDone: newDone?.n ?? 0,
    dueReview: due?.n ?? 0,
    promotedDue: promoted?.n ?? 0,
    newAvailable: newCards?.n ?? 0,
  });

  return {
    done: doneCount,
    remaining: q.remaining,
    reviewLeft: q.reviewLeft,
    promotedLeft: q.promotedLeft,
    newLeft: q.newLeft,
    reviewDone: q.reviewDone,
    newDone: newDone?.n ?? 0,
    dueReview: due?.n ?? 0,
    promotedDue: promoted?.n ?? 0,
    newAvailable: newCards?.n ?? 0,
  };
}

export type HardWord = {
  card_id: string;
  word_id: string;
  term: string;
  meaning: string;
  example: string | null;
  note: string | null;
  lapses: number;
};

export async function listHardWords(db: D1Database, userId: string): Promise<HardWord[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id AS card_id, w.id AS word_id, w.term, w.meaning, w.example, w.note, c.lapses
         FROM cards c
         JOIN words w ON w.id = c.word_id
        WHERE c.user_id = ? AND c.suspended = 1
        ORDER BY c.lapses DESC, w.term ASC`
    )
    .bind(userId)
    .all<HardWord>();
  return results;
}

export async function saveMnemonic(
  db: D1Database,
  userId: string,
  cardId: string,
  note: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE words SET note = ?
        WHERE id = (SELECT word_id FROM cards WHERE id = ? AND user_id = ?)`
    )
    .bind(note.trim() || null, cardId, userId)
    .run();
}

export async function resumeCard(db: D1Database, userId: string, cardId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE cards SET suspended = 0, lapses = 0, due_at = ?
        WHERE id = ? AND user_id = ?`
    )
    .bind(new Date().toISOString(), cardId, userId)
    .run();
}
