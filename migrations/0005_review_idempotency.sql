-- M6.1: 리뷰 멱등키
-- 같은 프롬프트에서 발생한 재전송을 한 번만 기록한다.
-- 기존 리뷰는 NULL로 남기고, 새 리뷰부터 값을 채운다.

ALTER TABLE reviews ADD COLUMN review_key TEXT;

CREATE UNIQUE INDEX ux_reviews_user_review_key
  ON reviews(user_id, review_key);
