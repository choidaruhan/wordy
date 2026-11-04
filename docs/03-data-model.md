# 03. 데이터 모델

DB: **Cloudflare D1 (SQLite)**
마이그레이션: `migrations/*.sql` → `wrangler d1 migrations apply`

## 설계 원칙

1. **날짜는 TEXT(ISO-8601 UTC)** — `2026-11-04T03:12:00.000Z`. SQLite에서 문자열 비교가 곧 시간 비교라 인덱스가 그대로 먹습니다.
2. **"오늘"은 미리 계산해서 저장** — 앱 단위 날짜 계산(타임존)을 SQL에 넣지 않습니다. 리뷰 저장 시 `local_date`를 함께 기록.
3. **조회 성능을 위해 `user_id`를 의도적으로 중복 저장** — 카드 조회가 `cards → words → decks → users` 3중 조인이 되면 큐 조회가 느려집니다.

## ERD

```
users ─1:N─ decks ─1:N─ words ─1:N─ cards ─1:N─ reviews
   └───────────── sessions
   └───────────── daily_plans
```

**단어 1개 = 카드 여러 장.** 카드 유형(`recognition` / `recall` / `cloze` / `listening`)마다
FSRS 상태가 독립입니다. 근거는 [06-learning-design.md](06-learning-design.md).

## 스키마

```sql
-- migrations/0001_init.sql

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            TEXT PRIMARY KEY,              -- crypto.randomUUID()
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  tz_offset_min INTEGER NOT NULL DEFAULT 540,  -- 분 단위. 540 = UTC+9 (KST)
  daily_new     INTEGER NOT NULL DEFAULT 10,   -- 하루 신규 카드 수 (온보딩 5/10/20)
  daily_review  INTEGER NOT NULL DEFAULT 200,  -- 하루 복습 상한
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,                -- SHA-256(토큰). 원문은 쿠키에만
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_exp  ON sessions(expires_at);

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
  term       TEXT NOT NULL,                    -- 영어 단어/구
  meaning    TEXT NOT NULL,                    -- 한국어 뜻
  pos        TEXT,                             -- 품사 (n/v/adj ...)
  example    TEXT,                             -- 영어 예문
  example_ko TEXT,                             -- 예문 해석
  note       TEXT,                             -- 개인 메모
  created_at TEXT NOT NULL
);
CREATE INDEX idx_words_deck ON words(deck_id);
CREATE UNIQUE INDEX ux_words_deck_term ON words(deck_id, term);
```

```sql
-- migrations/0002_cards.sql

CREATE TABLE cards (
  id               TEXT PRIMARY KEY,
  word_id          TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 조회용 중복

  -- 단어 1개에 여러 장의 카드. 유형마다 FSRS 상태가 독립.
  card_type        TEXT NOT NULL DEFAULT 'recognition',
                   -- recognition | recall | cloze | listening
  due_at           TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'new',  -- new|learning|review|relearning
  stability        REAL NOT NULL DEFAULT 0,      -- FSRS
  difficulty       REAL NOT NULL DEFAULT 0,      -- FSRS
  scheduled_days   REAL NOT NULL DEFAULT 0,      -- FSRS: 다음 복습까지 일수 ('외운 단어' 판정에 사용)
  learning_steps   INTEGER NOT NULL DEFAULT 0,   -- FSRS: 학습 스텝 진행도 (1분→10분)
  reps             INTEGER NOT NULL DEFAULT 0,
  lapses           INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  suspended        INTEGER NOT NULL DEFAULT 0,   -- 1 = 어려운 단어(leech)로 격리
  created_at       TEXT NOT NULL
);

-- 같은 단어에 같은 유형의 카드가 두 장 생기지 않게
CREATE UNIQUE INDEX ux_cards_word_type ON cards(word_id, card_type);

-- 복습 큐의 핵심 인덱스
CREATE INDEX idx_cards_queue ON cards(user_id, suspended, state, due_at);
CREATE INDEX idx_cards_word  ON cards(word_id);
```

