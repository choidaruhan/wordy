# 10. M8 개발 명세서 — 학습 시스템 통합

> 상태: **제안 명세 (구현 전)**
> 기준: `docs/09-system-overview.md`, 2026-11-05 코드
> 목표: `/play`와 `/review`를 하나의 학습 정책 엔진으로 통합하고,
> 세션·쿼터·승급 복구·통계의 일관성을 확보한다.
>
> 이 문서의 P0/P1/P2는 **M8 안에서의 우선순위**가 아니라
> **제품 개선 우선순위**다. M8은 P0를 완료하고, P1/P2는 후속 마일스톤으로 넘긴다.

---

## 0. 결정 요약

| 결정 | 내용 |
|---|---|
| 학습 UI | `/play` 하나로 통합. `/review`는 호환 리다이렉트만 남긴다 |
| 학습 방식 | `users.learning_mode` = `session`(한 판) / `daily`(하루 목표) |
| 정책 엔진 | `lib/learning-policy.ts`의 순수 함수로 통일 |
| 세션 상태 | `active / completed / abandoned / expired` 명시 |
| 세션 카드 | `play_session_items`로 “출제된 문제”를 저장 |
| 답안 원자성 | 문항 상태는 리뷰 INSERT 트리거로, 세션 카운터는 리뷰에서 파생 |
| 세션 카운터 | `play_sessions.answered/correct`는 파생값으로 전환 (불일치 원천 제거) |
| 승급 복구 | `/play` 시작 시 `ensureUnlocks()` 호출 + best-effort 유지 |
| 통계 | 세션 모드와 하루 목표 모드의 지표를 분리 |
| 평점 | M8은 **계측만** 추가. 임계값 변경은 데이터 확보 후 P1 |
| 숙련도 | P2. M8에서는 기존 `learnedCount` 유지 |

---

## 1. 현재 진단

### 1.1 두 학습 경로의 차이

| 항목 | `/play` | `/review` |
|---|---|---|
| 단위 | 한 판 (`session_size`) | 하루 계획 (`daily_plans`) |
| 신규 단어 | `new_per_session` | `daily_new` + 적응형 배분 |
| 복습 쿼터 | 없음 | `daily_review` |
| 워밍업 | 없음 | 최근 Again due 카드 |
| 마무리 재시험 | 없음 | 계획 완료 후 Again 카드 |
| 승급 복구 | 저장 직후만 | 로드 시 `ensureUnlocks` |
| 통계 | 세션 결과 | 계획 완료율 |

### 1.2 실제로 확인된 문제

1. **정책 이중화**
   - `/play`는 `daily_new`, `daily_review`, `new_card_mode`를 사용하지 않는다.
   - `/review`는 `session_size`, `new_per_session`을 사용하지 않는다.
   - 같은 사용자가 두 경로를 섞으면 신규 수·복습 부담이 예측 불가능해진다.

2. **승급 복구 비대칭**
   - `/play`는 `afterSavePlay()`에서 승급을 시도하지만, 실패 후 복구 경로가 없다.
   - `/review` GET에서만 `ensureUnlocks()`가 실행된다.

3. **세션 상태 불명확**
   - `play_sessions.completed_at`만으로 `active`와 `completed`를 구분한다.
   - 중간 이탈(`abandoned`), 만료(`expired`), 재접속 상태가 없다.
   - 오래된 미완료 세션이 결과 화면에 남을 수 있다.

4. **세션 카운터의 원자성**
   - 현재 `saveReview()` 성공 후 `incrementPlaySession()`을 별도 호출한다.
   - `incrementPlaySession()`이 실패하면 `reviews`는 저장됐지만 `play_sessions.answered`는 증가하지 않는다.
   - **정정**: 같은 요청이 순차적으로 두 번 들어오면 `review_key` 중복 조회로 두 번째는 `null`을 반환하고,
     `incrementPlaySession()`도 실행되지 않는다. 따라서 “answered가 2 증가”하는 문제는 재현되지 않는다.
     실제 문제는 **동시성 경합 시의 처리**와 **리뷰 저장과 카운터 갱신 사이의 실패**다.

5. **출제 카드 검증 부재**
   - 답안 엔드포인트는 카드가 해당 세션에서 실제로 출제됐는지, 아직 답하지 않았는지 검증하지 않는다.
   - 새로고침하면 `shown_at`이 새로 발급되어 `review_key`가 바뀐다.
   - 이전 탭과 새 탭에서 각각 제출하면 같은 카드가 두 번 리뷰될 수 있다.

6. **통계·설정 불일치**
   - `/stats`의 “오늘 학습 시작”이 `/review`로 연결된다.
   - 설정의 `하루 신규 단어`, `신규 단어 배분`, `하루 복습 상한`은 `/play`에 영향이 없다.
   - `Mastered`는 문서에만 있고 집계가 없다.

7. **시간대**
   - `tz_offset_min` 고정 오프셋은 DST가 있는 지역에서 “오늘”이 어긋난다.
   - 해외 사용자를 고려하면 IANA 시간대가 필요하다.

8. **보안·운영**
   - 상태 변경 POST에 CSRF 토큰이 없다. `sameSite=Lax`에 의존한다.
   - OAuth는 `state`만 사용하고 `nonce`/PKCE가 없다.
   - 요청 제한, 오류 모니터링, D1 백업·복구 절차가 문서화되어 있지 않다.

---

## 2. 설계 원칙

1. **하나의 정책, 두 개의 진입 방식**
   - 세션 방식과 하루 목표 방식은 같은 정책 함수에서 계산한다.
   - 진입 방식만 다르고, 신규 배분·복습 우선순위·취약 우선순위는 동일하다.

2. **FSRS는 단일 진실원**
   - `cards`가 스케줄의 진실원이다.
   - `reviews`는 감사 로그다.
   - 세션 재노출(마무리)은 FSRS 리뷰로 기록하지 않는다.

3. **출제와 답안은 1:1로 묶는다**
   - 서버가 문제를 낼 때 `play_session_items`에 기록한다.
   - 답안은 그 item에 대해서만 허용한다.
   - 같은 item은 한 번만 답할 수 있다.

4. **정책 변경은 조용히 하지 않는다**
   - 신규가 줄면 이유를 화면에 표시한다.
   - `policy_reason`을 세션과 하루 계획에 저장한다.

5. **기존 데이터를 보존한다**
   - 기존 `cards`, `reviews`, `daily_plans`, `play_sessions`는 삭제하지 않는다.
   - 새 컬럼은 기본값과 백필로 추가한다.

6. **복구는 best-effort, 일관성은 트리거로**
   - 승급·leech는 실패해도 리뷰를 막지 않는다.
   - 세션 문항 상태는 리뷰 INSERT와 같은 트랜잭션에서 갱신한다.
   - 세션 카운터는 저장하지 않고 리뷰에서 파생한다.

---

## 3. 목표 아키텍처

```text
┌─────────────────────────────────────────────────────┐
│                    Routes                           │
│  /play  /play/:id  /play/:id/answer  /play/:id/next │
│  /stats  /settings  /hard  /decks                   │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              Learning Policy (pure)                 │
│  - session / daily mode                            │
│  - due / new / weak allocation                     │
│  - reason codes                                    │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              Session Service                        │
│  - create session                                  │
│  - serve next card (idempotent item)               │
│  - answer (validate item → save review)            │
│  - complete / abandon / expire                     │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              FSRS Scheduler                         │
│  - schedule() / previewIntervals()                 │
│  - per-user fsrs_params                            │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              D1                                     │
│  cards / reviews / play_sessions / play_session_items│
└─────────────────────────────────────────────────────┘
```

새 모듈:

| 파일 | 역할 |
|---|---|
| `src/lib/learning-policy.ts` | 순수 정책 계산 |
| `src/services/session.ts` | 세션 생성·카드 출제·완료 |
| `src/services/unlock.ts` | 승급·leech·복구 |
| `src/services/integrity.ts` | 무결성 점검 쿼리 |
| `src/lib/rating-config.ts` | 카드 유형별 평점 임계값 |
| `src/lib/weak-confidence.ts` | 취약 점수 신뢰도 |

---

## 4. P0-1 · 학습 정책 통합

### 4.1 사용자 설정

`users.learning_mode` 추가:

```sql
ALTER TABLE users ADD COLUMN learning_mode TEXT NOT NULL DEFAULT 'session';
-- session | daily
```

- `session`: 한 판 단위. 하루 쿼터 없음.
- `daily`: 하루 계획 스냅샷 기반. 기존 `/review` 정책을 계승.
- 기존 사용자 백필:
  - 최근 30일 안에 `daily_plans`가 있는 사용자는 `daily`.
  - 나머지는 `session`.

```sql
UPDATE users
   SET learning_mode = 'daily'
 WHERE id IN (
   SELECT DISTINCT user_id
     FROM daily_plans
    WHERE local_date >= date('now', '-30 day')
 );
```

### 4.2 정책 입력·출력

```ts
export type LearningMode = 'session' | 'daily';
export type SessionKind = 'quick' | 'typing' | 'cloze' | 'listening' | 'weak' | 'custom';

export type PolicyInput = {
  mode: LearningMode;
  kind: SessionKind;
  sessionSize: number;
  newPerSession: number;
  dailyNew: number;
  dailyReview: number;
  newCardMode: 'auto' | 'fixed';
  dueCount: number;
  dueByType: Record<string, number>;
  newCount: number;
  weakDueCount: number;
  deckNewCount: number;
  todayDone: number;
  todayNewDone: number;
  overdue: number;
  throughput7: number;
  adherence7: number;
};

export type PolicyReason =
  | 'session'
  | 'daily_plan'
  | 'no_backlog'
  | 'heavy_backlog'
  | 'moderate_backlog'
  | 'light_backlog'
  | 'low_adherence'
  | 'fixed'
  | 'limited_new'
  | 'goal_done';

export type SessionPlan = {
  policyVersion: 1;
  mode: LearningMode;
  kind: SessionKind;
  targetSize: number;
  reviewTarget: number;
  newTarget: number;
  weakTarget: number;
  reason: PolicyReason;
  reasonText: string | null;
  dailyPlanDate?: string;
};
```

### 4.3 세션 모드 규칙

```text
size = clamp(session_size, 1, 20)
```

