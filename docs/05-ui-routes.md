# 05. 라우트 & HTMX 인터랙션

## 전체 원칙

1. **GET은 읽기만.** 상태 변경은 전부 POST/DELETE.
2. **모든 폼은 JS 없이도 동작**해야 합니다 (평범한 `<form method="post">`). HTMX는 그 위에 얹는 개선일 뿐.
3. 서버는 **전체 페이지** 또는 **HTML 조각** 둘 중 하나를 반환합니다. JSON API는 만들지 않습니다.

## 라우트 목록

| Method | Path | 인증 | 반환 | 설명 |
|---|---|---|---|---|
| GET | `/` | 선택 | 전체 | 비로그인=랜딩, 로그인=대시보드 |
| GET | `/login` | — | 전체 | 로그인 화면 |
| GET | `/auth/google` | — | 302 | OAuth 시작 |
| GET | `/auth/google/callback` | — | 302 | 콜백, 세션 쿠키 발급 |
| POST | `/logout` | 필요 | 302 | 세션 삭제 |
| GET | `/decks` | 필요 | 전체 | 단어장 목록 |
| POST | `/decks` | 필요 | 조각/302 | 단어장 생성 |
| DELETE | `/decks/:id` | 필요 | 조각 | 단어장 삭제 |
| GET | `/decks/:id` | 필요 | 전체 | 단어 목록 + 추가 폼 |
| POST | `/decks/:id/words` | 필요 | 조각 | 단어 1건 추가 → 목록에 append |
| DELETE | `/words/:id` | 필요 | 조각 | 단어 삭제 |
| POST | `/seeds/:slug` | 필요 | 302 | 기본 콘텐츠 임포트 (`basic-1000`, `function-100`) |
| GET | `/decks/:id/export` | 필요 | 파일 | CSV 다운로드 (⬜ 예정) |
| GET | `/play` | 필요 | 전체 | 플레이 모드 선택 |
| POST | `/play/start` | 필요 | 302 | 플레이 세션 생성 (정책 스냅샷) → `/play/:id` |
| GET | `/play/:id` | 필요 | 전체 | 현재 문제 |
| GET | `/play/:id/result` | 필요 | 전체 | 한 판 결과 |
| POST | `/play/:id/answer` | 필요 | 조각 | item 검증 후 채점 → 결과 |
| POST | `/play/:id/next` | 필요 | 조각 | 다음 문제 또는 결과 |
| POST | `/play/:id/abandon` | 필요 | 302 | 세션 중단 |
| GET | `/review` | 레거시 | 302 | `/play`로 이동 (`LEGACY_REVIEW=1`이면 유지) |
| GET | `/review?mode=weak` | 레거시 | 302 | `/play?intent=weak`로 이동 |
| GET | `/review/:cardId` | 필요 | 조각 | 앞면 카드 |
| POST | `/review/next` | 필요 | 조각 | 결과 확인 후 다음 카드 |
| POST | `/review/:cardId/hide` | 필요 | 조각 | 신규 카드 소개 → 4지선다 |
| POST | `/review/:cardId/choice` | 필요 | 조각 | 영→한 4지선다 채점 → 결과 |
| POST | `/review/:cardId/reveal` | 폴백 | 조각 | 보기가 부족할 때 뒷면(뜻/예문) 펼침 |
| POST | `/review/:cardId/answer` | 필요 | 조각 | 한→영 / 빈칸 / 듣기 입력 채점 → 결과 |
| GET | `/stats` | 필요 | 전체 | 학습 통계 |
| GET | `/settings` | 필요 | 전체 | 학습 목표, 듣기, FSRS 설정 |
| POST | `/settings` | 필요 | 302 | 설정 저장 |
| GET | `/settings/fsrs/export` | 필요 | JSON | FSRS 최적화용 리뷰 로그 |
| POST | `/settings/fsrs` | 필요 | 302 | 21개 FSRS 가중치 적용 |
| POST | `/settings/fsrs/reset` | 필요 | 302 | FSRS 파라미터 초기화 |
| GET | `/decks/:id/export` | 필요 | 파일 | 단어장 CSV 다운로드 |
| GET | `/terms` | — | 전체 | 이용약관 |
| GET | `/privacy` | — | 전체 | 개인정보처리방침 |
| GET | `/design` | — | 전체 | 퍼플 디자인 시스템 (토큰 · 컴포넌트 · 화면 패턴) |
| GET | `/quiz` | 필요 | 전체 | 테스트 설정 || POST | `/quiz/start` | 필요 | 302 | 새 테스트 생성 |
| GET | `/quiz/session` | 필요 | 전체 | 현재 문제 |
| POST | `/quiz/answer` | 필요 | 조각 | 채점 → 피드백 |
| POST | `/quiz/next` | 필요 | 조각 | 다음 문제 또는 결과 |
| GET | `/hard?tab=weak\|observing\|leech` | 필요 | 전체 | 취약·관찰 중·격리 단어 목록 |
| POST | `/hard/:cardId/note` | 필요 | 302 | 연상법 저장 |
| POST | `/hard/:cardId/resume` | 필요 | 302 | 학습 큐로 복귀 |
| POST | `/review/:cardId` | 폴백 | 조각 | 보기 부족 시 자기평가(`rating`) 처리 → 다음 카드 |
| GET | `/stats` | 필요 | 전체 | 통계 |
| GET | `/settings` | 필요 | 전체 | 일일 목표, 타임존 |
| POST | `/settings` | 필요 | 전체 | 설정 저장 |

