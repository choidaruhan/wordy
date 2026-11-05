# 07. 학습 엔진 명세 — M6

> **이 문서는 M6의 계약서입니다.**
> M6.1~M6.6 구현은 이 문서의 정의를 바꾸지 않는 한 이 문서를 기준으로 합니다.
> 코드가 이 문서와 다르면 코드를 고칩니다. 문서가 현실과 다르면 **이 문서를 먼저** 고칩니다.

> **M7 변경**: 메인 학습 진입점은 `/play`다. 하루 목표·일일 쿼터·`daily_plans`는
> `/review` 레거시 경로에만 적용되고, `/play`는 `play_sessions`와 세션 단위 제한을 쓴다.
> 구현은 `src/routes/play.tsx`, `src/db/play.ts`, `src/lib/play.ts`에 있다.

| 항목 | 내용 |
|---|---|
| 대상 | M6.1 ~ M6.6 |
| 전제 | FSRS 6, 카드별 학습 상태, 영→한·한→영·빈칸 카드, leech 격리 |
| 비목표 | XP·레벨, 소셜, AI 튜터, 실제 음성 파일, 다국어 UI, DST 대응 |
| 관련 문서 | [03-data-model.md](03-data-model.md), [04-srs.md](04-srs.md), [06-learning-design.md](06-learning-design.md) |

> **문서 관계**
> `06-learning-design.md`는 “왜 이렇게 가르치는가”를 다루고, 이 문서는 “M6에서 무엇을 어떤 값으로 구현하는가”를 다룹니다.
> 06의 7절 “외웠다의 정의”와 04의 “승급은 같은 트랜잭션” 표현은 이 문서가 대체합니다.

---

## 0. 목적·범위·비목표

### 0.1 목적

이미 동작하는 FSRS를 **측정 가능한 학습 시스템**으로 만든다.

1. 무엇을 왜 복습하는지 사용자에게 설명한다.
2. 틀린 단어를 “격리”와 “취약”으로 나눠 관리한다.
3. 하루 학습량을 복습 부담에 맞춰 자동으로 조절한다.
4. 학습 품질을 정답률 하나가 아니라 여러 지표로 본다.
5. 리뷰 로그와 FSRS 상태가 어긋나지 않게 한다.

### 0.2 원칙

- **FSRS는 단일 진실원(single source of truth)이다.** 새로운 스케줄러를 만들지 않는다.
- **파생 지표는 저장하지 않고 읽을 때 계산한다.** Known/Mastered/Weak는 파생 상태다.
- **퀴즈는 학습 스케줄을 바꾸지 않는다.** 취약 신호로만 쓴다.
- **자동 조절은 줄이는 방향으로만 한다.** 사용자가 고른 신규 수를 자동으로 늘리지 않는다.
- **변경 이유를 사용자에게 보여준다.** 조용한 조절은 신뢰를 깎는다.

### 0.3 비목표

- XP, 레벨, 뱃지, 리더보드
- 소셜 기능, 친구, 공유
- AI 예문 생성·AI 튜터
- 실제 원어민 음성 파일 배포 (TTS만)
- 다국어 UI
- DST가 있는 타임존의 IANA 대응 (v1은 고정 오프셋)

---

## 1. 현재 구조와 불변식

### 1.1 테이블

```text
users ─1:N─ decks ─1:N─ words ─1:N─ cards ─1:N─ reviews
   └──────────── sessions
   └──────────── daily_plans (M6.3에서 추가)
   └──────────── quiz_sessions ─1:N─ quiz_questions
```

| 테이블 | 역할 |
|---|---|
| `words` | 단어 콘텐츠. 단어장에 속한다 |
| `cards` | 단어 1개가 가진 카드 여러 장. **FSRS 상태의 진실원** |
| `reviews` | 리뷰 1건의 감사 로그. 통계·취약 분석의 원천 |
| `quiz_*` | 객관식 테스트. FSRS와 분리 |

### 1.2 불변식

1. 모든 단어는 `recognition` 카드를 정확히 1장 가진다.
2. 카드 유형마다 FSRS 상태는 독립이다. 같은 단어라도 영→한과 한→영의 `due_at`은 다르다.
3. `state`와 `due_at`은 분리한다. `Known`이어도 복습 예정일이 도래할 수 있다.
4. 리뷰 1건은 `cards` UPDATE와 `reviews` INSERT가 **함께 성공**해야 한다.
5. FSRS 스케줄의 진실원은 `cards`다. `reviews`는 감사 로그이며, 최신 로그와 카드가 어긋나면 카드가 우선이다.
6. 퀴즈는 `cards`/`reviews`를 변경하지 않는다.
7. `leech`는 `suspended = 1`이다. `weak`와 별개다.
8. 날짜는 UTC ISO 문자열로 저장하고, 사용자 로컬 날짜(`local_date`)는 **쓰기 시점**에 계산한다.
9. 승급(`recall`/`cloze`/`listening` 카드 생성)은 **best-effort**다. 실패해도 리뷰 저장은 유지되며,
   `/review` 로드 시 `ensureUnlocks`로 누락분을 재시도한다.

### 1.3 M6.1에서 해결한 불일치 (이력)

아래 항목은 M6.1에서 모두 수정했다. 회귀 방지를 위해 이력으로 남긴다.

| # | 현재 동작 | 목표 | 처리 |
|---|---|---|---|
| 1 | `daily_review` 상한이 큐에 적용되지 않음 (`nextDueReview`가 무제한 1장 조회) | 상한만큼만 복습 | M6.1 |
| 2 | 홈의 `due`가 신규 카드까지 포함 (`state` 필터 없음) | 복습 대기 + 오늘 신규만 표시 | M6.1 |
| 3 | `saveReview`가 UPDATE와 INSERT를 각각 실행 | 한 트랜잭션으로 저장 | M6.1 |
| 4 | 승급 카드가 신규 쿼터를 소모 (`reps_before = 0` 전체 카운트) | 승급 카드는 `daily_new` 미소모, `daily_review`에는 포함 | M6.1 |
| 5 | `learnedCount`가 카드 수를 셈 | 단어 수로 계산 | M6.1 |
| 6 | 정답률이 `rating >= 3` (Hard를 오답 처리) | `rating >= 2`를 “회상 성공”으로 정의 | M6.1 |
| 7 | `maybeUnlock*`가 저장 트랜잭션 밖 | best-effort로 문서와 코드 일치 | M6.1 |

> 6번은 **의도적인 동작 변경**이다. FSRS에서 `Again`만 실패이고 `Hard`는 어렵게라도 회상한 것이다.
> 기존 “정답률” 숫자는 M6.1 이후 높아질 수 있으므로, 목표치도 함께 재보정한다.

---

## 2. 용어와 상태

### 2.1 카드 상태 (FSRS)

| state | 의미 | due_at |
|---|---|---|
| `new` | 한 번도 리뷰하지 않음 | 생성 즉시 |
| `learning` | 학습 스텝 진행 중 | 수 분 뒤 |
| `review` | 정착됨 | 수 일~수 개월 뒤 |
| `relearning` | 잊어서 재학습 중 | 수 분 뒤 |

### 2.2 단어 표시 상태 (파생)

단어 상태는 저장하지 않는다. 카드와 리뷰를 읽어 계산한다.

| 상태 | 정의 |
|---|---|
| `new` | 모든 카드의 `reps = 0` |
| `learning` | `reps > 0`인 카드가 있으나 `state = 'review'`인 카드가 없음 |
| `review` | `state = 'review'`인 카드가 있으나 `known` 미만 |
| `known` | 아래 2.3 |
| `mastered` | 아래 2.3 |
| `weak` | `weakScore >= 0.6`이고 `leech`가 아님 |
| `leech` | `suspended = 1`인 카드가 하나라도 있음 |

**표시 우선순위**: `leech` > `weak` > `mastered` > `known` > `review` > `learning` > `new`

### 2.3 Known / Mastered

`recognition`은 입구, `recall`/`cloze`는 출구다.
출구 없이 “외웠다”고 말하지 않는다.

```text
production cards = card_type in ('recall', 'cloze')

known(word):
  recognition.state = 'review'
  AND recognition.scheduled_days >= 21
  AND production cards 1장 이상 존재
  AND max(production.scheduled_days) >= 7

mastered(word):
  recognition.state = 'review'
  AND recognition.scheduled_days >= 60
  AND production cards 1장 이상 존재
  AND min(production.scheduled_days) >= 21
```

