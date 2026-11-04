# 04. 복습 알고리즘 (FSRS)

이 앱의 본체. UI는 껍데기고 여기가 제품 가치입니다.

## 왜 SM-2가 아니라 FSRS인가

| | SM-2 (Anki 클래식) | FSRS |
|---|---|---|
| 모델 | ease factor 하나로 조절 | 기억 안정성(stability) + 난이도(difficulty) 2요인 |
| 복습 횟수 | 기준 | **20~30% 적음** (같은 기억률에서) |
| 구현 | 30줄 | 라이브러리 사용 (`ts-fsrs`) |
| 튜닝 | 수동 | 리뷰 로그로 개인화 가능 |

`ts-fsrs`는 순수 TypeScript라 Workers에서 그대로 돕니다.

## 카드 상태

| state | 의미 | due_at |
|---|---|---|
| `new` | 한 번도 안 봄 | 생성 즉시 (언제든 학습 가능) |
| `learning` | 학습 중 (분 단위 스텝) | 수 분 뒤 |
| `review` | 정착됨 (일 단위) | 수 일~수 개월 뒤 |
| `relearning` | 잊어서 재학습 중 | 수 분 뒤 |

## 평점 4단계

| 버튼 | rating | 사용자가 느낀 것 |
|---|---|---|
| Again | 1 | 몰랐다 / 틀렸다 |
| Hard | 2 | 겨우 생각났다, 헷갈렸다 |
| Good | 3 | 맞혔다 |
| Easy | 4 | 너무 쉬웠다 |

> **UI 원칙**: 버튼에 "내일 / 4일 뒤 / 12일 뒤"처럼 **다음 복습일을 미리 보여줍니다.**
> 사용자가 결과를 예측할 수 있어야 평점이 일관되게 매겨집니다.
>
> **보조 규칙**: 신규 카드(`reps = 0`)에는 `Hard` 버튼을 숨깁니다.
> 처음 보는 카드에서 "겨우 생각남"은 판단할 근거가 없어 오히려 노이즈입니다.

## 카드 유형과 승급

단어 1개가 카드 여러 장을 가집니다. **카드마다 FSRS 상태가 완전히 독립**입니다
(`cards` 행이 다르므로 별도 스케줄).

| 유형 | 생성 시점 | 이유 |
|---|---|---|
| `recognition` | 단어 생성 시 | 항상 존재하는 기본 카드 |
| `recall` | recognition이 `state='review'` **그리고** `scheduled_days >= 4` | 아직 기억이 불안정한데 철자까지 요구하면 좌절 |
| `cloze` | `words.example` 존재 **그리고** recognition `stability >= 7` | 문맥 없이 빈칸은 불가능 |
| `listening` | 수동 활성화 (v1.2) | TTS 품질 검증 후 |

승급 검사는 **평점을 저장한 직후, 같은 트랜잭션 안에서** 수행합니다.

```ts
await db.batch([updateCard, insertReview]);
await maybeUnlockCards(db, userId, card);  // 실패해도 학습은 계속되도록 뒤에
```

`INSERT ... ON CONFLICT(word_id, card_type) DO NOTHING` 으로 중복 생성을 방지합니다.

> 승급하지 않으면 이 앱은 "영→한"만 물어보는 평범한 단어 앱이 됩니다.
> 승급 규칙이 `recall`(한→영) 학습의 유일한 진입점입니다.

**큐 우선순위**: 승급된 한→영 카드는 `state='new'` 이지만 `daily_new` 쿼터에 포함하지 않고
먼저 꺼냅니다. 그렇지 않으면 새로 승급된 카드가 아직 안 본 단어 1,000개 뒤에 묻힙니다.

**승급 제외**: `pos` 가 `det` / `pron` / `prep` / `conj` / `modal` 인 기능어는 `recall` 승급을 하지 않습니다.
`"~안에" → in` 처럼 답이 하나로 정해지지 않아 한→영 채점이 성립하지 않기 때문입니다.
기능어는 `cloze`(문맥)로 검증합니다.

**cloze 승급 조건**

```
조건 : card_type='recognition'
     AND words.example 존재
     AND 예문에서 term 을 가릴 수 있음 (기본형 매칭)
     AND next.state='review' AND next.stability >= 7
동작 : cloze 카드를 state='new', due_at=now 로 생성
```

- 예문에 기본형이 없으면(굴절: become → became) 만들지 않습니다. 빈칸 위치를 특정할 수 없기 때문입니다.
- `stability` 는 FSRS 기억 안정성(일 단위)입니다. 7일 이상 버틸 것으로 추정될 때 문맥 테스트를 붙입니다.
- cloze 카드도 `daily_new` 쿼터에 포함하지 않습니다.

## 복습 부하 계산

카드 유형이 늘면 부하도 늘어납니다. `daily_new` 는 이걸 감안해 잡아야 합니다.

| 단어 수 | 카드 수(승급 후) | 안정화 후 하루 복습 |
|---|---|---|
| 300 | ~700 | 60~90 |
| 1,000 | ~2,300 | 200~300 (상한 `daily_review`로 제한) |

→ 신규 기본값 **10**, 상한 `daily_review` 기본 **200**.

## 래퍼 설계 (`src/lib/srs.ts`)