| 모드 | reviewTarget | newTarget | weakTarget |
|---|---|---|---|
| `quick` | `min(dueCount, size)` | `min(newPerSession, max(0, size - reviewTarget))` | 0 |
| `typing` | `min(recallDue + clozeDue, size)` | 0 | 0 |
| `cloze` | `min(clozeDue, size)` | 0 | 0 |
| `listening` | `min(listeningDue, size)` | 0 | 0 |
| `weak` | 0 | 0 | `min(weakDue, size)` |
| `custom` | 0 | `min(deckNewCount, size)` | 0 |

- `targetSize = reviewTarget + newTarget + weakTarget`
- `targetSize`가 0이면 세션을 만들지 않고 “풀 카드 없음”을 반환한다.
- `quick`은 `answered >= 2`부터 새 단어를 섞는다. 세션 모드에서도 이 동작을 유지한다.
- 새 단어 정렬은 **일반 모드(`quick`/`daily`)는 `created_at ASC`**(오래된 새 단어부터),
  **`custom`은 `created_at DESC`**(최근 추가한 단어부터)로 통일한다.
  기존 `/play quick`의 `DESC`와 `/review`의 `ASC`가 다르므로, M8에서 `ASC`를 기준으로 맞춘다.

### 4.4 하루 목표 모드 규칙

1. `getTodayPlan(db, user, now, true)`로 오늘 계획을 가져오거나 만든다.
2. 남은 목표를 계산한다.

```text
remaining = max(0, plan.target - plan.done)
if remaining == 0: goal_done

size = min(session_size, remaining)

reviewRemaining = plan.reviewTarget - plan.reviewDone
newRemaining    = plan.effectiveNew - plan.newDone

reviewTarget = min(reviewRemaining, size)
newTarget    = min(newRemaining, newPerSession, max(0, size - reviewTarget))
weakTarget   = 0   # 취약 연습은 별도 모드
targetSize   = reviewTarget + newTarget
```

- `typing`/`cloze`/`listening`은 `reviewTarget`만 사용하고 `newTarget = 0`.
- `custom`은 `newTarget`만 사용하되, 하루 목표 모드에서는 `newRemaining`을 넘지 않는다.
- `weak`는 `daily_review`의 남은 양을 넘지 않는다. (기존 `/review?mode=weak` 정책 유지)

### 4.5 신규 배분

하루 목표 모드에서만 적응형 배분을 적용한다. 세션 모드는 `new_per_session`만 쓴다.

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

- `new_card_mode = 'fixed'`이면 `adaptiveNew = daily_new`.
- `overdue > 0 && daysToClear > 7`이면 `backlogWarning = true`.
- 이유 문구는 기존 `planReasonText()`를 재사용한다.

### 4.6 정책 이유 표시

| reason | 표시 |
|---|---|
| `session` | “한 판 N문제” |
| `daily_plan` | “오늘 목표: 복습 N · 신규 M” |
| `heavy_backlog` | “밀린 복습이 2주치 이상이라 오늘은 신규를 넣지 않습니다.” |
| `moderate_backlog` | “신규를 N개 → M개로 줄였습니다.” |
| `light_backlog` | “복습 부담이 있어 신규를 25% 줄였습니다.” |
| `low_adherence` | “최근 학습일이 적어 신규를 조금 줄였습니다.” |
| `fixed` | “설정한 신규 N개를 유지합니다.” |
| `limited_new` | “오늘 새로 볼 수 있는 단어가 M개라 그만큼만 진행합니다.” |
| `goal_done` | “오늘 목표를 완료했습니다.” |

### 4.7 UI

**홈**

- `session` 모드:
  ```text
  지금 풀 수 있는 문제 42개
  복습 대기 38 · 새 단어 4
  [ 바로 시작 · 5문제 ]
  ```
- `daily` 모드:
  ```text
  오늘 목표 24 / 30
  복습 18 · 신규 3 · 취약 2
  [ 이어서 학습 · 5문제 ]
  ```

**설정**

```text
학습 방식
  ( ) 한 판씩        — 하루 목표 없이 가볍게
  ( ) 하루 목표       — 오늘 할 양을 정해두고

한 판 문제 수 [5] [10] [20]

한 판에 섞을 새 단어 [0] [1] [2] [3] [5]

--- 하루 목표 모드에서만 ---
하루 신규 단어 [5] [10] [20]
신규 단어 배분 (자동) (고정)
하루 복습 상한 [200]
```

### 4.8 P0-1 완료 조건

- [ ] `/play`와 `/review`가 같은 `buildSessionPlan()`을 사용한다.
- [ ] `learning_mode`가 설정 화면에서 선택·저장된다.
- [ ] `session` 모드에서 `/play`가 기존과 동일하게 동작한다.
- [ ] `daily` 모드에서 `/play`가 `daily_plans`의 남은 목표를 지킨다.
- [ ] 신규가 줄어든 이유가 화면에 표시된다.
- [ ] `/review`와 `/play`의 신규 정렬 순서가 통일된다.
- [ ] 기존 `daily_plans`·`reviews` 데이터가 보존된다.

---

## 5. P0-2 · 세션 상태와 생명주기

### 5.1 상태 정의

| status | 의미 | 전환 |
|---|---|---|
| `active` | 진행 중 | 생성 시 |
| `completed` | 목표 달성 | `answered >= target_size` |
| `abandoned` | 사용자가 중단 | `POST /play/:id/abandon` |
| `expired` | 만료 | `expires_at < now` 또는 6시간 무활동 |

- `completed_at`은 `completed`일 때만 기록한다.
- `abandoned`/`expired`는 결과 화면에서 “중단된 세션”으로 표시하고 정답률 통계에서 제외한다.
- `active` 세션은 사용자당 여러 개 허용한다. 대신 `play_session_items`가 세션별로 분리되므로
  다중 탭에서도 같은 세션의 같은 카드만 중복 제출이 막힌다.

### 5.2 스키마

```sql
ALTER TABLE play_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE play_sessions ADD COLUMN review_target INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_sessions ADD COLUMN new_target INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_sessions ADD COLUMN weak_target INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_sessions ADD COLUMN policy TEXT NOT NULL DEFAULT 'session';
ALTER TABLE play_sessions ADD COLUMN policy_reason TEXT;
ALTER TABLE play_sessions ADD COLUMN last_activity_at TEXT;
ALTER TABLE play_sessions ADD COLUMN expires_at TEXT;

CREATE INDEX idx_play_sessions_status
  ON play_sessions(user_id, status, started_at);
```

> 기존 `play_sessions.answered` / `correct` 컬럼은 **deprecated**다.
> M8부터는 `play_session_stats` 뷰에서 리뷰 수와 정답 수를 계산한다.
> 컬럼은 마이그레이션 기간 동안만 유지하고 M9에서 제거한다.

백필:

```sql
UPDATE play_sessions
   SET status = CASE WHEN completed_at IS NOT NULL THEN 'completed' ELSE 'active' END;

UPDATE play_sessions
   SET last_activity_at = COALESCE(completed_at, started_at);

UPDATE play_sessions
   SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', started_at, '+24 hours');

UPDATE play_sessions
   SET review_target = target_size
 WHERE review_target = 0 AND weak_target = 0 AND new_target = 0;
```

### 5.3 상태 전환 규칙

```text
GET /play/:id
  1. session.status == 'active' && expires_at < now
       → status = 'expired'
  2. session.status == 'active' && last_activity_at < now - 6h
       → status = 'abandoned'
  3. session.status == 'active' && answered >= target_size
       → status = 'completed', completed_at = now
  4. status == 'completed' → 결과 화면
  5. status == 'abandoned' | 'expired' → 중단 안내 화면
```

- `POST /play/:id/answer`는 `status == 'active'`일 때만 허용한다.
- `POST /play/:id/next`는 완료/중단 상태면 결과 또는 안내를 반환한다.
- `POST /play/start`는 같은 `mode`의 `active` 세션이 있고 만료되지 않았으면 재사용할 수 있다.
  - `?new=1`이면 새로 만든다.
  - 재사용 여부는 `policy`와 `deck_id`가 같을 때만.

### 5.4 API

| Method | Path | 변경 |
|---|---|---|
| POST | `/play/start` | `policy`, `new` 파라미터 추가. active 세션 재사용 |
| GET | `/play/:id` | 상태 전환/만료 처리 |
| POST | `/play/:id/abandon` | 신규 |
| GET | `/play/:id/result` | `completed`만 결과, 나머지는 안내 |
| POST | `/play/:id/answer` | item 검증, active 검증 |
| POST | `/play/:id/next` | 상태 확인 |

### 5.5 P0-2 완료 조건

- [ ] `active/completed/abandoned/expired`가 구분된다.
- [ ] 오래된 미완료 세션은 자동으로 `expired`/`abandoned`가 된다.
- [ ] 중단/만료 세션은 정답률 통계에서 제외된다.
- [ ] 세션 재접속 시 같은 미답변 문제가 다시 나온다.
- [ ] 다중 탭에서 같은 세션의 같은 문제는 한 번만 답할 수 있다.

---

## 6. P0-3 · 출제 문항과 답안 원자성

### 6.1 문제

현재 `/play`는 카드를 조회해서 바로 렌더한다. 서버가 “이 카드를 이 세션에서 냈다”는 기록을 남기지 않는다.
그래서 다음이 불가능하다.

- 이 카드가 실제로 출제됐는지 검증
- 이미 답한 문제인지 검증
- 새로고침 시 같은 문제를 같은 `review_key`로 유지
- 세션 카운터와 리뷰 수의 일치 보장

### 6.2 `play_session_items`

```sql
CREATE TABLE play_session_items (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  card_id      TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  bucket       TEXT NOT NULL,              -- review | new | weak | custom_new
  kind         TEXT NOT NULL DEFAULT 'prompt', -- prompt | wrapup
  served_at    TEXT NOT NULL,
  answered_at  TEXT,
  review_id    TEXT REFERENCES reviews(id) ON DELETE SET NULL,
  correct      INTEGER,
  UNIQUE(session_id, card_id, kind)
);

CREATE INDEX idx_play_session_items_session
  ON play_session_items(session_id, position);

CREATE UNIQUE INDEX ux_play_session_items_review
  ON play_session_items(review_id)
  WHERE review_id IS NOT NULL;
```

