# Wordy — 현재 영어 단어 암기 시스템 리뷰 브리프

> **사용법**: 이 문서 전체를 다른 LLM에 붙여넣고, 맨 끝의 「리뷰 요청」까지 함께 보내면 됩니다.
> 기준일: 2026-11-05, 저장소 `wordy`의 현재 코드 기준. 문서보다 코드를 우선했습니다.
> 이 문서는 앱 명세가 아니라 **외부 리뷰용 스냅샷**입니다.

---

## 0. 한 줄 요약

Wordy는 “단어장 뷰어”가 아니라 **인출(retrieval) 훈련기**다.
단어 1개에 여러 장의 카드(영→한, 한→영, 빈칸, 듣기)를 만들고, 카드마다 FSRS 상태를 따로 관리한다.
사용자가 답을 꺼내게 하고, **정답 여부 + 응답 시간**으로 자동 평점을 매긴 뒤, FSRS가 다음 복습일을 정한다.
메인 학습 경로는 **한 판 단위의 `/play`**이고, 하루 목표 기반의 `/review`는 레거시(리다이렉트)다.

---

## 1. 제품·기술 개요

| 항목 | 내용 |
|---|---|
| 제품 | 영어 단어 학습 PWA. “외우지 말고 꺼내세요.” |
| 타겟 | 한국어 사용자, 하루 10분 내외의 개인 학습 |
| 배포 | Cloudflare Workers (`https://wordy.choidaruhan.workers.dev`) |
| 런타임 | Cloudflare Workers |
| 프레임워크 | Hono v4 + `hono/jsx` SSR |
| 인터랙션 | HTMX 2.x. 서버가 HTML 조각을 반환 |
| 스타일 | Tailwind CSS v4, 빌드 타임 CLI |
| DB | Cloudflare D1 (SQLite), 바인딩 `DB` |
| SRS | `ts-fsrs` v6 (가중치 21개) |
| 클라이언트 JS | HTMX + 레이아웃에 인라인된 소량의 스크립트. React/번들러/hydration 없음 |
| 오프라인 | PWA 앱 셸만 캐시. 학습 상태/오프라인 큐는 없음 |
| 콘텐츠 | 기본 1,000단어 + 기능어 100단어 CSV 시드 |

핵심 제약:

- 서버 렌더 HTML이 기본. 학습 상태를 클라이언트에 저장하지 않는다.
- 응답 1건마다 즉시 DB에 저장한다. 세션 전체를 메모리에 들고 있지 않다.
- Cloudflare 무료 한도(Workers 10만 req/일, D1 reads/writes) 안에서 동작해야 한다.

---

## 2. 핵심 설계 원칙

1. **인출 연습(testing effect)**: 다시 읽는 것보다 기억에서 꺼내는 것이 오래 남는다.
2. **간격 효과(spacing effect)**: 같은 시간이면 몰아서보다 나눠서.
3. **스케줄의 단일 진실원은 `cards`**: `reviews`는 감사 로그·통계 원천이다.
4. **파생 상태는 저장하지 않는다**: 취약·관찰·재확인·외운 단어는 읽을 때 계산한다.
5. **퀴즈는 학습 스케줄을 바꾸지 않는다**: `/quiz`는 `cards`/`reviews`를 건드리지 않고, 취약 점수의 보조 신호로만 쓰인다.
6. **자동 조절은 줄이는 방향으로만**: 신규 단어를 자동으로 늘리지 않는다. 줄이면 이유를 화면에 보여준다.
7. **평점은 자기평가가 아니라 자동 채점**: 정답 여부와 응답 시간으로 Again/Hard/Good/Easy를 정한다.
8. **승급·격리는 best-effort**: 실패해도 리뷰 저장을 막지 않는다.

금지하는 것:

| 금지 | 이유 |
|---|---|
| 단어 목록을 훑어보게 하기 | 인출이 일어나지 않는다 |
| 뜻을 항상 같이 보여주기 | 꺼낼 필요가 없어진다 |
| 정답을 즉시 공개 | 애쓰는 시간이 학습량이다 |
| 하루에 200개 몰아주기 | 간격 효과가 사라진다 |

---

## 3. 데이터 모델

### 3.1 ERD

```text
users ─1:N─ decks ─1:N─ words ─1:N─ cards ─1:N─ reviews
   ├─────────────── sessions
   ├─────────────── daily_plans        (하루 목표 모드)
   ├─────────────── quiz_sessions ─1:N─ quiz_questions
   └─────────────── play_sessions ─1:N─ play_session_items

words ─1:N─ word_examples
```

### 3.2 주요 테이블

#### `users`

| 컬럼 | 의미 |
|---|---|
| `id`, `email`, `display_name` | 사용자 |
| `tz_offset_min` | 로컬 시간 오프셋(분), fallback |
| `timezone` | IANA 시간대 (`Asia/Seoul` 등), 있으면 우선 |
| `daily_new` | 하루 목표 모드의 신규 수 (5/10/20) |
| `daily_review` | 하루 목표 모드의 복습 상한 (10~1000) |
| `new_card_mode` | `auto` / `fixed` (하루 목표 모드에서만) |
| `learning_mode` | `session`(한 판) / `daily`(하루 목표). 기본 `session` |
| `session_size` | 한 판 문제 수 (5/10/20) |
| `new_per_session` | 한 판에 섞을 신규 수 (0/1/2/3/5) |
| `listening_enabled` | 듣기 카드 생성 여부 |
| `voice_locale`, `voice_rate` | TTS 발음/속도 |
| `fsrs_params` | 사용자별 FSRS 가중치 JSON number[21] |
| `last_unlock_check_at` | 승급 복구 throttle용으로 추가됐지만 현재 미사용 |

#### `words` / `decks`

- `words`: `term`, `meaning`, `pos`, `example`, `example_ko`, `note`(연상법), `category`, `level`(CEFR), `pronunciation`(IPA), `audio_url`, `collocations`, `synonyms`, `antonyms`.
- `word_examples`: 대표 예문 외 추가 예문 최대 2개.
- 같은 단어장에 같은 표제어 중복 금지 (`ux_words_deck_term`).
- 단어 추가/시드 임포트 시 `recognition` 카드를 함께 만든다.

#### `cards` — FSRS 상태의 진실원