- `known`은 “적어도 한 방향으로 꺼낼 수 있다”는 뜻이다.
- `mastered`는 “있는 모든 출구 카드가 안정적이다”라는 뜻이다.
- 기능어는 `recall`이 없으므로 `cloze`가 출구다.
- 예문이 없어 `cloze`가 없더라도 `recall`만으로 `mastered`가 될 수 있다.
  한→영 카드만으로도 능동적 회상이 가능하기 때문이다.
- **생산형 카드가 하나도 없으면 `known`/`mastered` 판정 대상이 아니다.**
  이 단어는 `review` 또는 `learning`으로 표시하고, 승급 조건을 안내한다.
- `listening`은 출구가 아니라 인식 카드로 본다. `mastered` 판정에 사용하지 않는다.

> **대시보드의 “외운 단어”는 카드 수가 아니라 단어 수다.**
> 카드 3장이 각각 21일을 넘겨도 단어는 1개로 센다.

---

## 3. 카드 유형과 승급

| 유형 | 자극 | 사용자가 하는 일 | 생성 시점 |
|---|---|---|---|
| `recognition` | 영어 단어 | 4지선다에서 뜻을 고른다 | 단어 생성 시 |
| `recall` | 한국어 뜻 | 철자를 입력한다 | 아래 승급 조건 |
| `cloze` | 빈칸 문장 | 빈칸에 단어를 넣는다 | 아래 승급 조건 |
| `listening` | 🔊 음성 | 듣고 철자를 입력한다 | 설정 활성화 + 아래 조건 |

### 3.1 승급 조건

```text
recall:
  recognition.state = 'review'
  AND recognition.scheduled_days >= 4
  AND words.pos not in ('det','pron','prep','conj','modal')

cloze:
  recognition.state = 'review'
  AND recognition.stability >= 7
  AND words.example 존재
  AND blankOut(words.example, words.term) != null

listening:
  users.listening_enabled = 1
  AND recognition.state = 'review'
  AND recognition.scheduled_days >= 14
```

- 기능어는 뜻→영어 답이 하나로 정해지지 않으므로 `recall`을 만들지 않는다.
- 예문에 기본형이 없으면(굴절 등) `cloze`를 만들지 않는다.
- `listening`은 기본 꺼짐이다. 사용자가 설정에서 켠 경우에만 승급한다.

### 3.2 승급 실행 규칙

- 리뷰 저장이 끝난 뒤 **best-effort**로 실행한다.
- `INSERT ... WHERE NOT EXISTS`로 중복 생성을 막는다.
- 승급 실패는 리뷰 저장에 영향을 주지 않는다.
- 승급된 카드는 `state = 'new'`, `due_at = now`로 생성한다.
- 누락을 복구하기 위해 `/review` 로드 시 `ensureUnlocks(userId)`를 실행한다.
  조건을 만족하는 `recognition` 카드 중 승급 카드가 없는 것을 찾아 생성한다.
- `ensureUnlocks`는 멱등적이며 리뷰 트랜잭션 밖에서 실행한다.
  승급 실패가 리뷰 저장을 막지 않으면서, 다음 로드에서 재시도된다.

### 3.3 쿼터

| 쿼터 | 적용 대상 |
|---|---|
| `daily_new` | **처음 보는 `recognition` 카드의 첫 리뷰**만 |
| `daily_review` | 그 외 모든 리뷰 (학습 스텝, 승급 카드 첫 리뷰, 복습 카드) |

- 승급 카드는 `daily_new`를 쓰지 않는다.
- 승급 카드는 `daily_review`에는 포함한다. 생산 연습도 학습 부담이기 때문이다.
- 학습 스텝(1분→10분)도 `daily_review`에 포함한다. 실제로 한 번 더 꺼내는 일이기 때문이다.

### 3.4 듣기 카드 규칙 (M6.5)

- 채점은 `recall`과 동일한 `gradeAnswer`를 쓴다.
- 재생 횟수 제한은 v1에서 두지 않는다. 대신 “다시 듣기”를 제공한다.
- 3회 이상 들어도 모르겠으면 “들리지 않아요” 버튼 → 정답 공개 + `Again`.
  TTS 품질 문제로 사용자를 벌하지 않기 위해서다.
- 발음 설정: `en-US` / `en-GB`, 속도 0.7~1.2.
- TTS가 없는 기기에서는 안내 문구를 보여주고 “들리지 않아요”로 정답을 확인하게 한다.
  카드를 만들지 않는 것은 아니다. 설정에서 켜 둔 사용자는 다른 기기에서 그대로 쓸 수 있다.
- 실제 음성 파일은 라이선스·용량 검토 후 `audio_url`로 대체한다.

### 3.5 퀴즈 자동 평점

사용자가 자기 기억을 평가하지 않는다. 정답 여부와 응답 시간으로 평점을 정한다.

```text
오답                         → Again (1)
오타 허용                    → Hard (2)
정답, response_ms > 8000     → Hard (2)
정답, 3000 < response_ms <= 8000 → Good (3)
정답, response_ms <= 3000    → 생산형(recall/cloze/listening)이면 Easy (4)
                               recognition이면 Good (3)
```

- `recognition`은 4지선다다. 찍어서 맞힌 경우를 구분하기 위해 `Easy`를 주지 않는다.
- 보기가 2개 미만인 단어는 기존 자기평가 화면으로 폴백한다.
- 응답 시간이 없으면 `Good`으로 둔다.
- 객관식 보기는 정답 뜻 + 사용자의 다른 단어 뜻 3개다. 정답은 서버가 문자열로 비교한다.
- `recognition`의 `grading_source`는 자동 채점이므로 `server`다. 폴백 자기평가만 `self`다.

---

## 4. 취약 단어 점수

### 4.1 계산 단위

- **카드 단위**로 계산하고, **단어 점수는 카드 점수의 최댓값**으로 한다.
- 이유: 영→한은 안정적인데 한→영만 계속 틀리는 단어를 놓치지 않기 위해서다.
- `listening`은 기본 꺼짐이므로, 켠 사용자만 계산에 포함한다.

### 4.2 입력값

| 값 | 출처 |
|---|---|
| `recentN`, `recentErrors` | 최근 20회 리뷰 |
| `totalN`, `totalErrors` | 전체 리뷰 |
| `lapses` | `cards.lapses` |
| `stability` | `cards.stability` |
| `state` | `cards.state` |
| `last_reviewed_at` | `cards.last_reviewed_at` |
| `quizWrongsLast30` | 최근 30일 퀴즈 오답 수 |

### 4.3 점수

```text
recentErrorRate = recentErrors / recentN
totalErrorRate  = totalErrors  / totalN

if recentN < 5:
    status = observing
    errorRate = totalErrorRate          # 참고용, 랭킹에는 사용하지 않음
elif recentN < 20:
    errorRate = 0.7 * recentErrorRate + 0.3 * totalErrorRate
else:
    errorRate = recentErrorRate

baseScore = 0.5 * errorRate
          + 0.3 * min(1, lapses / 8)
          + 0.2 * (1 - min(1, stability / 21))

quizBoost = min(0.15, 0.03 * quizWrongsLast30)
score = min(1, baseScore + quizBoost)
```

### 4.4 평가 대상

- `state in ('review', 'relearning')`
- `recentN >= 5`
- `last_reviewed_at`이 90일 이내
- `suspended = 0`

`learning` 카드는 평가하지 않는다. 아직 공정한 기회를 주지 않은 상태다.
`new` 카드도 당연히 제외한다.

### 4.5 상태

| 상태 | 조건 | 화면 |
|---|---|---|
| `observing` | `recentN < 5` | “관찰 중 (3/5회)” |
| `stale` | 마지막 리뷰 90일 초과 | “재확인 필요” |
| `weak` | `score >= 0.6` | “취약” |
| `attention` | `score >= 0.35` | “주의” |
| `good` | `score < 0.35` | “양호” |
| `leech` | `suspended = 1` | “격리” (별도 탭) |

- `leech`는 점수와 무관하게 별도 관리한다.
- `weak`/`attention` 단어만 “취약 단어 연습” 대상으로 삼는다.
- `observing`은 목록 하단에 접어서 보여준다.

### 4.6 방향 표시

단어 점수가 최댓값인 카드의 유형을 함께 저장한다.

