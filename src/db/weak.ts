import { computeWeakness } from '../lib/weak';
import type { QueueCard } from './review';

export type WeakWord = {
  wordId: string;
  term: string;
  meaning: string;
  example: string | null;
  note: string | null;
  pos: string | null;
  direction: string;
  score: number;
  status: 'weak' | 'attention';
  recentN: number;
  recentErrors: number;
  recentAccuracy: number;
  lapses: number;
  lastReviewedAt: string;
  quizWrongs: number;
};

export type WeaknessReport = {
  weak: WeakWord[];
  attention: WeakWord[];
  all: WeakWord[];
};

type WeakCardRow = {
  card_id: string;
  word_id: string;
  card_type: string;
  stability: number;
  lapses: number;
  last_reviewed_at: string;
  total_n: number;
  total_errors: number;
  recent_n: number;
  recent_errors: number;
  term: string;
  meaning: string;
  example: string | null;
  note: string | null;
  pos: string | null;
  quiz_wrongs: number;
};

const STALE_DAYS = 90;
const QUIZ_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
const MAX_WEAK_WORDS = 200;

/**
 * 취약/주의 단어를 계산한다.
 *
 * 최근 20회 리뷰는 윈도 함수로, 누적 오답은 같은 스캔에서 집계한다.
 * 퀴즈 오답은 최근 30일 신호로만 더한다. FSRS 스케줄은 건드리지 않는다.
 */
export async function listWeakness(
  db: D1Database,
  userId: string,
  now: Date = new Date()
): Promise<WeaknessReport> {
  const staleBefore = new Date(now.getTime() - STALE_DAYS * DAY_MS).toISOString();
  const quizSince = new Date(now.getTime() - QUIZ_WINDOW_DAYS * DAY_MS).toISOString();

  const { results } = await db
    .prepare(
      `WITH eligible AS (
         SELECT c.id, c.word_id, c.card_type, c.stability, c.lapses, c.last_reviewed_at
           FROM cards c
          WHERE c.user_id = ?
            AND c.suspended = 0
            AND c.state IN ('review','relearning')
            AND c.reps >= 5
            AND c.last_reviewed_at >= ?
       ),
       ranked AS (
         SELECT r.card_id, r.rating,
                ROW_NUMBER() OVER (
                  PARTITION BY r.card_id
                  ORDER BY r.reviewed_at DESC
                ) AS rn
           FROM reviews r
           JOIN eligible e ON e.id = r.card_id
          WHERE r.user_id = ?
       ),
       agg AS (
         SELECT card_id,
                COUNT(*) AS total_n,
                SUM(CASE WHEN rating < 2 THEN 1 ELSE 0 END) AS total_errors,
                SUM(CASE WHEN rn <= 20 THEN 1 ELSE 0 END) AS recent_n,
                SUM(CASE WHEN rn <= 20 AND rating < 2 THEN 1 ELSE 0 END) AS recent_errors
           FROM ranked
          GROUP BY card_id
       ),
       quiz AS (
         SELECT q.word_id, COUNT(*) AS quiz_wrongs
           FROM quiz_questions q
           JOIN quiz_sessions s ON s.id = q.session_id
          WHERE s.user_id = ?
            AND q.is_correct = 0
            AND q.answered_at >= ?
          GROUP BY q.word_id
       )
       SELECT e.id AS card_id, e.word_id, e.card_type, e.stability, e.lapses,
              e.last_reviewed_at, a.total_n, a.total_errors, a.recent_n, a.recent_errors,
              w.term, w.meaning, w.example, w.note, w.pos,
              COALESCE(qz.quiz_wrongs, 0) AS quiz_wrongs
         FROM eligible e
         JOIN agg a ON a.card_id = e.id
         JOIN words w ON w.id = e.word_id
         LEFT JOIN quiz qz ON qz.word_id = e.word_id`
    )
    .bind(userId, staleBefore, userId, userId, quizSince)
    .all<WeakCardRow>();

  const byWord = new Map<string, WeakWord>();

  for (const row of results) {
    const result = computeWeakness(
      {
        recentN: row.recent_n,
        recentErrors: row.recent_errors,
        totalN: row.total_n,
        totalErrors: row.total_errors,
        lapses: row.lapses,
        stability: row.stability,
        lastReviewedAt: row.last_reviewed_at,
        quizWrongs: row.quiz_wrongs,
      },
      now
    );

    if (result.status !== 'weak' && result.status !== 'attention') continue;

    const candidate: WeakWord = {
      wordId: row.word_id,
      term: row.term,
      meaning: row.meaning,
      example: row.example,
      note: row.note,
      pos: row.pos,
      direction: row.card_type,
      score: result.score,
      status: result.status,
      recentN: row.recent_n,
      recentErrors: row.recent_errors,
      recentAccuracy: row.recent_n > 0 ? 1 - row.recent_errors / row.recent_n : 0,
      lapses: row.lapses,
      lastReviewedAt: row.last_reviewed_at,
      quizWrongs: row.quiz_wrongs,
    };

    const existing = byWord.get(row.word_id);
    if (!existing || candidate.score > existing.score) {
      byWord.set(row.word_id, candidate);
    }
  }

  const all = [...byWord.values()].sort(
    (a, b) => b.score - a.score || a.term.localeCompare(b.term)
  );

  return {
    weak: all.filter((w) => w.status === 'weak'),
    attention: all.filter((w) => w.status === 'attention'),
    all,
  };
}