| 컬럼 | 의미 |
|---|---|
| `card_type` | `recognition` / `recall` / `cloze` / `listening` |
| `due_at` | 다음 복습 시각(UTC ISO) |
| `state` | `new` / `learning` / `review` / `relearning` |
| `stability`, `difficulty` | FSRS 기억 안정성/난이도 |
| `scheduled_days` | 다음 복습까지 일수 |
| `learning_steps` | 학습 스텝 진행도 |
| `reps`, `lapses` | 리뷰 횟수, 잊은 횟수 |
| `last_reviewed_at` | 마지막 리뷰 시각 |
| `suspended` | 1 = leech로 큐에서 격리 |

제약:

- `ux_cards_word_type(word_id, card_type)` — 단어당 유형별 카드 1장.
- 카드 유형마다 FSRS 상태는 **독립**이다. 같은 단어라도 영→한과 한→영의 `due_at`은 다르다.

#### `reviews` — 감사 로그

기본: `rating`(1 Again / 2 Hard / 3 Good / 4 Easy), `local_date`, `reviewed_at`, `elapsed_days`, `scheduled_days`, `reps_before`, `prev_state`.

계측 컬럼:

| 컬럼 | 의미 |
|---|---|
| `question_type` | 리뷰 시점 카드 유형 |
| `answer` | 사용자가 선택/입력한 답 (최대 200자) |
| `is_correct` | `rating >= 2`이면 1 |
| `grading_source` | `self`(폴백 자기평가) / `server`(자동 채점) |
| `response_ms` | 자극→응답 시간 (0~300000) |
| `review_key` | 멱등키. `/play`는 `item.id`, 레거시는 `card_id:shown_at` |
| `attempt_seq` | 같은 카드·같은 날짜의 시도 순번 |
| `source` | `review` / `weak` |
| `next_state`, `next_due_at` | 리뷰 후 카드 상태/다음 due 스냅샷 |
| `session_id` | 플레이 세션 ID |
| `prompt_started_at` | 자극 시작 시각(듣기는 TTS 시작) |
| `first_input_at` | 첫 입력/선택 시각 |
| `confidence` | 0 모름 / 1 애매 / 2 확신. 현재 UI에서 수집하지 않음 |
| `rating_model_version` | 평점 모델 버전(현재 1) |
| `grading_reliability` | 0~1 채점 신뢰도(분석용, 평점에는 미사용) |

유니크 인덱스:

- `ux_reviews_user_review_key(user_id, review_key)` — 같은 요청 재전송 방지.
- `ux_reviews_card_instant(card_id, reviewed_at)` — 같은 밀리초 중복 방지.
- `ux_reviews_card_date_attempt(card_id, local_date, attempt_seq)`.

#### `play_sessions`

| 컬럼 | 의미 |
|---|---|
| `id`, `user_id` | 세션 |
| `mode` | `quick` / `typing` / `cloze` / `listening` / `weak` / `custom` |
| `target_size` | 목표 문제 수 |
| `review_target`, `new_target`, `weak_target` | 버킷별 목표 |
| `policy`, `policy_reason` | `session`/`daily`와 계획 이유 |
| `status` | `active` / `completed` / `abandoned` / `expired` |
| `started_at`, `completed_at`, `last_activity_at`, `expires_at` | 생명주기 |
| `deck_id` | `custom` 모드의 단어장 |
| ~~`answered`, `correct`~~ | deprecated. `play_session_stats` 뷰에서 파생 |

#### `play_session_items`

| 컬럼 | 의미 |
|---|---|
| `id` | 멱등키로도 사용 (`review_key`) |
| `session_id`, `card_id` | 어떤 세션에서 어떤 카드를 냈는지 |
| `position` | 출제 순서 |
| `bucket` | `review` / `new` / `weak` / `custom_new` |
| `kind` | `prompt` (현재 `wrapup`은 미구현) |
| `served_at` | 출제 시각. `shown_at`으로 사용 |
| `answered_at`, `review_id`, `correct` | 답변 결과 |

제약:

- `UNIQUE(session_id, card_id, kind)`.
- `ux_play_session_items_pending(session_id) WHERE answered_at IS NULL AND kind='prompt'` — 한 세션에 미답변 문제는 하나만.
- `ux_play_session_items_review(review_id)` — 리뷰 1건은 item 1개에만 연결.

#### `daily_plans` — 하루 목표 스냅샷

- PK `(user_id, local_date)`.
- `base_new`, `effective_new`, `review_target`, `promoted_target`, `due_count`, `estimated_minutes`, `reason`, `created_at`, `completed_at`.
- `/review` 또는 daily 모드의 `/play` 첫 로드에서 `INSERT ... ON CONFLICT DO NOTHING`으로 고정. 당일 설정 변경은 반영되지 않는다.

#### `quiz_sessions` / `quiz_questions`

- 10/20문제 객관식 테스트.
- `cards`/`reviews`를 변경하지 않는다.
- 오답은 최근 30일 기준 취약 점수의 `quizBoost`로만 반영.

### 3.3 불변식

1. 모든 단어는 `recognition` 카드를 정확히 1장 가진다.
2. 카드 유형마다 FSRS 상태는 독립이다.
3. `state`와 `due_at`은 분리한다. `review` 상태여도 due가 도래할 수 있다.
4. 리뷰 1건은 `cards` UPDATE와 `reviews` INSERT가 **함께 성공**해야 한다.
5. 최신 로그와 카드가 어긋나면 **카드가 우선**이다.
6. 퀴즈는 `cards`/`reviews`를 변경하지 않는다.
7. `leech`는 `suspended = 1`이고 `weak`와 별개다.
8. 날짜는 UTC ISO로 저장하고, `local_date`는 **쓰기 시점**에 사용자 시간대로 계산한다.
9. 승급은 best-effort다. 실패해도 리뷰 저장은 유지된다.

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

- 기능어(관사·대명사·전치사·접속사·조동사)는 뜻→영어 답이 하나로 정해지지 않으므로 `recall`을 만들지 않는다. 기능어는 `cloze`가 출구다.
- 예문에 기본형이 없으면(굴절: `become → became`) `cloze`를 만들지 않는다. `blankOut()`은 정규식 단어 경계로 기본형만 찾는다.
- `listening`은 기본 꺼짐. 켠 사용자에게만 생성된다. 이미 만든 카드는 끄더라도 계속 복습된다.
- 승급 카드는 `state = 'new'`, `due_at = now`로 생성되고, 첫 리뷰는 신규 쿼터를 쓰지 않는다.

### 4.3 승급 실행