```text
weakestDirection = argmax(cardScore)
```

화면에는 `취약 · 한→영`처럼 표시한다. 사용자가 “왜 이 단어가 취약인지”를 알 수 있어야 한다.

### 4.7 퀴즈 오답

- 퀴즈 오답은 `quizBoost`로만 반영한다.
- 최대 0.15점. 퀴즈만으로 `weak`가 되지 않게 상한을 둔다.
- 퀴즈는 `cards`/`reviews`를 변경하지 않는다.
- 퀴즈 오답이 많아도 FSRS 복습 일정은 그대로다.

### 4.8 연습 정책

- `/review?mode=weak`는 **기한이 도래한 취약 단어만** 보여준다.
- 기한 전 카드를 당겨서 복습하지 않는다. FSRS 간격을 왜곡하지 않기 위해서다.
- 취약 단어가 없으면 “오늘은 취약 단어 복습이 없습니다. 내일 N개 예정”을 보여준다.
- `leech`는 취약 연습에 넣지 않는다. 연상법 작성 → `resume` 후에만 큐로 돌아온다.

### 4.9 성능

- v1은 읽을 때 SQL 집계 + TS 점수 계산으로 구현한다.
- 최근 20회는 윈도 함수(`ROW_NUMBER`)로, 전체 리뷰는 `GROUP BY card_id`로 집계한다.
- 1,100단어·개인 사용 기준으로 충분하다. 느려지면 `word_stats` 물리화를 검토한다.
- `/hard`는 최대 200개만 렌더한다. 전체 개수는 별도 COUNT로 표시한다.

---

## 5. 하루 세션 설계

### 5.1 입력

| 값 | 정의 |
|---|---|
| `dueReview` | `state in ('learning','review','relearning')`, `due_at <= now`, `suspended = 0` |
| `promotedDue` | `state = 'new'`, `card_type in ('recall','cloze','listening')`, `due_at <= now` |
| `newAvailable` | `state = 'new'`, `card_type = 'recognition'` |
| `reviewDoneToday` | 오늘 리뷰 중 `daily_new` 대상이 아닌 것 |
| `newDoneToday` | 오늘 처음 본 `recognition` 카드 수 |

### 5.2 쿼터

```text
reviewCapacity = max(0, daily_review - reviewDoneToday)
reviewTarget   = min(dueReview, reviewCapacity)
promotedTarget = min(promotedDue, reviewCapacity - reviewTarget)
effectiveNew   = adaptiveNew(...)   # 6절
```

- 순서는 **복습 → 승급 → 신규**다. 복습이 가장 중요하고, 승급은 그다음, 신규는 마지막이다.
- `reviewDoneToday` = 오늘 리뷰 중 `NOT (reps_before = 0 AND question_type = 'recognition')`.
- `newDoneToday` = 오늘 리뷰 중 `reps_before = 0 AND question_type = 'recognition'`.
- `daily_new`는 `newDoneToday`에만 적용한다.
- 승급 카드는 `daily_new`를 쓰지 않지만 `daily_review`에는 포함한다.
- `daily_review` 상한에 도달하면 남은 복습은 내일로 넘긴다.

### 5.3 순서

```text
[1] 워밍업     최근 24시간 안에 Again을 받은 due 카드, 최대 5장
[2] 복습       dueReview, 유형 혼합
[3] 승급       promotedDue (한→영 / 빈칸 / 듣기)
[4] 신규       처음 보는 recognition, effectiveNew 만큼
[5] 마무리     이번 세션에서 Again을 받은 카드 중 due인 것, 최대 5장
```

- 워밍업은 별도 카드가 아니라 `reviewTarget` 안에서 먼저 보여주는 것이다.
- 마무리 재시험은 `daily_review` 상한에서 예외로 최대 5장까지 허용한다.
  세션 안에서 한 번 더 꺼내는 것이 그날 기억에 가장 효과적이기 때문이다.
- 구현에서는 계획 완료 후 2시간 안에 Again을 받은 due 카드를 최대 5장까지 다시 낸다.
- 신규와 복습은 섞지 않는다. 인지 부하를 낮추기 위해서다.

### 5.4 유형 혼합 (interleaving)

복습 블록 안에서만 유형을 섞는다.

| 유형 | 목표 비율 |
|---|---|
| `recognition` | 50% |
| `recall` | 30% |
| `cloze` | 20% |
| `listening` | 켠 경우 10% (recognition에서 차감) |

선택 규칙:

```text
for each type with available cards:
    deficit = targetRatio[type] - servedRatio[type]
choose the type with the largest deficit
tie-break: due_at이 가장 오래된 카드
```

- 해당 유형의 due 카드가 없으면 남은 유형의 비율을 정규화해 채운다.
- 엄격한 쿼터가 아니다. 굶는 유형이 생기지 않게 하는 가중치다.
- 신규 블록은 `recognition`만, 승급 블록은 `recall`/`cloze`/`listening`만 나온다.

### 5.5 진행률

- `done` = `daily_plans.created_at` 이후의 리뷰 수 (학습 스텝 포함)
- `planTarget` = `reviewTarget + promotedTarget + effectiveNew`
- 진행률 = `done / max(1, planTarget)`
- “장”은 리뷰 1건을 뜻한다. 같은 카드의 학습 스텝도 1장으로 센다.
- 별도로 “오늘 처음 꺼낸 단어 수”를 보여주고 싶으면 `newDoneToday`를 쓴다.

> 계획 생성 시각을 기준으로 세는 이유: 사용자가 하루 중간에 `/review`를 다시 열어도
> 이미 한 리뷰가 계획 목표에 중복으로 들어가지 않게 하기 위해서다.

### 5.6 하루 계획 스냅샷

M6.3에서 `daily_plans` 테이블을 추가한다.

```sql
CREATE TABLE daily_plans (
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date       TEXT NOT NULL,
  base_new         INTEGER NOT NULL,
  effective_new    INTEGER NOT NULL,
  review_target    INTEGER NOT NULL,
  promoted_target  INTEGER NOT NULL,
  due_count        INTEGER NOT NULL,
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  reason           TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  completed_at     TEXT,
  PRIMARY KEY (user_id, local_date)
);
```

- `/review`를 처음 열 때 `INSERT ... ON CONFLICT DO NOTHING`으로 하루 계획을 고정한다.
- 사용자가 설정을 바꿔도 당일 계획은 유지한다. 다음 날부터 반영한다.
- `completed_at`은 계획 목표(`reviewTarget + promotedTarget + effectiveNew`)에 도달했을 때 기록한다.
  목표가 0인 계획은 생성 즉시 완료로 본다.
- `daily_review` 상한 때문에 남은 due는 완료 판정에 포함하지 않는다. 그건 “내일 몫”이다.
- 이 스냅샷으로 “어제 계획 대비 완료율”과 “오늘 예상 시간”을 계산한다.

### 5.7 완료 화면

```text
오늘 계획 완료
복습 38 · 신규 4 · 취약 3

내일 예정 42장
취약 단어 5개 연습하기
```

- 남은 due가 상한 때문에 남아 있으면 “오늘 복습 상한에 도달했습니다. 남은 120장은 내일”을 보여준다.
- 신규가 0으로 조정됐으면 이유를 함께 보여준다.

---

## 6. 적응형 신규 단어 배분

### 6.1 입력

| 값 | 정의 |
|---|---|
| `base` | `users.daily_new` (5/10/20) |
| `overdue` | 기한 지난 복습 카드 수 (`state in learning/review/relearning`, `suspended=0`) |
| `throughput7` | 최근 7일 총 리뷰 수 / 7 |
| `adherence7` | 최근 7일 중 리뷰가 1건 이상 있는 날 / 7 |

- `overdue`에 신규 카드는 포함하지 않는다.
- `throughput7`은 신규·복습·학습 스텝을 모두 포함한다. 실제 처리 능력의 proxy다.
- M6.3 이후 `adherence7`은 “계획을 완료한 날 / 계획이 있던 날”로 교체한다.

### 6.2 계산

```text
daysToClear = overdue / max(1, throughput7)

backlogFactor =
    overdue == 0        ? 1 :
    daysToClear > 14    ? 0 :
    daysToClear > 7     ? 0.5 :
    daysToClear > 3     ? 0.75 : 1

adherenceFactor = adherence7 >= 0.6 ? 1 : 0.85

factor = overdue == 0 ? 1 : min(backlogFactor, adherenceFactor)
effectiveNew = clamp(floor(base * factor), 0, base)
```

