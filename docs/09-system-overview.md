# 09. 시스템 전체 정리 — 영어 단어 암기 시스템

> 기준: 2026-11-05, M7 `/play` + 퍼플 리디자인 반영.
> 이 문서는 **현재 코드가 실제로 어떻게 동작하는지**를 한곳에 모은 것이다.
> `docs/06`, `docs/07`의 하루 계획·쿼터·적응형 배분 설명은 현재 메인 경로가 아니라
> **레거시 `/review` 경로**에 해당한다. 충돌하면 이 문서와 코드를 우선한다.
>
> **2026-11-05 M8.2 업데이트**: `/play`는 `learning_mode`(session/daily),
> `play_session_items` 기반 출제/답안 검증, 세션 상태(active/completed/abandoned/expired),
> 승급된 `recall`/`cloze`/`listening` new 카드 출제를 사용한다.
> `/review`는 기본적으로 `/play`로 리다이렉트된다. 구현 상세는 `docs/10`을 본다.

---

## 0. 한눈에 보기

Wordy는 “단어장 뷰어”가 아니라 **인출 훈련기**다.

```text
단어 1개
  └─ 카드 여러 장 (recognition / recall / cloze / listening)
       └─ 카드마다 독립적인 FSRS 상태
            └─ 사용자가 답을 꺼내게 함
                 └─ 정답 여부 + 응답 시간으로 자동 평점
                      └─ FSRS가 다음 등장 시점 계산
```

핵심 원칙:

1. **스케줄의 단일 진실원은 `cards`다.** `reviews`는 감사 로그·통계 원천이다.
2. **파생 상태는 저장하지 않는다.** 취약·관찰·재확인은 읽을 때 계산한다.
3. **퀴즈는 학습 스케줄을 바꾸지 않는다.** 취약 점수의 보조 신호로만 쓴다.
4. **자동 조절은 줄이는 방향으로만 한다.** 신규를 자동으로 늘리지 않는다.
5. **메인 학습 진입점은 `/play`다.** `/review`는 하루 계획 기반 레거시 경로다.

두 개의 학습 루프:

| 루프 | 진입점 | 단위 | 쿼터 | 상태 |
|---|---|---|---|---|
| 플레이 | `/play` | 한 판 (`session_size`) | 없음 | **현재 메인** |
| 하루 학습 | `/review` | 하루 계획 (`daily_plans`) | `daily_new`, `daily_review` | 레거시 |

---

## 1. 학습 설계 원리

### 1.1 근거

- **인출 연습(testing effect)**: 다시 읽는 것보다 기억에서 꺼내는 것이 오래 남는다.
- **간격 효과(spacing effect)**: 같은 총 시간이면 몰아서보다 나눠서가 오래 남는다.

따라서 금지하는 것:

| 금지 | 이유 |
|---|---|
| 단어 목록을 훑어보게 하기 | 인출이 일어나지 않는다 |
| 뜻을 항상 같이 보여주기 | 꺼낼 필요가 없어진다 |
| 정답을 즉시 공개 | 애쓰는 시간이 학습량이다 |
| 하루에 200개 몰아주기 | 간격 효과가 사라진다 |

### 1.2 카드 1장의 루프

```text
① 자극(cue) 제시
② 인출 시도          ← 학습이 일어나는 순간. 앱은 여기서 아무것도 하지 않는다
③ 피드백 공개        ← 뜻 + 품사 + 예문 + 발음
④ 자동 채점          ← 정답 여부 + 응답 시간
⑤ FSRS 다음 복습일 계산
```

목표 소요:

- 객관식: 6~10초
- 타이핑형: 15~20초
- 신규 소개: 3~5초 노출 후 즉시 인출

### 1.3 세션 구조 철학

- 복습을 먼저, 신규를 나중에 둔다.
- 신규와 복습을 무작위로 섞지 않는다. 인지 부하를 낮추기 위해서다.
- 세션 안에서 틀린 카드를 한 번 더 꺼내는 “마무리”가 기억에 효과적이다.
- 현재 `/play`는 이 철학을 **한 판 5문제** 단위로 축소해 적용한다.

---

## 2. 아키텍처

### 2.1 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 런타임 | Cloudflare Workers | D1 바인딩 `DB` |
| 프레임워크 | Hono v4 | SSR + `hono/jsx` |
| 인터랙션 | HTMX 2.x | 서버가 HTML 조각 반환 |
| 스타일 | Tailwind CSS v4 | 빌드 타임 CLI |
| DB | Cloudflare D1 (SQLite) | 마이그레이션 `migrations/*.sql` |
| 복습 알고리즘 | `ts-fsrs` v6 | Workers에서 동작 |
| 클라이언트 JS | HTMX + 소량의 인라인 스크립트 | React·번들러·hydration 없음 |

### 2.2 요청 흐름

```text
브라우저
  │  GET /play
  ▼
Hono (Workers)
  │  getSessionUser() → users row
  │  getPlayPoolCounts() → due / new
  ▼
JSX SSR (Layout + PlayHome)
  │  HTML
  ▼
브라우저
  │  POST /play/:id/answer (HTMX)
  ▼
Hono
  │  getPlaySessionItem() → item 검증
  │  getCardForReview()
  │  grade / ratingFromQuiz()
  │  saveReview() → D1 batch (cards UPDATE + reviews INSERT)
  │  afterSavePlay() → 승급·leech
  │  trigger → item 답변/세션 활동 갱신, 카운터는 뷰에서 파생
  ▼
HTML 조각 (PlayFeedback)
```

### 2.3 클라이언트 JS가 하는 일

`src/components/layout.tsx`의 인라인 스크립트:

- `[data-speak]` 클릭 → `speechSynthesis`로 TTS 재생
- TTS 미지원 기기 감지 → `[data-tts-note]` 표시
- 키보드:
  - `1~4`: 보기 선택
  - `Space` / `Enter`: “뜻 보기”, “가리고 확인하기”, “계속” 클릭
- HTMX swap 후 `[data-autofocus]` 입력창 포커스
- 하단 탭/상단 내비 현재 위치 표시
- 서비스 워커 등록

그 외 상태는 모두 서버가 HTML로 렌더한다. 클라이언트에 학습 상태를 저장하지 않는다.

### 2.4 폴더 구조

```text
src/
  index.tsx              라우트 등록
  types.ts               Env / User / Stats 타입
  components/layout.tsx  공통 레이아웃 + 클라이언트 JS
  routes/
    auth.tsx             로그인/OAuth
    home.tsx             홈 대시보드
    play.tsx             현재 메인 학습
    review.tsx           레거시 하루 학습
    decks.tsx            단어장/단어 CRUD/CSV
    hard.tsx             취약/관찰/격리
    stats.tsx            통계
    quiz.tsx             객관식 테스트
    settings.tsx         설정/FSRS
    legal.tsx            약관/개인정보
    design.tsx           디자인 시스템
  db/
    queries.ts           단어장/단어/임포트/통계
    review.ts            리뷰 저장·승급·leech
    play.ts              플레이 세션/카드 선택
    plan.ts              하루 계획(레거시)
    weak.ts              취약/관찰/재확인
    stats.ts             통계 쿼리
    quiz.ts              퀴즈
  lib/
    srs.ts               FSRS 래퍼
    grade.ts             철자 채점/빈칸/글자 비교
    rating.ts            자동 평점
    weak.ts              취약 점수 순수 함수
    adaptive.ts          적응형 신규 배분(레거시)
    session.ts           유형 혼합/예상 시간(레거시)
    play.ts              플레이 순수 규칙
    quota.ts             쿼터/응답 시간(레거시)
    csv.ts               CSV 파싱/내보내기
    word-meta.ts         메타데이터 파싱
    time.ts              로컬 날짜/표시
    auth.ts              세션/사용자
```

---

## 3. 데이터 모델

### 3.1 ERD

```text
users ─1:N─ decks ─1:N─ words ─1:N─ cards ─1:N─ reviews
   ├─────────────── sessions
   ├─────────────── daily_plans        (레거시 하루 계획)
   ├─────────────── quiz_sessions ─1:N─ quiz_questions
   └─────────────── play_sessions      (M7 플레이)

words ─1:N─ word_examples
```

### 3.2 테이블

#### `users`

| 컬럼 | 타입 | 기본값 | 의미 |
|---|---|---|---|
| `id` | TEXT PK | | UUID |
| `email` | TEXT UNIQUE | | 로그인 식별자 |
| `display_name` | TEXT | NULL | 표시 이름 |
| `tz_offset_min` | INTEGER | 540 | 로컬 시간 오프셋(분), fallback |
| `timezone` | TEXT | NULL | IANA 시간대 (`Asia/Seoul` 등) |
| `daily_new` | INTEGER | 10 | 하루 신규 수 (레거시) |
| `daily_review` | INTEGER | 200 | 하루 복습 상한 (레거시) |
| `created_at` | TEXT | | UTC ISO |
| `new_card_mode` | TEXT | `auto` | `auto` / `fixed` (레거시) |
| `listening_enabled` | INTEGER | 0 | 듣기 카드 생성 여부 |
| `voice_locale` | TEXT | `en-US` | `en-US` / `en-GB` |
| `voice_rate` | REAL | 0.9 | 0.7 ~ 1.2 |
| `fsrs_params` | TEXT | NULL | JSON number[21] |
| `fsrs_params_updated_at` | TEXT | NULL | 적용 시각 |
| `session_size` | INTEGER | 5 | 한 판 문제 수 (M7) |
| `new_per_session` | INTEGER | 2 | 한 판에 섞을 새 단어 수 (M7) |