## 데이터 흐름

```
GET /review
  └─ 큐 생성 → 첫 카드 렌더 → HTML 전체

POST /review/:id/hide
  └─ 신규 소개 → 4지선다 조각 반환

POST /review/:id/choice  (영→한 4지선다)
POST /review/:id/answer  (한→영 / 빈칸 / 듣기 입력)
  ├─ D1 batch: cards UPDATE + reviews INSERT
  ├─ 정답/오답 + 다음 복습일 조각 반환
  └─ [계속] → POST /review/next → 다음 카드
```

## 복습 화면 상세

### 마크업 (영→한 4지선다)

```tsx
<div id="review-root">
  <div id="progress" class="...">7 / 20</div>

  <section id="card" class="...">
    <p class="text-3xl">ubiquitous</p>
    <p class="text-sm text-gray-500">/juːˈbɪkwɪtəs/</p>
    <p>뜻을 고르세요</p>

    <form hx-post={`/review/${card.id}/choice`} hx-target="#review-root" hx-swap="innerHTML">
      <input type="hidden" name="shown_at" value={shownAt} />
      <input type="hidden" name="source" value={source} />
      {choices.map((choice, i) => (
        <button name="choice" value={choice} data-choice={i + 1}>{choice}</button>
      ))}
    </form>
  </section>
</div>
```

### 결과 응답

```tsx
<article>
  <p class="text-accent">정답</p>   {/* 또는 text-danger: 오답 */}
  <p class="text-3xl">ubiquitous</p>
  <p class="text-xl">어디에나 있는</p>
  {!correct ? <p>내 답: 드문</p> : null}
  <p>다음 복습 4일</p>
  <button hx-post="/review/next" data-act="next">계속</button>
</article>
```

> 결과 화면에는 발음, 추가 예문, 함께 쓰는 표현, 유의어/반의어를 함께 표시한다.
>
> `response_ms`는 보기 화면 렌더 시 서버가 넣은 `shown_at`으로 계산한다.
> `review_key`는 `${card.id}:${shown_at}`다. 같은 프롬프트의 재전송을 막는 멱등키다.
> `source`는 일반 복습이면 `review`, 취약 연습이면 `weak`다.
> 정답 여부와 응답 시간으로 `Again/Hard/Good/Easy`를 서버가 정한다.

### 다음 카드 응답 (제출 POST)

```tsx
{/* 진행률 — 화면 다른 위치를 바꾸는 OOB 스왑 */}
<div id="progress" hx-swap-oob="true">8 / 20</div>

{/* 카드 본체 */}
<section id="card" class="...">
  {next ? <CardFront card={next} /> : <DoneState />}
</section>
```