### 6.3 원칙

1. 복습이 밀리면 신규를 줄인다.
2. 최근 학습일이 적으면 **완만하게** 줄인다. (0.85배, 과도한 처벌 금지)
3. 복습 밀림이 없으면 완료율과 무관하게 기본값을 유지한다.
4. 자동으로 기본값보다 늘리지 않는다.
5. 조정 이유를 화면에 표시한다.

### 6.4 이유 코드

| reason | 조건 | 문구 |
|---|---|---|
| `no_backlog` | `overdue == 0` | “복습이 밀리지 않아 설정한 신규 N개를 유지합니다.” |
| `heavy_backlog` | `daysToClear > 14` | “밀린 복습이 2주치 이상이라 오늘은 신규를 넣지 않습니다.” |
| `moderate_backlog` | `daysToClear > 7` | “밀린 복습을 먼저 끝내도록 신규를 절반으로 줄였습니다.” |
| `light_backlog` | `daysToClear > 3` | “복습 부담이 있어 신규를 25% 줄였습니다.” |
| `low_adherence` | `adherence7 < 0.6` | “최근 학습일이 적어 신규를 조금 줄였습니다.” |
| `fixed` | `new_card_mode = 'fixed'` | “설정한 신규 N개를 고정으로 진행합니다.” |
| `limited_new` | 사용 가능한 신규 카드가 계산값보다 적음 | “오늘 새로 볼 수 있는 단어가 N개라 그만큼만 진행합니다.” |

### 6.5 예외

- `new_card_mode = 'fixed'`이면 자동 조절을 하지 않는다. 대신 밀린 복습 경고만 보여준다.
- `effectiveNew = 0`이어도 승급 카드와 복습은 계속한다.
- 신규가 0이 된 날은 “오늘은 복습만”이라고 명시한다. 실패가 아니라 계획이다.
- 신규를 늘리는 자동 조절은 없음. 사용자가 설정에서 직접 올린다.

### 6.6 엣지 케이스

| 상황 | 결과 |
|---|---|
| 신규 사용자, 리뷰 0 | `overdue=0` → 기본값 |
| 1주일 쉬고 복귀, overdue 80 | `throughput7=0` → `daysToClear=80` → 0 |
| overdue 5, throughput 10 | `daysToClear=0.5` → 1.0 |
| overdue 100, throughput 20 | `daysToClear=5` → 0.75 |
| overdue 100, throughput 5 | `daysToClear=20` → 0 |
| overdue 0, adherence 0.2 | 기본값 유지 |

---

## 7. 학습 품질 측정 (A)

단순 정답률 하나로 실력을 평가하지 않는다. 아래 지표를 `/stats`에 표시한다.

### 7.1 첫 시도 정답률

- `attempt_seq = 1`인 리뷰만 사용한다.
- 단, 처음 보는 `recognition`의 소개 리뷰(`reps_before = 0`)는 제외한다.
  뜻을 방금 보여준 직후의 테스트라 공정한 첫 시도가 아니다.
- 승급 카드의 첫 리뷰(`reps_before = 0`, `question_type != recognition`)는 포함한다.
- `correct = rating >= 2`.

```text
firstAttemptAccuracy =
  count(attempt_seq = 1 AND NOT (reps_before = 0 AND question_type = 'recognition') AND rating >= 2)
  / count(같은 조건의 전체)
```

### 7.2 유형별 정답률

- `question_type`별로 `rating >= 2` 비율.
- 최근 30일, 표본 20건 미만이면 “표본 부족”.
- `recognition` / `recall` / `cloze` / `listening`을 각각 보여준다.

### 7.3 평균 응답 시간

- `response_ms`의 중앙값(p50)과 p90을 유형별로 표시한다.
- 최근 30일, 표본 20건 미만이면 “표본 부족”.
- 5분을 초과한 값은 쓰기 시점에 300,000ms로 clamp한다.
- 인식 카드는 “자극 → 보기 선택”까지, 입력 카드는 “자극 → 제출”까지를 잰다.
  뜻을 본 뒤 평점을 누르는 시간은 학습 시간이 아니므로 제외한다.

### 7.4 기억 유지율

| 지표 | 정의 | 창 |
|---|---|---|
| `retention_7d` | `elapsed_days >= 7`인 리뷰의 `rating >= 2` 비율 | 최근 30일 |
| `retention_21d` | `elapsed_days >= 21`인 리뷰의 `rating >= 2` 비율 | 최근 90일 |

- 표본 20건 미만이면 “표본 부족”.
- 이는 FSRS가 예측한 값이 아니라 **실제 회상 결과**다.
- 기존 “21일 이상 유지 카드 비율”은 예약 기준 지표로 남기고, 위 지표와 구분해 표시한다.

### 7.5 방향별 숙련도

- `recognition` 정답률과 `recall` 정답률을 나란히 보여준다.
- 기능어는 `recall` 대신 `cloze`를 출구로 표시한다.
- `directionGap = recognitionAccuracy - recallAccuracy`.
- 25%p 이상 벌어지면 “한→영 연습이 필요합니다” 안내를 띄운다.
- 단, 이 격자는 정상적인 경우가 많다. 목표는 격자를 없애는 것이 아니라 추세를 보는 것이다.

### 7.6 대시보드 지표

| 지표 | 정의 |
|---|---|
| `knownWords` | 2.3의 known 단어 수 |
| `masteredWords` | 2.3의 mastered 단어 수 |
| `weakWords` | weak + attention 단어 수 |
| `leechWords` | suspended 카드가 있는 단어 수 |
| `learningWords` | new도 known도 아닌 단어 수 |
| `newWords` | 모든 카드 `reps=0`인 단어 수 |
| `masteryRate` | `masteredWords / totalWords` |
| `todayProgress` | `done / planTarget` |
| `streak` | 기존 연속 학습일 |

---

## 8. 학습 부담 관리 (B)

### 8.1 권장 복습량

```text
recommendedReview = min(dueReview, daily_review)
overdueRemaining  = max(0, dueReview - recommendedReview)
```

- `dueReview > daily_review`이면 “오늘 N장, 남은 M장은 내일”을 보여준다.
- `daily_review`를 자동으로 늘리지 않는다.
- 3일 연속 `overdue > 2 * daily_review`이면 “복습이 계속 밀리고 있습니다. 신규를 0으로 두고 복습만 진행하세요”를 띄운다.

### 8.2 예상 학습 시간

```text
avgSec = {
  recognition: 최근 30일 p50, 없으면 8초
  recall:      최근 30일 p50, 없으면 18초
  cloze:       최근 30일 p50, 없으면 20초
  listening:   최근 30일 p50, 없으면 15초
  newIntro:    25초
}

estimatedMinutes = ceil(
  (reviewCount * avgSec[type] + promotedCount * avgSec[type] + newCount * 25) / 60
)
```

- 홈과 `/review` 헤더에 “예상 12분”으로 표시한다.
- 30분을 넘으면 “오늘은 복습만 하거나 신규를 줄이세요”를 제안한다.
- 시간은 강제하지 않는다. 예측일 뿐이다.

### 8.3 완료율

- `daily_plans` 기준.
- `completion7 = completed_at이 있는 날 / 계획이 있는 날` (최근 7일).
- 상한 때문에 남은 due는 완료 판정에서 제외한다. 계획 목표를 채우면 완료다.
- 계획이 없는 날은 분모에서 제외한다.
- 첫 3일은 “표본 부족”으로 표시한다.
- M6.3 이전에는 “리뷰가 1건 이상 있는 날 / 7”을 임시 adherence로 쓴다.

### 8.4 경고 문구

| 상황 | 문구 |
|---|---|
| 복습 상한 도달 | “오늘 복습 상한에 도달했습니다. 남은 N장은 내일.” |
| 신규 0 | “오늘은 복습만. 밀린 복습을 먼저 끝냅시다.” |
| 7일 완료율 < 50% | “최근 계획을 자주 못 지켰습니다. 하루 목표를 조금 낮춰볼까요?” |
| leech 10개 초과 | “격리된 단어가 많습니다. 연상법을 먼저 적어보세요.” |

- 비난조 금지. “실패”가 아니라 “조정”으로 표현한다.

---

## 9. 리뷰 로그·계측 명세