```sql
-- migrations/0003_reviews.sql

CREATE TABLE reviews (
  id            TEXT PRIMARY KEY,
  card_id       TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 통계용 중복
  rating        INTEGER NOT NULL,             -- 1=Again 2=Hard 3=Good 4=Easy
  local_date    TEXT NOT NULL,                -- 'YYYY-MM-DD', 사용자 로컬 기준
  reviewed_at   TEXT NOT NULL,                -- UTC ISO
  elapsed_days  REAL,
  scheduled_days REAL,
  reps_before   INTEGER NOT NULL,             -- 0이면 신규 카드 첫 리뷰
  prev_state    TEXT NOT NULL
);

CREATE INDEX idx_reviews_user_date ON reviews(user_id, local_date);
CREATE INDEX idx_reviews_card      ON reviews(card_id, reviewed_at);

-- 같은 단어를 같은 초에 두 번 저장하는 사고 방지
CREATE UNIQUE INDEX ux_reviews_card_instant ON reviews(card_id, reviewed_at);
```

```sql
-- migrations/0004_review_instrumentation.sql (M6.1)
-- 기존 리뷰는 보존하고, 아래 컬럼만 추가한 뒤 백필한다.

ALTER TABLE reviews ADD COLUMN question_type TEXT;
ALTER TABLE reviews ADD COLUMN answer TEXT;
ALTER TABLE reviews ADD COLUMN is_correct INTEGER;
ALTER TABLE reviews ADD COLUMN grading_source TEXT;
ALTER TABLE reviews ADD COLUMN response_ms INTEGER;
ALTER TABLE reviews ADD COLUMN attempt_seq INTEGER;
ALTER TABLE reviews ADD COLUMN source TEXT NOT NULL DEFAULT 'review';
ALTER TABLE reviews ADD COLUMN next_state TEXT;
ALTER TABLE reviews ADD COLUMN next_due_at TEXT;

CREATE INDEX idx_reviews_user_card ON reviews(user_id, card_id, reviewed_at);
CREATE INDEX idx_reviews_user_type_date ON reviews(user_id, question_type, local_date);
CREATE UNIQUE INDEX ux_reviews_card_date_attempt ON reviews(card_id, local_date, attempt_seq);
```

```sql
-- migrations/0005_review_idempotency.sql (M6.1)
-- 같은 프롬프트에서 나온 재전송을 한 번만 기록한다.
ALTER TABLE reviews ADD COLUMN review_key TEXT;  -- 'card_id:shown_at'
CREATE UNIQUE INDEX ux_reviews_user_review_key ON reviews(user_id, review_key);
```

```sql
-- migrations/0006_daily_plans.sql (M6.3)
CREATE TABLE daily_plans (
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date        TEXT NOT NULL,
  base_new          INTEGER NOT NULL,
  effective_new     INTEGER NOT NULL,
  review_target     INTEGER NOT NULL,
  promoted_target   INTEGER NOT NULL,
  due_count         INTEGER NOT NULL,
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  reason            TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  completed_at      TEXT,
  PRIMARY KEY (user_id, local_date)
);
CREATE INDEX idx_daily_plans_completed ON daily_plans(user_id, completed_at);

ALTER TABLE users ADD COLUMN new_card_mode TEXT NOT NULL DEFAULT 'auto';
```

```sql
-- migrations/0007_words_metadata.sql (M6.4)
ALTER TABLE words ADD COLUMN category TEXT;
ALTER TABLE words ADD COLUMN level TEXT;           -- A1~C2
ALTER TABLE words ADD COLUMN pronunciation TEXT;   -- IPA
ALTER TABLE words ADD COLUMN audio_url TEXT;
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
```