#### `sessions`

- `token_hash` PK: 쿠키 토큰의 SHA-256
- `user_id`, `expires_at`, `created_at`
- 쿠키 이름 `sid`, 30일, `httpOnly`, `sameSite=Lax`, HTTPS면 `secure`

#### `decks` / `words`

`words` 주요 컬럼:

| 컬럼 | 의미 |
|---|---|
| `term` | 영어 단어/구 |
| `meaning` | 한국어 뜻 |
| `pos` | 품사 (`n`, `v`, `adj`, `prep` …) |
| `example` / `example_ko` | 대표 예문/해석 |
| `note` | 사용자가 적은 연상법 |
| `category` | 카테고리 |
| `level` | CEFR A1~C2 |
| `pronunciation` | IPA |
| `audio_url` | 실제 음성(추후) |
| `collocations` | JSON 배열 |
| `synonyms` | JSON 배열 |
| `antonyms` | JSON 배열 |

제약:

- `ux_words_deck_term(deck_id, term)` — 같은 단어장에 같은 표제어 중복 금지
- `word_examples(word_id, sentence, translation, is_primary, created_at)` — 추가 예문

#### `cards` — FSRS 상태의 진실원

| 컬럼 | 의미 |
|---|---|
| `card_type` | `recognition` / `recall` / `cloze` / `listening` |
| `due_at` | 다음 복습 시각 (UTC ISO) |
| `state` | `new` / `learning` / `review` / `relearning` |
| `stability` | FSRS 기억 안정성(일) |
| `difficulty` | FSRS 난이도 |
| `scheduled_days` | 다음 복습까지 일수 |
| `learning_steps` | 학습 스텝 진행도 |
| `reps` | 리뷰 횟수 |
| `lapses` | 잊은 횟수 |
| `last_reviewed_at` | 마지막 리뷰 시각 |
| `suspended` | 1 = leech로 큐에서 격리 |

제약·인덱스:

- `ux_cards_word_type(word_id, card_type)` — 단어당 유형별 카드 1장
- `idx_cards_queue(user_id, suspended, state, due_at)` — 복습 큐
- `idx_cards_word(word_id)`

#### `reviews` — 감사 로그

기본 컬럼:

- `rating` (1 Again / 2 Hard / 3 Good / 4 Easy)
- `local_date` (`YYYY-MM-DD`, 쓰기 시점 사용자 로컬 날짜)
- `reviewed_at` (UTC ISO)
- `elapsed_days`, `scheduled_days`
- `reps_before`, `prev_state`

M6.1·M7 이후 추가:

| 컬럼 | 의미 |
|---|---|
| `question_type` | 리뷰 시점 카드 유형 |
| `answer` | 사용자가 선택/입력한 답 |
| `is_correct` | `rating >= 2`이면 1 |
| `grading_source` | `self` / `server` |
| `response_ms` | 자극 → 응답 시간 (0~300000) |
| `review_key` | `item.id` (`/play`) / `card_id:shown_at` (`/review` 레거시) 멱등키 |
| `attempt_seq` | 같은 카드·같은 날짜의 시도 순번 |
| `source` | `review` / `weak` |
| `next_state` | 리뷰 후 카드 상태 |
| `next_due_at` | 리뷰 후 다음 due |
| `session_id` | 플레이 세션 ID (M7) |

제약·인덱스:

- `ux_reviews_card_instant(card_id, reviewed_at)` — 같은 초 중복 방지
- `ux_reviews_card_date_attempt(card_id, local_date, attempt_seq)`
- `ux_reviews_user_review_key(user_id, review_key)`
- `idx_reviews_user_date`, `idx_reviews_card`, `idx_reviews_user_card`,
  `idx_reviews_user_type_date`, `idx_reviews_session`

#### `daily_plans` — 레거시 하루 계획 스냅샷

- PK `(user_id, local_date)`
- `base_new`, `effective_new`, `review_target`, `promoted_target`
- `due_count`, `estimated_minutes`, `reason`
- `created_at`, `completed_at`

#### `play_sessions` — M7 플레이

최종 컬럼(0012에서 점수/콤보 제거 후):

| 컬럼 | 의미 |
|---|---|
| `id` | UUID |
| `user_id` | 사용자 |
| `mode` | `quick` / `typing` / `cloze` / `listening` / `weak` / `custom` |
| `target_size` | 목표 문제 수 |
| `answered` | 처리한 문제 수 |
| `correct` | 맞힌 문제 수 |
| `started_at`, `completed_at` | 세션 시각 |
| `deck_id` | `custom` 모드의 단어장 |

인덱스: `idx_play_sessions_user(user_id, started_at)`,
`idx_play_sessions_active(user_id, completed_at)`

#### `quiz_sessions` / `quiz_questions`

- `quiz_sessions(total, correct, created_at, completed_at)`
- `quiz_questions(session_id, word_id, position, options JSON, answer_index,
  chosen_index, is_correct, answered_at)`

### 3.3 마이그레이션 이력

| 파일 | 내용 |
|---|---|
| `0001_init.sql` | users/sessions/decks/words/cards/reviews |
| `0002_card_learning_steps.sql` | `cards.learning_steps` |
| `0003_quiz.sql` | 퀴즈 테이블 |
| `0004_review_instrumentation.sql` | 리뷰 계측 컬럼 + 백필 + 인덱스 |
| `0005_review_idempotency.sql` | `review_key` + 유니크 인덱스 |
| `0006_daily_plans.sql` | `daily_plans`, `new_card_mode` |
| `0007_words_metadata.sql` | 단어 메타데이터 + `word_examples` |
| `0008_user_preferences.sql` | 듣기/발음 설정 |
| `0009_fsrs_params.sql` | 사용자별 FSRS 가중치 |
| `0010_play_sessions.sql` | `play_sessions`, `reviews.session_id`, 세션 설정 |
| `0011_play_session_deck.sql` | `play_sessions.deck_id` |
| `0012_drop_play_score.sql` | 플레이 점수/콤보 컬럼 제거 |

### 3.4 불변식

1. 모든 단어는 `recognition` 카드를 정확히 1장 가진다.
2. 카드 유형마다 FSRS 상태는 독립이다. 같은 단어라도 영→한과 한→영의 `due_at`은 다르다.
3. `state`와 `due_at`은 분리한다. `review` 상태여도 due가 도래할 수 있다.
4. 리뷰 1건은 `cards` UPDATE와 `reviews` INSERT가 **함께 성공**해야 한다.
5. FSRS 스케줄의 진실원은 `cards`다. 최신 로그와 카드가 어긋나면 카드가 우선이다.
6. 퀴즈는 `cards`/`reviews`를 변경하지 않는다.
7. `leech`는 `suspended = 1`이다. `weak`와 별개다.
8. 날짜는 UTC ISO로 저장하고, `local_date`는 **쓰기 시점**에 계산한다.
9. 승급은 **best-effort**다. 실패해도 리뷰 저장은 유지된다.

---

## 4. 카드 시스템

### 4.1 카드 4종

| 유형 | 자극 | 사용자가 하는 일 | 난이도 | 생성 |
|---|---|---|---|---|
| `recognition` | 영어 단어 | 뜻 4지선다 | ★ | 단어 생성 시 항상 |
| `recall` | 한국어 뜻 | 영어 철자 입력 | ★★★ | 승급 조건 |
| `cloze` | 빈칸 예문 | 빈칸 단어 입력 | ★★ | 승급 조건 |
| `listening` | TTS 음성 | 듣고 철자 입력 | ★★★ | 설정 ON + 승급 조건 |

### 4.2 승급 조건

```text
recall:
  recognition.state = 'review'
  AND recognition.scheduled_days >= 4
  AND words.pos NOT IN ('det','pron','prep','conj','modal')

cloze:
  recognition.state = 'review'
  AND recognition.stability >= 7
  AND words.example IS NOT NULL
  AND blankOut(words.example, words.term) != null

listening:
  users.listening_enabled = 1
  AND recognition.state = 'review'
  AND recognition.scheduled_days >= 14
```

추가 규칙:

- 기능어는 뜻→영어 답이 하나로 정해지지 않으므로 `recall`을 만들지 않는다.
  기능어는 `cloze`가 출구다.
- 예문에 기본형이 없으면(굴절: `become → became`) `cloze`를 만들지 않는다.
- `cloze`는 `recognition` 카드의 리뷰 결과가 `stability >= 7`일 때 생성된다.
- `listening`은 기본 꺼짐. 켠 사용자에게만 생성된다. 이미 만든 카드는 끄더라도 계속 복습된다.
- 승급된 카드는 `state = 'new'`, `due_at = now`로 생성된다.