### 9.1 추가 컬럼 (`reviews`)

| 컬럼 | 타입 | 설명 | 백필 |
|---|---|---|---|
| `question_type` | TEXT | `recognition` / `recall` / `cloze` / `listening` | `cards.card_type` |
| `answer` | TEXT | 사용자 선택/입력 답안 | — |
| `is_correct` | INTEGER | `rating >= 2`이면 1 | `rating >= 2` |
| `grading_source` | TEXT | `self` (폴백 자기평가) / `server` (객관식·입력 자동채점) | 타입에서 유도 |
| `response_ms` | INTEGER | 자극 → 응답 시간. 0~300000 | NULL |
| `review_key` | TEXT | `card_id:shown_at`. 같은 프롬프트 재전송 방지 | NULL (기존 리뷰) |
| `attempt_seq` | INTEGER | 같은 카드·같은 날짜의 시도 순번 (1부터) | 윈도 함수 |
| `source` | TEXT | `review` / `weak` | 기본 `review` |
| `next_state` | TEXT | 리뷰 후 카드 상태 | NULL |
| `next_due_at` | TEXT | 리뷰 후 다음 due | NULL |

### 9.2 쓰기 경로

```text
1. 카드 렌더 시 서버 시각을 hidden 필드(shown_at)로 넣는다.
2. 사용자가 보기를 고르거나 답을 제출하면 서버가 response_ms를 계산한다.
3. schedule()로 다음 FSRS 상태를 계산한다.
4. cards UPDATE + reviews INSERT를 한 트랜잭션으로 실행한다.
5. 승급·leech 검사를 best-effort로 실행한다.
```

- `response_ms = clamp(now - shown_at, 0, 300000)`. 음수는 0으로 올린다.
- `shown_at`이 없으면 `response_ms = NULL`. NULL을 허용한다.
- 클라이언트 시각은 신뢰하지 않는다. 서버 시각만 쓴다.
- `question_type`은 `cards.card_type`에서 복사한다. 조인을 줄이고 로그를 불변으로 만들기 위해서다.
- `grading_source`: 자동채점은 `server`. 보기가 부족해 자기평가로 폴백한 `recognition`만 `self`.
- `review_key`: `${card_id}:${shown_at}`. 같은 프롬프트에서 나온 재전송을 식별한다.
  서버가 렌더 시 발급한 `shown_at`을 쓰므로 클라이언트가 임의로 새 키를 만들 수 없다.
- `attempt_seq`: 같은 `card_id` + `local_date`의 기존 리뷰 수 + 1.
  별도 세션 ID를 저장하지 않아도, 이 순번이 **같은 세션 내 재시도 순서**를 보존한다.
  같은 날 여러 세션을 돌려도 순서가 이어지므로 로그가 뒤섞이지 않는다.
- `source`: 일반 큐는 `review`, 취약 연습은 `weak`. 두 기록은 같은 FSRS 절차를 쓰되 통계에서 구분한다.
- `next_state` / `next_due_at`: `schedule()`이 계산한 리뷰 처리 후 상태와 예정일을 그대로 기록한다.

### 9.3 원자성

현재 코드는 UPDATE와 INSERT를 따로 실행한다. M6.1에서 아래처럼 바꾼다.

```sql
-- 같은 batch, 같은 트랜잭션
UPDATE cards
   SET due_at = ?, state = ?, stability = ?, difficulty = ?, scheduled_days = ?,
       learning_steps = ?, reps = ?, lapses = ?, last_reviewed_at = ?
 WHERE id = ? AND user_id = ? AND reps = ?;

INSERT INTO reviews (
  id, card_id, user_id, rating, local_date, reviewed_at,
  elapsed_days, scheduled_days, reps_before, prev_state,
  question_type, answer, is_correct, grading_source, response_ms,
  review_key, attempt_seq, source, next_state, next_due_at
)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?,
       (SELECT COUNT(*) + 1 FROM reviews WHERE card_id = ? AND local_date = ?),
       ?, ?, ?
 WHERE EXISTS (
   SELECT 1 FROM cards
    WHERE id = ? AND user_id = ? AND last_reviewed_at = ?
 );
```

- 저장 전에 `SELECT 1 FROM reviews WHERE user_id=? AND review_key=?`로 재전송을 먼저 거른다.
- 동시에 같은 키가 들어오면 `ux_reviews_user_review_key(user_id, review_key)`가 막는다.
  이때 batch 전체가 롤백되므로 카드 상태만 바뀌는 사고가 없다.
- `UPDATE`가 0행이면 `last_reviewed_at`이 갱신되지 않으므로 `INSERT`도 0행이 된다.
- 같은 밀리초 충돌은 `ux_reviews_card_instant(card_id, reviewed_at)`가 막는다.
- `UPDATE`와 `INSERT`가 같은 batch이므로 하나가 실패하면 둘 다 롤백된다.
- `maybeUnlock*`는 batch 밖에서 실행한다. 승급 실패가 리뷰 저장을 막지 않게 한다.
  `INSERT ... WHERE NOT EXISTS`로 멱등성을 유지한다.
- `/review` 로드 시 `ensureUnlocks`를 실행해 누락된 승급을 재시도한다.
  이 경로는 리뷰 저장과 분리되어 있으므로, 승급 실패가 학습 기록을 훼손하지 않는다.

### 9.4 중복 방지

- 낙관적 락: `WHERE reps = ?`.
- 멱등키: `review_key = card_id:shown_at`. 같은 프롬프트의 재전송을 식별한다.
- 유니크 인덱스: `(user_id, review_key)`, `(card_id, reviewed_at)`, `(card_id, local_date, attempt_seq)`.
- 네트워크 재시도로 같은 요청이 두 번 와도 두 번째는 저장되지 않는다.
  키가 같으면 사전 확인에서 끝나고, 동시 요청이면 유니크 인덱스가 batch를 롤백한다.
- 0행이면 “이미 처리됨”으로 보고 다음 카드를 렌더한다.

### 9.5 백필

```sql
UPDATE reviews
   SET question_type = (SELECT card_type FROM cards WHERE cards.id = reviews.card_id)
 WHERE question_type IS NULL;

UPDATE reviews
   SET is_correct = CASE WHEN rating >= 2 THEN 1 ELSE 0 END
 WHERE is_correct IS NULL;

UPDATE reviews
   SET grading_source = CASE WHEN question_type = 'recognition' THEN 'self' ELSE 'server' END
 WHERE grading_source IS NULL;
```

- `attempt_seq`는 윈도 함수로 채운다. 실패하면 NULL로 두고, 통계에서 `COALESCE`로 처리한다.
- `response_ms`, `review_key`, `next_state`, `next_due_at`은 과거 데이터에 없다. NULL을 허용한다.

---

## 10. 학습 데이터 신뢰성 (C)

### 10.1 퀴즈와 FSRS 분리

- 퀴즈는 `quiz_sessions` / `quiz_questions`만 변경한다.
- `cards` / `reviews`는 절대 변경하지 않는다.
- 퀴즈 오답은 취약 점수의 `quizBoost`로만 반영한다.
- 퀴즈 정답/오답은 `due_at`을 바꾸지 않는다.

### 10.2 타임존

- `local_date`는 리뷰 쓰기 시점에 `tz_offset_min`으로 계산한다.
- “오늘”의 경계는 사용자 로컬 자정이다.
- 한국(+540분)은 DST가 없으므로 고정 오프셋으로 충분하다.
- 해외 사용자가 늘면 `users.timezone`(IANA)을 추가하고 `Intl.DateTimeFormat`으로 교체한다.
  M6에서는 하지 않는다.
- 테스트: 23:59 KST와 00:01 KST에서 `local_date`가 올바르게 바뀌는지 확인한다.

### 10.3 앱 종료·복구

- 학습 상태는 **응답 1건마다** 저장한다. 세션 전체를 메모리에 들고 있지 않는다.
- 보기를 고르기 전에 종료: 리뷰 없음. 카드는 그대로 due.
- 정답을 확인한 뒤 다음 카드로 넘어가기 전에 종료: 리뷰는 이미 저장됨.
- 제출 후 종료: 리뷰 저장됨. 다시 열면 다음 카드가 나온다.
- `daily_plans` 덕분에 하루 계획은 재접속해도 유지된다.
- 클라이언트에 저장하는 학습 상태는 없다. 오프라인 큐도 M6 범위 밖이다.

