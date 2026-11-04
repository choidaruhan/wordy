CREATE TABLE quiz_sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total        INTEGER NOT NULL,
  correct      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_quiz_sessions_user ON quiz_sessions(user_id, completed_at);

CREATE TABLE quiz_questions (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  word_id      TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  options      TEXT NOT NULL,
  answer_index INTEGER NOT NULL,
  chosen_index INTEGER,
  is_correct   INTEGER,
  answered_at  TEXT
);
CREATE INDEX idx_quiz_questions_session ON quiz_questions(session_id, position);