> `hx-swap-oob`는 HTMX의 out-of-band swap. 응답 안에 다른 `id` 조각을 넣어두면 해당 위치가 갱신됩니다. 진행률 바를 따로 요청하지 않아도 되는 이유.

### 타이핑 카드 (`recall` / `cloze`)

`recognition`은 4지선다, `recall`/`cloze`/`listening`은 입력으로 **서버가 채점**합니다. 평점 버튼이 없습니다.

```tsx
<form
  hx-post={`/review/${card.id}/answer`}
  hx-target="#review-root"
  hx-swap="innerHTML"
  hx-disabled-elt="find button">
  <input type="hidden" name="shown_at" value={shownAt} />
  <input type="hidden" name="source" value={source} />
  <p class="text-2xl">어디에나 있는</p>
  <input name="answer" autocomplete="off" autocapitalize="off" spellcheck="false"
         class="..." autofocus />
  <button type="submit">확인</button>
</form>
```

- `shown_at`은 프롬프트 렌더 시 서버 시각. `response_ms` 계산에 쓴다.
- `autocapitalize="off"`, `spellcheck="false"` 필수. 모바일에서 자동 대문자/맞춤법이 채점을 망칩니다.
- Enter로 제출 (`<form>`이므로 기본 동작).
- 채점 결과는 [06-learning-design.md](06-learning-design.md) 5절 규칙을 따릅니다.

**cloze 변형**: `recall` 과 같은 폼을 쓰되 자극이 다릅니다.

```
빈칸에 들어갈 단어를 쓰세요
She ate ____ apple.
[힌트: 뜻 보기]  ← <details> 로 접어둔다 (서버 요청 없음)
[            ] [확인]
```

- 예문은 `blankOut(example, term)` 으로 만듭니다. 기본형이 매칭되지 않으면 빈칸 카드를 만들지 않습니다.
- 뜻을 기본 노출하지 않습니다. 문맥만으로 떠올리는 것이 cloze의 목적이고, 막힐 때만 힌트를 엽니다.

### 듣기 카드 (`listening`)

- 단어를 화면에 보여주지 않고 **TTS 재생 버튼**만 표시합니다.
- 입력·채점은 `recall`과 같습니다. `question_type='listening'`으로 기록합니다.
- 재생 횟수 제한은 없습니다. “다시 듣기”는 같은 버튼을 다시 누르면 됩니다.
- “들리지 않아요”는 빈 답안으로 제출해 `Again` 처리하고 정답을 공개합니다.
- TTS가 없는 기기에서는 안내 문구를 보여주고 “들리지 않아요”로 넘어가게 합니다.
- 발음 설정(미국식/영국식, 속도)은 `body`의 `data-voice-locale` / `data-voice-rate`로 전달합니다.

오답 응답:

```tsx
<section id="card">
  <p class="text-red-600">✗</p>
  <p>내 답: <del>ubiquitos</del></p>
  <p>정답: <strong>ubiquitous</strong></p>
  <p class="text-sm text-gray-600">어디에나 있는</p>
  <button hx-post={`/review/${card.id}`} hx-vals='{"rating":1}' ...>
    계속 (Again)
  </button>
</section>
```

> 오답일 때는 사용자가 "확인"을 누르게 합니다. 자동으로 넘어가면
> 정답을 읽을 시간이 없어 학습이 일어나지 않습니다.

## 취약 단어 `/hard`

- 탭: `weak`(기본) / `observing` / `leech`
- 취약 탭: `weak` + `attention` 단어, 최근 정답률, 취약 방향, 마지막 복습
- 90일 이상 지난 `stale` 단어는 취약 랭킹에서 제외하고 “재확인 필요”에 접어서 표시
- 관찰 중 탭: 리뷰 5회 미만이라 판정을 보류한 단어
- 격리 탭: `suspended=1` 단어. 연상법 저장/복귀 폼은 기존과 동일
- “취약 단어 연습” 버튼은 `/review?mode=weak`로 이동한다.

`/review?mode=weak`는 **기한이 도래한 취약 단어만** 보여준다. 기한 전 카드를 당기지 않는다.
리뷰는 기존 FSRS 절차를 그대로 쓰고, `source='weak'`로 기록한다.