> `kind='wrapup'`은 P2에서 사용한다. M8에서는 `prompt`만 쓴다.

### 6.3 카드 출제 흐름

```text
serveNextCard(session):
  1. 같은 세션에 미답변 prompt item이 있으면 그대로 반환
     (새로고침해도 같은 문제, 같은 served_at)

  2. 없으면 정책에 따라 다음 카드 선택
     - 버킷: review / new / weak / custom_new
     - 같은 세션에서 이미 출제한 카드 제외

  3. play_session_items INSERT
     - position = COUNT(*) + 1
     - served_at = now
     - bucket = 정책 버킷

  4. 카드 + item 반환
```

- `shown_at`은 `item.served_at`을 쓴다.
- `review_key`는 `item.id`를 쓴다. (기존 `card_id:shown_at`보다 강한 멱등키)
- 레거시 `/review`는 기존 `card_id:shown_at`을 유지한다.

### 6.4 답안 흐름

```text
answer(sessionId, itemId, cardId, choice/answer):
  1. session = getPlaySession(userId, sessionId)
     - status == 'active' 아니면 거부
  2. item = getSessionItem(userId, sessionId, itemId)
     - item.card_id == cardId 확인
     - item.answered_at IS NULL 확인
  3. 카드 조회 + 채점
  4. saveReview(..., {
       sessionId,
       sessionItemId: item.id,
       reviewKey: item.id,
       ...
     })
  5. DB 트리거가 item.answered_at / review_id / correct / last_activity_at 를 갱신
     (세션 카운터는 play_session_stats에서 파생)
  6. 피드백 반환
```

### 6.5 DB 트리거

```sql
-- 1) active 세션 + 미답변 item이 아니면 리뷰 INSERT를 막는다.
CREATE TRIGGER trg_reviews_require_play_item
BEFORE INSERT ON reviews
WHEN NEW.session_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM play_sessions
       WHERE id = NEW.session_id AND status = 'active'
    )
    THEN RAISE(ABORT, 'PLAY_SESSION_NOT_ACTIVE')
    WHEN NOT EXISTS (
      SELECT 1 FROM play_session_items
       WHERE session_id = NEW.session_id
         AND card_id = NEW.card_id
         AND kind = 'prompt'
         AND answered_at IS NULL
    )
    THEN RAISE(ABORT, 'PLAY_SESSION_ITEM_NOT_FOUND')
  END;
END;

-- 2) 리뷰가 저장되면 해당 item을 답변 완료로 표시한다.
CREATE TRIGGER trg_reviews_mark_play_item
AFTER INSERT ON reviews
WHEN NEW.session_id IS NOT NULL
BEGIN
  UPDATE play_session_items
     SET answered_at = NEW.reviewed_at,
         review_id = NEW.id,
         correct = NEW.is_correct
   WHERE session_id = NEW.session_id
     AND card_id = NEW.card_id
     AND kind = 'prompt'
     AND answered_at IS NULL;
END;

-- 3) 세션 활동 시각만 갱신한다. 카운터는 리뷰에서 파생한다.
CREATE TRIGGER trg_reviews_touch_play_session
AFTER INSERT ON reviews
WHEN NEW.session_id IS NOT NULL
BEGIN
  UPDATE play_sessions
     SET last_activity_at = NEW.reviewed_at
   WHERE id = NEW.session_id;
END;

-- 4) 세션 카운터는 저장하지 않고 리뷰에서 계산한다.
CREATE VIEW play_session_stats AS
SELECT s.id AS session_id,
       COUNT(r.id) AS answered,
       COALESCE(SUM(r.is_correct), 0) AS correct,
       MAX(r.reviewed_at) AS last_answered_at
  FROM play_sessions s
  LEFT JOIN reviews r ON r.session_id = s.id
 GROUP BY s.id;
```

- D1은 SQLite 트리거/뷰를 지원한다.
- `saveReview()`의 batch 안에서 INSERT가 실행되므로 트리거도 같은 트랜잭션이다.
- `incrementPlaySession()`은 제거한다.
- `play_sessions.answered/correct`는 **deprecated**가 된다.
  - `getPlaySession()`은 `play_session_stats`를 JOIN해 `answered/correct`를 읽는다.
  - 기존 컬럼은 M9에서 제거하거나, 호환용으로만 남긴다.
- 카운터를 저장하지 않으므로 “리뷰는 저장됐는데 카운터가 안 늘어나는” 문제가 원천적으로 사라진다.
- `saveReview()`는 `PLAY_SESSION_NOT_ACTIVE`, `PLAY_SESSION_ITEM_NOT_FOUND`를 잡아
  `{ ok: false, code }`로 반환한다.

### 6.6 중복·경합 처리

| 상황 | 처리 |
|---|---|
| 같은 item에 두 번 제출 | 두 번째는 `answered_at IS NOT NULL` → 409 “이미 처리됨” |
| 두 탭에서 동시 제출 | 트리거가 한 번만 통과, 나머지는 ABORT |
| 새로고침 | 미답변 item을 재사용. `review_key` 동일 |
| 다른 세션에서 같은 카드 | 세션이 다르면 별개 item. 정상 |
| 리뷰 저장 후 카운터 실패 | 카운터는 `play_session_stats`에서 파생되므로 불일치 없음 |
| 세션 완료 후 늦은 제출 | `PLAY_SESSION_NOT_ACTIVE` → 409 |

### 6.7 P0-3 완료 조건

- [ ] 모든 답안은 `play_session_items`에 존재하는 미답변 item에 대해서만 저장된다.
- [ ] `review_key = item.id`로 같은 문제의 재전송이 한 번만 저장된다.
- [ ] `play_session_stats.answered`가 리뷰 수와 항상 일치한다.
- [ ] 새로고침해도 같은 문제와 같은 `review_key`가 유지된다.
- [ ] 두 탭 동시 제출 테스트에서 리뷰 1건, 파생 `answered` 1.
- [ ] `/review` 레거시는 `session_id = NULL`이라 트리거 영향을 받지 않는다.

---

## 7. P0-4 · 승급·leech 복구 통합

### 7.1 서비스 분리

`src/services/unlock.ts`:

```ts
export async function runPostReviewTasks(db, user, card, next, now) { ... }
export async function ensureUnlocks(db, userId, now, listeningEnabled, options?) { ... }
export async function runMaintenance(db, userId, now, user) {
  await ensureUnlocks(...);
  await maybeResumeExpiredLeeches?.(...); // 선택
}
```

### 7.2 호출 지점

| 지점 | 호출 |
|---|---|
| `/play` GET | `runMaintenance()` (1시간 throttle) |
| `POST /play/start` | `runMaintenance()` |
| `/play/:id/answer` 저장 후 | `runPostReviewTasks()` |
| `/review` GET (레거시) | `runMaintenance()` |
| `/settings` 저장 후 | `runMaintenance()` (듣기 On 시) |

### 7.3 Throttle

`users.last_unlock_check_at` 추가:

```sql
ALTER TABLE users ADD COLUMN last_unlock_check_at TEXT;
```

- `now - last_unlock_check_at < 1시간`이면 건너뛴다.
- 성공/실패와 무관하게 시각을 갱신한다. (실패 시 다음 시간에 재시도)
- `/play` 시작 시에는 throttle을 무시하고 1회 실행할 수 있다.

### 7.4 Cron (선택)

Cloudflare Cron Trigger로 매시간 활성 사용자 유지보수:

```jsonc
// wrangler.jsonc
"triggers": {
  "crons": ["0 * * * *"]
}
```

```ts
export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledMaintenance(env));
  }
};
```

- 최근 30일 내 리뷰가 있는 사용자만 대상으로 한다.
- 사용자 수가 적은 초기에는 생략 가능. P1로 미룬다.

### 7.5 P0-4 완료 조건

- [ ] `/play`만 사용해도 승급 누락이 1시간 안에 복구된다.
- [ ] 승급 실패가 리뷰 저장을 막지 않는다.
- [ ] `ensureUnlocks`는 멱등적이다.
- [ ] 듣기 설정을 켠 직후 `/play`에서 listening 카드가 생성된다.

---

## 8. P0-5 · `/review` 레거시 정리

### 8.1 전략

- M8에서는 `/review`를 **삭제하지 않고 리다이렉트**한다.
- `LEGACY_REVIEW=1` 환경 변수가 있으면 기존 화면을 유지한다.
- 데이터(`daily_plans`, 레거시 `reviews`)는 보존한다.

### 8.2 라우트

```text
GET /review
  → 302 /play

GET /review?mode=weak
  → 302 /play?intent=weak
```

- `/play?intent=weak`는 “취약 연습 시작” 버튼을 보여준다.
  GET에서 세션을 자동 생성하지 않는다. (부작용 방지)
- 기존 북마크는 `/play`로 이동한다.

### 8.3 코드

- M8: `src/routes/review.tsx`는 유지하되, feature flag로 분기.
- M9: 레거시 코드 삭제, `daily_plans`는 `daily` 모드에서 계속 사용.
- `docs/06`, `docs/07` 상단에 레거시 표시.

### 8.4 P0-5 완료 조건

- [ ] `/review` 접근 시 `/play`로 이동한다.
- [ ] `?mode=weak` 의도가 유지된다.
- [ ] 레거시 데이터가 삭제되지 않는다.
- [ ] `LEGACY_REVIEW=1`에서 기존 동작이 유지된다.

---

## 9. P0-6 · 통계 CTA·설정·문서 정리

### 9.1 통계 CTA

- `/stats` 하단 “오늘 학습 시작” → `/play`.
- `daily` 모드면 “오늘 목표 이어서” → `/play/start` (quick, daily).
- `session` 모드면 “한 판 시작” → `/play`.

### 9.2 설정

- `learning_mode` 라디오 추가.
- `daily` 모드에서만 `daily_new`, `new_card_mode`, `daily_review` 노출.
- `session` 모드에서는 “한 판 문제 수”, “한 판에 섞을 새 단어”만 노출.
- 레거시 항목에는 “하루 목표 모드에서 사용” 라벨.

### 9.3 문서