### 4.3 승급 실행

- 리뷰 저장이 끝난 뒤 **best-effort**로 `maybeUnlockRecall/Cloze/Listening` 실행.
- `INSERT OR IGNORE` + `ux_cards_word_type`으로 중복 생성 방지.
- 승급 실패는 리뷰 저장에 영향을 주지 않는다.
- `/review` 로드 시 `ensureUnlocks(userId)`가 조건을 만족하지만 카드가 없는 것을 찾아 복구한다.
  - 멱등적이며 리뷰 트랜잭션 밖에서 실행된다.
  - **현재 `ensureUnlocks`는 `/review` GET에서만 호출된다.** `/play`는 저장 직후 승급만 시도하고,
    누락 복구는 하지 않는다.

### 4.4 쿼터 (레거시 `/review` 전용)

| 쿼터 | 적용 대상 |
|---|---|
| `daily_new` | 처음 보는 `recognition` 카드의 첫 리뷰만 |
| `daily_review` | 그 외 모든 리뷰 (학습 스텝, 승급 첫 리뷰, 복습 카드) |

- 승급 카드는 `daily_new`를 쓰지 않는다.
- 승급 카드의 첫 리뷰는 `daily_review`에 포함한다.
- 학습 스텝(1분→10분)도 `daily_review`에 포함한다.
- **`/play`는 이 쿼터를 전혀 사용하지 않는다.**

---

## 5. FSRS 엔진

### 5.1 기본 파라미터

`src/lib/srs.ts`:

```ts
request_retention: 0.9
maximum_interval: 1095        // 3년
enable_fuzz: true             // 같은 날 복습이 몰리지 않게
enable_short_term: true
learning_steps: ['1m', '10m']
relearning_steps: ['10m']
```

### 5.2 상태

| state | 의미 | due_at |
|---|---|---|
| `new` | 한 번도 리뷰하지 않음 | 생성 즉시 |
| `learning` | 학습 스텝 진행 중 | 수 분 뒤 |
| `review` | 정착됨 | 수 일~수 개월 뒤 |
| `relearning` | 잊어서 재학습 중 | 수 분 뒤 |

### 5.3 D1 ↔ ts-fsrs 매핑

| ts-fsrs | D1 | 변환 |
|---|---|---|
| `due: Date` | `due_at TEXT` | `.toISOString()` |
| `state: State` | `state TEXT` | 이름 매핑 |
| `stability` | `stability REAL` | 그대로 |
| `difficulty` | `difficulty REAL` | 그대로 |
| `reps` | `reps INTEGER` | 그대로 |
| `lapses` | `lapses INTEGER` | 그대로 |
| `last_review` | `last_reviewed_at TEXT` | `.toISOString()` |
| `learning_steps` | `learning_steps INTEGER` | 그대로 |

### 5.4 `schedule()`

```ts
schedule(row, now, rating, params?) → {
  due_at, state, stability, difficulty, scheduled_days,
  learning_steps, reps, lapses, last_reviewed_at, elapsed_days
}
```

- `elapsed_days`는 마지막 리뷰 이후 경과일.
- `scheduled_days`는 ts-fsrs가 계산한 값.
- `previewIntervals()`는 4개 평점별 다음 복습일을 한국어로 표시한다.
  현재는 레거시 `/review`의 자기평가 폴백에서만 쓴다.

### 5.5 사용자별 가중치

- `users.fsrs_params`에 21개 숫자 JSON 배열을 저장.
- `parseFsrsParams()`는 정확히 21개 유한 숫자만 허용. 아니면 `null`.
- `getScheduler(params)`는 가중치 문자열을 키로 스케줄러를 캐시한다.
- 가중치가 잘못되면 기본 파라미터로 폴백.
- 1,000건 미만에서는 기본값 사용을 권장한다. 그 전 튜닝은 과적합 위험.

### 5.6 시간 처리

```ts
localDate(now, tzOffsetMin, timezone) =
  timezone
    ? Intl.DateTimeFormat('en-US', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(now) → 'YYYY-MM-DD'
    : new Date(now.getTime() + tzOffsetMin * 60_000)
        .toISOString().slice(0, 10)
```

- `due_at`은 절대 시각(UTC).
- “오늘 복습” 판정은 `due_at <= now`.
- streak·일일 상한은 `reviews.local_date`.
- `users.timezone`(IANA)이 있으면 DST를 포함해 정확히 계산한다.
- `timezone`이 없거나 잘못됐으면 `tz_offset_min`으로 폴백한다.
- `local_date`는 리뷰 쓰기 시점에 계산해 저장한다.

---

## 6. 채점 시스템

### 6.1 영→한 `recognition`

- 4지선다. 정답 뜻 + 사용자의 다른 단어 뜻 3개를 섞는다.
- 정답은 서버가 문자열로 비교한다: `normalize(choice) === normalize(card.meaning)`.
- `normalize()`: 소문자화, 앞뒤 공백 제거, 연속 공백 1칸으로 축약.
- 보기가 2개 미만이면 객관식이 성립하지 않으므로 자기평가 화면으로 폴백한다.
  - “알겠어요” → `Good(3)`
  - “모르겠어요” → `Again(1)`
  - 이때만 `grading_source = 'self'`.

### 6.2 한→영 / 빈칸 / 듣기

- 입력값을 `gradeAnswer(input, card.term)`로 채점한다.
- 듣기 카드의 “들리지 않아요”는 빈 답안으로 제출 → `Again`.
- 오타 허용 거리:

| 정답 길이 | 허용 거리 |
|---|---|
| 8자 이상 | 2 |
| 5~7자 | 1 |
| 4자 이하 | 0 |

- 정답이 여러 개면 `/`로 구분한다. 예: `ubiquitous / omnipresent`
- 결과:
  - 정확: `ok=true, typo=false`
  - 오타 허용: `ok=true, typo=true` → `Hard`
  - 오답: `ok=false`
- 결과 화면에서 글자 단위로 틀린 부분을 하이라이트한다.

### 6.3 자동 평점

`ratingFromQuiz()`:

```text
오답                                      → Again (1)
오타 허용                                 → Hard (2)
정답, response_ms > 8000                  → Hard (2)
정답, 3000 < response_ms <= 8000          → Good (3)
정답, response_ms <= 3000:
  생산형(recall/cloze/listening)          → Easy (4)
  recognition                             → Good (3)
response_ms 없음                          → Good (3)
```

- `recognition`은 찍어서 맞힌 경우를 구분하기 위해 `Easy`를 주지 않는다.
- 응답 시간은 서버가 `shown_at` 기준으로 계산한다.
- `clampResponseMs()`: `0 ~ 300000ms`로 보정. `shown_at`이 없으면 `null`.

### 6.4 `self` vs `server`

| 경로 | `grading_source` |
|---|---|
| 영→한 4지선다 | `server` |
| 한→영/빈칸/듣기 입력 | `server` |
| 보기 부족으로 폴백한 영→한 자기평가 | `self` |
| 레거시 `/review`의 “뜻 보기 → 자기평가” | `self` |

---

## 7. 현재 메인 학습 흐름 — `/play`

### 7.1 진입과 세션 생성

```text
GET  /play            모드 선택 + 현재 풀 수 있는 수
POST /play/start      play_sessions 생성 → /play/:id
GET  /play/:id        현재 문제 또는 결과
POST /play/:id/answer 채점 → 피드백
POST /play/:id/next   다음 문제 또는 결과
GET  /play/:id/result 결과
```

- 한 판 크기: `users.session_size` (기본 5, 설정 5/10/20)
- 한 판에 섞을 새 단어: `users.new_per_session` (기본 2, 설정 0/1/2/3/5)
- `play_sessions.mode`는 정규화된 모드만 저장한다.
- 듣기 모드는 `listening_enabled`가 꺼져 있으면 `quick`으로 정규화된다.

### 7.2 모드

| 모드 | 라벨 | 출제 카드 |
|---|---|---|
| `quick` | 바로 시작 | 모든 유형의 due + 새 `recognition` |
| `typing` | 철자 도전 | `recall` + `cloze` due |
| `cloze` | 빈칸 퀴즈 | `cloze` due |
| `listening` | 듣기 퀴즈 | `listening` due |
| `weak` | 취약 집중 | 취약/주의 단어의 due (모든 유형) |
| `custom` | 새 단어 연습 | 지정 단어장의 새 `recognition`만, 최신순 |

- `PLAY_MODES`(홈/플레이 화면 노출)는 `quick, typing, cloze, listening, weak`.
- `custom`은 단어장 화면의 “이 단어장의 새 단어로 한 판”에서만 시작한다.
- `typing`은 이름과 달리 `recall`뿐 아니라 `cloze`도 포함한다.

### 7.3 카드 선택 알고리즘 (`nextPlayCard`)

