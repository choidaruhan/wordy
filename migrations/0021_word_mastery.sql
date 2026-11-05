-- M11: 단어 숙련도 뷰
--
-- new      : 모든 카드 reps = 0
-- learning : 리뷰 시작, recognition이 review 상태가 아님
-- familiar : recognition review + scheduled_days >= 7
-- known    : recognition review + scheduled_days >= 21
--            + 생산형 카드 존재 + 생산형 최대 scheduled_days >= 7
-- mastered : recognition review + scheduled_days >= 60
--            + 존재하는 모든 생산형 카드 scheduled_days >= 21
--            + 존재하는 모든 생산형 카드가 최근 90일 내 rating >= 3 성공

CREATE VIEW word_mastery AS
WITH recognition AS (
  SELECT word_id, state, scheduled_days
    FROM cards
   WHERE card_type = 'recognition'
),
production AS (
  SELECT id, word_id, card_type, scheduled_days
    FROM cards
   WHERE card_type IN ('recall', 'cloze')
)
SELECT
  w.id AS word_id,
  w.deck_id,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM cards c
       WHERE c.word_id = w.id AND c.reps > 0
    ) THEN 'new'

    WHEN r.state IS NULL OR r.state != 'review' THEN 'learning'

    WHEN r.scheduled_days >= 60
      AND EXISTS (SELECT 1 FROM production p WHERE p.word_id = w.id)
      AND (
        SELECT MIN(p.scheduled_days)
          FROM production p
         WHERE p.word_id = w.id
      ) >= 21
      AND NOT EXISTS (
        SELECT 1
          FROM production p
         WHERE p.word_id = w.id
           AND NOT EXISTS (
             SELECT 1 FROM reviews rv
              WHERE rv.card_id = p.id
                AND rv.rating >= 3
                AND rv.reviewed_at >= strftime(
                  '%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days'
                )
           )
      ) THEN 'mastered'

    WHEN r.scheduled_days >= 21
      AND EXISTS (SELECT 1 FROM production p WHERE p.word_id = w.id)
      AND (
        SELECT MAX(p.scheduled_days)
          FROM production p
         WHERE p.word_id = w.id
      ) >= 7 THEN 'known'

    WHEN r.scheduled_days >= 7 THEN 'familiar'

    ELSE 'learning'
  END AS mastery
FROM words w
LEFT JOIN recognition r ON r.word_id = w.id;
