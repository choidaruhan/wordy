-- 단순 단어장: 단어 + 뜻 두 컬럼만 쓴다.
CREATE TABLE IF NOT EXISTS vocab (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  term TEXT NOT NULL,
  meaning TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_vocab_user_term
  ON vocab(user_id, lower(term));

CREATE INDEX IF NOT EXISTS idx_vocab_user_created
  ON vocab(user_id, created_at DESC);