- `docs/06` 상단:
  > 이 문서는 학습 설계 배경이다. 현재 구현의 하루 계획·쿼터는
  > `learning_mode='daily'`에서만 사용된다. 전체 구조는 `09`, `10`을 본다.
- `docs/07` 상단:
  > M6 학습 엔진 명세. 현재 메인은 `/play`이며, 이 문서의 하루 계획은
  > `daily` 모드에 해당한다. 세션 구조는 `09`, `10`을 본다.
- `README` 구현 상태에 M8 행 추가.

### 9.4 P0-6 완료 조건

- [ ] `/stats`에서 `/review` 링크가 사라진다.
- [ ] 설정에서 현재 모드에 맞는 항목만 보인다.
- [ ] 06/07 문서에 레거시/현재 관계가 명시된다.
- [ ] README 문서 목록과 구현 상태가 갱신된다.

---

## 10. P1-1 · 평점 신뢰도 계측과 보정

> M8에서는 **데이터를 수집**하고, 임계값 변경은 데이터 확보 후 적용한다.
> FSRS에 전달하는 평점을 급격히 바꾸면 기존 스케줄과 비교가 불가능해진다.

### 10.1 문제

현재 평점은 카드 유형과 무관하게 3초/8초 기준을 쓴다.

- 인식(4지선다)과 생산형(입력)의 인지 부하가 다르다.
- TTS 재생 시간이 `response_ms`에 포함된다.
- 모바일 키보드 지연이 포함된다.
- 찍어서 맞힌 경우를 `Easy`만 막고, `Good`은 그대로 준다.

### 10.2 수집할 신호

`reviews`에 추가:

```sql
ALTER TABLE reviews ADD COLUMN prompt_started_at TEXT;
ALTER TABLE reviews ADD COLUMN first_input_at TEXT;
ALTER TABLE reviews ADD COLUMN confidence INTEGER;         -- 0 모름 / 1 애매 / 2 확신
ALTER TABLE reviews ADD COLUMN rating_model_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reviews ADD COLUMN grading_reliability REAL;    -- 0~1, 분석용
```

- `prompt_started_at`
  - 일반 카드: 카드 렌더 시각
  - 듣기 카드: TTS 재생 시작 또는 종료 시각 (클라이언트가 hidden으로 전달)
- `first_input_at`
  - 입력형: 첫 키 입력 시각
  - 객관식: 첫 선택 시각
- `confidence`
  - M8에서는 **선택적**으로 수집한다. 모든 문제에 묻지 않는다.
  - 예: 하루 10문제 중 1문제, 또는 설정에서 “확신도 기록”을 켠 사용자만.
- `grading_reliability`
  - `correctness`, `response_ms`, `card_type`, `confidence`로 계산한 0~1 값.
  - M8에서는 저장만 하고 FSRS 평점에는 사용하지 않는다.

### 10.3 카드 유형별 임계값 (P1 적용 후보)

```ts
export const RATING_THRESHOLDS = {
  recognition: { easy: null, good: 3_000, hard: 8_000 },
  recall:      { easy: 4_000, good: 10_000, hard: 20_000 },
  cloze:       { easy: 5_000, good: 12_000, hard: 25_000 },
  listening:   { easy: 5_000, good: 12_000, hard: 25_000 },
};
```

- 인식형은 `Easy`를 주지 않는다.
- 생산형은 유형별로 `Easy/Good/Hard` 구간을 분리한다.
- 듣기 카드는 `prompt_started_at`을 TTS 종료 시점으로 잡아 재생 시간을 제외한다.
- 모바일 키보드 지연은 `first_input_at`을 사용해 완화한다.

### 10.4 신뢰도 계산 (분석용)

```text
reliability =
  0.45 * correctnessSignal
+ 0.25 * timingSignal
+ 0.20 * typeSignal
+ 0.10 * confidenceSignal
```

- `correctnessSignal`: 오답 0, 정답 1
- `timingSignal`: 유형별 정상 범위 안이면 1, 극단값이면 0.5
- `typeSignal`: 생산형 1, 인식형 0.8
- `confidenceSignal`: confidence가 있으면 1, 없으면 0.5

이 값은 통계·실험에만 쓰고, FSRS 평점은 기존 규칙을 유지한다.

### 10.5 캘리브레이션

- `scripts/analyze-ratings.mjs`:
  - 평점별 다음 리뷰 성공률
  - 유형별 응답 시간 분포
  - `Easy`/`Good`/`Hard`의 실제 유지율
  - 오타 허용과 실제 오답의 구분
- 목표:
  - `Good`의 다음 리뷰 성공률 85~90%
  - `Hard`의 다음 리뷰 성공률 70~80%
  - `Again`의 다음 리뷰 성공률 30~50%
- 임계값은 이 데이터로 조정한다.

### 10.6 P1-1 완료 조건

- [ ] `prompt_started_at`, `first_input_at`이 기록된다.
- [ ] 듣기 카드의 TTS 재생 시간이 응답 시간에서 제외된다.
- [ ] `confidence`를 선택적으로 기록할 수 있다.
- [ ] `grading_reliability`가 저장된다.
- [ ] 분석 스크립트가 평점별 유지율을 출력한다.
- [ ] 기존 FSRS 스케줄은 변경되지 않는다.

---

## 11. P1-2 · 취약 점수 신뢰도와 무결성

### 11.1 취약 점수 확장

현재 `WeakResult`:

```ts
{ score, status, errorRate }
```

확장:

```ts
type WeakResult = {
  score: number;
  status: WeakStatus;
  errorRate: number;
  confidence: 'low' | 'medium' | 'high';
  sampleSize: number;
  factors: {
    recentErrorRate: number;
    lapses: number;
    lowStability: number;
    quizWrongs: number;
  };
};
```

신뢰도 규칙:

```text
sampleSize = recentN
confidence =
  recentN >= 20 ? 'high' :
  recentN >= 10 ? 'medium' : 'low'
```

- `observing`은 `low`.
- `stale`은 신뢰도 계산에서 제외.
- UI:
  - `취약 · 신뢰도 높음`
  - `취약 · 신뢰도 보통`
  - `취약 · 데이터 부족 (5/20)`
- 정렬:
  - `weak` + `high` → 상단
  - `weak` + `low` → 하단
  - `attention`은 그 아래

### 11.2 무결성 점검

`src/services/integrity.ts`:

```ts
export type IntegrityReport = {
  cardReviewMismatch: number;
  reviewMissingCard: number;
  sessionCounterMismatch: number;
  sessionItemMissingReview: number;
  unlockCandidates: number;
  orphanWordExamples: number;
  orphanQuizQuestions: number;
  orphanReviews: number;
};
```

점검 쿼리:

```sql
-- 1. 카드와 최신 리뷰 스냅샷 불일치
SELECT c.id
  FROM cards c
  JOIN (
    SELECT card_id, next_state, next_due_at,
           ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY reviewed_at DESC) AS rn
      FROM reviews
     WHERE next_state IS NOT NULL
  ) r ON r.card_id = c.id AND r.rn = 1
 WHERE c.state != r.next_state OR c.due_at != r.next_due_at;

-- 2. 저장 카운터와 파생 카운터 불일치 (마이그레이션 기간에만)
SELECT s.id, s.answered AS stored, v.answered AS derived
  FROM play_sessions s
  JOIN play_session_stats v ON v.session_id = s.id
 WHERE s.answered != v.answered OR s.correct != v.correct;

-- 3. 승급 조건을 만족하지만 카드가 없는 단어
-- ensureUnlocks와 같은 쿼리

-- 4. 고아 데이터
SELECT COUNT(*) FROM reviews r
 LEFT JOIN cards c ON c.id = r.card_id
 WHERE c.id IS NULL;
```

실행:

- `npm run check:integrity` (로컬/원격 D1).
- `GET /admin/integrity` (관리자 이메일 또는 secret).
- 결과가 0이 아니면 배포 후 알림.

### 11.3 보안 기준선

P1에서 처리:

| 항목 | 조치 |
|---|---|
| CSRF | `Origin`/`Referer` 검증 + `X-CSRF-Token` (double submit) |
| OAuth | `nonce` 추가, ID token 검증 또는 userinfo 유지 근거 문서화 |
| PKCE | Google OAuth에 `code_challenge`/`code_verifier` 적용 |
| 세션 | 로그인 시 토큰 회전, 전체 로그아웃, idle timeout |
| 접근 제어 | 모든 리소스 사용자 소유권 테스트 |
| 요청 제한 | `/auth/*`, `/play/*/answer`, `/decks/*/words` rate limit |
| 백업 | D1 export 스케줄 + 복구 리허설 |
| 로그 | 리뷰 저장 실패, 승급 실패, 무결성 불일치 구조화 로그 |

> `sameSite=Lax`는 cross-site POST에 쿠키를 보내지 않아 기본 방어가 된다.
> 그래도 상태 변경 요청에 Origin 검증을 추가하는 것이 안전하다.

### 11.4 P1-2 완료 조건

- [ ] 취약 목록에 신뢰도/표본 수가 표시된다.
- [ ] `check:integrity`가 8개 점검 항목을 출력한다.
- [ ] 무결성 불일치가 0건이면 exit 0, 아니면 exit 1.
- [ ] 상태 변경 POST에 Origin 검증이 적용된다.
- [ ] 접근 제어 테스트(다른 사용자 리소스)가 통과한다.
- [ ] OAuth nonce/PKCE 적용 여부가 결정되고 문서화된다.
- [ ] D1 백업·복구 절차가 문서화된다.

---

## 12. P1-3 · IANA 시간대

### 12.1 스키마

```sql
ALTER TABLE users ADD COLUMN timezone TEXT; -- 예: Asia/Seoul
```

백필:

```sql
UPDATE users SET timezone = 'Asia/Seoul' WHERE tz_offset_min = 540;
UPDATE users SET timezone = 'UTC'        WHERE tz_offset_min = 0;
```

### 12.2 함수

```ts
export function localDate(now: Date, tzOffsetMin: number, timezone?: string | null): string {
  if (timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  return new Date(now.getTime() + tzOffsetMin * 60_000).toISOString().slice(0, 10);
}
```

- `timezone`이 있으면 IANA, 없으면 기존 오프셋.
- `due_at`은 계속 UTC.
- `local_date`는 쓰기 시점에 계산.

### 12.3 테스트