### 10.4 로그와 상태의 일관성

- `cards`가 진실원, `reviews`는 감사 로그다.
- 각 카드의 최신 리뷰와 카드 상태를 비교하는 점검 쿼리를 둔다.

```sql
-- 최신 리뷰의 next_state/next_due_at과 카드가 어긋난 건
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

- 마이그레이션 후, 배포 후, 그리고 테스트에서 이 쿼리가 0건인지 확인한다.
- 어긋난 건이 있으면 카드가 우선이다. 로그는 기록으로 남긴다.

### 10.5 마이그레이션 규칙

- 이미 적용된 마이그레이션 파일은 수정하지 않는다. 새 파일만 추가한다.
- 파일명: `NNNN_설명.sql`, 순번 증가.
- 배포 순서: `db:remote` → `deploy`. 반대면 런타임 에러.
- 로컬 D1에서 먼저 적용하고 `npm run typecheck`와 시드 검수를 통과시킨다.
- **기존 사용자 데이터가 있는 DB 사본**에서 업그레이드 테스트를 한다.
  리뷰 수·카드 수가 보존되고, 대표 카드의 `state`/`due_at`이 바뀌지 않는지 확인한다.
- `is_correct`는 과거 리뷰까지 `rating >= 2`로 재계산한다. 기존 리뷰 행은 삭제하지 않는다.

---

## 11. 데이터베이스 마이그레이션

### 11.1 `0004_review_instrumentation.sql` (M6.1)

```sql
ALTER TABLE reviews ADD COLUMN question_type TEXT;
ALTER TABLE reviews ADD COLUMN answer TEXT;
ALTER TABLE reviews ADD COLUMN is_correct INTEGER;
ALTER TABLE reviews ADD COLUMN grading_source TEXT;
ALTER TABLE reviews ADD COLUMN response_ms INTEGER;
ALTER TABLE reviews ADD COLUMN attempt_seq INTEGER;
ALTER TABLE reviews ADD COLUMN source TEXT NOT NULL DEFAULT 'review';
ALTER TABLE reviews ADD COLUMN next_state TEXT;
ALTER TABLE reviews ADD COLUMN next_due_at TEXT;

UPDATE reviews
   SET question_type = (SELECT card_type FROM cards WHERE cards.id = reviews.card_id)
 WHERE question_type IS NULL;

UPDATE reviews
   SET is_correct = CASE WHEN rating >= 2 THEN 1 ELSE 0 END
 WHERE is_correct IS NULL;

UPDATE reviews
   SET grading_source = CASE WHEN question_type = 'recognition' THEN 'self' ELSE 'server' END
 WHERE grading_source IS NULL;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY card_id, local_date
           ORDER BY reviewed_at
         ) AS seq
    FROM reviews
)
UPDATE reviews
   SET attempt_seq = (SELECT seq FROM ranked WHERE ranked.id = reviews.id)
 WHERE attempt_seq IS NULL;

CREATE INDEX idx_reviews_user_card
  ON reviews(user_id, card_id, reviewed_at);
CREATE INDEX idx_reviews_user_type_date
  ON reviews(user_id, question_type, local_date);
CREATE UNIQUE INDEX ux_reviews_card_date_attempt
  ON reviews(card_id, local_date, attempt_seq);
```

> `ALTER TABLE ... ADD COLUMN`만 사용한다. DROP/타입 변경은 하지 않는다.
> 기존 `ux_reviews_card_instant(card_id, reviewed_at)`는 그대로 둔다.

### 11.2 `0005_review_idempotency.sql` (M6.1)

```sql
ALTER TABLE reviews ADD COLUMN review_key TEXT;

-- 기존 리뷰는 NULL. SQLite 유니크 인덱스는 NULL을 중복으로 보지 않는다.
CREATE UNIQUE INDEX ux_reviews_user_review_key
  ON reviews(user_id, review_key);
```

- `review_key`는 `card_id:shown_at` 형식이다.
- 저장 전에 같은 키가 있는지 확인하고, 동시 요청은 유니크 인덱스가 막는다.

### 11.3 `0006_daily_plans.sql` (M6.3)

```sql
CREATE TABLE daily_plans (
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date       TEXT NOT NULL,
  base_new         INTEGER NOT NULL,
  effective_new    INTEGER NOT NULL,
  review_target    INTEGER NOT NULL,
  promoted_target  INTEGER NOT NULL,
  due_count        INTEGER NOT NULL,
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  reason           TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  completed_at     TEXT,
  PRIMARY KEY (user_id, local_date)
);

CREATE INDEX idx_daily_plans_completed
  ON daily_plans(user_id, completed_at);

ALTER TABLE users ADD COLUMN new_card_mode TEXT NOT NULL DEFAULT 'auto';
-- auto | fixed
```

### 11.4 `0007_words_metadata.sql` (M6.4)

```sql
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
```

- `words.example` / `example_ko`는 대표 예문으로 유지한다.
- 추가 예문은 `word_examples`에 넣는다. 단어장에서는 `details`로 펼치고,
  복습 뒷면에서는 최대 2개까지 함께 보여준다.
- CSV v2는 기존 5컬럼을 유지하고 뒤에 선택 컬럼을 붙인다.
  `category`, `level`, `pronunciation`, `audio_url`, `collocations`, `synonyms`, `antonyms`,
  `example_2`, `example_2_ko`, `example_3`, `example_3_ko`.
- `collocations`/`synonyms`/`antonyms`는 CSV 셀 안에서 `|`로 구분한다.
  예: `abandon a plan|abandon hope`
- 기존 5컬럼 CSV는 그대로 임포트된다. 새 컬럼이 없으면 NULL로 둔다.

### 11.5 `0008_user_preferences.sql` (M6.5)

```sql
ALTER TABLE users ADD COLUMN listening_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN voice_locale TEXT NOT NULL DEFAULT 'en-US';
ALTER TABLE users ADD COLUMN voice_rate REAL NOT NULL DEFAULT 0.9;
```

- `listening_enabled = 0`이면 `listening` 카드를 만들지 않는다.
- `voice_locale`: `en-US` / `en-GB`.
- `voice_rate`: 0.7 ~ 1.2.

### 11.6 `0009_fsrs_params.sql` (M6.6)

```sql
ALTER TABLE users ADD COLUMN fsrs_params TEXT;           -- JSON number[21]
ALTER TABLE users ADD COLUMN fsrs_params_updated_at TEXT;
```

- 값이 없거나 21개 숫자 배열이 아니면 기본 파라미터를 쓴다.
- `srs.ts`는 파라미터별 스케줄러를 캐시한다.

---

## 12. API·화면 변경 범위

### 12.1 라우트

| Method | Path | 변경 | 단계 |
|---|---|---|---|
| GET | `/` | 오늘 계획, 예상 시간, 취약 단어 수, known/mastered 단어 수 | M6.3 |
| GET | `/review` | 계획 헤더, `?mode=weak` 지원 | M6.2/M6.3 |
| POST | `/review/:id/choice` | 영→한 4지선다 채점, `response_ms`, `review_key`, `source` 기록 | M6.7 |
| POST | `/review/:id/reveal` | 보기 부족 시 폴백. `response_ms`, `review_key` hidden 필드 포함 | M6.1 |
| POST | `/review/:id/answer` | `response_ms`, `review_key`, `source`, `attempt_seq` 기록 | M6.1 |
| POST | `/review/:id` | 평점과 함께 `response_ms`, `review_key` 기록 | M6.1 |
| GET | `/hard` | 취약/격리/관찰 탭 | M6.2 |
| POST | `/hard/:cardId/note` | 기존 유지 | — |
| POST | `/hard/:cardId/resume` | 기존 유지 | — |
| GET | `/stats` | 품질·부담 지표 추가 | M6.2/M6.3 |
| GET | `/settings` | 신규 자동/고정, 듣기 설정, FSRS 상태 | M6.3/M6.5/M6.6 |
| POST | `/settings` | 위 설정 저장 | M6.3/M6.5 |
| GET | `/settings/fsrs/export` | FSRS 최적화용 리뷰 로그 JSON | M6.6 |
| POST | `/settings/fsrs` | 21개 가중치 적용 | M6.6 |
| POST | `/settings/fsrs/reset` | 기본 파라미터로 초기화 | M6.6 |

### 12.2 홈

```text
오늘의 학습
복습 38 · 신규 4 · 예상 12분
[ 학습 시작 ]

