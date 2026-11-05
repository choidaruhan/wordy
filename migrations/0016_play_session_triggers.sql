-- M8.2: 출제 문항 트리거와 세션 통계 뷰
--
-- 배포 순서:
--   1) 0013~0015 적용
--   2) 새 앱 배포 (item 생성/답안 검증)
--   3) 0016 적용 (기존 리뷰 item 백필 + 트리거)
--
-- 트리거가 먼저 켜지면 item 을 만들지 않는 구버전 앱의 답안이 실패하므로
-- 반드시 앱 배포 후 적용한다.

-- 1) 기존 세션 리뷰를 item 으로 백필한다.
INSERT OR IGNORE INTO play_session_items (
  id, session_id, card_id, position, bucket, kind,
  served_at, answered_at, review_id, correct
)
SELECT lower(hex(randomblob(16))),
       r.session_id,
       r.card_id,
       ROW_NUMBER() OVER (PARTITION BY r.session_id ORDER BY r.reviewed_at),
       CASE
         WHEN r.reps_before = 0 AND r.question_type = 'recognition' THEN 'new'
         WHEN r.source = 'weak' THEN 'weak'
         ELSE 'review'
       END,
       'prompt',
       r.reviewed_at,
       r.reviewed_at,
       r.id,
       r.is_correct
  FROM reviews r
 WHERE r.session_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM play_session_items i WHERE i.review_id = r.id
   );

-- 한 세션에는 미답변 prompt item 이 하나만 존재한다.
CREATE UNIQUE INDEX ux_play_session_items_pending
  ON play_session_items(session_id)
  WHERE answered_at IS NULL AND kind = 'prompt';

-- 2) active 세션 + 미답변 item 이 아니면 리뷰 INSERT를 막는다.
CREATE TRIGGER trg_reviews_require_play_item
BEFORE INSERT ON reviews
WHEN NEW.session_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM play_sessions
       WHERE id = NEW.session_id AND status = 'active'
    )
    THEN RAISE(ABORT, 'PLAY_SESSION_NOT_ACTIVE')
    WHEN NOT EXISTS (
      SELECT 1 FROM play_session_items
       WHERE session_id = NEW.session_id
         AND card_id = NEW.card_id
         AND kind = 'prompt'
         AND answered_at IS NULL
    )
    THEN RAISE(ABORT, 'PLAY_SESSION_ITEM_NOT_FOUND')
  END;
END;

-- 3) 리뷰가 저장되면 해당 item 을 답변 완료로 표시한다.
CREATE TRIGGER trg_reviews_mark_play_item
AFTER INSERT ON reviews
WHEN NEW.session_id IS NOT NULL
BEGIN
  UPDATE play_session_items
     SET answered_at = NEW.reviewed_at,
         review_id = NEW.id,
         correct = NEW.is_correct
   WHERE session_id = NEW.session_id
     AND card_id = NEW.card_id
     AND kind = 'prompt'
     AND answered_at IS NULL;
END;

-- 4) 세션 활동 시각만 갱신한다. 카운터는 리뷰에서 파생한다.
CREATE TRIGGER trg_reviews_touch_play_session
AFTER INSERT ON reviews
WHEN NEW.session_id IS NOT NULL
BEGIN
  UPDATE play_sessions
     SET last_activity_at = NEW.reviewed_at
   WHERE id = NEW.session_id;
END;

-- 5) 세션 카운터는 저장하지 않고 리뷰에서 계산한다.
CREATE VIEW play_session_stats AS
SELECT s.id AS session_id,
       COUNT(r.id) AS answered,
       COALESCE(SUM(r.is_correct), 0) AS correct,
       MAX(r.reviewed_at) AS last_answered_at
  FROM play_sessions s
  LEFT JOIN reviews r ON r.session_id = s.id
 GROUP BY s.id;
