-- P1: 평점 신뢰도 계측
-- 평점 규칙은 유지하고, 나중에 보정할 수 있는 신호만 저장한다.

ALTER TABLE reviews ADD COLUMN prompt_started_at TEXT;
ALTER TABLE reviews ADD COLUMN first_input_at TEXT;
ALTER TABLE reviews ADD COLUMN confidence INTEGER;          -- 0 모름 / 1 애매 / 2 확신 / NULL 미수집
ALTER TABLE reviews ADD COLUMN rating_model_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reviews ADD COLUMN grading_reliability REAL;    -- 0~1, 분석용
