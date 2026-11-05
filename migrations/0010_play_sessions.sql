-- M7: 하루 목표 없는 플레이 세션

CREATE TABLE play_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL DEFAULT 'quick',
  target_size   INTEGER NOT NULL DEFAULT 5,
  answered      INTEGER NOT NULL DEFAULT 0,
  correct       INTEGER NOT NULL DEFAULT 0,
  combo         INTEGER NOT NULL DEFAULT 0,
  best_combo    INTEGER NOT NULL DEFAULT 0,
  score         INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT NOT NULL,
  completed_at  TEXT
);

CREATE INDEX idx_play_sessions_user ON play_sessions(user_id, started_at);
CREATE INDEX idx_play_sessions_active ON play_sessions(user_id, completed_at);

ALTER TABLE reviews ADD COLUMN session_id TEXT;
CREATE INDEX idx_reviews_session ON reviews(session_id);

ALTER TABLE users ADD COLUMN session_size INTEGER NOT NULL DEFAULT 5;
ALTER TABLE users ADD COLUMN new_per_session INTEGER NOT NULL DEFAULT 2;