## FSRS 개인화 `/settings`

- 리뷰 건수와 1,000건 목표를 표시한다.
- `리뷰 로그 내보내기 (JSON)`은 FSRS 최적화 입력을 내려받는다.
- 21개 가중치 배열을 textarea에 붙여넣어 적용한다.
- 적용 중이면 `기본값으로 초기화` 버튼을 보여준다.
- 잘못된 JSON/길이는 `?fsrs=invalid`로 돌려보내고 오류를 표시한다.

## HTMX 속성 정리

| 속성 | 용도 |
|---|---|
| `hx-post` / `hx-delete` | 요청 |
| `hx-target` | 교체할 요소 |
| `hx-swap` | `outerHTML` (자기 자신 교체) / `innerHTML` (내부 교체) |
| `hx-vals` | JS 없이 추가 파라미터 전달 |
| `hx-trigger` | `click`, `keyup[key=='1']`, `revealed` |
| `hx-swap-oob` | 응답 조각으로 다른 위치 갱신 |
| `hx-indicator` | 로딩 스피너 표시 |
| `hx-boost` | `<a>` 태그를 AJAX 네비게이션으로 (`<body hx-boost="true">`) |

## 키보드 단축키 (유일하게 허용하는 JS)

복습 화면에만 40줄짜리 인라인 스크립트를 둡니다.

| 키 | 동작 |
|---|---|
| `Space` / `Enter` | 결과 화면에서 다음 카드 |
| `1`~`4` | 4지선다 보기 선택 (폴백에서는 평점) |

구현은 "해당 버튼을 찾아 `.click()`"이면 끝. HTMX가 나머지를 처리합니다.

```js
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    document.querySelector('[data-act="next"],[data-act="hide"]')?.click();
  } else if (e.key >= '1' && e.key <= '4') {
    document.querySelector(`[data-choice="${e.key}"]`)?.click();
  }
});
```

## 화면별 레이아웃

### 대시보드 `/`

```
┌─────────────────────────────┐
│  Wordy             🔥 12일   │
├─────────────────────────────┤
│                             │
│      오늘의 학습            │
│          23장               │
│ 복습 18 · 승급 2 · 신규 3    │
│      예상 12분              │
│                             │
│   [  학습 시작하기  ]        │
│                             │
├─────────────────────────────┤
│  최근 7일  ▂▃▅▂▇▄█          │
└─────────────────────────────┘
```

### 단어장 `/decks/:id`

- 상단: 단어장 이름, 단어 수, `내보내기` / `전체`(`?full=1`)
- 본문: 단어 리스트 (term / 발음 / meaning / 레벨·카테고리 / 다음 복습일 / 삭제)
- 각 단어의 추가 예문·콜로케이션·유의어·반의어는 `details`로 접어서 표시
- 하단 고정: 빠른 추가 입력 (term + meaning 두 칸, Enter로 연속 추가)

> **연속 추가 UX가 중요합니다.** 단어 입력은 이 앱에서 가장 귀찮은 작업입니다.
> 추가 후 입력창이 비워지고 포커스가 유지되어야 합니다 (HTMX `hx-swap="beforeend"` + `hx-on::after-request`).

## 에러 처리

HTMX는 **4xx 응답을 기본적으로 swap하지 않습니다.** 따라서:

| 상황 | 처리 |
|---|---|
| 폼 검증 실패 | `200` + 폼 조각에 에러 메시지 포함 |
| 인증 만료 | `401` + `HX-Redirect: /login` 헤더 |
| 리소스 없음 | `404` + 안내 조각 |
| 서버 에러 | `500` + `HX-Retarget: #toast` 로 토스트만 교체 |

## 접근성

- 보기·평점 버튼은 실제 `<button>`. `div` + `onclick` 금지.
- 입력 카드가 열리면 입력창에 포커스 (`autofocus`).
- 색만으로 정답·오답을 구분하지 않기 (`정답` / `오답` 텍스트 병기).
- `prefers-reduced-motion` 존중 — 전환 애니메이션 끄기.