- `America/New_York`의 DST 시작/종료일 23:59, 00:01.
- `Asia/Seoul`은 DST 없음.
- `Europe/London`의 3월/10월 경계.

### 12.4 P1-3 완료 조건

- [ ] `users.timezone`이 저장된다.
- [ ] `localDate()`가 IANA와 오프셋을 모두 지원한다.
- [ ] DST 경계 테스트가 통과한다.
- [ ] 기존 사용자 데이터의 `local_date`는 변경하지 않는다.

---

## 13. P2-1 · 오답 마무리 (세션 내 재노출)

> FSRS 리뷰와 분리한다. 재노출은 스케줄을 바꾸지 않는다.

### 13.1 흐름

```text
한 판 5문제:
  1. 복습 2문제 (due)
  2. 신규 1~2문제
  3. 이번 판에서 틀린 문제 1문제 재노출
```

- 재노출은 `play_session_items.kind = 'wrapup'`으로 기록한다.
- `reviews`에는 저장하지 않는다.
- `play_session_items.correct`에 재노출 결과만 저장한다.
- 세션 결과에 “이번 판 오답 다시 보기 1/1”을 표시한다.
- 재노출 문제는 FSRS `due_at`을 변경하지 않는다.

### 13.2 정책

```text
wrapupTarget =
  session.answered >= 3
    ? min(2, count(incorrect items in session))
    : 0
```

- 오답이 없으면 재노출하지 않는다.
- 재노출은 정답률 통계에 포함하지 않는다. 별도 “세션 내 재확인” 지표로 분리한다.
- 재노출에서 또 틀려도 FSRS에 반영하지 않는다.

### 13.3 완료 조건

- [ ] 이번 판 오답이 있으면 최대 2문제를 다시 낸다.
- [ ] 재노출은 `reviews`를 생성하지 않는다.
- [ ] `cards.due_at`이 변하지 않는다.
- [ ] 결과 화면에 재노출 결과가 표시된다.
- [ ] 정답률 통계와 분리된다.

---

## 14. P2-2 · 단어 숙련도 (Word Mastery)

### 14.1 단계

| 단계 | 조건 |
|---|---|
| `new` | 모든 카드 `reps = 0` |
| `learning` | 리뷰 시작, `recognition.state != review` |
| `familiar` | `recognition.state = review` + `scheduled_days >= 7` |
| `known` | 현재 `learnedCount` 조건 |
| `mastered` | 아래 |

### 14.2 Known / Mastered

```text
known:
  recognition.state = 'review'
  AND recognition.scheduled_days >= 21
  AND EXISTS production card (recall/cloze)
  AND max(production.scheduled_days) >= 7

mastered:
  recognition.state = 'review'
  AND recognition.scheduled_days >= 60
  AND EXISTS production card
  AND min(production.scheduled_days) >= 21
  AND for each production type that exists (recall/cloze):
        at least one review with rating >= 3 in the last 90 days
```

- `listening`은 인식 카드로 보고 `mastered` 판정에 쓰지 않는다.
- 생산형 카드가 없으면 `known/mastered`가 아니다.
- `mastered`는 “있는 모든 출구 카드가 안정적”이라는 뜻이다.

### 14.3 쿼리

```sql
-- 단어별 상태를 계산하는 뷰
CREATE VIEW word_mastery AS
SELECT w.id AS word_id,
       w.deck_id,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM cards c WHERE c.word_id = w.id AND c.reps > 0) THEN 'new'
         WHEN NOT EXISTS (SELECT 1 FROM cards c WHERE c.word_id = w.id AND c.card_type = 'recognition' AND c.state = 'review') THEN 'learning'
         WHEN ... THEN 'familiar'
         WHEN ... THEN 'known'
         WHEN ... THEN 'mastered'
         ELSE 'learning'
       END AS mastery
  FROM words w;
```

> D1/SQLite 뷰는 읽기 전용 집계에 적합하다. 성능이 문제되면 `word_stats` 물리화.

### 14.4 완료 조건

- [ ] `/stats`에 숙련도 분포가 표시된다.
- [ ] `known`/`mastered`가 단어 수 기준으로 집계된다.
- [ ] 생산형 카드가 없는 단어는 known/mastered가 아니다.
- [ ] 기존 `learnedCount`와 `known`이 일치한다.
- [ ] `mastered`가 `scheduled_days`만으로 판정되지 않는다.

---

## 15. P2-3 · 대시보드·피로도·리포트

### 15.1 대시보드

```text
오늘 학습          24 / 30
외운 단어          342
취약 단어          18
오늘 복습 예정      42
숙련도 분포        Learning 120 · Familiar 210 · Known 342 · Mastered 86
```

- `session` 모드: “오늘 학습”은 세션 완료 수 / 시작 수 또는 처리 문제 수.
- `daily` 모드: “오늘 학습”은 계획 대비 진행률.
- `예상 복습량`은 `getPlayPoolCounts().due`.
- `취약 단어`는 weak + attention.

### 15.2 피로도

- 세션 사이 휴식 권장:
  - 연속 3판 이상, 최근 정답률 10%p 하락 시 “잠깐 쉬어가세요”.
- 오늘의 신규 권장량:
  - `daily` 모드: 남은 신규.
  - `session` 모드: `new_per_session * 3`을 하루 권장량으로 표시(강제 아님).
- 복습 중심 모드 추천:
  - `overdue > 2 * daily_review`이면 “오늘은 복습만” 배너.

### 15.3 리포트

- 주간:
  - 학습일, 처리량, 정확도, 유지율, 취약 단어 변화.
- 월간:
  - 숙련도 분포 변화, 마스터 수, 복습 부담 추세.

### 15.4 완료 조건

- [ ] 대시보드에 숙련도 분포가 표시된다.
- [ ] 세션/하루 목표 모드에 따라 “오늘 학습” 정의가 다르게 표시된다.
- [ ] 피로도 배너는 강제 제한이 아니라 안내다.
- [ ] 주간 리포트가 리뷰 로그에서 계산된다.

---

## 16. 데이터베이스 변경 요약

### 16.1 M8 (P0)

```sql
-- 0013_learning_mode.sql
ALTER TABLE users ADD COLUMN learning_mode TEXT NOT NULL DEFAULT 'session';
ALTER TABLE users ADD COLUMN last_unlock_check_at TEXT;

UPDATE users
   SET learning_mode = 'daily'
 WHERE id IN (
   SELECT DISTINCT user_id FROM daily_plans
    WHERE local_date >= date('now', '-30 day')
 );
```

```sql
-- 0014_play_session_state.sql
ALTER TABLE play_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE play_sessions ADD COLUMN review_target INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_sessions ADD COLUMN new_target INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_sessions ADD COLUMN weak_target INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_sessions ADD COLUMN policy TEXT NOT NULL DEFAULT 'session';
ALTER TABLE play_sessions ADD COLUMN policy_reason TEXT;
ALTER TABLE play_sessions ADD COLUMN last_activity_at TEXT;
ALTER TABLE play_sessions ADD COLUMN expires_at TEXT;

UPDATE play_sessions
   SET status = CASE WHEN completed_at IS NOT NULL THEN 'completed' ELSE 'active' END;
UPDATE play_sessions
   SET last_activity_at = COALESCE(completed_at, started_at);
UPDATE play_sessions
   SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', started_at, '+24 hours');
UPDATE play_sessions
   SET review_target = target_size
 WHERE review_target = 0 AND new_target = 0 AND weak_target = 0;

-- 기존 세션 카운터를 리뷰 로그 기준으로 재계산한다.
UPDATE play_sessions
   SET answered = (
         SELECT COUNT(*) FROM reviews r WHERE r.session_id = play_sessions.id
       ),
       correct = (
         SELECT COALESCE(SUM(r.is_correct), 0)
           FROM reviews r WHERE r.session_id = play_sessions.id
       );

CREATE INDEX idx_play_sessions_status
  ON play_sessions(user_id, status, started_at);
```

```sql
-- 0015_play_session_items.sql
CREATE TABLE play_session_items (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  card_id      TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  bucket       TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'prompt',
  served_at    TEXT NOT NULL,
  answered_at  TEXT,
  review_id    TEXT REFERENCES reviews(id) ON DELETE SET NULL,
  correct      INTEGER,
  UNIQUE(session_id, card_id, kind)
);

CREATE INDEX idx_play_session_items_session
  ON play_session_items(session_id, position);

CREATE UNIQUE INDEX ux_play_session_items_review
  ON play_session_items(review_id)
  WHERE review_id IS NOT NULL;
```

```sql
-- 0016_play_session_triggers.sql
-- 배포 순서: 0013~0015 적용 → 새 앱 배포 → 0016 적용.
-- 기존 세션의 리뷰를 item으로 백필한 뒤 트리거를 활성화한다.
INSERT OR IGNORE INTO play_session_items (
  id, session_id, card_id, position, bucket, kind,
  served_at, answered_at, review_id, correct
)
SELECT lower(hex(randomblob(16))),
       r.session_id,
       r.card_id,
       ROW_NUMBER() OVER (PARTITION BY r.session_id ORDER BY r.reviewed_at),
       CASE
         WHEN r.reps_before = 0 AND r.question_type = 'recognition' THEN 'new'
         WHEN r.source = 'weak' THEN 'weak'
         ELSE 'review'
       END,
       'prompt',
       r.reviewed_at,
       r.reviewed_at,
       r.id,
       r.is_correct
  FROM reviews r
 WHERE r.session_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM play_session_items i WHERE i.review_id = r.id
   );

CREATE TRIGGER trg_reviews_require_play_item
BEFORE INSERT ON reviews
WHEN NEW.session_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM play_sessions
       WHERE id = NEW.session_id AND status = 'active'
    ) THEN RAISE(ABORT, 'PLAY_SESSION_NOT_ACTIVE')
    WHEN NOT EXISTS (
      SELECT 1 FROM play_session_items
       WHERE session_id = NEW.session_id
         AND card_id = NEW.card_id
         AND kind = 'prompt'
         AND answered_at IS NULL
    ) THEN RAISE(ABORT, 'PLAY_SESSION_ITEM_NOT_FOUND')
  END;
END;

CREATE TRIGGER trg_reviews_mark_play_item
AFTER INSERT ON reviews
WHEN NEW.session_id IS NOT NULL
BEGIN
  UPDATE play_session_items
     SET answered_at = NEW.reviewed_at,
         review_id = NEW.id,
         correct = NEW.is_correct
   WHERE session_id = NEW.session_id
     AND card_id = NEW.card_id
     AND kind = 'prompt'
     AND answered_at IS NULL;
END;

CREATE TRIGGER trg_reviews_touch_play_session
AFTER INSERT ON reviews
WHEN NEW.session_id IS NOT NULL
BEGIN
  UPDATE play_sessions
     SET last_activity_at = NEW.reviewed_at
   WHERE id = NEW.session_id;
END;

CREATE VIEW play_session_stats AS
SELECT s.id AS session_id,
       COUNT(r.id) AS answered,
       COALESCE(SUM(r.is_correct), 0) AS correct,
       MAX(r.reviewed_at) AS last_answered_at
  FROM play_sessions s
  LEFT JOIN reviews r ON r.session_id = s.id
 GROUP BY s.id;
```

