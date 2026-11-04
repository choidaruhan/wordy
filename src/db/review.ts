import { schedule, type CardRow, type Scheduled } from '../lib/srs';
import { blankOut } from '../lib/grade';
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
};

const SELECT_CARD = `
  SELECT c.id, c.word_id, c.card_type, c.stability, c.difficulty, c.scheduled_days,
         c.learning_steps, c.reps, c.lapses, c.state, c.due_at, c.last_reviewed_at,
         w.term, w.meaning, w.pos, w.example, w.example_ko, w.note
    FROM cards c
    JOIN words w ON w.id = c.word_id
`;

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

/** 승급된 카드 (한→영 / 빈칸). 신규 단어 쿼터를 쓰지 않고 먼저 나온다 */
export async function nextPromotedCard(
  db: D1Database,
  userId: string,
  nowIso: string
): Promise<QueueCard | null> {
  return db
    .prepare(
      `${SELECT_CARD}
        WHERE c.user_id = ? AND c.suspended = 0 AND c.state = 'new'
          AND c.card_type IN ('recall','cloze') AND c.due_at <= ?
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

/**
 * 평점 저장. `reps` 조건으로 낙관적 락을 건다.
 * 이미 다른 요청이 처리했다면 null 을 돌려준다.
 */
export async function saveReview(
  db: D1Database,
  userId: string,
  row: CardRow,
  rating: Grade,
  now: Date,
  localDateStr: string
): Promise<Scheduled | null> {
  const s = schedule(row, now, rating);

  const res = await db
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
    )
    .run();

  if ((res.meta.changes ?? 0) === 0) return null;

  await db
    .prepare(
      `INSERT INTO reviews
         (id, card_id, user_id, rating, local_date, reviewed_at,
          elapsed_days, scheduled_days, reps_before, prev_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      row.state
    )
    .run();

  return s;
}

const LEECH_THRESHOLD = 8;
const RECALL_UNLOCK_DAYS = 4;
const CLOZE_UNLOCK_STABILITY = 7;

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
      `INSERT INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
       SELECT ?, ?, ?, 'recall', ?, 'new', ?
        WHERE NOT EXISTS (
          SELECT 1 FROM cards WHERE word_id = ? AND card_type = 'recall'
        )`
    )
    .bind(crypto.randomUUID(), card.word_id, userId, nowIso, nowIso, card.word_id)
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
      `INSERT INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
       SELECT ?, ?, ?, 'cloze', ?, 'new', ?
        WHERE NOT EXISTS (
          SELECT 1 FROM cards WHERE word_id = ? AND card_type = 'cloze'
        )`
    )
    .bind(crypto.randomUUID(), card.word_id, userId, nowIso, nowIso, card.word_id)
    .run();

  return (res.meta.changes ?? 0) > 0;
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
  newLeft: number;
};

/** 오늘 진행률 = 오늘 한 카드 + 남은 카드 */
export async function getProgress(
  db: D1Database,
  userId: string,
  today: string,
  nowIso: string,
  dailyNew: number
): Promise<Progress> {
  const [done, newDone, due, newCards] = await Promise.all([
    db
      .prepare('SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND local_date = ?')
      .bind(userId, today)
      .first<{ n: number }>(),
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND local_date = ? AND reps_before = 0'
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
            AND card_type = 'recognition'`
      )
      .bind(userId)
      .first<{ n: number }>(),
  ]);

  const newLeft = Math.min(Math.max(0, dailyNew - (newDone?.n ?? 0)), newCards?.n ?? 0);

  return {
    done: done?.n ?? 0,
    remaining: (due?.n ?? 0) + newLeft,
    newLeft,
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
