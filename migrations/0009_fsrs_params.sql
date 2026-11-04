-- M6.6: 사용자별 FSRS 파라미터

ALTER TABLE users ADD COLUMN fsrs_params TEXT;           -- JSON number[21]
ALTER TABLE users ADD COLUMN fsrs_params_updated_at TEXT;