### 16.2 P1

```sql
-- 0017_review_rating_signals.sql
ALTER TABLE reviews ADD COLUMN prompt_started_at TEXT;
ALTER TABLE reviews ADD COLUMN first_input_at TEXT;
ALTER TABLE reviews ADD COLUMN confidence INTEGER;
ALTER TABLE reviews ADD COLUMN rating_model_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reviews ADD COLUMN grading_reliability REAL;

-- 0018_users_timezone.sql
ALTER TABLE users ADD COLUMN timezone TEXT;
```

### 16.3 P2

```sql
-- 0019_word_mastery_view.sql
CREATE VIEW word_mastery AS ...
```

> 마이그레이션 번호는 실제 작업 시점에 맞춰 조정한다.
> 이미 적용된 마이그레이션은 수정하지 않는다.

---

## 17. API 변경 요약

| Method | Path | 변경 | 단계 |
|---|---|---|---|
| GET | `/play` | `learning_mode`에 따른 홈 표시 | P0 |
| POST | `/play/start` | `policy`, `new=1`, active 세션 재사용 | P0 |
| GET | `/play/:id` | 상태 전환, 미답변 item 재사용 | P0 |
| POST | `/play/:id/answer` | `session_item_id` 필수, item 검증 | P0 |
| POST | `/play/:id/next` | 상태 확인 | P0 |
| POST | `/play/:id/abandon` | 신규 | P0 |
| GET | `/play/:id/result` | `completed`만 결과 | P0 |
| GET | `/review` | 302 → `/play` | P0 |
| GET | `/review?mode=weak` | 302 → `/play?intent=weak` | P0 |
| GET | `/stats` | CTA 변경, 모드별 지표 | P0 |
| GET | `/settings` | `learning_mode`, 조건부 필드 | P0 |
| POST | `/settings` | `learning_mode` 저장 | P0 |
| GET | `/settings/maintenance` | 수동 유지보수 (선택) | P1 |
| GET | `/admin/integrity` | 무결성 리포트 (관리자) | P1 |

### 17.1 `POST /play/start`

```text
입력:
  mode   = quick | typing | cloze | listening | weak | custom
  deck_id = custom일 때 필수
  policy  = session | daily (생략 시 users.learning_mode)
  new     = 1이면 active 세션 재사용하지 않음

동작:
  1. mode 정규화
  2. policy 결정
  3. active 세션 재사용 여부 확인
  4. buildSessionPlan()
  5. targetSize == 0 → /play?empty=1
  6. play_sessions INSERT
  7. → /play/:id
```

### 17.2 `POST /play/:id/answer`

```text
입력:
  session_item_id
  card_id
  shown_at
  choice | answer | rating | give_up

검증:
  - 세션 소유자
  - status == active
  - item.session_id == session.id
  - item.card_id == card_id
  - item.answered_at IS NULL
  - item.kind == prompt

실패:
  409 SESSION_NOT_ACTIVE
  409 ITEM_ALREADY_ANSWERED
  400 ITEM_CARD_MISMATCH
  404 ITEM_NOT_FOUND
```

> `shown_at`은 하위 호환용 입력이다. 서버는 `play_session_items.served_at`을 사용하고
> 클라이언트가 보낸 시각은 신뢰하지 않는다.

### 17.3 `GET /play/:id`

```text
1. 세션 조회
2. status/expiry 전환
3. completed → 결과
4. abandoned/expired → 안내
5. 미답변 item 있으면 그 카드 재사용
6. 없으면 serveNextCard()
7. 카드 없으면 complete
```

---

## 18. 정책 의사코드

### 18.1 `buildSessionPlan`

```ts
function buildSessionPlan(input: PolicyInput, daily?: TodayPlan): SessionPlan {
  if (input.mode === 'daily' && daily) {
    const remaining = Math.max(0, daily.target - daily.done);
    if (remaining === 0) return { targetSize: 0, reason: 'goal_done', ... };

    const size = Math.min(input.sessionSize, remaining);
    const reviewRemaining = Math.max(0, daily.reviewTarget - daily.reviewDone);
    const newRemaining = Math.max(0, daily.effectiveNew - daily.newDone);

    const reviewTarget = Math.min(reviewRemaining, size);
    const newTarget = Math.min(
      newRemaining,
      input.newPerSession,
      Math.max(0, size - reviewTarget)
    );

    return {
      targetSize: reviewTarget + newTarget,
      reviewTarget,
      newTarget,
      weakTarget: 0,
      reason: 'daily_plan',
      reasonText: planReasonText(daily),
    };
  }

  const size = clamp(input.sessionSize, 1, 20);

  if (input.kind === 'custom') {
    const newTarget = Math.min(input.deckNewCount, size);
    return { targetSize: newTarget, reviewTarget: 0, newTarget, weakTarget: 0, reason: 'session' };
  }

  if (input.kind === 'weak') {
    const weakTarget = Math.min(input.weakDueCount, size);
    return { targetSize: weakTarget, reviewTarget: 0, newTarget: 0, weakTarget, reason: 'session' };
  }

  if (input.kind !== 'quick') {
    const due = input.dueByType[input.kind === 'typing' ? 'recall' : input.kind] ?? 0;
    const dueCloze = input.kind === 'typing' ? (input.dueByType['cloze'] ?? 0) : 0;
    const reviewTarget = Math.min(due + dueCloze, size);
    return { targetSize: reviewTarget, reviewTarget, newTarget: 0, weakTarget: 0, reason: 'session' };
  }

  const reviewTarget = Math.min(input.dueCount, size);
  const newTarget = Math.min(input.newPerSession, Math.max(0, size - reviewTarget));
  return {
    targetSize: reviewTarget + newTarget,
    reviewTarget,
    newTarget,
    weakTarget: 0,
    reason: 'session',
  };
}
```

### 18.2 `serveNextCard`

```ts
async function serveNextCard(db, user, session, plan) {
  const pending = await getPendingItem(db, session.id);
  if (pending) return pending; // 새로고침 시 같은 문제

  const served = await countServedByBucket(db, session.id);
  const answered = session.answered;

  // 워밍업: 첫 2문제, 최근 24시간 Again due
  if (answered < 2 && served.review < plan.reviewTarget) {
    const warm = await nextWarmupCard(db, user.id, now, now - 24h);
    if (warm) return createItem(db, session, warm, 'review');
  }

  // quick: 3번째부터 새 단어를 섞는다
  if (session.kind === 'quick' && answered >= 2 && served.new < plan.newTarget) {
    const fresh = await pickNewCard(db, user, session);
    if (fresh) return createItem(db, session, fresh, 'new');
  }

  if (served.review < plan.reviewTarget) {
    const card = await pickDueCard(db, user, session);
    if (card) return createItem(db, session, card, 'review');
  }

  if (served.new < plan.newTarget) {
    const card = await pickNewCard(db, user, session);
    if (card) return createItem(db, session, card, 'new');
  }

  if (served.weak < plan.weakTarget) {
    const card = await pickWeakCard(db, user, session);
    if (card) return createItem(db, session, card, 'weak');
  }

  return null;
}
```

### 18.3 `answer`

```ts
async function answer(user, session, item, input) {
  if (session.status !== 'active') return error('SESSION_NOT_ACTIVE');
  if (item.answered_at) return error('ITEM_ALREADY_ANSWERED');
  if (item.card_id !== input.card_id) return error('ITEM_CARD_MISMATCH');

  const card = await getCardForReview(user.id, item.card_id);
  const result = grade(card, input);
  const saved = await saveReview(user.id, card, result.rating, now, {
    sessionId: session.id,
    sessionItemId: item.id,
    reviewKey: item.id,
    answer: result.answer,
    responseMs: result.responseMs,
    source: session.mode === 'weak' ? 'weak' : 'review',
  });

  if (!saved) return error('REVIEW_SAVE_FAILED');
  await runPostReviewTasks(user, card, saved, now);
  return feedback(result);
}
```

---

## 19. 테스트 계획

### 19.1 단위 테스트

| ID | 대상 | 케이스 |
|---|---|---|
| U1 | `buildSessionPlan` | session quick: due 10, size 5, newPerSession 2 → review 5, new 0 |
| U2 | `buildSessionPlan` | session quick: due 2, size 5, newPerSession 2 → review 2, new 2 |
| U3 | `buildSessionPlan` | daily: remaining 4, size 5 → target 4 |
| U4 | `buildSessionPlan` | daily: goal done → target 0, reason goal_done |
| U5 | `buildSessionPlan` | typing: recall 3 + cloze 2, size 5 → review 5 |
| U6 | `buildSessionPlan` | weak: weakDue 7, size 5 → weak 5 |
| U7 | `buildSessionPlan` | custom: deckNew 3, size 5 → new 3 |
| U8 | `computeAdaptiveNew` | 기존 M6 테스트 유지 |
| U9 | `ratingFromQuiz` | 기존 규칙 회귀 |
| U10 | `computeWeakness` | confidence low/medium/high |
| U11 | `localDate` | IANA DST 경계 |

### 19.2 통합 테스트 (로컬 D1)