- 리뷰 저장 후 `maybeUnlockRecall/Cloze/Listening`을 best-effort로 실행.
- `INSERT OR IGNORE` + `ux_cards_word_type`으로 중복 방지.
- `/play` GET과 `/play/start`에서 `ensureUnlocks()`를 호출해 누락된 승급을 복구한다. (조건당 최대 50개)
- `last_unlock_check_at` 컬럼은 있으나 throttle에 쓰이지 않는다.

---

## 5. FSRS 엔진

### 5.1 기본 파라미터 (`src/lib/srs.ts`)

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

| ts-fsrs | D1 |
|---|---|
| `due: Date` | `due_at TEXT` (`.toISOString()`) |
| `state: State` | `state TEXT` (이름 매핑) |
| `stability`, `difficulty` | REAL 그대로 |
| `reps`, `lapses`, `learning_steps` | INTEGER 그대로 |
| `last_review` | `last_reviewed_at TEXT` |

### 5.4 `schedule()`

```ts
schedule(row, now, rating, params?) → {
  due_at, state, stability, difficulty, scheduled_days,
  learning_steps, reps, lapses, last_reviewed_at, elapsed_days
}
```

- `elapsed_days`는 마지막 리뷰 이후 경과일.
- `scheduled_days`는 ts-fsrs가 계산한 값. 0이면 `due - now`로 보정한다.
- `previewIntervals()`는 4개 평점별 다음 복습일을 한국어로 표시한다. 현재는 레거시 자기평가 폴백에서만 쓴다.

### 5.5 사용자별 가중치

- `users.fsrs_params`에 정확히 21개의 유한 숫자 배열만 허용.
- 잘못된 값은 `null`로 보고 기본 파라미터로 폴백.
- 가중치 문자열을 키로 스케줄러를 캐시.
- 설정에서 1,000건 이상 리뷰 시 FSRS 최적화용 리뷰 로그 JSON을 내려주고, 외부 옵티마이저가 계산한 21개 배열을 붙여넣어 적용한다.
- 1,000건 이전 튜닝은 과적합 위험이 있어 기본값 사용을 권장.

### 5.6 시간 처리

```ts
localDate(now, tzOffsetMin, timezone) =
  timezone
    ? Intl.DateTimeFormat('en-US', { timeZone: timezone, ... }).formatToParts(now)
        → 'YYYY-MM-DD'
    : new Date(now.getTime() + tzOffsetMin * 60_000)
        .toISOString().slice(0, 10)
```

- `due_at`은 절대 시각(UTC). “오늘 복습” 판정은 `due_at <= now`.
- streak·일일 상한은 `reviews.local_date`.
- IANA 시간대가 있으면 DST를 포함해 정확히 계산하고, 없거나 잘못됐으면 오프셋으로 폴백한다.

---

## 6. 채점 시스템

### 6.1 영→한 `recognition`

- 4지선다. 정답 뜻 + **사용자의 다른 단어 뜻 3개**를 무작위로 섞는다.
- 정답 판정: `normalize(choice) === normalize(card.meaning)`.
  - `normalize()`: 소문자화, 앞뒤 공백 제거, 연속 공백 1칸 축약.
- 보기가 2개 미만이면 객관식이 성립하지 않으므로 자기평가 화면으로 폴백한다.
  - “알겠어요” → `Good(3)`
  - “모르겠어요” → `Again(1)`
  - 이때만 `grading_source = 'self'`.
- 보기 생성 시 정답과 중복되는 뜻은 제거하지만, 유의어/반의어/품사 일치 여부는 고려하지 않는다.

### 6.2 한→영 / 빈칸 / 듣기

- 입력값을 `gradeAnswer(input, card.term)`로 채점한다.
- 정답이 여러 개면 `/`로 구분한다. 예: `ubiquitous / omnipresent`
- 오타 허용 거리(Levenshtein):

| 정답 길이 | 허용 거리 |
|---|---|
| 8자 이상 | 2 |
| 5~7자 | 1 |
| 4자 이하 | 0 |

- 결과:
  - 정확: `ok=true, typo=false`
  - 오타 허용: `ok=true, typo=true` → `Hard`
  - 오답: `ok=false`
- 결과 화면에서 글자 단위로 틀린 부분을 하이라이트한다.
- 듣기 카드의 “들리지 않아요”는 빈 답안 제출 → `Again`.
- 입력창은 `autocapitalize=off`, `autocorrect=off`, `spellcheck=false`.

### 6.3 자동 평점 (`ratingFromQuiz`)

```text
오답                                      → Again (1)
오타 허용                                 → Hard (2)
정답, response_ms > 8,000                 → Hard (2)
정답, 3,000 < response_ms <= 8,000        → Good (3)
정답, response_ms <= 3,000:
  생산형(recall/cloze/listening)          → Easy (4)
  recognition                             → Good (3)
response_ms 없음                          → Good (3)
```

- `recognition`은 찍어서 맞힌 경우를 구분하기 위해 `Easy`를 주지 않는다.
- 응답 시간은 서버가 `item.served_at` 기준으로 계산한다. 클라이언트 시각은 신뢰하지 않는다.
- `clampResponseMs()`: `0 ~ 300,000ms`로 보정.

### 6.4 평점 계측과 실제 평점의 분리

- `src/lib/rating-config.ts`에는 카드 유형별 타이밍 기준(`recognition 8s/12s`, `recall 18s/30s`, `cloze 20s/35s`, `listening 18s/30s`)이 있다.
- 그러나 이 값은 **`grading_reliability` 계산에만** 쓰이고, 실제 FSRS 평점은 모든 유형에 3초/8초 기준을 쓴다.
- `grading_reliability` = `0.45*correctness + 0.25*timing + 0.20*type + 0.10*confidence`.
- `confidence`는 UI에서 묻지 않으므로 현재 항상 `null`.
- `first_input_at`은 기록되지만 평점·응답 시간 계산에는 쓰이지 않는다.
- 듣기 카드의 `prompt_started_at`은 TTS 버튼을 누를 때 기록되지만, `response_ms`는 여전히 `item.served_at`부터 계산하므로 **TTS 재생 시간이 응답 시간에 포함된다.**

### 6.5 `self` vs `server`

| 경로 | `grading_source` |
|---|---|
| 영→한 4지선다 | `server` |
| 한→영/빈칸/듣기 입력 | `server` |
| 보기 부족으로 폴백한 영→한 자기평가 | `self` |
| 레거시 `/review`의 “뜻 보기 → 자기평가” | `self` |

---

## 7. 메인 학습 루프 — `/play`

### 7.1 진입과 세션 생성