export type ObservingWord = {
  wordId: string;
  term: string;
  meaning: string;
  reps: number;
  lastReviewedAt: string | null;
};

/** 아직 리뷰가 5회 미만이라 취약 판정을 보류한 단어 */
export async function listObservingWords(
  db: D1Database,
  userId: string,
  limit = 100
): Promise<ObservingWord[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id AS wordId, w.term, w.meaning,
              MAX(c.reps) AS reps,
              MAX(c.last_reviewed_at) AS lastReviewedAt
         FROM words w
         JOIN decks d ON d.id = w.deck_id
         JOIN cards c ON c.word_id = w.id
        WHERE d.user_id = ? AND c.suspended = 0
          AND c.reps > 0
        GROUP BY w.id
       HAVING MAX(c.reps) < 5
        ORDER BY lastReviewedAt DESC
        LIMIT ?`
    )
    .bind(userId, limit)
    .all<ObservingWord>();
  return results;
}

export type StaleWord = {
  wordId: string;
  term: string;
  meaning: string;
  lastReviewedAt: string;
  scheduledDays: number;
};

/** 90일 이상 복습하지 않은 단어. 취약 랭킹에서는 제외한다. */
export async function listStaleWords(
  db: D1Database,
  userId: string,
  now: Date = new Date(),
  limit = 50
): Promise<StaleWord[]> {
  const before = new Date(now.getTime() - STALE_DAYS * DAY_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT w.id AS wordId, w.term, w.meaning,
              MAX(c.last_reviewed_at) AS lastReviewedAt,
              MAX(c.scheduled_days) AS scheduledDays
         FROM words w
         JOIN decks d ON d.id = w.deck_id
         JOIN cards c ON c.word_id = w.id
        WHERE d.user_id = ? AND c.suspended = 0
          AND c.state IN ('review','relearning')
          AND c.last_reviewed_at < ?
        GROUP BY w.id
        ORDER BY lastReviewedAt ASC
        LIMIT ?`
    )
    .bind(userId, before, limit)
    .all<StaleWord>();
  return results;
}

/** weak + attention 단어의 ID. due 카드 조회에 쓴다. */
export function weakWordIds(report: WeaknessReport): string[] {
  return report.all.slice(0, MAX_WEAK_WORDS).map((w) => w.wordId);
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(',');
}

/** 취약 단어 중 기한이 도래한 카드 수 */
export async function countWeakDue(
  db: D1Database,
  userId: string,
  nowIso: string,
  wordIds: string[]
): Promise<number> {
  if (wordIds.length === 0) return 0;

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM cards
        WHERE user_id = ? AND suspended = 0
          AND state IN ('learning','review','relearning')
          AND due_at <= ?
          AND word_id IN (${placeholders(wordIds.length)})`
    )
    .bind(userId, nowIso, ...wordIds)
    .first<{ n: number }>();

  return row?.n ?? 0;
}

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

/** 취약 단어 중 기한이 도래한 카드 1장 */
export async function nextWeakDueReview(
  db: D1Database,
  userId: string,
  nowIso: string,
  wordIds: string[]
): Promise<QueueCard | null> {
  if (wordIds.length === 0) return null;

  return db
    .prepare(
      `${SELECT_CARD}
        WHERE c.user_id = ? AND c.suspended = 0
          AND c.state IN ('learning','review','relearning')
          AND c.due_at <= ?
          AND c.word_id IN (${placeholders(wordIds.length)})
        ORDER BY c.due_at ASC
        LIMIT 1`
    )
    .bind(userId, nowIso, ...wordIds)
    .first<QueueCard>();
}

/** 오늘 취약 연습으로 처리한 리뷰 수 */
export async function countWeakDoneToday(
  db: D1Database,
  userId: string,
  today: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM reviews
        WHERE user_id = ? AND local_date = ? AND source = 'weak'`
    )
    .bind(userId, today)
    .first<{ n: number }>();

  return row?.n ?? 0;
}