```text
1. 모드별 카드 유형 필터 결정
   - typing  → recall, cloze
   - cloze   → cloze
   - listening → listening
   - 그 외   → 전체

2. 같은 세션에서 이미 낸 카드는 제외
   NOT EXISTS (reviews WHERE session_id = ? AND card_id = c.id)

3. 최근 10분 안에 리뷰한 카드는 제외
   last_reviewed_at IS NULL OR last_reviewed_at < now - 10분

4. custom 모드
   - deck_id가 없으면 null
   - 해당 단어장의 state='new' AND card_type='recognition'
   - created_at DESC (최근 추가한 단어부터)

5. quick 모드의 새 단어
   - 세션에 저장된 new_target 미만
   - session.answered >= 2 (3번째 문제부터)
   - 새 카드가 있으면 due보다 먼저 반환

6. due 카드
   - state IN ('learning','review','relearning')
     OR (state = 'new' AND card_type != 'recognition')  -- 승급 카드
   - due_at <= now
   - 모드 유형 필터 적용
   - weak 모드면 취약 단어 ID 필터 적용
   - due_at ASC

7. quick 모드에서 due가 없으면 새 카드로 채움
   - 다른 모드는 새 카드를 억지로 넣지 않고 null 반환
```

주의할 점:

- `quick`에서 due가 있으면 1~2번째는 due가 나오고, 3번째부터 새 단어가 끼어든다.
- due가 아예 없으면 1번째부터 새 단어가 나온다.
- 새 단어는 `created_at DESC`(최근 추가) 순서다. 레거시 `/review`는 `ASC`(오래된 것부터)다.
- `weak` 모드도 `due_at <= now` 조건을 만족해야 한다. 기한 전 카드를 당기지 않는다.
- 취약 모드는 `listWeakness()`를 카드마다 다시 호출한다. 현재 규모에서는 문제없지만
  단어가 많아지면 캐싱 후보.

### 7.4 문제 화면

| 유형 | 화면 |
|---|---|
| `recognition` | 단어 + 발음 + (있으면) 4지선다 |
| `recognition` (보기 부족) | “뜻이 떠올랐나요?” + 알겠어요/모르겠어요 |
| `recall` | 한국어 뜻 + (있으면) 빈칸 예문 + 입력 |
| `cloze` | 빈칸 예문 + “힌트: 뜻 보기” + 입력 |
| `listening` | “발음 듣기” 버튼 + 입력 + “들리지 않아요” |

- 신규 `recognition`도 `/play`에서는 별도 소개 화면 없이 바로 4지선다로 나온다.
  (레거시 `/review`에는 소개 → 가리기 단계가 있다.)
- 진행률은 `answered / target_size`.
- 키보드 `1~4`로 보기 선택, `Space`/`Enter`로 계속.

### 7.5 답안 처리 순서

```text
POST /play/:id/answer
  1. 세션 소유권 확인
  2. 이미 완료됐거나 target_size에 도달했으면 결과 화면
  3. card_id로 카드 조회
  4. shown_at → response_ms 계산
  5. review_key = item.id (item.served_at)
  6. 유형별 채점
     - recognition: choice 문자열 비교 또는 fallback rating
     - recall/cloze/listening: gradeAnswer + give_up
  7. ratingFromQuiz()
  8. source = (session.mode === 'weak') ? 'weak' : 'review'
  9. saveReview() → cards UPDATE + reviews INSERT (batch, 트리거가 item 검증)
 10. saved이면 afterSavePlay(); 트리거가 item 답변/세션 활동 갱신
 11. sample/always 모드면 선택적 확신도 프롬프트 표시
 12. 피드백 HTML 반환
```

`afterSavePlay()`:

- `maybeUnlockRecall`
- `maybeUnlockCloze`
- `maybeUnlockListening`
- `maybeSuspendLeech`

모두 best-effort. 실패해도 이미 저장된 리뷰를 막지 않는다.

### 7.6 세션 완료

- `answered >= target_size`이면 `completed_at` 기록.
- 다음 카드가 없으면 일찍 완료 처리하고 결과 화면.
- 결과 화면:
  - `한 판 완료`
  - `correct / answered 정답`
  - “한 판 더” (같은 모드, custom이면 같은 단어장)
  - “다른 모드”
  - “홈”
- 카드가 없어서 끝난 경우 “풀 카드가 없어요”와 “바로 시작”을 보여준다.

### 7.7 `/play`의 경계 조건

| 상황 | 동작 |
|---|---|
| due 0, new 0 | 시작 버튼 비활성, “풀 문제가 없습니다” |
| 모드에 해당 유형 due 0 | 결과 화면 “이 모드에 지금 풀 수 있는 카드가 없습니다” |
| 이미 완료된 세션 재접속 | 결과 화면 |
| 같은 문제 재전송 | `review_key`로 저장 1회만 |
| 같은 카드가 10분 내 재등장 | 제외 |
| 세션 중 앱 종료 | 답을 제출한 카드는 이미 저장됨. 다시 열면 다음 카드 |
| `custom`에 deck_id 없음 | 카드 없음 → 결과 |
| `custom`의 deck_id가 다른 사용자 것 | 카드 조회는 `c.user_id`로 제한되므로 남의 카드는 나오지 않음 |

### 7.8 오답 마무리

- 메인 목표(`target_size`)를 채운 뒤, 이번 판에서 틀린 `prompt` item을 최대 2개 재출제한다.
- 재출제 item은 `kind = 'wrapup'`, `bucket = 'wrapup'`으로 기록한다.
- `reviews`를 만들지 않는다. FSRS 일정과 `cards.due_at`을 변경하지 않는다.
- 오답 마무리 답변은 `play_session_items.correct`만 갱신한다.
- 결과 화면에 `오답 다시 보기 N / M`을 표시한다.
- 진행 중 세션이 목표를 채웠지만 오답 마무리가 남아 있으면 홈에서 “이어서” 대상이 된다.

### 7.9 학습 펄스

`/play` 홈 상단에 최근 학습 상태를 표시한다.

- 최근 20회 정확도
- 오늘 처리한 문제 수
- 최근 7일 학습일 수
- 피로도 배너
  - `high_load`: 오늘 40문제 이상 또는 `overdue > max(40, daily_review * 2)`
  - `tired`: 최근 20회 중 10회 이상이고 정확도 70% 미만 또는 이전 20회 대비 15%p 이상 하락
- 배너는 강제 제한이 아니라 휴식/복습 중심을 권하는 안내다.

---

## 8. 레거시 하루 학습 — `/review`

> 현재 내비게이션에는 노출되지 않는다. `/stats` CTA도 `/play`로 이동한다.
> `/play`와 달리 하루 계획·쿼터·적응형 신규 배분을 사용한다.

### 8.1 하루 계획 스냅샷

`GET /review` 첫 로드에서 `daily_plans`에 그날 계획을 고정한다.

```sql
INSERT INTO daily_plans (...)
VALUES (...)
ON CONFLICT(user_id, local_date) DO NOTHING
```

- 사용자가 설정을 바꿔도 당일 계획은 유지된다.
- 다음 날부터 새 설정이 반영된다.
- 목표가 0인 계획은 생성 즉시 `completed_at`을 기록한다.

### 8.2 계획 계산

입력:

| 값 | 정의 |
|---|---|
| `dueReview` | `state in (learning, review, relearning)`, `due_at <= now`, `suspended = 0` |
| `promotedDue` | `state = 'new'`, `card_type in (recall, cloze, listening)`, `due_at <= now` |
| `newAvailable` | `state = 'new'`, `card_type = 'recognition'` |
| `newDoneToday` | 오늘 `reps_before = 0 AND question_type = 'recognition'` |
| `reviewDoneToday` | 오늘 전체 리뷰 − `newDoneToday` |

쿼터:

```text
reviewCapacity = max(0, daily_review - reviewDoneToday)
reviewTarget   = min(dueReview, reviewCapacity)
promotedTarget = min(promotedDue, reviewCapacity - reviewTarget)
effectiveNew   = min(adaptiveNew(...), newLeft)  # 8.5, newLeft는 남은 신규 가능 수
```

우선순위: **복습 → 승급 → 신규**.

### 8.3 진행률

- 계획 생성 이후 리뷰 수를 센다 (`reviewed_at >= plan.created_at`, `source = 'review'`).
- 학습 스텝도 1장으로 센다.
- `done` = 일반 복습 + 승급 첫 리뷰 + 신규 첫 리뷰
- `target` = `reviewTarget + promotedTarget + effectiveNew`
- `remaining = max(0, target - done)`
- `completed = done >= target`
- 계획 완료 후 `completed_at` 기록.

### 8.4 세션 순서

```text
[1] 워밍업   최근 24시간 안에 Again을 받은 due 카드, 최대 5장
[2] 복습     dueReview, 유형 혼합 (recognition 50% · recall 30% · cloze 20%)
[3] 승급     promotedDue (recall / cloze / listening)
[4] 신규     처음 보는 recognition, effectiveNew 만큼
[5] 마무리   계획 완료 후 2시간 안에 Again을 받은 due 카드, 최대 5장
```

구현 세부:

- 워밍업: `progress.done < 5`일 때 `nextWarmupCard(now, now-24h)`.
- 마무리: `remaining <= 0`이고 `plan.completed_at`이 있을 때,
  `countReviewsSince(completed_at) < 5`이면 `nextWarmupCard(now, now-2h)`.