```sql
-- migrations/0008_user_preferences.sql (M6.5)
ALTER TABLE users ADD COLUMN listening_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN voice_locale TEXT NOT NULL DEFAULT 'en-US';
ALTER TABLE users ADD COLUMN voice_rate REAL NOT NULL DEFAULT 0.9;
```

```sql
-- migrations/0009_fsrs_params.sql (M6.6)
ALTER TABLE users ADD COLUMN fsrs_params TEXT;           -- JSON number[21]
ALTER TABLE users ADD COLUMN fsrs_params_updated_at TEXT;
```

> 컬럼 의미와 백필 규칙은 [07-learning-engine.md](07-learning-engine.md) 9~11절이 기준입니다.
> `is_correct`는 `rating >= 2`다. FSRS에서 Again만 실패다.

```sql
-- migrations/0003_quiz.sql
-- 객관식 테스트. 학습 일정(FSRS)과 완전히 분리된 기록이다.

CREATE TABLE quiz_sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total        INTEGER NOT NULL,
  correct      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE quiz_questions (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  word_id      TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  options      TEXT NOT NULL,      -- JSON 배열 (한국어 뜻 4개)
  answer_index INTEGER NOT NULL,
  chosen_index INTEGER,
  is_correct   INTEGER,
  answered_at  TEXT
);
```

> 퀴즈는 `cards` / `reviews` 를 건드리지 않습니다.
> 객관식은 인출 강도가 낮아 FSRS 스케줄에 반영하면 학습 효율을 왜곡하기 때문입니다.

## "오늘의 큐" 조회

```sql
-- ① 오늘 이미 한 신규 소개 수 (daily_new 상한 계산용)
-- 승급 카드(recall/cloze)의 첫 리뷰는 여기에 포함하지 않는다.
SELECT COUNT(*) AS n
FROM reviews
WHERE user_id = ?1 AND local_date = ?2
  AND reps_before = 0 AND question_type = 'recognition';

-- ② 복습 대기 카드
SELECT c.*, w.term, w.meaning, w.pos, w.example
FROM cards c
JOIN words w ON w.id = c.word_id
WHERE c.user_id = ?1
  AND c.suspended = 0
  AND c.state IN ('learning','review','relearning')
  AND c.due_at <= ?3          -- 현재 UTC 시각
ORDER BY c.due_at ASC
LIMIT ?4;                     -- daily_review - 오늘 복습한 수

-- ③ 신규 카드 (①②로 상한이 안 찼을 때만)
SELECT c.*, w.term, w.meaning, w.pos, w.example
FROM cards c
JOIN words w ON w.id = c.word_id
WHERE c.user_id = ?1
  AND c.suspended = 0
  AND c.state = 'new'
ORDER BY c.created_at ASC
LIMIT ?4;
```

**순서 규칙**: 복습 카드(기한 지난 것) → 승급 카드(한→영/빈칸) → 신규 카드.
신규를 먼저 보여주면 사용자가 어려운 복습을 회피합니다.

**쿼터**: `daily_review`는 복습과 승급 첫 리뷰에 함께 적용하고, `daily_new`는 처음 보는
`recognition` 카드에만 적용합니다. 자세한 계산은 [07-learning-engine.md](07-learning-engine.md) 5~6절.

## 리뷰 저장 (트랜잭션)

리뷰 1건 = `cards` UPDATE + `reviews` INSERT. **반드시 함께 성공해야 합니다.**