| ID | 시나리오 | 기대 |
|---|---|---|
| I1 | `/play` 세션 생성 | `play_sessions.status='active'`, targets 저장 |
| I2 | 카드 출제 | `play_session_items` 1건, `served_at` 기록 |
| I3 | 새로고침 | 같은 item, 같은 `review_key` |
| I4 | 정상 답안 | review 1건, item.answered_at, `play_session_stats.answered` 1 |
| I5 | 같은 item 재전송 | review 1건 유지, 409 |
| I6 | 두 탭 동시 제출 | review 1건, 파생 answered 1 |
| I7 | 완료 후 제출 | 409, review 추가 없음 |
| I8 | `answered >= target_size` | status completed, completed_at |
| I9 | 만료 세션 GET | status expired, 결과 대신 안내 |
| I10 | 중단 세션 | status abandoned, 통계 제외 |
| I11 | `/review` GET | 302 `/play` |
| I12 | `/review?mode=weak` | 302 `/play?intent=weak` |
| I13 | daily 모드 시작 | `daily_plans` 생성, 남은 목표 반영 |
| I14 | daily 목표 완료 | target 0, goal_done |
| I15 | session 모드 | `daily_plans` 생성하지 않음 |
| I16 | 승급 실패 후 `/play` 시작 | `ensureUnlocks` 복구 |
| I17 | 듣기 On 저장 | listening 카드 생성 |
| I18 | `play_session_stats` vs review 수 | 항상 일치 |
| I19 | 다른 사용자 세션 접근 | 404/403 |
| I20 | 다른 사용자 카드 답안 | 404 |
| I21 | `custom` 다른 사용자 deck | 카드 없음, 데이터 노출 없음 |
| I22 | `/stats` CTA | `/play` 링크 |

### 19.3 수동 테스트

- [ ] 홈에서 session/daily 모드 전환 후 시작 버튼 문구 확인
- [ ] 설정에서 모드별 필드만 보이는지 확인
- [ ] `/review` 북마크 → `/play` 이동
- [ ] 세션 중 새로고침 → 같은 문제
- [ ] 두 탭에서 같은 문제 제출 → 한 번만 저장
- [ ] 세션 중 브라우저 종료 → 재접속 시 이어서
- [ ] 24시간 지난 세션 → 만료 안내
- [ ] daily 모드에서 목표 달성 → 완료 화면
- [ ] KST/뉴욕 DST 경계에서 `local_date`
- [ ] TTS 재생 후 듣기 카드 응답 시간
- [ ] 취약 연습 시작/빈 상태
- [ ] 관리자 무결성 리포트

---

## 20. 롤아웃 계획

### 20.1 단계

| 단계 | 내용 | 롤백 |
|---|---|---|
| 1 | 마이그레이션 0013~0015 적용 (테이블/컬럼만) | 새 컬럼/테이블은 무시 가능 |
| 2 | 정책 엔진 + 세션 상태 + item 출제/검증 배포 | `learning_mode='session'` 기본 |
| 3 | 기존 세션 item 백필 + 무결성 확인 | 백필 중단, 테이블 유지 |
| 4 | 0016 트리거 적용 (item 검증/마킹) | 트리거 DROP, 기존 경로 복원 |
| 5 | `/review` 리다이렉트 | `LEGACY_REVIEW=1` |
| 6 | 통계/설정 정리 | UI만 되돌리기 |
| 7 | P1 계측 배포 | 컬럼은 nullable |

> **중요**: 0015의 테이블과 0016의 트리거를 한 마이그레이션에 넣지 않는다.
> 트리거가 먼저 활성화되면 item을 만들지 않는 구버전 앱의 답안이 모두 실패한다.
> 0013~0015 적용 → 새 앱 배포 → item 백필 → 0016 트리거 적용 순서를 지킨다.
> 세션 카운터는 리뷰에서 파생되므로 트리거 적용 시점의 이중 증가 문제가 없다.

### 20.2 모니터링

- 세션 완료율
- `answered` vs `reviews` 불일치
- `PLAY_SESSION_ITEM_NOT_FOUND` 발생 수
- 승급 실패 로그
- 응답 시간 p50/p90
- `/play` 이탈률

### 20.3 롤백

- 정책: `learning_mode`를 `session`으로 강제.
- 세션: `play_session_items` 트리거 비활성화, `incrementPlaySession()` 복원.
- `/review`: `LEGACY_REVIEW=1`.
- 마이그레이션은 DROP하지 않고 컬럼/테이블을 남긴다.

---

## 21. 완료 조건 (Definition of Done)

### 21.1 M8 P0

- [ ] `/play`와 `/review`가 같은 정책 엔진을 쓴다.
- [ ] `learning_mode` session/daily가 동작한다.
- [ ] `/review`는 `/play`로 리다이렉트된다.
- [ ] 세션 상태 `active/completed/abandoned/expired`가 동작한다.
- [ ] 모든 답안이 `play_session_items`를 통과한다.
- [ ] 리뷰 저장과 세션 문항 상태가 트리거로 원자적이다.
- [ ] 세션 카운터(`play_session_stats`)가 리뷰 수와 항상 일치한다.
- [ ] `/play`만 사용해도 승급 복구가 동작한다.
- [ ] `/stats` CTA와 설정이 모드에 맞게 정리된다.
- [ ] 기존 데이터가 보존된다.
- [ ] `npm run typecheck`, `npm test` 통과.
- [ ] 신규 통합 테스트 I1~I22 통과.
- [ ] 마이그레이션 후 무결성 점검 0건.

### 21.2 P1

- [ ] 평점 신호(`prompt_started_at`, `first_input_at`, `confidence`, `grading_reliability`)가 기록된다.
- [ ] 취약 목록에 신뢰도/표본 수가 표시된다.
- [ ] 무결성 스크립트가 동작한다.
- [ ] CSRF Origin 검증, 접근 제어 테스트, rate limit이 적용된다.
- [ ] IANA 시간대가 지원된다.
- [ ] D1 백업·복구 절차가 문서화된다.

### 21.3 P2

- [ ] 오답 마무리가 FSRS와 분리되어 동작한다.
- [ ] Word Mastery 단계와 숙련도 분포가 표시된다.
- [ ] 대시보드에 취약/숙련도/예상 복습량이 표시된다.
- [ ] 피로도 안내가 강제 제한 없이 동작한다.
- [ ] 주간/월간 리포트가 제공된다.

---

## 22. 리스크와 열린 질문

| 리스크 | 영향 | 대응 |
|---|---|---|
| D1 트리거 지원/동작 차이 | 답안 저장 실패 | 로컬 D1 + 원격 스테이징에서 검증 |
| 세션 item과 리뷰의 이중 기록 | 저장 실패 시 불일치 | 트리거 + 무결성 점검 |
| 다중 탭 | 같은 카드 중복 | item 단위 잠금 |
| daily/session 모드 혼용 | 통계 해석 혼란 | 모드별 지표 분리, 모드 표시 |
| 기존 `/review` 사용자 | 갑작스러운 UI 변경 | `LEGACY_REVIEW` 플래그, 공지 |
| TTS/모바일 지연 | 평점 왜곡 | `prompt_started_at`, `first_input_at` |
| DST | local_date 오류 | IANA + 경계 테스트 |
| 트리거로 인한 마이그레이션 복잡도 | 배포 실패 | 단계별 배포, 롤백 SQL 준비 |

열린 질문:

1. `daily` 모드에서 `custom` 새 단어가 하루 신규를 소모하는가?
   - 제안: 소모한다. 단, `newRemaining`을 넘지 않는다.
2. `weak` 연습이 `daily_review` 상한을 소모하는가?
   - 제안: 소모하지 않는다. 취약 연습은 별도 트랙.
3. 세션 만료 기준은 24시간인가, 6시간 무활동인가?
   - 제안: `expires_at = 시작 + 24시간`, `abandoned = 6시간 무활동`.
4. `review_key`를 `item.id`로 바꾸면 기존 `/review`와 통계가 섞이는가?
   - 제안: `review_key`는 멱등키일 뿐 의미가 없다. `/review`는 기존 형식을 유지한다.
5. `Mastered`에 `listening`을 포함하는가?
   - 제안: 포함하지 않는다. 인식 카드로 본다.
6. 평점 임계값을 카드 유형별로 바꾸는 시점은?
   - 제안: 최소 500건 이상의 유형별 리뷰가 쌓인 뒤 P1에서 A/B 없이 단계 적용.

---

## 23. 마일스톤 매핑

| 마일스톤 | 범위 | 관련 P |
|---|---|---|
| **M8** | 정책 통합, 세션 상태, item 원자성, 승급 복구, CTA/설정/문서 | P0 |
| **M9** | 평점 계측·보정, 취약 신뢰도, 무결성, 보안, 시간대 | P1 |
| **M10** | 오답 마무리, 적응형 학습 엔진 고도화 | P1/P2 |
| **M11** | Word Mastery, 숙련도 통계 | P2 |
| **M12** | 대시보드, 피로도, 리포트 | P2 |

---

## 24. 최종 요약

M8의 본질은 기능 추가가 아니라 **학습 정책의 단일화**다.

- `/play`와 `/review`가 같은 정책을 쓴다.
- 세션은 명시적인 상태를 갖는다.
- 모든 답안은 서버가 발급한 item에 대해서만 저장된다.
- 리뷰 저장과 세션 문항 상태는 같은 트랜잭션에서 갱신된다.
- 세션 카운터는 리뷰에서 파생되어 불일치가 생기지 않는다.
- 승급 복구는 진입 경로와 무관하게 동작한다.
- 통계와 설정은 현재 모드와 일치한다.

이것이 끝나면 그다음 단계에서 평점 신뢰도, 취약도 신뢰도, 숙련도, 학습 경험을
안전하게 올릴 수 있다.

---

## 25. 확정된 정책 (2026-11-05)

| 항목 | 결정 |
|---|---|
| `daily` 모드의 `custom` 새 단어 | `daily_new` 잔여량을 소모한다. `newRemaining`을 넘지 않는다 |
| `weak` 연습 | 하루 계획 목표를 소모하지 않는 별도 트랙. 단, 남은 `daily_review` 상한을 넘지 않는다 |
| 세션 만료 | 시작 후 24시간 |
| 세션 중단 | 6시간 무활동 시 `abandoned` |
| `review_key` | `/play`는 `play_session_item.id`, 레거시 `/review`는 `card_id:shown_at` |
| `listening`의 Mastered 판정 | 인식 카드로 보고 Mastered에서 제외한다 |
| 평점 모델 | P1에서는 계측만 한다. 임계값 변경은 유형별 표본이 쌓인 뒤 적용한다 |