- 복습 블록: `selectNextType()`으로 유형 비율을 맞춘다.
- 해당 유형 due가 없으면 남은 유형 비율을 정규화한다.
- 유형 선택이 실패하면 아무 due 카드나 사용한다.
- 신규 블록은 `recognition`만, 승급 블록은 `recall/cloze/listening`만.
- 신규와 복습은 섞지 않는다.

유형 비율:

| 유형 | 기본 | 듣기 켠 경우 |
|---|---|---|
| `recognition` | 0.5 | 0.5 |
| `recall` | 0.3 | 0.3 |
| `cloze` | 0.2 | 0.2 |
| `listening` | — | 0.1 |

`selectNextType()`은 “목표 비율 − 현재 제공 비율”이 가장 큰 유형을 고른다.
동률이면 객체 순서(`recognition → recall → cloze → listening`)에서 먼저 나온 유형이 선택된다.

### 8.5 적응형 신규 배분

입력:

| 값 | 정의 |
|---|---|
| `base` | `users.daily_new` (5/10/20) |
| `overdue` | 기한 지난 복습 카드 수 |
| `throughput7` | 최근 7일 총 리뷰 수 / 7 |
| `adherence7` | 최근 7일 계획 완료율. 계획이 없으면 리뷰가 있는 날 / 7 |
| `mode` | `auto` / `fixed` |

계산:

```text
daysToClear = overdue / max(1, throughput7)

backlogFactor =
  overdue == 0     ? 1 :
  daysToClear > 14 ? 0 :
  daysToClear > 7  ? 0.5 :
  daysToClear > 3  ? 0.75 : 1

adherenceFactor = adherence7 >= 0.6 ? 1 : 0.85

factor = overdue == 0 ? 1 : min(backlogFactor, adherenceFactor)
adaptiveNew = clamp(floor(base * factor), 0, base)
effectiveNew = min(adaptiveNew, newLeft)  # 오늘 실제로 볼 수 있는 신규 수
```

원칙:

1. 복습이 밀리면 신규를 줄인다.
2. 최근 학습일이 적으면 완만하게 줄인다 (0.85배).
3. 복습 밀림이 없으면 완료율과 무관하게 기본값 유지.
4. 자동으로 기본값보다 늘리지 않는다.
5. 조정 이유를 화면에 표시한다.

이유 코드:

| reason | 조건 | 문구 |
|---|---|---|
| `no_backlog` | `overdue == 0` | 설정한 신규 N개 유지 |
| `heavy_backlog` | `daysToClear > 14` | 신규 0 |
| `moderate_backlog` | `daysToClear > 7` | 신규 절반 |
| `light_backlog` | `daysToClear > 3` | 신규 25% 감소 |
| `low_adherence` | `adherence7 < 0.6` | 최근 학습일이 적어 감소 |
| `fixed` | `new_card_mode = 'fixed'` | 설정값 고정 |
| `limited_new` | 사용 가능한 신규가 계산값보다 적음 | 가능한 만큼만 |

`fixed` 모드에서도 `daysToClear > 7`이면 `backlogWarning = true`로 경고한다.

### 8.6 예상 학습 시간

```text
avgSec[type] =
  최근 30일 response_ms 중앙값
  (표본 10건 미만이면 fallback)
  recognition 8초 / recall 18초 / cloze 20초 / listening 15초 / newIntro 25초

estimatedMinutes = ceil(
  (reviewTarget * reviewAvgSec
   + promotedTarget * promotedAvgSec
   + newTarget * 25) / 60
)
```

- 복습 평균은 due 카드 유형 분포로 가중 평균한다.
- 30분을 넘으면 “복습만 하거나 신규를 줄이세요”를 제안한다.

### 8.7 `/review` 화면과 엔드포인트

| Method | Path | 역할 |
|---|---|---|
| GET | `/review` | 오늘 계획 + 현재 카드 |
| GET | `/review?mode=weak` | 기한 도래 취약 단어 연습 |
| POST | `/review/next` | 다음 카드 |
| POST | `/review/:id/hide` | 신규 소개 → 뜻 가리기 |
| POST | `/review/:id/reveal` | 앞면 → 정답 |
| POST | `/review/:id/choice` | 영→한 4지선다 채점 |
| POST | `/review/:id/answer` | 한→영/빈칸/듣기 채점 |
| POST | `/review/:id` | 자기평가(폴백) 저장 |

화면 단계:

```text
recognition (reps = 0): intro → hide → choice → 결과
recognition (reps > 0): choice → 결과
recognition (보기 부족): front → reveal → back(자기평가) → 다음
recall / cloze / listening: front → answer → 결과
```

- 신규 소개 화면은 뜻을 보여주고 “가리고 확인하기”를 누르면 4지선다로 넘어간다.
- 자기평가 화면은 “답을 보기 전에 뜻이 떠올랐나요?”를 묻고,
  버튼에 다음 복습일 미리보기를 표시한다.
- 신규 카드(`reps = 0`)에는 `Hard`를 숨긴다.
- `Easy`는 주 버튼이 아니라 “아주 쉬웠어요” 텍스트 링크다.

### 8.8 완료 화면

- `오늘 계획 완료` 또는 `오늘은 다 했어요`
- 오늘 복습한 장 수
- 복습 상한 때문에 남은 due가 있으면 “남은 N장은 내일”
- 취약 단어 목록/대시보드 링크

---

## 9. 취약(weak) · 격리(leech) · 관찰 · 재확인

### 9.1 weak의 계산 단위

- **카드 단위**로 계산하고, **단어 점수는 카드 점수의 최댓값**으로 집계한다.
- 이유: 영→한은 안정적인데 한→영만 계속 틀리는 단어를 놓치지 않기 위해서다.
- `listening`은 켠 사용자만 계산에 포함한다.
- 단어의 대표 방향(`weakestDirection`)은 점수가 가장 높은 카드의 유형이다.

### 9.2 입력값

| 값 | 출처 |
|---|---|
| `recentN`, `recentErrors` | 최근 20회 리뷰 |
| `totalN`, `totalErrors` | 전체 리뷰 |
| `lapses` | `cards.lapses` |
| `stability` | `cards.stability` |
| `lastReviewedAt` | `cards.last_reviewed_at` |
| `quizWrongs` | 최근 30일 퀴즈 오답 수 |

### 9.3 점수식

```text
recentErrorRate = recentErrors / recentN
totalErrorRate  = totalErrors / totalN

if lastReviewedAt > 90일 전:
    status = stale

elif recentN < 5:
    status = observing

else:
    errorRate =
      recentN < 20 ? 0.7 * recentErrorRate + 0.3 * totalErrorRate
                   : recentErrorRate

    baseScore =
      0.5 * errorRate
      + 0.3 * min(1, lapses / 8)
      + 0.2 * (1 - min(1, stability / 21))

    quizBoost = min(0.15, 0.03 * quizWrongs)
    score = min(1, baseScore + quizBoost)

    status =
      score >= 0.6 ? weak :
      score >= 0.35 ? attention : good
```

### 9.4 실제 조회 대상

`listWeakness()`의 SQL 조건:

- `suspended = 0`
- `state IN ('review','relearning')`
- `reps >= 5`
- `last_reviewed_at >= now - 90일`

따라서:

- `learning` 카드는 취약 평가에서 제외된다.
- `new` 카드도 제외된다.
- `stale`과 `observing`은 `listWeakness()`가 아니라 별도 쿼리로 보여준다.
  - `listObservingWords()`: `reps > 0`, `MAX(reps) < 5`
  - `listStaleWords()`: `state review/relearning`, `last_reviewed_at < now - 90일`

### 9.5 상태와 화면

| 상태 | 조건 | 화면 |
|---|---|---|
| `observing` | 리뷰 5회 미만 | “관찰 중” |
| `stale` | 90일 이상 경과 | “재확인 필요” |
| `weak` | `score >= 0.6` | “취약” |
| `attention` | `score >= 0.35` | “주의” |
| `good` | `score < 0.35` | “양호” |
| `leech` | `suspended = 1` | “격리” |

- 표본 수(`recentN`)에 따라 신뢰도를 함께 표시한다.
  - `recentN >= 20`: 높음
  - `recentN >= 10`: 보통
  - 그 미만: 데이터 부족 (`N/20`)
- `factors`에 최근 오답률, lapses, 낮은 안정성, 퀴즈 오답 수를 함께 계산한다.

`/hard` 탭:

1. **취약** — weak + attention. 단어, 뜻, 취약 방향, 신뢰도, 최근 20회 오답 수,
   누적 lapses, 마지막 리뷰, 퀴즈 오답 수. weak 우선·신뢰도 높은 순으로 정렬. 최대 200개 렌더.
2. **관찰 중** — reps 1~4. 취약 목록에 포함된 단어는 제외.
3. **격리** — suspended 카드. 연상법 작성/복귀.
4. **재확인 필요** — 취약 탭 하단에 접어서 표시.

취약 탭 상단의 “취약 단어 연습”은 `POST /play/start` + `mode=weak`로 이동한다.
기한 도래 취약 카드가 없으면 “오늘은 기한이 도래한 취약 단어가 없습니다”를 보여준다.

