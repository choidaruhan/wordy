-- M6.3: 하루 학습 계획 스냅샷

CREATE TABLE daily_plans (
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date       TEXT NOT NULL,
  base_new         INTEGER NOT NULL,
  effective_new    INTEGER NOT NULL,
  review_target    INTEGER NOT NULL,
  promoted_target  INTEGER NOT NULL,
  due_count        INTEGER NOT NULL,
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  reason           TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  completed_at     TEXT,
  PRIMARY KEY (user_id, local_date)
);

CREATE INDEX idx_daily_plans_completed
  ON daily_plans(user_id, completed_at);

ALTER TABLE users ADD COLUMN new_card_mode TEXT NOT NULL DEFAULT 'auto';
-- auto | fixed
