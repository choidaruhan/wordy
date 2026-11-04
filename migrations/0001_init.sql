PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  tz_offset_min INTEGER NOT NULL DEFAULT 540,
  daily_new     INTEGER NOT NULL DEFAULT 10,
  daily_review  INTEGER NOT NULL DEFAULT 200,
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_exp ON sessions(expires_at);

CREATE TABLE decks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_decks_user ON decks(user_id);

CREATE TABLE words (
  id         TEXT PRIMARY KEY,
  deck_id    TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  term       TEXT NOT NULL,
  meaning    TEXT NOT NULL,
  pos        TEXT,
  example    TEXT,
  example_ko TEXT,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_words_deck ON words(deck_id);
CREATE UNIQUE INDEX ux_words_deck_term ON words(deck_id, term);

CREATE TABLE cards (
  id               TEXT PRIMARY KEY,
  word_id          TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_type        TEXT NOT NULL DEFAULT 'recognition',
  due_at           TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'new',
  stability        REAL NOT NULL DEFAULT 0,
  difficulty       REAL NOT NULL DEFAULT 0,
  scheduled_days   REAL NOT NULL DEFAULT 0,
  reps             INTEGER NOT NULL DEFAULT 0,
  lapses           INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  suspended        INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_cards_word_type ON cards(word_id, card_type);
CREATE INDEX idx_cards_queue ON cards(user_id, suspended, state, due_at);
CREATE INDEX idx_cards_word ON cards(word_id);

CREATE TABLE reviews (
  id             TEXT PRIMARY KEY,
  card_id        TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating         INTEGER NOT NULL,
  local_date     TEXT NOT NULL,
  reviewed_at    TEXT NOT NULL,
  elapsed_days   REAL,
  scheduled_days REAL,
  reps_before    INTEGER NOT NULL,
  prev_state     TEXT NOT NULL
);
CREATE INDEX idx_reviews_user_date ON reviews(user_id, local_date);
CREATE INDEX idx_reviews_card ON reviews(card_id, reviewed_at);
CREATE UNIQUE INDEX ux_reviews_card_instant ON reviews(card_id, reviewed_at);