### 9.6 weak 연습 정책

- **기한이 도래한 카드만** 출제한다. 기한 전 카드를 당기지 않는다.
- `/play?mode=weak`는 일일 쿼터를 사용하지 않는다.
- `/review?mode=weak`는 레거시이며 `daily_review` 상한을 함께 본다.
- `leech`는 weak 연습에 넣지 않는다.
- `source = 'weak'`로 기록해 일반 복습과 구분한다.

### 9.7 leech

- `lapses >= 8`이면 `cards.suspended = 1`.
- 큐에서 제외된다.
- `/hard?tab=leech`에서 사용자가 **연상법(mnemonic)** 을 직접 적는다.
  - 자기 생성 효과(generation effect)를 이용한다.
  - `words.note`에 저장되며, 해당 단어의 모든 카드 복습 화면에 표시된다.
- “다시 학습에 포함”을 누르면:
  - `suspended = 0`
  - `lapses = 0`
  - `due_at = now`
- leech를 weak 연습에 넣지 않는 이유: “지금 약한 단어”와 “잠시 내려놓은 단어”는 다르다.

---

## 10. 저장 · 중복 방지 · 복구

### 10.1 `saveReview()` 흐름

```text
1. schedule(row, now, rating, fsrsParams) → 다음 FSRS 상태 계산
2. review_key가 있으면 먼저 중복 조회
   SELECT 1 FROM reviews WHERE user_id = ? AND review_key = ?
   있으면 null 반환 (이미 처리됨)
3. D1 batch 실행
   a) UPDATE cards
        SET due_at, state, stability, difficulty, scheduled_days,
            learning_steps, reps, lapses, last_reviewed_at
        WHERE id = ? AND user_id = ? AND reps = ?
   b) INSERT INTO reviews (...)
        SELECT ...
        WHERE EXISTS (
          SELECT 1 FROM cards
           WHERE id = ? AND user_id = ? AND last_reviewed_at = ?
        )
4. batch 결과 확인
   - cards UPDATE 0행 → null (다른 요청이 먼저 처리)
   - reviews INSERT 0행 → 데이터 사고로 throw
5. 저장된 Scheduled 반환
```

### 10.2 중복 방지 장치

| 장치 | 역할 |
|---|---|
| `WHERE reps = ?` | 낙관적 락. 같은 카드 동시 제출 중 하나만 성공 |
| `review_key = item.id` (`/play`) / `card_id:shown_at` (`/review`) | 같은 프롬프트 재전송 식별 |
| `ux_reviews_user_review_key` | 동시에 같은 키가 들어와도 1건만 |
| `ux_reviews_card_instant(card_id, reviewed_at)` | 같은 밀리초 중복 방지 |
| `ux_reviews_card_date_attempt` | 같은 날짜 시도 순번 중복 방지 |

### 10.3 리뷰 로그 필드

- `question_type`: 카드 유형을 리뷰 시점에 복사
- `answer`: 사용자 선택/입력 (최대 200자)
- `is_correct`: `rating >= 2`
- `grading_source`: `self` / `server`
- `response_ms`: 서버 계산, 0~300000
- `review_key`: `/play`는 `play_session_items.id`, 레거시 `/review`는 `card_id:shown_at`
- `attempt_seq`: 같은 카드·같은 날짜의 기존 리뷰 수 + 1
- `source`: `review` / `weak`
- `session_id`: 플레이 세션
- `next_state`, `next_due_at`: `schedule()` 결과

### 10.4 로그와 카드의 일관성

`cards`가 진실원, `reviews`는 감사 로그다. 최신 리뷰의 `next_state`/`next_due_at`과
카드가 어긋난 건을 찾는 점검 쿼리를 둔다.

```sql
SELECT c.id, c.state, c.due_at, r.next_state, r.next_due_at
  FROM cards c
  JOIN (
    SELECT card_id, next_state, next_due_at,
           ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY reviewed_at DESC) AS rn
      FROM reviews
     WHERE next_state IS NOT NULL
  ) r ON r.card_id = c.id AND r.rn = 1
 WHERE c.state != r.next_state
    OR c.due_at != r.next_due_at;
```

- 마이그레이션 후, 배포 후, 테스트에서 0건인지 확인한다.
- 어긋난 건이 있으면 카드가 우선이다.

### 10.5 앱 종료·복구

- 학습 상태는 **응답 1건마다** 저장한다. 세션 전체를 메모리에 들고 있지 않는다.
- 보기를 고르기 전 종료: 리뷰 없음. 카드는 그대로 due.
- 정답 확인 후 다음 카드 전 종료: 리뷰는 이미 저장됨.
- 제출 후 종료: 리뷰 저장됨. 다시 열면 다음 카드.
- `daily_plans` 덕분에 레거시 하루 계획은 재접속해도 유지된다.
- 클라이언트에 저장하는 학습 상태는 없다. 오프라인 큐도 없다.

### 10.6 알려진 제약

- `answer` 계열 엔드포인트는 카드가 실제로 due인지 확인하지 않는다.
  due가 아닌 카드에 대한 새 제출도 저장될 수 있다. (브라우저 뒤로가기 정도의 위험)
- `/play`는 `ensureUnlocks()`를 호출하지 않는다. 승급 복구는 `/review` 로드 시에만 일어난다.
- `saveReview()`의 `attempt_seq`는 batch 안에서 `COUNT(*) + 1`로 계산한다.
  동시 제출은 유니크 인덱스가 최종 방어한다.

---

## 11. 통계와 지표

### 11.1 외운 단어 (`learnedCount`)

현재 구현:

```sql
SELECT COUNT(*) FROM words w
 JOIN decks d ON d.id = w.deck_id
WHERE d.user_id = ?
  AND EXISTS (
    SELECT 1 FROM cards r
     WHERE r.word_id = w.id AND r.user_id = ?
       AND r.card_type = 'recognition'
       AND r.state = 'review'
       AND r.scheduled_days >= 21
  )
  AND EXISTS (
    SELECT 1 FROM cards p
     WHERE p.word_id = w.id AND p.user_id = ?
       AND p.card_type IN ('recall','cloze')
       AND p.scheduled_days >= 7
  )
```

의미:

- 영→한이 `review` + 21일 이상.
- 생산형(한→영/빈칸) 카드가 1장 이상 있고, 그중 하나가 7일 이상.
- 카드 수가 아니라 **고유 단어 수**로 센다.
- 생산형 카드가 없으면 아직 “외운 단어”가 아니다.

문서상 `Mastered` 정의(영→한 60일 + 생산형 21일)는 있지만,
현재 통계 화면/쿼리에는 `Mastered` 집계가 별도로 구현되어 있지 않다.

### 11.2 정확도

- `rangeSummary()`: 선택 기간 리뷰 중 `rating >= 2` 비율.
- `dailyStats()`: 날짜별 전체/정답 수.
- `Again`만 오답이다. `Hard/Good/Easy`는 정답이다.
- `/stats`는 7/14/30일 범위를 지원한다.

### 11.3 오늘 학습 / 연속 학습

- 오늘 학습: `local_date = 오늘`인 리뷰 수.
- 연속 학습:
  - `reviews.local_date`의 distinct 값을 최근 400개 조회.
  - 오늘 리뷰가 있으면 오늘부터, 없으면 어제부터 거꾸로 센다.
  - 중간에 빠진 날이 있으면 거기서 끊긴다.

### 11.4 계획 완료율 (레거시)

- `getCompletion7()`: 최근 7일 `daily_plans` 중 `completed_at`이 있는 날 / 계획이 있는 날.
- 계획이 없는 날은 분모에서 제외한다.
- `/play`만 쓰는 사용자는 계획이 없으므로 “표본 부족”으로 표시된다.

### 11.5 통계 화면 구성

`/stats`:

- 기간 탭: 7일 / 14일 / 30일
- 정확도 링:
  - `correct / total` (%)
  - 최근 N일 총 리뷰 수
- 요약 카드:
  - 외운 단어 (`learnedCount`)
  - 연속 학습 (`streak`)
  - 오늘 학습 (`countOn`)
- 숙련도 분포 (`word_mastery` 뷰)
  - 마스터 / 외운 / 익숙 / 학습 중 / 새 단어
- 이번 주 리포트
  - 이번 주 리뷰 수·학습일·정확도
  - 지난 주 대비 리뷰 수·정확도
  - 최장 연속 학습일
- 학습 펄스 배너 (정확도 하락·과부하)
- 일별 막대 그래프
- 최근 7일 계획 완료율 (레거시 `daily_plans`)
- “자주 보는 곳”: 단어장 / 취약 단어 / 격리된 단어
- 하단 CTA: **“오늘 학습 시작” → `/play`**

---

## 12. 설정

### 12.1 사용자 설정 필드