```ts
const [cardResult, reviewResult] = await c.env.DB.batch([
  c.env.DB.prepare(
    `UPDATE cards
        SET due_at=?, state=?, stability=?, difficulty=?, scheduled_days=?,
            learning_steps=?, reps=?, lapses=?, last_reviewed_at=?
      WHERE id=? AND user_id=? AND reps=?`
  ).bind(..., row.id, userId, row.reps),
  c.env.DB.prepare(
    `INSERT INTO reviews (
       id, card_id, user_id, rating, local_date, reviewed_at,
       elapsed_days, scheduled_days, reps_before, prev_state,
       question_type, answer, is_correct, grading_source, response_ms, review_key,
       attempt_seq, source, next_state, next_due_at
     )
     SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
            (SELECT COUNT(*)+1 FROM reviews WHERE card_id=? AND local_date=?),
            ?,?,?
      WHERE EXISTS (
        SELECT 1 FROM cards WHERE id=? AND user_id=? AND last_reviewed_at=?
      )`
  ).bind(...),
]);

if ((cardResult.meta.changes ?? 0) === 0) return null; // 이미 처리됨
```

`DB.batch()`는 D1에서 하나의 트랜잭션으로 실행됩니다.
`WHERE reps=?` 낙관적 락, `last_reviewed_at` 토큰, `review_key` 유니크 인덱스로 중복 저장을 막습니다.
유니크 위반이 나면 batch 전체가 롤백되므로 카드 상태만 바뀌는 사고가 없습니다.
`maybeUnlock*`는 배치 밖에서 best-effort로 실행하고, `/review` 로드 시
`ensureUnlocks()`로 누락분을 재시도합니다.

## 연속 학습일 (streak)

`reviews.local_date`만 쓰면 SQL 한 줄입니다.

```sql
SELECT DISTINCT local_date
FROM reviews
WHERE user_id = ?1
ORDER BY local_date DESC
LIMIT 400;
```

앱에서 오늘/어제부터 연속인지 세면 됩니다. (SQL 창 함수로도 가능하지만 코드가 더 읽기 쉽습니다.)

## 통계 쿼리

```sql
-- 최근 30일 일별 복습량
SELECT local_date, COUNT(*) AS n, AVG(rating) AS avg_rating
FROM reviews
WHERE user_id = ?1 AND local_date >= ?2
GROUP BY local_date
ORDER BY local_date;

-- 정답률 (Again만 오답. Hard/Good/Easy는 회상 성공)
SELECT
  SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS accuracy
FROM reviews
WHERE user_id = ?1 AND local_date >= ?2;
```

## CSV 형식

**이 포맷이 곧 기본 단어장의 포맷입니다.** 시드, 임포트, 내보내기가 같은 형식을 씁니다.

### 컬럼

| 컬럼 | 필수 | 설명 |
|---|---|---|
| `term` | ✅ | 영어 단어/구. 같은 단어장 안에서 유일 |
| `meaning` | ✅ | 한국어 뜻. 여러 개는 `;` 로 구분 (`경우;사건`) |
| `pos` | | 품사: `n` `v` `adj` `adv` `prep` `conj` `pron` `det` `num` `modal` `phr` |
| `example` | | 영어 예문. `term` 이 포함되어야 cloze 카드로 승급 가능 |
| `example_ko` | | 예문 해석 |
| `category` | | 카테고리 (예: 일상생활, 감정과 심리) |
| `level` | | CEFR `A1` `A2` `B1` `B2` `C1` `C2` |
| `pronunciation` | | IPA 발음 기호 |
| `audio_url` | | 추후 실제 음성 URL |
| `collocations` | | 함께 쓰는 표현. `\|` 로 구분 |
| `synonyms` | | 유의어. `\|` 로 구분 |
| `antonyms` | | 반의어. `\|` 로 구분 |
| `example_2` | | 추가 예문 1. `term` 포함 권장 |
| `example_2_ko` | | 추가 예문 1 해석 |
| `example_3` | | 추가 예문 2 |
| `example_3_ko` | | 추가 예문 2 해석 |

```csv
term,meaning,pos,example,example_ko,category,level,pronunciation,collocations,synonyms,antonyms,example_2,example_2_ko,example_3,example_3_ko
ubiquitous,어디에나 있는,adj,"Smartphones are ubiquitous these days.","요즘 스마트폰은 어디에나 있다.",일상생활,B2,/juːˈbɪkwɪtəs/,"ubiquitous technology|ubiquitous presence",omnipresent,rare,"Smartphones are ubiquitous.","스마트폰은 어디에나 있다.",,
resilient,회복력 있는,adj,,,감정과 심리,B2,/rɪˈzɪliənt/,"resilient economy|resilient person",tough,fragile,,,,,
```