---

## 26. 구현 현황 (2026-11-05)

M8.1 + M8.2 기반 작업 완료:

- [x] `0013_learning_mode.sql` — `learning_mode`, `last_unlock_check_at` + daily 백필
- [x] `0014_play_session_state.sql` — 세션 상태·정책 스냅샷·만료 시각·카운터 백필
- [x] `0015_play_session_items.sql` — 출제 문항 테이블
- [x] `0016_play_session_triggers.sql` — item 백필, item 검증/마킹 트리거, `play_session_stats` 뷰
- [x] `src/lib/learning-policy.ts` — session/daily 정책, 버킷 배분, backlog 경고
- [x] 정책 단위 테스트 — session/daily/weak/custom/backlog/음수 입력
- [x] 마이그레이션 테스트 — 기존 사용자·세션 보존, weak/custom 백필, 0016 뷰/트리거
- [x] `users.learning_mode` 타입·인증 계층 연결
- [x] 설정 화면 학습 방식 선택·저장
- [x] `/play` 세션 생성 시 정책 스냅샷 저장
- [x] `/play`에서 승급된 `recall`/`cloze`/`listening` new 카드 출제
- [x] `/play/:id/answer`의 `session_item_id` 검증
- [x] `review_key = item.id` 적용
- [x] 새로고침 시 같은 item/`served_at` 재사용
- [x] `play_sessions.answered/correct`를 `play_session_stats`에서 파생
- [x] 세션 `active/completed/abandoned/expired` 전환
- [x] `그만두기`로 세션 중단
- [x] `/play` 시작 시 `ensureUnlocks()` 호출
- [x] `/review` → `/play` 리다이렉트 (`LEGACY_REVIEW=1`로 유지 가능)
- [x] `/stats` CTA를 `/play`로 변경
- [x] 설정의 하루 목표 항목을 `daily` 모드에서만 노출
- [x] `/play` 홈에 오늘 목표 진행률·복습/승급/신규·예상 시간 표시
- [x] 로컬 D1 마이그레이션 적용 + 실제 `/play` 답안 저장 스모크 테스트
- [x] daily 모드 설정 저장 → `/play` 목표 카드 표시 스모크 테스트

P1.1 평점 신뢰도 계측 완료:

- [x] `0017_review_rating_signals.sql` — `prompt_started_at`, `first_input_at`, `confidence`, `rating_model_version`, `grading_reliability`
- [x] `src/lib/rating-config.ts` — 카드 유형별 시간 기준, `computeGradingReliability`
- [x] `saveReview()`가 신호를 저장
- [x] `/play`에서 `prompt_started_at`(특히 듣기), `first_input_at`을 hidden 필드로 수집
- [x] 클라이언트 JS가 첫 입력/선택 시각과 TTS 시작 시각을 기록
- [x] 평점 규칙(`ratingFromQuiz`)은 변경하지 않음
- [x] 스모크 테스트로 `grading_reliability` 저장 확인

P1.2 취약 신뢰도·무결성 완료:

- [x] `computeWeakness()`에 `confidence`, `sampleSize`, `factors` 추가
- [x] 취약 목록 정렬: weak 우선, 신뢰도 높은 순, 점수 순
- [x] `/hard`에 `신뢰도 높음/보통/데이터 부족 (N/20)` 표시
- [x] `src/db/integrity.ts` — 카드/리뷰 불일치, 세션 문항 불일치, 고아 데이터, 승급 후보 점검
- [x] `scripts/check-integrity.mjs` + `npm run check:integrity`
- [x] 무결성 테스트 3종 (정상/불일치/고아 데이터)
- [x] 로컬 D1에서 `check:integrity` 실행 확인

P1.3 보안 기준선 완료:

- [x] 상태 변경 요청에 `Origin`/`Referer`/`Sec-Fetch-Site` 검증
- [x] 보안 헤더 추가 (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy)
- [x] Google OAuth PKCE (`S256`) 적용
- [x] `nonce` 미사용 근거 문서화 (userinfo 플로우)
- [x] 접근 제어 테스트: 다른 사용자의 단어장/카드/세션/리뷰 변경 차단
- [x] 보안·PKCE 단위 테스트
- [x] 로컬 스모크 테스트: cross-site POST 403, same-origin POST 302

P1.4 IANA 시간대 완료:

- [x] `0018_users_timezone.sql` — `users.timezone` + `Asia/Seoul`/`UTC` 백필
- [x] `localDate()`가 IANA 시간대와 오프셋 fallback 지원
- [x] `isValidTimeZone()` 추가
- [x] 모든 `local_date` 계산에 `user.timezone` 전달
- [x] 설정 화면에 IANA 시간대 입력 + 유효성 검사
- [x] 홈 날짜 표시를 IANA 기준으로 변경
- [x] DST 경계 테스트 (`America/New_York`, `Europe/London`)
- [x] 로컬 스모크 테스트: 유효/무효 시간대 저장 확인

P1.5 평점 캘리브레이션 분석 완료:

- [x] `src/lib/rating-analysis.ts` — 평점별·유형별·신뢰도 구간별 성과, 7/21일 유지율
- [x] `scripts/analyze-ratings.mjs` + `npm run analyze:ratings`
- [x] `--user`, `--json`, `--db` 옵션
- [x] 다음 리뷰 평점 기반 성공률, 응답 시간 p50/p90
- [x] 순수 분석 테스트 4종
- [x] 로컬 D1에서 분석 실행 확인

P1.6 선택적 confidence UI 완료:

- [x] `0019_confidence_mode.sql` — `users.confidence_mode` (`off` / `sample` / `always`, 기본 `sample`)
- [x] 설정 화면에서 확신도 질문 빈도 선택
- [x] `/play` 답변 후 `sample`은 5문제마다, `always`는 매 문제 질문
- [x] `POST /play/:id/confidence`로 리뷰의 `confidence` 갱신
- [x] confidence 갱신 시 `grading_reliability` 재계산
- [x] `shouldAskConfidence()` 순수 함수 + 테스트
- [x] 다른 사용자/다른 세션의 리뷰 갱신 차단
- [x] 로컬 스모크 테스트: 프롬프트 표시 → confidence 저장 확인

P1.7 요청 제한 완료:

- [x] `0020_rate_limits.sql` — 고정 윈도우 카운터 테이블
- [x] `src/lib/rate-limit.ts` — 경로별 정책, D1 기반 제한
- [x] 로그인/OAuth 10회/분 (IP)
- [x] `/play/start`, 답안, confidence, 중단 제한 (사용자)
- [x] 단어장·단어·시드 쓰기/삭제, 퀴즈, 설정 제한
- [x] 429 + `Retry-After` 응답
- [x] rate limit 저장 실패 시 학습을 막지 않는 best-effort
- [x] 단위 테스트 + 로컬 스모크 테스트 (11번째 요청 429)

P1.8 D1 백업·복구 완료:

- [x] `scripts/backup-d1.mjs` — 원격/로컬 D1 export, 타임스탬프 파일
- [x] `scripts/restore-drill.mjs` — 백업을 임시 SQLite에 복원 후 `PRAGMA integrity_check` + 앱 무결성 점검
- [x] `npm run db:backup`, `db:backup:local`, `db:restore:drill`, `db:restore:drill:remote`
- [x] `docs/11-backup-restore.md` — 백업 보관, 원격/로컬 복구, 장애 대응
- [x] `backups/` gitignore
- [x] 로컬 백업 + 복구 리허설 성공 (2.6MB, 3 users, integrity ok)

M10 오답 마무리 완료:

- [x] `play_session_items.kind='wrapup'` 기반 재출제
- [x] 목표 달성 후 틀린 `prompt` item 최대 2개 재노출
- [x] 오답 마무리는 `reviews`를 만들지 않고 FSRS 일정을 바꾸지 않음
- [x] `answerWrapupItem()`로 item 정답만 갱신
- [x] 결과 화면 `오답 다시 보기 N / M`
- [x] 목표 달성 후 오답 마무리가 남은 세션을 홈 “이어서” 대상에 포함
- [x] 무결성 점검에서 `kind='prompt'`만 리뷰 누락 대상으로 처리
- [x] 최대 2개 제한·리뷰 미생성·통계 테스트
- [x] 로컬 스모크 테스트: 오답 → 마무리 문제 → 결과 확인

M11 Word Mastery 완료:

- [x] `0021_word_mastery.sql` — new/learning/familiar/known/mastered 뷰
- [x] `src/db/mastery.ts` — `getMasteryCounts`, `masteredCount`
- [x] `/stats`에 숙련도 분포 (마스터·외운·익숙·학습 중·새 단어)
- [x] mastery 판정 테스트 4종
- [x] 로컬 스모크 테스트: 숙련도 섹션과 분포 표시 확인

M12 학습 경험 고도화 완료:

- [x] `src/lib/fatigue.ts` — 최근 정확도·하락폭·처리량·밀린 복습 기반 피로도
- [x] `src/db/report.ts` — 학습 펄스, 주간 리포트, 최장 연속 학습
- [x] `/play` 홈에 최근 정확도·오늘 문제 수·7일 학습일·피로도 배너
- [x] `/stats`에 이번 주 vs 지난 주 리포트와 최장 연속 학습
- [x] 순수 피로도 테스트 6종, 리포트 DB 테스트 4종
- [x] 로컬 스모크 테스트: `/play` 펄스, `/stats` 주간 리포트·숙련도 확인

Release 준비 완료:

- [x] `npm run verify` — typecheck + test + migration 순서 + seed 검수
- [x] `npm run check:migrations` — 0001부터 연속성 검사
- [x] `predeploy` — verify + build 자동 실행
- [x] `docs/12-release-checklist.md` — 배포·스모크·롤백·관찰 체크리스트
- [x] 0016 트리거 호환 경계와 긴급 롤백 SQL 문서화
- [x] 원격 배포 순서: 백업 → `db:remote` → `deploy` → 무결성 점검

남은 P1:

- [ ] 카드 유형별 임계값 적용 (표본 확보 후)