| 설정 | 값 | 현재 영향 |
|---|---|---|
| 표시 이름 | 최대 40자 | 화면 표시 |
| 하루 신규 단어 | 5 / 10 / 20 | 레거시 `/review` |
| 한 판 문제 수 | 5 / 10 / 20 | `/play` |
| 한 판에 섞을 새 단어 | 0 / 1 / 2 / 3 / 5 | `/play` |
| 신규 단어 배분 | 자동 / 고정 | 레거시 `/review` |
| 하루 복습 상한 | 10 ~ 1000 | 레거시 `/review` |
| 듣기 카드 | 사용 안 함 / 사용 | 듣기 카드 생성, `/play` 듣기 모드 |
| 발음 | 미국식 / 영국식 | TTS |
| 재생 속도 | 0.7 ~ 1.2 | TTS |

### 12.2 FSRS 개인화

- 리뷰 1,000건 이상이면 최적화 준비 상태를 표시한다.
- `GET /settings/fsrs/export`:
  - JSON 파일 (`wordy-fsrs-reviews.json`)
  - `card_id, rating, reviewed_at, elapsed_days, scheduled_days, reps_before,
    prev_state, question_type, is_correct, source`
- `POST /settings/fsrs`:
  - 21개 숫자 배열만 허용
  - `users.fsrs_params`에 JSON 저장
  - 즉시 스케줄에 반영
- `POST /settings/fsrs/reset`:
  - `fsrs_params = NULL`
  - 기본 파라미터로 복귀

### 12.3 로그인

- `DEV_LOGIN=true`이면 “로컬 개발 계정으로 시작” (`dev@local`).
- Google OAuth:
  - scope `openid email profile`
  - `state` 쿠키로 CSRF 방지
  - 사용자 정보의 email/name으로 `findOrCreateUser`
- 세션:
  - 30일
  - 토큰 원문은 쿠키에만, DB에는 SHA-256 해시
  - `httpOnly`, `sameSite=Lax`, HTTPS면 `secure`

---

## 13. 콘텐츠와 단어장

### 13.1 기본 콘텐츠

| 파일 | 내용 | 수 |
|---|---|---|
| `public/seeds/basic-1000.csv` | 명사·동사·형용사·부사·구동사 | 1,000 |
| `public/seeds/function-100.csv` | 관사·대명사·전치사·접속사·조동사 | 100 |

- 사용자가 “추가”하면 자기 단어장으로 복사된다.
- 기능어는 `recall` 승급 대상이 아니고 `cloze`로 검증한다.

### 13.2 CSV 형식

필수 5컬럼(순서 고정):

```text
term,meaning,pos,example,example_ko
```

선택 11컬럼:

```text
category,level,pronunciation,audio_url,collocations,synonyms,antonyms,
example_2,example_2_ko,example_3,example_3_ko
```

- `collocations`/`synonyms`/`antonyms`는 셀 안에서 `|`로 구분.
- 추가 예문은 `example_2`, `example_3` 최대 2개.
- BOM 허용. 알 수 없는 컬럼은 거부.
- 필수 헤더 순서가 다르면 거부.

### 13.3 임포트

- `importSeed()`:
  - 파일 내 같은 `term`은 1개만 저장.
  - 단어 + `recognition` 카드 + 추가 예문을 batch로 저장.
- `ux_words_deck_term(deck_id, term)`이 최종 중복 방지.
- 단어 추가 시 `addWord()`:
  - 단어 + `recognition` 카드 + 추가 예문을 batch로 저장.
  - 같은 단어장에 같은 표제어가 있으면 실패 → “이미 있는 단어입니다.”

### 13.4 내보내기

- `GET /decks/:id/export` → 기본 5컬럼.
- `GET /decks/:id/export?full=1` → 확장 16컬럼.
- Excel 한글 깨짐 방지를 위해 BOM을 붙인다.

### 13.5 단어 메타데이터

- `category`, `level`(A1~C2), `pronunciation`(IPA), `audio_url`
- `collocations`/`synonyms`/`antonyms`는 JSON 배열 문자열로 저장.
- `word_examples`에 추가 예문 저장.
- 복습 결과 화면에서:
  - 대표 예문 + 해석
  - 추가 예문 최대 2개
  - 함께 쓰는 표현
  - 유의어/반의어
  - 연상법(`words.note`)

---

## 14. 객관식 테스트 (`/quiz`)

### 14.1 목적

- 현재 기억을 확인하는 별도 테스트.
- **FSRS 스케줄을 바꾸지 않는다.**
- `cards`/`reviews`를 변경하지 않는다.

### 14.2 생성

- 10문제 / 20문제 선택.
- 단어가 4개 이상이고 서로 다른 뜻이 4개 이상이어야 한다.
- 진행 중이던 미완료 퀴즈 세션은 삭제한다.
- 단어를 무작위로 뽑고, 각 문제의 보기는:
  - 정답 뜻
  - 사용자의 다른 단어 뜻 3개
  - 무작위 순서

### 14.3 응답

- `quiz_questions`에 `chosen_index`, `is_correct`, `answered_at` 기록.
- `quiz_sessions.correct` 증가.
- 모든 문제에 답하면 `completed_at` 기록.
- 결과 화면: 점수, 정답률, 틀린 단어 목록.

### 14.4 취약 점수와의 연결

- 퀴즈 오답은 `quiz_questions.answered_at` 최근 30일 기준으로 집계.
- 취약 점수의 `quizBoost = min(0.15, 0.03 * 오답 수)`로만 반영.
- 퀴즈만으로 `weak`가 되지 않도록 상한이 있다.

---

## 15. 라우트 전체

| Method | Path | 인증 | 응답 | 역할 |
|---|---|---|---|---|
| GET | `/` | 선택 | 전체 | 랜딩/대시보드 |
| GET | `/login` | — | 전체 | 로그인 |
| POST | `/auth/dev` | — | 302 | 로컬 개발 로그인 |
| GET | `/auth/google` | — | 302 | Google OAuth 시작 |
| GET | `/auth/google/callback` | — | 302 | Google OAuth 콜백 |
| POST | `/logout` | 필요 | 302 | 로그아웃 |
| GET | `/play` | 필요 | 전체 | 모드 선택 |
| POST | `/play/start` | 필요 | 302 | 세션 생성 |
| GET | `/play/:id` | 필요 | 전체 | 문제/결과 |
| GET | `/play/:id/result` | 필요 | 전체 | 결과 |
| POST | `/play/:id/answer` | 필요 | 조각 | 채점 |
| POST | `/play/:id/next` | 필요 | 조각 | 다음 문제 |
| GET | `/review` | 필요 | 전체 | 레거시 오늘 학습 |
| GET | `/review?mode=weak` | 필요 | 전체 | 레거시 취약 연습 |
| POST | `/review/next` | 필요 | 조각 | 다음 카드 |
| POST | `/review/:id/hide` | 필요 | 조각 | 신규 소개 → 가리기 |
| POST | `/review/:id/reveal` | 필요 | 조각 | 정답 공개 |
| POST | `/review/:id/choice` | 필요 | 조각 | 4지선다 채점 |
| POST | `/review/:id/answer` | 필요 | 조각 | 입력 채점 |
| POST | `/review/:id` | 필요 | 조각 | 자기평가 |
| GET | `/decks` | 필요 | 전체 | 단어장 목록 |
| POST | `/decks` | 필요 | 302 | 단어장 생성 |
| GET | `/decks/:id` | 필요 | 전체 | 단어 목록 |
| DELETE | `/decks/:id` | 필요 | 조각 | 단어장 삭제 |
| POST | `/decks/:id/words` | 필요 | 조각 | 단어 추가 |
| DELETE | `/words/:id` | 필요 | 조각 | 단어 삭제 |
| GET | `/decks/:id/export` | 필요 | 파일 | CSV 내보내기 |
| POST | `/seeds/:slug` | 필요 | 302 | 기본 단어장 임포트 |
| GET | `/hard` | 필요 | 전체 | 취약/관찰/격리 |
| POST | `/hard/:cardId/note` | 필요 | 302 | 연상법 저장 |
| POST | `/hard/:cardId/resume` | 필요 | 302 | 격리 해제 |
| GET | `/stats` | 필요 | 전체 | 통계 |
| GET | `/quiz` | 필요 | 전체 | 퀴즈 설정 |
| POST | `/quiz/start` | 필요 | 302 | 퀴즈 생성 |
| GET | `/quiz/session` | 필요 | 전체 | 현재 문제 |
| POST | `/quiz/answer` | 필요 | 조각 | 채점 |
| POST | `/quiz/next` | 필요 | 조각 | 다음 문제 |
| GET | `/settings` | 필요 | 전체 | 설정 |
| POST | `/settings` | 필요 | 302 | 설정 저장 |
| GET | `/settings/fsrs/export` | 필요 | 파일 | FSRS 로그 |
| POST | `/settings/fsrs` | 필요 | 302 | 가중치 적용 |
| POST | `/settings/fsrs/reset` | 필요 | 302 | 기본값 복귀 |
| GET | `/terms` | — | 전체 | 이용약관 |
| GET | `/privacy` | — | 전체 | 개인정보처리방침 |
| GET | `/design` | — | 전체 | 디자인 시스템 |

---

## 16. 파일 지도 (학습 관련)