주의: 복습이 밀려 신규를 10개 → 4개로 줄였습니다.

외운 단어 128 / 400
취약 단어 7 · 격리 3
연속 12일
```

- `due`는 **복습 대기 + 오늘 신규**만 센다. 전체 신규 카드를 세지 않는다.
- 계획이 완료됐으면 “오늘 계획 완료. 내일 42장 예정”을 보여준다.
- 취약 단어가 있으면 `/review?mode=weak` 링크를 노출한다.

### 12.3 복습 화면

```text
오늘 계획: 복습 38 · 승급 5 · 신규 4 · 예상 12분
12장 완료 / 35장 남음
[워밍업] [복습] [승급] [신규] [마무리]

        ubiquitous
        /juːˈbɪkwɪtəs/  🔊

        뜻을 고르세요
        A. 어디에나 있는
        B. 드문
        C. 위험한
        D. 조용한
```

- 상단에 현재 블록과 남은 양을 표시한다.
- 워밍업 카드에는 “어제 틀린 단어” 배지를 붙인다.
- 신규 카드에는 “새 단어” 배지를 붙인다.
- 완료 화면에 “내일 예정”과 “취약 단어 연습”을 넣는다.

### 12.4 어려운 단어 (`/hard`)

탭:

1. **취약** — `weak` + `attention`. 단어, 뜻, 취약 방향, 최근 정답률, 마지막 리뷰.
2. **관찰 중** — `observing`. 최근 리뷰 5회 미만.
3. **격리** — `leech`. 기존 연상법/복귀 UI.

취약 탭 상단에 “취약 단어만 연습” 버튼(`/review?mode=weak`)을 둔다.
`stale`은 취약 탭 하단에 “재확인 필요”로 접어서 보여준다.

### 12.5 통계 (`/stats`)

```text
학습 품질
첫 시도 정답률 86%    평균 응답 7.4초
영→한 92%             한→영 71%
7일 유지율 84%        21일 유지율 61%

학습 부담
오늘 복습 38 / 상한 200
밀린 복습 12
오늘 신규 4 / 기본 10
예상 12분
최근 7일 완료율 71%

단어
외운 단어 128
마스터 42
취약 7
격리 3
```

- 각 지표에 표본 수를 함께 보여준다.
- 표본이 부족하면 숫자 대신 “표본 부족 (12/20)”을 보여준다.
- 정답률 옆에 **“Again만 오답”** 각주를 표시한다. Hard/Good/Easy는 정답이다.
- 기준 변경 전후 숫자를 직접 비교하지 않도록 “2026-11-04 기준”을 명시한다.
- 과거 리뷰도 `is_correct`로 재계산하므로, 기존 사용자의 정답률이 달라질 수 있다.

### 12.6 설정

- 하루 신규 단어: 5 / 10 / 20 (기존)
- 신규 배분: 자동 / 고정
- 하루 복습 상한: 기존
- 듣기 카드: 켜기 / 끄기 (기본 끄기)
- 발음: 미국식 / 영국식, 속도 0.7~1.2
- 기존 표시 이름, 로그아웃 유지

### 12.7 HTMX·클라이언트

- 서버 렌더 HTML 조각 원칙 유지.
- `response_ms`는 hidden input으로 전달한다. 클라이언트 타이머 JS를 추가하지 않는다.
- 키보드 단축키는 기존과 동일.
- 듣기 카드만 `speechSynthesis`를 사용한다. 재생 버튼은 기존 `data-speak` 패턴을 확장한다.
- TTS가 없는 기기에서는 “이 기기에서는 듣기를 지원하지 않습니다”를 보여주고,
  “들리지 않아요” 버튼으로 정답을 확인하게 한다.
- 오프라인 앱 셸은 깨지지 않아야 한다. 새 정적 자산이 있으면 `sw.js` 캐시 목록을 갱신한다.

---

## 13. 테스트·검증

### 13.1 단위 테스트 (M6 전체)

Node 26의 타입 스트리핑을 사용해 별도 프레임워크 없이 `node --test`로 돌린다.
M6.1에서는 원자성·쿼터·정답률 테스트만 먼저 넣고, `weakScore`/`adaptiveNew`/`buildPlan`은
해당 기능을 구현하는 M6.2/M6.3에서 추가한다.

| 대상 | 케이스 |
|---|---|
| `weakScore` | 4회/1오답 → observing, 5회/3오답 → attention, 20회/12오답 → weak, 90일 경과 → stale, leech 제외 |
| `weakScore` | 인식 90% + 한→영 40% → 단어 점수는 한→영 기준 |
| `adaptiveNew` | overdue 0 → base, 5/10 → base, 100/20 → 0.75, 100/5 → 0, base 초과 없음 |
| `buildPlan` | reviewTarget/promotedTarget/newTarget 합이 상한을 넘지 않음 |
| `selectNextType` | 목표 비율, 유형 없음, 쿼터 소진 |
| `mastery` | recognition만, recall 있음, cloze만, 둘 다, 예문 없음 |
| `gradeAnswer` | 기존 철자 채점 회귀 |

### 13.2 통합 테스트 (로컬 D1)

1. 기존 사용자 데이터가 있는 DB에 해당 마일스톤까지의 마이그레이션을 적용한다.
   리뷰 수·카드 수·대표 카드의 `state`/`due_at`이 보존되는지 확인한다.
2. 과거 리뷰의 `is_correct`가 `rating >= 2`로 재계산되고, 원본 리뷰 행은 삭제되지 않는다.
3. 같은 리뷰를 두 번 POST → `reviews` 1건, 카드 상태 1회만 진행.
4. 같은 `review_key`로 재전송 → `reviews` 1건, 카드 상태 변화 없음.
5. due 250장, `daily_review=200` → 큐가 200장에서 멈춤.
6. 신규 recognition 10장 + 승급 3장 → `daily_new=10`이면 신규 10장, 승급 3장은 별도.
7. 홈 `due`가 신규 카드를 포함하지 않음.
8. `learnedCount`가 같은 단어의 여러 카드를 1개로 계산.
9. 최신 리뷰 `next_state`/`next_due_at`과 카드 상태가 일치.
10. 승급 INSERT를 일부러 실패시킨 뒤 `/review` 로드 → `ensureUnlocks`가 누락분을 생성.
11. 취약 연습(`source='weak'`)과 일반 복습(`source='review'`)이 구분되어 기록됨.
12. 퀴즈 응답 후 `cards`/`reviews` 변경 0건.
13. `/review` 첫 로드에서 `daily_plans` 스냅샷이 생성되고, 같은 날 재로드해도 값이 바뀌지 않음.
14. 계획 목표 도달 시 `completed_at`이 기록되고, 완료율 분모에 포함됨.
15. 계획 상한을 넘는 due 카드는 “내일”로 넘어가고 당일 큐에 들어오지 않음.

### 13.3 수동 테스트

- KST 23:59와 00:01에 리뷰 → `local_date` 경계 확인.
- 보기 선택 전/후, 제출 후 앱 종료 → 복구 동작 확인.
- 두 탭에서 같은 카드 제출 → 한 번만 저장.
- 듣기 켜기/끄기, TTS 없는 브라우저.
- 오프라인에서 앱 셸 열기.
- 모바일에서 입력 자동 대문자/맞춤법이 꺼져 있는지.

### 13.4 2주 후 확인할 지표

| 지표 | 목표 |
|---|---|
| 하루 세션 완료율 | 80% |
| 첫 시도 정답률 (`rating >= 2`) | 85~90% |
| `recall` 오답률 | 20~30% |
| `retention_21d` | 40% 이상 |
| 취약 단어 연습 사용률 | 주 2회 이상 |
| 복습 밀림일 | 주 2일 이하 |

> `rating >= 2`로 정의가 바뀌므로 기존 목표치와 직접 비교하지 않는다.
> M6.1 배포 후 2주 데이터로 목표를 다시 잡는다.

### 13.5 회귀 체크리스트

- 영→한 카드: 소개 → 가리기 → 4지선다 → 정답/오답 → 다음 복습일
- 한→영 카드: 뜻 → 입력 → 채점 → 정답/오타/오답 표시
- 빈칸 카드: 예문 → 입력 → 채점
- 승급: 4일/7일 조건, 기능어 제외
- leech: 8회 → 격리 → 연상법 → 복귀
- 퀴즈: 10/20문제, 결과, 오답 목록
- 통계: 오늘/연속/정답률/외운 단어
- CSV: 기본 1,000 + 기능어 100 임포트, 내보내기
- PWA: 설치, 오프라인 셸
- 타입 검사: `npm run typecheck`
- 시드 검수: `npm run check:seed`

---

## 14. 미결정 사항·후속 과제

| 항목 | 현재 결정 | 시점 |
|---|---|---|
| 정답률 기준 | `rating >= 2` (Again만 실패) | M6.1에서 확정 |
| Mastered의 생산 카드 요구 | 생산 카드 1장 이상, 존재하는 모든 생산 카드 21일 이상. 생산 카드가 없으면 판정 제외 | M6.1에서 확정 |
| `daily_review`에 학습 스텝 포함 | 포함 | M6.1에서 확정 |
| `daily_plans` 스냅샷 | 도입 | M6.3 |
| 취약 연습의 기한 전 카드 | 당기지 않음 | M6.2 |
| FSRS 개인화 | 리뷰 1,000건 이후, 별도 최적화 | M6.6 |
| 실제 음성 파일 | 라이선스·용량 검토 후 | M6.5 이후 |
| IANA 타임존 | 해외 사용자 증가 시 | M6 이후 |
| XP·레벨 | 도입하지 않음 | — |
| 콘텐츠 검수 | AI 초안 + 사람 검수 | M6.4 |

### 14.1 M6.6 FSRS 개인화

- 현재 의존성(`ts-fsrs` 6.0)에는 옵티마이저 API가 포함되어 있지 않다.
- 리뷰 1,000건 이상 쌓이면 `/settings/fsrs/export`로 리뷰 로그를 JSON으로 내보낸다.
  - `card_id`, `rating`, `reviewed_at`, `elapsed_days`, `scheduled_days`, `reps_before`, `prev_state`, `question_type`
- 외부 FSRS 옵티마이저에서 계산한 **21개 가중치 배열**을 `/settings`의 “파라미터 JSON”에 붙여넣어 적용한다.
- 결과는 `users.fsrs_params`(JSON), `users.fsrs_params_updated_at`에 저장한다.
- `srs.ts`는 사용자별 가중치로 스케줄러를 만들고, isolate 안에서 파라미터별로 캐시한다.
  - 파라미터가 없거나 잘못되면 기본값으로 돌아간다.
- 그 전에는 기본 `request_retention = 0.9`를 유지한다. 지금 손대면 과적합이다.
- “기본값으로 초기화”는 `fsrs_params = NULL`로 되돌린다.

### 14.2 콘텐츠 확장 메모

- 1,100개 단어의 카테고리·난이도·콜로케이션·유의어·반의어는 코드가 아니라 **콘텐츠 작업**이다.
- 스키마만 먼저 열고, 시드는 점진적으로 채운다.
- 검수 없는 AI 생성 데이터를 그대로 배포하지 않는다.
- 생산형 카드(`recall`/`cloze`)가 하나도 없는 단어는 `known`/`mastered`가 될 수 없다는 제약을 UI에서 안내한다.
  예문이 없어 `cloze`가 없더라도 `recall`이 있으면 `mastered`가 가능하다.
- 문장 완성·영작 카드는 M6 범위 밖이다. `cloze`와 `recall`이 그 역할을 부분적으로 대신한다.

---

## 부록 A. 계산 예시

### A.1 취약 점수

```text
카드: recognition
최근 20회: 20건, 오답 8건 → recentErrorRate = 0.4
전체: 30건, 오답 10건 → totalErrorRate = 0.333
lapses = 3 → 3/8 = 0.375
stability = 6 → 1 - 6/21 = 0.714
quizWrongsLast30 = 1 → quizBoost = 0.03

