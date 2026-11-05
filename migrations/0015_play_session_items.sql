-- M8.1: 서버가 실제로 출제한 문제를 기록한다.
-- 답안은 이 item 에 대해서만 허용하고, review_key = item.id 로 멱등성을 유지한다.
-- 트리거는 0016 에서 별도로 활성화한다. (구버전 앱과의 배포 순서 보호)

CREATE TABLE play_session_items (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  card_id      TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  bucket       TEXT NOT NULL,              -- review | new | weak | custom_new
  kind         TEXT NOT NULL DEFAULT 'prompt', -- prompt | wrapup
  served_at    TEXT NOT NULL,
  answered_at  TEXT,
  review_id    TEXT REFERENCES reviews(id) ON DELETE SET NULL,
  correct      INTEGER,
  UNIQUE(session_id, card_id, kind)
);

CREATE INDEX idx_play_session_items_session
  ON play_session_items(session_id, position);

CREATE UNIQUE INDEX ux_play_session_items_review
  ON play_session_items(review_id)
  WHERE review_id IS NOT NULL;