| 역할 | 파일 |
|---|---|
| FSRS 래퍼·가중치 | `src/lib/srs.ts` |
| 철자 채점·빈칸·글자 비교 | `src/lib/grade.ts` |
| 자동 평점 | `src/lib/rating.ts` |
| 취약 점수 | `src/lib/weak.ts` |
| 취약/관찰/재확인 쿼리 | `src/db/weak.ts` |
| 리뷰 저장·승급·leech | `src/db/review.ts` |
| 플레이 세션·카드 선택 | `src/db/play.ts` |
| 플레이 순수 규칙 | `src/lib/play.ts` |
| 플레이 라우트/화면 | `src/routes/play.tsx` |
| 레거시 하루 계획 | `src/db/plan.ts` |
| 적응형 신규 배분 | `src/lib/adaptive.ts` |
| 유형 혼합·예상 시간 | `src/lib/session.ts` |
| 레거시 쿼터 | `src/lib/quota.ts` |
| 레거시 학습 화면 | `src/routes/review.tsx` |
| 취약/격리 화면 | `src/routes/hard.tsx` |
| 통계 쿼리 | `src/db/stats.ts` |
| 통계 화면 | `src/routes/stats.tsx` |
| 퀴즈 | `src/db/quiz.ts`, `src/routes/quiz.tsx` |
| 단어장/CSV | `src/db/queries.ts`, `src/lib/csv.ts`, `src/routes/decks.tsx` |
| 설정/FSRS | `src/routes/settings.tsx` |
| 공통 레이아웃/TTS/키보드 | `src/components/layout.tsx` |

---

## 17. 현재 불일치·주의사항

1. **문서와 현재 메인 경로**
   - `docs/06`, `docs/07` 5~6절은 하루 계획·쿼터·적응형 배분을 설명한다.
   - 현재 메인은 `/play`이고, 이 로직은 `/review` 레거시에만 적용된다.
   - `docs/07` 상단에는 M7 변경 안내가 있지만 본문은 M6 기준이다.

2. **통계 화면 CTA**
   - `/stats` 하단 “오늘 학습 시작”이 `/review`로 연결되어 있다.
   - 홈·내비게이션의 학습은 `/play`다.

3. **설정 화면의 레거시 항목**
   - `하루 신규 단어`, `신규 단어 배분`, `하루 복습 상한`은 `/review`에만 영향을 준다.
   - `/play` 사용자에게는 효과가 없는 설정이 그대로 노출된다.

4. **승급 복구**
   - `ensureUnlocks()`는 `/review` GET에서만 호출된다.
   - `/play`만 쓰는 사용자는 승급 실패가 있어도 `/review`를 열기 전까지 복구되지 않는다.
   - 정상 경로에서는 `afterSavePlay()`가 승급을 시도하므로 빈도는 낮다.

5. **Mastered 지표**
   - 문서에는 Known/Mastered 정의가 있지만, 현재 통계에는 Known(외운 단어)만 집계된다.
   - Mastered/취약/격리 단어 수를 대시보드에 함께 보여주지 않는다.

6. **레거시 경로 접근**
   - `/review`는 내비게이션에서 숨겨져 있지만 URL로 접근 가능하다.
   - 통계 CTA 때문에 실수로 레거시로 진입할 수 있다.

7. **`new_per_session` 폴백**
   - `getSessionUser()`는 `Number(row.new_per_session) || 0`을 쓴다.
   - DB 값이 NULL이면 0이 된다. 신규 사용자는 기본 2로 생성되므로 일반적이지 않지만,
     아주 오래된 row에는 0으로 보일 수 있다.

8. **`/play` custom 모드의 deck 소유권**
   - 세션 생성 시 `deck_id`의 소유권을 별도로 검증하지 않는다.
   - 카드 조회는 `c.user_id`로 제한되므로 다른 사용자의 카드가 노출되지는 않는다.
   - 다만 남의 deck_id로 빈 세션을 만들 수는 있다.

9. **`getMeaningChoices` 성능**
   - 매 문제마다 `ORDER BY RANDOM()`으로 보기 후보를 뽑는다.
   - 단어 1,100개 규모에서는 충분하지만, 수만 개가 되면 후보 풀 캐싱이 필요하다.

10. **`/play` weak 모드 성능**
    - 카드 1장을 고를 때마다 `listWeakness()`를 다시 실행한다.
    - 취약 단어가 많아지면 세션 시작 시 한 번 계산해 캐시하는 편이 좋다.

---

## 18. 테스트·검증

### 18.1 실행

```bash
npm run typecheck
npm test
npm run check:seed
```

### 18.2 `scripts/test-m6.test.mjs`가 검증하는 것

- 마이그레이션 0004 백필: 기존 리뷰 보존, `is_correct`, `grading_source`,
  `attempt_seq`, 인덱스
- `getMeaningChoices`: 정답 뜻 + 다른 뜻 3개, 단어 1개면 빈 배열
- 플레이: 세션 생성, 같은 카드 반복 방지, `session_id` 기록, custom 최신순
- 플레이: due 카드가 새 단어보다 먼저
- `saveReview`: 카드+리뷰 원자 저장, 낙관적 락, 같은 날 `attempt_seq` 증가
- `saveReview`: 같은 `review_key` 재전송 시 카드 상태 불변
- `saveReview`: Hard 정답/Again 오답/weak source 구분
- `getProgress`: `daily_review` 상한과 승급/신규 쿼터 분리
- 통계: Hard 정답, Again 오답
- `learnedCount`: 카드 수가 아닌 고유 단어 수
- weak: weak/attention/observing/stale/leech 분류, 방향, quiz boost, due 연습
- plan: 미리보기/스냅샷/진행률/완료 기록
- CSV: 5컬럼/확장 컬럼, 알 수 없는 컬럼 거부, 라운드트립
- FSRS: 21개 가중치 파싱, 사용자 파라미터 스케줄/미리보기
- `ensureUnlocks`: listening_enabled일 때만 듣기 카드, 멱등 복구
- `saveReview`: listening 카드의 `question_type`/`grading_source`

### 18.3 `scripts/test-play.test.mjs`

- 모드 정규화 (`listening` 꺼짐 → `quick`, 알 수 없는 모드 → `quick`)
- 세션 크기 1~20, 새 단어 수 0~10 clamp
- 모드별 카드 유형

### 18.4 수동 확인 체크리스트

- 신규 `recognition`: 소개 → 가리기 → 4지선다 → 결과 → 다음 복습일
- `recall`: 뜻 → 입력 → 채점 → 오타/오답 표시
- `cloze`: 예문 → 입력 → 채점
- `listening`: TTS 재생, 다시 듣기, 들리지 않아요
- 승급: 4일/7일 조건, 기능어 제외
- leech: 8회 → 격리 → 연상법 → 복귀
- `/play`: 모드별 카드 유형, 한 판 완료, 한 판 더
- `/quiz`: 10/20문제, 결과, 오답 목록
- `/stats`: 정확도, 외운 단어, 연속 학습, 그래프
- CSV: 1,000 + 100 임포트, 기본/전체 내보내기
- KST 23:59 / 00:01 `local_date` 경계
- 두 탭에서 같은 카드 제출 → 1회만 저장
- PWA 설치, 오프라인 앱 셸

---

## 19. 정리하면 좋은 후속 작업

우선순위 제안:

1. **문서 정리**
   - `docs/06`, `docs/07`을 “현재 `/play`”와 “레거시 `/review`”로 분리하거나,
     06/07 상단에 레거시 표시를 명확히 한다.
   - 이 문서(`09`)를 기준 문서로 두고 06/07은 설계 배경으로 남긴다.

2. **`/stats` CTA를 `/play`로 변경**
   - “오늘 학습 시작” → `/play`.
   - 레거시 `/review`는 별도 링크나 숨김 처리.

3. **설정 화면 정리**
   - `하루 신규 단어`, `신규 단어 배분`, `하루 복습 상한`을 “레거시 하루 학습” 섹션으로 묶거나 숨긴다.
   - 현재 메인 설정인 `한 판 문제 수`, `한 판에 섞을 새 단어`를 강조한다.

4. **승급 복구를 `/play`에도 연결**
   - `/play` GET에서 `ensureUnlocks()`를 best-effort로 호출하거나,
     세션 시작 시 한 번만 호출한다.

5. **지표 확장**
   - `Mastered` 단어 수, `weak`, `leech` 수를 `/stats`와 홈에 표시.
   - `/play` 기준 정확도·응답 시간 통계 추가.

6. **성능**
   - `/play` weak 모드의 `listWeakness()`를 세션 시작 시 1회 계산으로 변경.
   - 객관식 보기 후보를 캐싱하거나 `ORDER BY RANDOM()` 비용을 줄인다.

---

## 20. 요약 문장

> Wordy는 단어 하나를 여러 장의 카드로 나누고, 카드마다 FSRS로 다음 복습일을 정한다.
> 사용자는 뜻을 고르거나 철자를 입력하며 기억에서 답을 꺼내고, 서버는 정답 여부와 응답 시간으로
> 평점을 자동 계산한다. 현재는 하루 목표 없이 5문제 한 판을 도는 `/play`가 메인이고,
> 하루 계획·쿼터·적응형 배분을 쓰는 `/review`는 레거시로 남아 있다.
