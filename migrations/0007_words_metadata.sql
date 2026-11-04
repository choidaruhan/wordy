-- M6.4: 단어 메타데이터 + 다중 예문

ALTER TABLE words ADD COLUMN category TEXT;
ALTER TABLE words ADD COLUMN level TEXT;           -- A1~C2
ALTER TABLE words ADD COLUMN pronunciation TEXT;   -- IPA
ALTER TABLE words ADD COLUMN audio_url TEXT;       -- 추후 실제 음성
ALTER TABLE words ADD COLUMN collocations TEXT;    -- JSON array
ALTER TABLE words ADD COLUMN synonyms TEXT;        -- JSON array
ALTER TABLE words ADD COLUMN antonyms TEXT;        -- JSON array

CREATE TABLE word_examples (
  id          TEXT PRIMARY KEY,
  word_id     TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  sentence    TEXT NOT NULL,
  translation TEXT,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_word_examples_word ON word_examples(word_id);

CREATE INDEX idx_quiz_questions_word ON quiz_questions(word_id);