### 규칙

- 인코딩: UTF-8 (BOM 허용, 파싱 시 제거)
- 구분자: 쉼표. 따옴표 안의 쉼표·줄바꿈 허용 → **예문/해석은 항상 따옴표로 감쌀 것**
- `meaning` 에는 쉼표를 쓰지 않습니다 (`;` 사용). 따옴표 없이 관리하기 위함
- **앞 5컬럼은 필수, 그 뒤 선택 컬럼은 순서를 바꿔도 됩니다.** 기존 5컬럼 파일도 그대로 임포트됩니다.
- `collocations` / `synonyms` / `antonyms` 는 셀 안에서 `|` 로 구분합니다.
- `term` 중복 시: **건너뛰고 결과에 "중복 3건 제외" 표시** (덮어쓰지 않음)
- 파일 크기 상한: 5MB (Workers 요청 본문 한도 고려)
- **파일 순서 = 학습 순서**입니다. 별도 순위 컬럼을 두지 않습니다

### 검수

1000줄을 눈으로 검사할 수 없으므로 스크립트로 확인합니다.

```bash
node scripts/check-seed.mjs public/seeds/basic-1000.csv --expect 1000
```

중복, 컬럼 수, 빈 필드, 품사 오타, 예문에 단어가 빠진 경우를 잡아냅니다.

내보내기는 기본적으로 **같은 5컬럼**을 그대로 내보냅니다. 다시 임포트할 수 있어야 하기 때문입니다.
`?full=1` 을 붙이면 메타데이터·추가 예문까지 포함한 16컬럼으로 내보냅니다.
학습 상태(`due_at`, `state`)는 진행도 백업용으로는 유용하지만, 그 컬럼이 있으면 재임포트가 깨집니다.
(필요해지면 `?progress=1` 같은 별도 옵션으로 분리)

파일은 엑셀 호환을 위해 UTF-8 BOM으로 시작하고, `Content-Disposition` 에 한글 파일명을 RFC 5987로 함께 넣습니다.

### 기본 단어장 시드

| 파일 | 내용 | 수 |
|---|---|---|
| `public/seeds/basic-1000.csv` | 명사·동사·형용사·부사·구동사 | 1,000 |
| `public/seeds/function-100.csv` | 관사·대명사·전치사·접속사·조동사 | 100 |

- 정적 자산으로 배포되고, 사용자가 "추가"를 누르면 `ASSETS.fetch('/seeds/<slug>.csv')` 로 읽어 파싱한 뒤 자기 `decks` 로 복사합니다.
- Worker 번들에 1,100줄을 인라인하지 않습니다 (번들 크기 절약).
- 기본 1,000개에서 **기능어(the, of, and, to…)는 제외**합니다. 문법이지 암기 대상이 아닙니다.
- 기능어는 별도 단어장으로 보충합니다. 두 파일 간 **단어 중복은 0건**입니다.
- 두 단어장은 `POST /seeds/:slug` 하나로 임포트합니다 (`basic-1000`, `function-100`).

## 마이그레이션 규칙

- 파일명: `NNNN_설명.sql`, 순번 증가
- **이미 적용된 마이그레이션 파일은 절대 수정하지 않습니다.** 수정하려면 새 파일 추가.
- D1은 `ALTER TABLE ... ADD COLUMN`은 되지만 `DROP COLUMN`/타입 변경은 제약이 있습니다. 스키마 변경 시 새 테이블 + `INSERT SELECT` + `RENAME` 패턴 사용.
- 배포 순서: `db:remote` → `deploy`. 반대면 런타임 에러.