```ts
import { fsrs, generatorParameters, Rating, State, createEmptyCard, type Card } from 'ts-fsrs';

const f = fsrs(generatorParameters({
  request_retention: 0.9,      // 목표 기억률 90%
  maximum_interval: 365 * 3,   // 최대 3년
  enable_fuzz: true,           // 같은 날 복습이 몰리지 않게 흔들기
  enable_short_term: true,     // learning 스텝 사용
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
}));

/** D1 row → ts-fsrs Card */
export function rowToCard(row: CardRow): Card { /* ... */ }

/** D1 row + 평점 → 다음 상태 (DB 저장용 평면 객체) */
export function schedule(row: CardRow, now: Date, rating: Rating) {
  const next = f.next(rowToCard(row), now, rating);
  return {
    due_at: next.card.due.toISOString(),
    state: STATE_NAME[next.card.state],
    stability: next.card.stability,
    difficulty: next.card.difficulty,
    reps: next.card.reps,
    lapses: next.card.lapses,
    last_reviewed_at: now.toISOString(),
  };
}

/** 버튼 4개에 표시할 "다음 복습일" 미리보기 */
export function previewIntervals(row: CardRow, now: Date): Record<Rating, string> {
  const out = {} as Record<Rating, string>;
  for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
    out[r] = formatInterval(f.next(rowToCard(row), now, r).card.due, now);
  }
  return out;
}
```

`formatInterval`은 `10분`, `1일`, `4일`, `2개월` 식으로 한국어 포맷. 1분 미만은 `곧`.

## 필드 매핑 (ts-fsrs ↔ D1)

| ts-fsrs `Card` | D1 `cards` | 변환 |
|---|---|---|
| `due: Date` | `due_at TEXT` | `.toISOString()` |
| `state: State` (0~3) | `state TEXT` | `new/learning/review/relearning` |
| `stability: number` | `stability REAL` | 그대로 |
| `difficulty: number` | `difficulty REAL` | 그대로 |
| `reps: number` | `reps INTEGER` | 그대로 |
| `lapses: number` | `lapses INTEGER` | 그대로 |
| `last_review: Date` | `last_reviewed_at TEXT` | `.toISOString()` |
| `learning_steps: number` | `learning_steps INTEGER` | 그대로 (1분→10분 진행도) |
| `elapsed_days` | `reviews.elapsed_days` | 로그용 |
| `scheduled_days` | `reviews.scheduled_days` | 로그용 |

> 날짜는 **항상 UTC ISO 문자열**로 저장. 타임존 변환은 표시할 때만.

## 시각 처리

```ts
// src/lib/time.ts

/** 사용자 로컬 기준 'YYYY-MM-DD' */
export function localDate(now: Date, tzOffsetMin: number): string {
  const shifted = new Date(now.getTime() + tzOffsetMin * 60_000);
  return shifted.toISOString().slice(0, 10);
}
```

- `due_at`은 절대 시각(UTC). "오늘 복습" 판정은 `due_at <= now`.
- streak / 일일 상한은 `reviews.local_date` (로컬 날짜).
- DST 없는 한국(+540분)이면 고정 오프셋으로 충분. 해외 사용자 대응 시 `Intl.DateTimeFormat` + IANA tz로 교체.

## 하루 큐 구성

```ts
async function buildQueue(db: D1Database, userId: string, now: Date) {
  const today = localDate(now, tzOffset);
  const newDoneToday = await countNewReviewsToday(db, userId, today);
  const reviewDoneToday = await countReviewsToday(db, userId, today);

  const reviewQuota = Math.max(0, daily_review - reviewDoneToday);
  const newQuota = Math.max(0, daily_new - newDoneToday);

  const reviews = await dueReviews(db, userId, now.toISOString(), reviewQuota);
  const news = newQuota > 0 ? await newCards(db, userId, newQuota) : [];

  return [...reviews, ...news];
}
```

## 안전장치

| 상황 | 처리 |
|---|---|
| 카드가 이미 다른 탭에서 처리됨 | `UPDATE ... WHERE id=? AND last_reviewed_at=?` 조건부 갱신. 0행이면 "이미 처리됨" 응답 후 큐 새로고침 |
| 사용자가 창을 오래 열어둠 | 매 POST마다 `Date.now()` 서버 기준으로 재계산. 클라이언트 시간 신뢰 안 함 |
| 큐가 비었을 때 | "오늘은 다 했어요" 카드 + 내일 예정 카드 수 표시 |
| 새벽 4시 이전 | 그날로 취급할지 선택. **MVP는 자정 기준**으로 단순하게 |
| 기기 시계 조작 | 서버 시각 사용. 어뷰징은 개인 앱이라 무시 |

## 튜닝은 나중에

`request_retention = 0.9` 기본값으로 시작합니다.

- 리뷰가 **1,000건 이상** 쌓이면 `ts-fsrs`의 옵티마이저로 개인 파라미터를 뽑을 수 있습니다.
- 그전에 손대면 과적합입니다. **v1.1 이후 과제.**

## 테스트해야 할 것

1. `state: new` + `Good` → `state: learning`, `due` ≈ 10분 뒤
2. `state: learning` + `Good` → `state: review`, `due` ≥ 1일 뒤
3. `state: review` + `Again` → `state: relearning`, `lapses` +1
4. 같은 카드에 4번 연속 `Again` → `due_at`이 미래로 계속 밀리는지 (무한 루프 방지)
5. `previewIntervals`가 단조 증가하는지 (Again ≤ Hard ≤ Good ≤ Easy)