```text
GET  /play            모드 선택 + 현재 풀 수 있는 수
POST /play/start      play_sessions 생성 → /play/:id
GET  /play/:id        현재 문제 또는 결과
POST /play/:id/answer 채점 → 피드백
POST /play/:id/next   다음 문제 또는 결과
POST /play/:id/abandon 중단
GET  /play/:id/result 결과
```

- `POST /play/start`는 항상 새 세션을 만든다. **active 세션 재사용/`new=1`은 구현되어 있지 않다.**
- 듣기 모드는 `listening_enabled`가 꺼져 있으면 `quick`으로 정규화된다.
- 세션은 `started_at + 24h`에 만료되고, 6시간 무활동이면 `abandoned`로 전환된다.

### 7.2 모드

| 모드 | 라벨 | 출제 카드 | 신규 포함 |
|---|---|---|---|
| `quick` | 바로 시작 | 모든 유형의 due + 새 `recognition` | O (`new_per_session`) |
| `typing` | 철자 도전 | `recall` + `cloze` due | X |
| `cloze` | 빈칸 퀴즈 | `cloze` due | X |
| `listening` | 듣기 퀴즈 | `listening` due | X |
| `weak` | 취약 집중 | 취약/주의 단어의 due (모든 유형) | X |
| `custom` | 새 단어 연습 | 지정 단어장의 새 `recognition`만, 최신순 | O |

- 홈/플레이 화면에 노출되는 모드는 `quick, typing, cloze, listening, weak`.
- `custom`은 단어장 화면의 “이 단어장의 새 단어로 한 판”에서만 시작한다.
- `typing`은 이름과 달리 `recall`뿐 아니라 `cloze`도 포함한다.

### 7.3 계획 정책 (`src/lib/learning-policy.ts`)

#### session 모드

```text
size = clamp(session_size, 1, 20)
newPer = clamp(new_per_session, 0, 10)

quick:
  reviewTarget = min(dueCount, size)
  newTarget    = min(newPer, size - reviewTarget, newCount)

typing:
  reviewTarget = min(recallDue + clozeDue, size)

cloze / listening:
  reviewTarget = min(typeDue, size)

weak:
  weakTarget = min(weakDueCount, size)

custom:
  newTarget = min(deckNewCount, size)

targetSize = reviewTarget + newTarget + weakTarget
```

- `targetSize`가 0이면 세션을 만들지 않고 `/play?empty=1`로 보낸다.
- **중요**: `quick`에서 due가 0이고 새 단어만 있으면 `targetSize = min(newPer, size)`가 된다. 즉 “한 판 5문제”로 설정해도 새 단어만 있는 단어장에서는 2문제만 나올 수 있다.

#### daily 모드

```text
remaining = max(0, plan.target - plan.done)
if remaining == 0 → goal_done
size = min(session_size, remaining)

reviewRemaining = plan.reviewTarget - plan.reviewDone
newRemaining    = plan.effectiveNew - plan.newDone

quick:
  reviewTarget = min(reviewRemaining, size)
  newTarget    = min(newRemaining, newPerSession, size - reviewTarget)

typing / cloze / listening:
  reviewTarget = min(유형별 due, reviewRemaining, size)

weak:
  weakTarget = min(weakDueCount, size, dailyReview - todayReviewDone)

custom:
  newTarget = min(deckNewCount, newRemaining, size)
```

- daily 모드의 `plan`은 `daily_plans` 스냅샷에서 온다.
- 신규 배분은 하루 목표 모드에서만 적응형(`computeAdaptiveNew`)을 쓴다. 세션 모드는 `new_per_session`만 쓴다.

### 7.4 카드 선택 알고리즘 (`selectNextPlayCard`)

```text
1. 모드별 카드 유형 필터 결정
   - typing  → recall, cloze
   - cloze   → cloze
   - listening → listening
   - 그 외   → 전체

2. 같은 세션에서 이미 낸 카드는 제외
   NOT EXISTS (reviews WHERE session_id = ? AND card_id = c.id)

3. due 카드는 최근 10분 안에 리뷰한 카드 제외
   last_reviewed_at IS NULL OR last_reviewed_at < now - 10분

4. custom 모드
   - deck_id가 없으면 null
   - 해당 단어장의 state='new' AND card_type='recognition'
   - created_at DESC (최근 추가한 단어부터)

5. quick 모드의 새 단어
   - servedNew < new_target
   - session.answered >= 2 (3번째 문제부터)
   - 새 카드가 있으면 due보다 먼저 반환

6. due 카드
   - state IN ('learning','review','relearning')
     OR (state='new' AND card_type != 'recognition')  -- 승급 카드
   - due_at <= now
   - 모드 유형 필터 적용
   - weak 모드면 취약 단어 ID 필터 적용
   - due_at ASC

7. quick 모드에서 due가 없으면 새 카드로 채움
   - 다른 모드는 새 카드를 억지로 넣지 않고 null 반환
```

주의:

- `quick`에서 due가 있으면 1~2번째는 due, 3번째부터 새 단어가 끼어든다. due가 아예 없으면 1번째부터 새 단어다.
- 새 단어 정렬은 일반 모드가 `created_at ASC`(오래된 새 단어부터), `custom`이 `DESC`다.
- `weak` 모드도 `due_at <= now`를 만족해야 한다. 기한 전 카드를 당기지 않는다.
- `weak` 모드는 다음 카드를 고를 때마다 `listWeakness()`를 다시 호출한다. 현재 규모에서는 문제없지만 단어가 많아지면 캐싱 후보.

### 7.5 문제 출제와 답안 원자성

```text
serveNextPlayCard(session):
  1. 같은 세션에 미답변 prompt item이 있으면 그대로 반환
     (새로고침해도 같은 문제, 같은 served_at)
  2. 없으면 정책에 따라 다음 카드 선택
  3. play_session_items INSERT
     - position = MAX(position)+1
     - served_at = now
     - bucket = 정책 버킷
  4. 카드 + item 반환

answer(sessionId, itemId, cardId, choice/answer):
  1. 세션 소유권/active 확인
  2. item = getPlaySessionItem(...)
     - item.kind == 'prompt'
     - item.answered_at IS NULL
     - item.card_id == cardId
  3. shown_at = item.served_at, review_key = item.id
  4. 유형별 채점
  5. saveReview() → cards UPDATE + reviews INSERT (batch)
  6. DB 트리거가 item 답변 완료/세션 활동 갱신
  7. 세션 카운터는 play_session_stats 뷰에서 파생
  8. afterSavePlay()로 승급/leech best-effort
  9. 피드백 HTML 반환
```

