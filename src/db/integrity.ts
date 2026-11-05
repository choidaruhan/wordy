/**
 * 학습 데이터 무결성 점검.
 *
 * - `cards`가 진실원이고 `reviews`는 감사 로그다.
 * - 세션 문항과 리뷰, 승급 후보, 고아 데이터를 확인한다.
 * - `severity='info'`인 항목은 오류가 아니라 유지보수 후보다.
 */

export type IntegritySeverity = 'error' | 'info';

export type IntegrityCheck = {
  key: string;
  label: string;
  severity: IntegritySeverity;
  count: number;
  sampleIds: string[];
};

export type IntegrityReport = {
  ok: boolean;
  checkedAt: string;
  userId: string;
  checks: IntegrityCheck[];
};

type CheckSpec = {
  key: string;
  label: string;
  severity: IntegritySeverity;
  sql: string;
  binds: unknown[];
};

function specs(userId: string): CheckSpec[] {
  return [
    {
      key: 'card_review_mismatch',
      label: '카드 상태와 최신 리뷰 스냅샷 불일치',
      severity: 'error',
      sql: `
        SELECT c.id AS id
          FROM cards c
          JOIN (
            SELECT card_id, next_state, next_due_at,
                   ROW_NUMBER() OVER (
                     PARTITION BY card_id ORDER BY reviewed_at DESC
                   ) AS rn
              FROM reviews
             WHERE user_id = ? AND next_state IS NOT NULL
          ) r ON r.card_id = c.id AND r.rn = 1
         WHERE c.user_id = ?
           AND (c.state != r.next_state OR c.due_at != r.next_due_at)
      `,
      binds: [userId, userId],
    },
    {
      key: 'review_missing_card',
      label: '카드가 없는 리뷰',
      severity: 'error',
      sql: `
        SELECT r.id AS id
          FROM reviews r
          LEFT JOIN cards c ON c.id = r.card_id
         WHERE r.user_id = ? AND c.id IS NULL
      `,
      binds: [userId],
    },
    {
      key: 'session_item_missing_review',
      label: '답변 표시됐지만 리뷰가 없는 세션 문항',
      severity: 'error',
      sql: `
        SELECT i.id AS id
          FROM play_session_items i
          JOIN play_sessions s ON s.id = i.session_id
          LEFT JOIN reviews r ON r.id = i.review_id
         WHERE s.user_id = ?
           AND i.kind = 'prompt'
           AND i.answered_at IS NOT NULL
           AND (i.review_id IS NULL OR r.id IS NULL)
      `,
      binds: [userId],
    },
    {
      key: 'session_item_review_mismatch',
      label: '세션 문항과 리뷰의 카드/세션/정답 불일치',
      severity: 'error',
      sql: `
        SELECT i.id AS id
          FROM play_session_items i
          JOIN play_sessions s ON s.id = i.session_id
          JOIN reviews r ON r.id = i.review_id
         WHERE s.user_id = ?
           AND (
             r.card_id != i.card_id
             OR COALESCE(r.session_id, '') != i.session_id
             OR COALESCE(i.correct, -1) != COALESCE(r.is_correct, -1)
           )
      `,
      binds: [userId],
    },
    {
      key: 'orphan_word_examples',
      label: '단어가 없는 추가 예문',
      severity: 'error',
      sql: `
        SELECT e.id AS id
          FROM word_examples e
          LEFT JOIN words w ON w.id = e.word_id
         WHERE w.id IS NULL
      `,
      binds: [],
    },
    {
      key: 'orphan_quiz_questions',
      label: '세션 또는 단어가 없는 퀴즈 문항',
      severity: 'error',
      sql: `
        SELECT q.id AS id
          FROM quiz_questions q
          LEFT JOIN quiz_sessions s ON s.id = q.session_id
          LEFT JOIN words w ON w.id = q.word_id
         WHERE s.id IS NULL OR w.id IS NULL
      `,
      binds: [],
    },
    {
      key: 'orphan_reviews',
      label: '카드 또는 사용자가 없는 리뷰',
      severity: 'error',
      sql: `
        SELECT r.id AS id
          FROM reviews r
          LEFT JOIN cards c ON c.id = r.card_id
          LEFT JOIN users u ON u.id = r.user_id
         WHERE c.id IS NULL OR u.id IS NULL
      `,
      binds: [],
    },
    {
      key: 'orphan_session_items',
      label: '세션 또는 카드가 없는 출제 문항',
      severity: 'error',
      sql: `
        SELECT i.id AS id
          FROM play_session_items i
          LEFT JOIN play_sessions s ON s.id = i.session_id
          LEFT JOIN cards c ON c.id = i.card_id
         WHERE s.id IS NULL OR c.id IS NULL
      `,
      binds: [],
    },
    {
      key: 'unlock_candidates',
      label: '승급 조건을 만족하지만 카드가 없는 단어',
      severity: 'info',
      sql: `
        SELECT c.word_id AS id
          FROM cards c
          JOIN words w ON w.id = c.word_id
         WHERE c.user_id = ?
           AND c.card_type = 'recognition'
           AND c.state = 'review'
           AND c.scheduled_days >= 4
           AND (w.pos IS NULL OR w.pos NOT IN ('det','pron','prep','conj','modal'))
           AND NOT EXISTS (
             SELECT 1 FROM cards x
              WHERE x.word_id = c.word_id AND x.card_type = 'recall'
           )
        UNION
        SELECT c.word_id AS id
          FROM cards c
          JOIN words w ON w.id = c.word_id
         WHERE c.user_id = ?
           AND c.card_type = 'recognition'
           AND c.state = 'review'
           AND c.stability >= 7
           AND w.example IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM cards x
              WHERE x.word_id = c.word_id AND x.card_type = 'cloze'
           )
      `,
      binds: [userId, userId],
    },
  ];
}

async function runCheck(db: D1Database, spec: CheckSpec): Promise<IntegrityCheck> {
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM (${spec.sql})`)
    .bind(...spec.binds)
    .first<{ n: number }>();

  const sampleRows = await db
    .prepare(`SELECT id FROM (${spec.sql}) LIMIT 5`)
    .bind(...spec.binds)
    .all<{ id: string }>();

  return {
    key: spec.key,
    label: spec.label,
    severity: spec.severity,
    count: countRow?.n ?? 0,
    sampleIds: sampleRows.results.map((row) => row.id),
  };
}

export async function checkIntegrity(
  db: D1Database,
  userId: string,
  now: Date = new Date()
): Promise<IntegrityReport> {
  const checks = await Promise.all(
    specs(userId).map((spec) => runCheck(db, spec))
  );

  return {
    ok: checks
      .filter((check) => check.severity === 'error')
      .every((check) => check.count === 0),
    checkedAt: now.toISOString(),
    userId,
    checks,
  };
}