base = 0.5*0.4 + 0.3*0.375 + 0.2*0.714
     = 0.2 + 0.1125 + 0.1428
     = 0.4553
score = min(1, 0.4553 + 0.03) = 0.4853 → attention
```

### A.2 적응형 신규

```text
base = 10
overdue = 120
throughput7 = 144 / 7 = 20.57
daysToClear = 120 / 20.57 = 5.83 → backlogFactor = 0.75
adherence7 = 5 / 7 = 0.714 → adherenceFactor = 1

effectiveNew = floor(10 * 0.75) = 7
```

### A.3 Known / Mastered

```text
recognition: state=review, scheduled_days=70
recall:      state=review, scheduled_days=30
cloze:       state=review, scheduled_days=14

known:    70 >= 21, max(30,14) >= 7 → true
mastered: 70 >= 60, min(30,14)=14 < 21 → false
```

```text
recognition: state=review, scheduled_days=70
recall:      state=review, scheduled_days=30
cloze:       없음 (예문 없음)

known:    70 >= 21, 30 >= 7 → true
mastered: 70 >= 60, 30 >= 21 → true
```

```text
recognition: state=review, scheduled_days=70
recall:      없음 (기능어라 승급 제외)
cloze:       없음 (예문 없음)

known:    생산형 카드 없음 → false
mastered: 생산형 카드 없음 → false
```

---

## 부록 B. 용어

| 용어 | 뜻 |
|---|---|
| due | `due_at <= now`인 카드 |
| overdue | 기한이 지난 복습 카드. 신규 제외 |
| retention | 실제 회상 성공률. FSRS 예측값과 구분 |
| leech | 8회 이상 실패해 격리된 카드 |
| weak | 최근 성과가 나쁜 카드/단어. 격리와 별개 |
| observing | 최근 리뷰 5회 미만이라 판단 보류 |
| stale | 마지막 리뷰가 90일을 넘은 카드 |
| production card | `recall` / `cloze`. 출구 카드 |
| new intro | 처음 보는 `recognition`의 첫 리뷰 |

---

## 부록 C. M6.1 착수 체크리스트

명세서 검토가 끝나면 아래 순서로 M6.1을 진행한다. **M6.1은 학습 알고리즘을 바꾸지 않는다.**
데이터의 정확성과 저장의 신뢰성만 먼저 확보한다.

1. `0004_review_instrumentation.sql`, `0005_review_idempotency.sql` 추가 및 로컬 적용
2. `saveReview`를 batch 기반 원자적 저장으로 변경
3. `review_key` 멱등키로 같은 프롬프트 재전송 차단
4. `daily_review` 상한을 큐에 적용
5. 승급 카드가 `daily_new`를 소모하지 않도록 카운트 분리
6. 홈 `due`에서 신규 카드 제외, `learnedCount`를 단어 단위로 변경
7. `shown_at` / `response_ms` 계측 추가 (`NULL` 허용, 음수 방지)
8. 정답률 기준을 `rating >= 2`로 통일하고 과거 리뷰 재계산
9. `ensureUnlocks`로 승급 누락 재시도 경로 추가
10. 원자성·쿼터·정답률·멱등성 회귀 테스트 추가
11. `03-data-model.md`, `04-srs.md`, `06-learning-design.md`의 모순된 문장 수정
12. README 문서 인덱스에 `docs/07-learning-engine.md` 링크 추가
13. 기존 데이터가 있는 로컬 D1에서 업그레이드 테스트
14. `npm run typecheck`, `npm run check:seed`, 기존 테스트 전체 통과

M6.1이 끝나면 `/stats`에 새 지표를 붙이기 전이라도, `reviews`에 데이터가 쌓이기 시작해야 한다.
M6.2 취약 단어 화면은 그 데이터를 읽어서 만든다. `weakScore`/`adaptiveNew` 단위 테스트는
각각 M6.2/M6.3에서 해당 순수 함수를 만들 때 추가한다.

### 완료 조건

- 기존 FSRS 리뷰 기능 정상 작동
- 기존 사용자 학습 데이터 보존
- `Hard`가 정답, `Again`만 오답으로 집계
- `daily_review` 상한 정상 적용
- 승급 카드가 신규 쿼터를 소모하지 않음
- `learnedCount`가 카드 수가 아닌 고유 단어 수를 계산
- 리뷰 로그와 카드 상태가 원자적으로 저장
- 같은 `review_key` 재전송이 중복 리뷰를 만들지 않음
- 승급 누락 시 `ensureUnlocks`로 재시도 가능
- 취약 연습과 일반 복습 기록이 `source`로 구분됨
- 기존 테스트 전체 통과
- 새 마이그레이션의 업그레이드 및 기존 데이터 검증