DB 트리거:

- `trg_reviews_require_play_item`: `session_id`가 있는 리뷰는 **active 세션 + 미답변 item**이 아니면 INSERT를 ABORT.
- `trg_reviews_mark_play_item`: 리뷰 INSERT 후 해당 item을 답변 완료로 표시.
- `trg_reviews_touch_play_session`: 세션 `last_activity_at` 갱신.
- `play_session_stats` 뷰: `answered`, `correct`, `last_answered_at`를 리뷰에서 계산.

`saveReview()`의 방어:

- `SELECT 1 FROM reviews WHERE user_id=? AND review_key=?`로 재전송 사전 차단.
- `UPDATE cards ... WHERE id=? AND user_id=? AND reps=?` 낙관적 락.
- `INSERT ... SELECT ... WHERE EXISTS (cards.last_reviewed_at = ?)`로 UPDATE와 INSERT를 같은 batch에 묶는다.
- UPDATE 0행 → `null` (다른 요청이 먼저 처리).
- INSERT 0행 → 데이터 사고로 throw.
- 유니크 위반/세션 가드 위반 → `null`로 중복 처리.

### 7.6 세션 상태 전환

```text
GET /play/:id
  1. active && expires_at < now → expired
  2. active && last_activity_at < now - 6h → abandoned
  3. active && answered >= target_size → completed
  4. completed → 결과 화면
  5. abandoned/expired → 중단 안내
```

- `POST /play/:id/answer`는 active일 때만 허용.
- 세션 완료 후 늦은 제출은 트리거가 막는다.
- 결과 화면: 완료/중단/만료, `correct / answered`, “한 판 더”, “다른 모드”, “홈”.

### 7.7 `/play`의 경계 조건

| 상황 | 동작 |
|---|---|
| due 0, new 0 | 시작 버튼 비활성, “풀 문제가 없습니다” |
| 모드에 해당 유형 due 0 | 결과 화면 “이 모드에 지금 풀 수 있는 카드가 없습니다” |
| 이미 완료된 세션 재접속 | 결과 화면 |
| 같은 문제 재전송 | `review_key`로 저장 1회만 |
| 같은 카드가 10분 내 재등장 | 제외 |
| 세션 중 앱 종료 | 답을 제출한 카드는 저장됨. 다시 열면 다음 카드 |
| custom에 deck_id 없음 | 카드 없음 → 결과 |
| custom의 deck_id가 다른 사용자 것 | 카드 조회는 `c.user_id`로 제한되어 남의 카드는 안 나옴 |

---

## 8. 하루 목표 모드 / 레거시 `/review`

- `LEGACY_REVIEW !== '1'`이면 `/review`는 `/play`로, `/review?mode=weak`은 `/play?intent=weak`로 302 리다이렉트한다.
- daily 모드로 설정한 사용자는 `/play`에서 `daily_plans` 스냅샷을 사용한다.
- `/review` 원본 코드는 남아 있으나 기본 경로가 아니다.

### 8.1 하루 계획 스냅샷

- `/play`(daily) 또는 `/review` 첫 로드에서 `daily_plans`에 그날 계획을 `ON CONFLICT DO NOTHING`으로 고정한다.
- 사용자가 설정을 바꿔도 당일 계획은 유지되고, 다음 날부터 반영된다.
- 목표가 0인 계획은 생성 즉시 `completed_at`을 기록한다.

### 8.2 계획 계산

| 값 | 정의 |
|---|---|
| `dueReview` | `state in (learning, review, relearning)`, `due_at <= now`, `suspended = 0` |
| `promotedDue` | `state = 'new'`, `card_type in (recall, cloze, listening)`, `due_at <= now` |
| `newAvailable` | `state = 'new'`, `card_type = 'recognition'` |
| `newDoneToday` | 오늘 `reps_before = 0 AND question_type = 'recognition'` |
| `reviewDoneToday` | 오늘 전체 리뷰 − `newDoneToday` |

```text
reviewCapacity = max(0, daily_review - reviewDoneToday)
reviewTarget   = min(dueReview, reviewCapacity)
promotedTarget = min(promotedDue, reviewCapacity - reviewTarget)
effectiveNew   = min(adaptiveNew(...), newLeft)
```

우선순위: **복습 → 승급 → 신규**.

### 8.3 적응형 신규 배분

```text
daysToClear = overdue / max(1, throughput7)

backlogFactor =
  overdue == 0     ? 1 :
  daysToClear > 14 ? 0 :
  daysToClear > 7  ? 0.5 :
  daysToClear > 3  ? 0.75 : 1

adherenceFactor = adherence7 >= 0.6 ? 1 : 0.85
factor = overdue == 0 ? 1 : min(backlogFactor, adherenceFactor)
adaptiveNew = clamp(floor(daily_new * factor), 0, daily_new)
effectiveNew = min(adaptiveNew, newAvailable)
```

- 원칙: 복습이 밀리면 신규를 줄인다. 자동으로 기본값보다 늘리지 않는다.
- `new_card_mode = 'fixed'`이면 자동 조절을 하지 않고 경고만 한다.
- 이유 코드: `no_backlog`, `heavy_backlog`, `moderate_backlog`, `light_backlog`, `low_adherence`, `fixed`, `limited_new`.
- `throughput7` = 최근 7일 총 리뷰 / 7.
- `adherence7` = 최근 7일 계획 완료율. 계획이 없으면 리뷰가 있는 날 / 7.

### 8.4 세션 순서 (레거시 `/review`)

```text
[1] 워밍업   최근 24시간 안에 Again을 받은 due 카드, 최대 5장
[2] 복습     dueReview, 유형 혼합 (recognition 50% · recall 30% · cloze 20%)
[3] 승급     promotedDue (recall / cloze / listening)
[4] 신규     처음 보는 recognition, effectiveNew 만큼
[5] 마무리   계획 완료 후 2시간 안에 Again을 받은 due 카드, 최대 5장
```

- 신규와 복습은 섞지 않는다.
- `selectNextType()`은 “목표 비율 − 현재 제공 비율”이 가장 큰 유형을 고른다.
- 해당 유형 due가 없으면 남은 유형 비율을 정규화한다.

### 8.5 예상 학습 시간

```text
avgSec[type] = 최근 30일 response_ms 중앙값 (표본 10건 미만이면 fallback)
fallback: recognition 8초 / recall 18초 / cloze 20초 / listening 15초 / newIntro 25초

estimatedMinutes = ceil(
  (reviewTarget * reviewAvgSec
   + promotedTarget * promotedAvgSec
   + newTarget * 25) / 60
)
```

