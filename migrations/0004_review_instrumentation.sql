-- M6.1: 리뷰 계측
-- 기존 리뷰는 보존하고, 새 컬럼만 추가한 뒤 백필한다.

ALTER TABLE reviews ADD COLUMN question_type TEXT;
ALTER TABLE reviews ADD COLUMN answer TEXT;
ALTER TABLE reviews ADD COLUMN is_correct INTEGER;
ALTER TABLE reviews ADD COLUMN grading_source TEXT;
ALTER TABLE reviews ADD COLUMN response_ms INTEGER;
ALTER TABLE reviews ADD COLUMN attempt_seq INTEGER;
ALTER TABLE reviews ADD COLUMN source TEXT NOT NULL DEFAULT 'review';
ALTER TABLE reviews ADD COLUMN next_state TEXT;
ALTER TABLE reviews ADD COLUMN next_due_at TEXT;

-- 카드 타입은 리뷰 시점에 고정된다. 조인을 줄이기 위해 복사한다.
UPDATE reviews
   SET question_type = (SELECT card_type FROM cards WHERE cards.id = reviews.card_id)
 WHERE question_type IS NULL;

-- FSRS 기준: Again(1)만 실패. Hard(2)/Good(3)/Easy(4)는 회상 성공.
UPDATE reviews
   SET is_correct = CASE WHEN rating >= 2 THEN 1 ELSE 0 END
 WHERE is_correct IS NULL;

UPDATE reviews
   SET grading_source = CASE WHEN question_type = 'recognition' THEN 'self' ELSE 'server' END
 WHERE grading_source IS NULL;

-- 같은 카드·같은 로컬 날짜의 시도 순번. 같은 세션 내 재시도 순서를 보존한다.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY card_id, local_date
           ORDER BY reviewed_at
         ) AS seq
    FROM reviews
)
UPDATE reviews
   SET attempt_seq = (SELECT seq FROM ranked WHERE ranked.id = reviews.id)
 WHERE attempt_seq IS NULL;

CREATE INDEX idx_reviews_user_card
  ON reviews(user_id, card_id, reviewed_at);

CREATE INDEX idx_reviews_user_type_date
  ON reviews(user_id, question_type, local_date);

CREATE UNIQUE INDEX ux_reviews_card_date_attempt
  ON reviews(card_id, local_date, attempt_seq);