- 복습 평균은 due 카드 유형 분포로 가중 평균한다.
- 30분을 넘으면 “복습만 하거나 신규를 줄이세요”를 제안한다.

### 8.6 진행률·완료

- 계획 생성 이후 리뷰 수를 센다(`reviewed_at >= plan.created_at`, `source='review'`).
- 학습 스텝도 1장으로 센다.
- `done` = 일반 복습 + 승급 첫 리뷰 + 신규 첫 리뷰.
- `target` = `reviewTarget + promotedTarget + effectiveNew`.
- `completed = done >= target`.
- 계획 완료 후 `completed_at` 기록.

---

## 9. 취약(weak) · 격리(leech) · 관찰 · 재확인

### 9.1 계산 단위

- **카드 단위**로 계산하고, **단어 점수는 카드 점수의 최댓값**으로 집계한다.
- 이유: 영→한은 안정적인데 한→영만 계속 틀리는 단어를 놓치지 않기 위해서다.
- `listening`은 켠 사용자만 계산에 포함한다.
- 단어의 대표 방향(`weakestDirection`)은 점수가 가장 높은 카드의 유형이다.

### 9.2 평가 대상

`listWeakness()` SQL 조건:

- `suspended = 0`
- `state IN ('review','relearning')`
- `reps >= 5`
- `last_reviewed_at >= now - 90일`

따라서 `learning` 카드와 `new` 카드는 취약 평가에서 제외된다.

### 9.3 점수식

```text
recentErrorRate = recentErrors / recentN       # 최근 20회
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

    quizBoost = min(0.15, 0.03 * quizWrongs)   # 최근 30일 퀴즈 오답
    score = min(1, baseScore + quizBoost)

    status =
      score >= 0.6 ? weak :
      score >= 0.35 ? attention : good
```

### 9.4 상태와 화면

| 상태 | 조건 | 화면 |
|---|---|---|
| `observing` | 리뷰 5회 미만 | “관찰 중” |
| `stale` | 90일 이상 경과 | “재확인 필요” |
| `weak` | `score >= 0.6` | “취약” |
| `attention` | `score >= 0.35` | “주의” |
| `good` | `score < 0.35` | “양호” |
| `leech` | `suspended = 1` | “격리” |

- 표본 수(`recentN`)에 따라 신뢰도를 표시한다: `>=20` 높음, `>=10` 보통, 그 미만 데이터 부족.
- `/hard` 탭: 취약, 관찰 중, 격리, 재확인 필요.
- 취약 탭 상단의 “취약 단어 연습”은 `POST /play/start` + `mode=weak`로 이동한다.

### 9.5 weak 연습 정책

- **기한이 도래한 카드만** 출제한다. 기한 전 카드를 당기지 않는다.
- `/play?mode=weak`는 일일 쿼터를 사용하지 않는다.
- `leech`는 weak 연습에 넣지 않는다.
- `source = 'weak'`로 기록해 일반 복습과 구분한다.

### 9.6 leech

- `lapses >= 8`이면 해당 카드 `suspended = 1`.
- 큐에서 제외된다.
- `/hard?tab=leech`에서 사용자가 **연상법(mnemonic)** 을 직접 적는다(자기 생성 효과).
  - `words.note`에 저장되며, 해당 단어의 모든 카드 복습 화면에 표시된다.
- “다시 학습에 포함”을 누르면 `suspended = 0`, `lapses = 0`, `due_at = now`.
- leech를 weak 연습에 넣지 않는 이유: “지금 약한 단어”와 “잠시 내려놓은 단어”는 다르다.

---

## 10. 통계와 지표

### 10.1 외운 단어 (`learnedCount`)

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
  );
```

- 영→한이 `review` + 21일 이상.
- 생산형(한→영/빈칸) 카드가 1장 이상 있고, 그중 하나가 7일 이상.
- 카드 수가 아니라 **고유 단어 수**로 센다.
- 생산형 카드가 없으면 아직 “외운 단어”가 아니다.

문서에는 `Mastered`(영→한 60일 + 생산형 21일) 정의가 있지만, **현재 집계는 구현되어 있지 않다.**

### 10.2 정확도

- `rangeSummary()`: 선택 기간 리뷰 중 `rating >= 2` 비율.
- `dailyStats()`: 날짜별 전체/정답 수.
- `Again`만 오답이다. `Hard/Good/Easy`는 정답이다.
- `/stats`는 7/14/30일 범위를 지원한다.

### 10.3 오늘 학습 / 연속 학습

- 오늘 학습: `local_date = 오늘`인 리뷰 수.
- 연속 학습: `reviews.local_date`의 distinct 값을 최근 400개 조회.
  - 오늘 리뷰가 있으면 오늘부터, 없으면 어제부터 거꾸로 센다.
  - 중간에 빠진 날이 있으면 거기서 끊긴다.

### 10.4 계획 완료율

- `getCompletion7()`: 최근 7일 `daily_plans` 중 `completed_at`이 있는 날 / 계획이 있는 날.
- 계획이 없는 날은 분모에서 제외.
- 세션 모드만 쓰는 사용자는 계획이 없으므로 “표본 부족”으로 표시된다.

### 10.5 통계 화면

- 기간 탭: 7일 / 14일 / 30일.
- 정확도 링, 요약 카드(외운 단어·연속 학습·오늘 학습), 일별 막대 그래프.
- 최근 7일 계획 완료율(레거시).
- “자주 보는 곳”: 단어장 / 취약 단어 / 격리된 단어.
- 하단 CTA: “오늘 학습 시작” → `/play`.

---

## 11. 설정

| 설정 | 값 | 현재 영향 |
|---|---|---|
| 표시 이름 | 최대 40자 | 화면 표시 |
| 학습 방식 | 한 판(`session`) / 하루 목표(`daily`) | `/play` 정책 |
| 한 판 문제 수 | 5 / 10 / 20 | `/play` |
| 한 판에 섞을 새 단어 | 0 / 1 / 2 / 3 / 5 | `/play` |
| 하루 신규 단어 | 5 / 10 / 20 | daily 모드/레거시 `/review` |
| 신규 단어 배분 | 자동 / 고정 | daily 모드/레거시 |
| 하루 복습 상한 | 10 ~ 1000 | daily 모드/레거시 |
| 듣기 카드 | 사용 안 함 / 사용 | 듣기 카드 생성, `/play` 듣기 모드 |
| 발음 | 미국식 / 영국식 | TTS |
| 재생 속도 | 0.7 ~ 1.2 | TTS |
| 시간대 | IANA | 로컬 날짜 계산 |

FSRS 설정:

- 리뷰 1,000건 이상이면 최적화 준비 상태 표시.
- `GET /settings/fsrs/export` → 리뷰 로그 JSON.
- `POST /settings/fsrs` → 21개 숫자 배열만 허용, 즉시 반영.
- `POST /settings/fsrs/reset` → 기본값 복귀.

---

## 12. 신뢰성·보안·운영

### 12.1 원자성과 중복 방지

| 장치 | 역할 |
|---|---|
| `WHERE reps = ?` | 낙관적 락. 같은 카드 동시 제출 중 하나만 성공 |
| `review_key = item.id` (`/play`) | 같은 프롬프트 재전송 식별 |
| `ux_reviews_user_review_key` | 동시에 같은 키가 들어와도 1건만 |
| `ux_reviews_card_instant` | 같은 밀리초 중복 방지 |
| `ux_reviews_card_date_attempt` | 같은 날짜 시도 순번 중복 방지 |
| `trg_reviews_require_play_item` | active 세션 + 미답변 item만 리뷰 INSERT 허용 |
| `ux_play_session_items_pending` | 한 세션에 미답변 문제 하나만 |

### 12.2 앱 종료·복구

- 학습 상태는 응답 1건마다 저장한다. 세션 전체를 메모리에 들고 있지 않다.
- 보기를 고르기 전 종료: 리뷰 없음. 카드는 그대로 due.
- 정답 확인 후 다음 카드 전 종료: 리뷰는 이미 저장됨.
- 제출 후 종료: 리뷰 저장됨. 다시 열면 다음 카드.
- `daily_plans` 덕분에 하루 목표는 재접속해도 유지된다.
- 클라이언트에 저장하는 학습 상태는 없다. 오프라인 큐도 없다.

### 12.3 보안

- 상태 변경 요청(`POST` 등)에 `Origin`/`Referer`/`Sec-Fetch-Site` 검증.
- CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
- Google OAuth `state` + PKCE.
- 세션 쿠키 `sid`: 30일, `httpOnly`, `sameSite=Lax`, HTTPS면 `secure`.
- DB에는 토큰 원문이 아니라 SHA-256 해시 저장.
- 모든 리소스 쿼리에 `user_id` 소유권 조건.

### 12.4 테스트·점검

- `npm run typecheck`
- `npm test` — 쿼터·원자성·마이그레이션 테스트
- `npm run check:seed` — 시드 CSV 검수
- `npm run check:integrity` — 로컬 D1 무결성 점검
- `npm run analyze:ratings` — 평점별 다음 리뷰 성공률, 유형별 응답 시간 분포 등 캘리브레이션

---

## 13. 현재 한계·문서-코드 불일치 (리뷰 시 중요)

| # | 항목 | 현재 상태 | 영향 |
|---|---|---|---|
| 1 | `Mastered` 미구현 | 문서에 정의만 있고 집계 없음 | 숙련도 분포/장기 목표를 볼 수 없음 |
| 2 | 듣기 응답 시간 | `response_ms`가 `item.served_at`부터라 TTS 재생 시간 포함 | 듣기 카드 평점이 실제보다 느리게 나옴 |
| 3 | 유형별 평점 임계값 | `rating-config.ts` 값은 신뢰도 계산에만 사용. 실제 평점은 전 유형 3s/8s | 인식/생산형 난이도 차이가 평점에 반영되지 않음 |
| 4 | `first_input_at`, `confidence` | 기록만 하고 평점에 미사용. `confidence`는 UI에서 수집 안 함 | 계측 필드는 있으나 활용 없음 |
| 5 | 새 단어만 있는 세션 | `quick`에서 `newTarget = min(newPer, ...)` | “한 판 5문제”인데 2문제만 나올 수 있음 |
| 6 | active 세션 재사용 | `POST /play/start`는 항상 새 세션 생성. `new=1` 미구현 | 탭을 여러 개 열면 active 세션이 여러 개 생김 |
| 7 | 승급 복구 throttle | `last_unlock_check_at` 컬럼은 있으나 미사용. `/play` GET마다 `ensureUnlocks` | 요청마다 추가 쿼리 3개 + 쓰기 가능 |
| 8 | 교차 세션 중복 | 같은 카드가 두 세션에 출제될 수 있음. 한 세션에서 답해도 다른 세션의 pending item은 유효 | due가 아닌 카드에 두 번째 리뷰가 저장될 수 있음 |
| 9 | weak 조회 비용 | `selectNextPlayCard`마다 `listWeakness()` 재계산 | 단어/리뷰가 늘면 느려짐 |
| 10 | 객관식 보기 품질 | 사용자의 다른 단어 뜻을 무작위 선택. 품사/레벨/유의어 고려 없음 | 너무 쉬운 보기, 뜻이 겹치는 보기 가능 |
| 11 | cloze 생성 | 예문에 기본형이 없으면 생성 불가 | 굴절형 많은 단어는 cloze 출구가 없음 |
| 12 | 신규 첫 노출 | `/play`는 신규 `recognition`도 소개 화면 없이 바로 4지선다 | 맥락 없이 처음 보는 단어를 찍게 될 수 있음 |
| 13 | 세션 마무리 재노출 | P2로 계획됐으나 미구현 (`kind='wrapup'` 없음) | 틀린 카드를 같은 판에서 한 번 더 꺼내지 않음 |
| 14 | 오프라인 학습 | 앱 셸만 캐시. 오프라인 리뷰 큐 없음 | 지하철 등에서 학습 불가 |
| 15 | `review` 레거시 | 코드는 남아 있고 `LEGACY_REVIEW=1`로만 접근 | 이중 경로 유지 비용 |
| 16 | 통계 정의 | `learnedCount`는 known만. mastered/learning 분포 없음 | “외운 단어”의 의미가 문서와 다름 |
| 17 | 응답 시간 상한 | 5분 초과는 300,000ms로 clamp | 자리 비움과 오래 고민을 구분 못 함 |
| 18 | 오타 허용 | 5~7자 단어는 1글자 오타 허용 | 짧은 단어에서 다른 단어를 정답 처리할 여지 |
| 19 | `attempt_seq` | batch 안에서 `COUNT(*)+1` | 동시 제출은 유니크 인덱스가 최종 방어 |
| 20 | 문서 최신성 | `docs/09`는 `/play`가 `ensureUnlocks`를 호출하지 않는다고 하고, 새 단어 정렬을 DESC라고 설명 | 실제 코드는 호출하며 ASC |
| 21 | M8 명세 상태 | `docs/10`은 “제안 명세(구현 전)”이나 0013~0018이 이미 구현됨 | 문서 상태 표기 불일치 |
| 22 | 요청 제한 | `/auth/*`, `/play/:id/answer`, 단어 추가에 rate limit 없음 | 남용/실수 연타 방어 없음 |
| 23 | 세션 크기 의미 | `target_size`는 계획된 review+new 합계 | “한 판 N문제”와 실제 문항 수가 다를 수 있음 |
| 24 | `play_session_items.position` | INSERT 후 반환 객체는 `position: 0` | 화면에는 영향 없지만 API 응답이 부정확 |
| 25 | `POST /play/:id/answer` 오류 | 409/404를 plain text로 반환 | HTMX가 4xx를 swap하지 않아 사용자에게 피드백이 안 보일 수 있음 |

---

## 14. 코드 맵

```text
src/
  index.tsx                 라우트 등록, 보안 헤더, Origin 검증
  types.ts                  Env / User 타입
  components/layout.tsx     공통 레이아웃 + 인라인 클라이언트 JS
  routes/
    home.tsx                홈 대시보드
    play.tsx                메인 학습 (/play)
    review.tsx              레거시 하루 학습
    decks.tsx               단어장/단어 CRUD/CSV
    hard.tsx                취약/관찰/격리/재확인
    stats.tsx               통계
    quiz.tsx                객관식 테스트
    settings.tsx            설정/FSRS
    auth.tsx                로그인/OAuth
  db/
    queries.ts              단어장/단어/임포트/통계
    review.ts               리뷰 저장·승급·leech
    play.ts                 플레이 세션/카드 선택/상태
    plan.ts                 하루 계획/적응형 배분
    weak.ts                 취약/관찰/재확인
    stats.ts                통계 쿼리
    quiz.ts                 퀴즈
  lib/
    srs.ts                  FSRS 래퍼
    grade.ts                철자 채점/빈칸/글자 비교
    rating.ts               자동 평점
    rating-config.ts        평점 신뢰도 계측
    weak.ts                 취약 점수 순수 함수
    learning-policy.ts      세션/하루 목표 정책
    adaptive.ts             적응형 신규 배분
    session.ts              유형 혼합/예상 시간
    play.ts                 플레이 모드 규칙
    quota.ts                쿼터/응답 시간
    time.ts                 로컬 날짜/표시
migrations/
  0001~0018                 스키마 이력
docs/
  06-learning-design.md     학습 설계 배경
  07-learning-engine.md     M6 학습 엔진 명세
  09-system-overview.md     전체 구조 스냅샷
  10-m8-development-spec.md M8 통합 명세
  11-llm-review-brief.md    이 문서
public/seeds/
  basic-1000.csv            기본 단어 1,000
  function-100.csv          기능어 100
```

---

## 15. 다른 LLM에 붙여넣을 리뷰 요청

아래는 이 문서와 함께 보낼 요청문입니다.

```text
당신은 간격 반복(spaced repetition), 인지과학, 언어 학습 앱 설계, 그리고 서버리스/HTMX 제품 아키텍처에 능숙한 시니어 엔지니어 겸 학습 설계자입니다.
첨부한 Wordy 시스템 스냅샷을 읽고, **현재 구조를 유지하면서** 학습 효과와 제품 완성도를 높일 개선안을 제안해 주세요.

[전제]
- 사용자는 한국어 모국어 성인이며, 하루 10분 내외로 영어 단어를 학습합니다.
- 스케줄의 단일 진실원은 cards이고, FSRS를 새로 만들지 않습니다.
- Cloudflare Workers + D1 + Hono + HTMX + SSR 제약을 유지합니다.
- 클라이언트에 학습 상태를 저장하지 않고, 응답 1건마다 서버에 저장합니다.
- 기존 cards/reviews 데이터를 보존해야 하며, 마이그레이션은 additive해야 합니다.
- 자동 조절은 원칙적으로 “줄이는 방향”만 허용하고, 조정 이유를 사용자에게 보여줘야 합니다.

[요청]
1. 먼저 시스템을 10줄 이내로 요약하고, 현재 설계에서 **가장 큰 학습 효과 손실** 3가지를 지적하세요.
2. 다음 영역별로 개선안을 제시하세요. 각 항목은 “문제 → 근거 → 제안 → 기대 효과 → 구현 난이도/리스크” 형식으로 쓰세요.
   A. 카드 설계와 인출 난이도 (recognition/recall/cloze/listening, 신규 첫 노출, 보기 생성, cloze 생성)
   B. FSRS 평점과 응답 시간 (3s/8s 기준, 유형별 임계값, 듣기 TTS 시간, first_input_at, confidence)
   C. 세션 구성과 정책 (한 판 크기, 신규 배분, due 우선순위, 세션 내 재노출, 세션 재사용/만료)
   D. 취약·leech·관찰·재확인 (점수식, 표본 신뢰도, 연습 정책, leech 복귀)
   E. 측정과 실험 (known/mastered, 유지율, 첫 시도 정답률, A/B 테스트 설계, 최소 표본)
   F. 데이터 모델과 서버 아키텍처 (트리거, 멱등성, 교차 세션 중복, weak 조회 비용, 오프라인)
   G. 콘텐츠와 사용자 경험 (1,100단어, 기능어, 예문 품질, TTS, 접근성)
3. 13절의 “현재 한계” 중 **실제 버그로 볼 수 있는 것**과 **제품 선택으로 볼 수 있는 것**을 구분하세요.
4. 개선안을 P0(지금 당장), P1(2~4주), P2(장기)로 나누고, 각 항목에 예상 효과와 비용을 1~5점으로 매기세요.
5. P0에 대해서는 구체적인 스키마 변경, 함수 시그니처, 의사코드, 테스트 케이스까지 제안하세요.
6. 마지막에 “지금 당장 하지 말아야 할 것” 3가지를 이유와 함께 쓰세요.

[출력 형식]
- 한국어로 작성
- 표와 짧은 코드 블록을 사용하되, 설명은 간결하게
- 추측과 사실을 구분하고, 근거가 없는 주장은 “가설”로 표시
- 현재 시스템에 없는 기능을 당연히 있다고 가정하지 말 것
```
