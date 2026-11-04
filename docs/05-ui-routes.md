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
| GET | `/review` | 필요 | 전체 | 오늘의 큐, 첫 카드 표시 |
| GET | `/review/:cardId` | 필요 | 조각 | 앞면 카드 |
| POST | `/review/next` | 필요 | 조각 | 결과 확인 후 다음 카드 |
| POST | `/review/:cardId/hide` | 필요 | 조각 | 신규 카드 소개 → 뜻 가리기 |
| POST | `/review/:cardId/reveal` | 필요 | 조각 | 뒷면(뜻/예문) 펼침 |
| POST | `/review/:cardId/answer` | 필요 | 조각 | 한→영 / 빈칸 입력 채점 → 결과 |
| GET | `/stats` | 필요 | 전체 | 학습 통계 |
| GET | `/settings` | 필요 | 전체 | 학습 목표 설정 |
| POST | `/settings` | 필요 | 302 | 설정 저장 |
| GET | `/decks/:id/export` | 필요 | 파일 | 단어장 CSV 다운로드 |
| GET | `/terms` | — | 전체 | 이용약관 |
| GET | `/privacy` | — | 전체 | 개인정보처리방침 |
| GET | `/quiz` | 필요 | 전체 | 테스트 설정 || POST | `/quiz/start` | 필요 | 302 | 새 테스트 생성 |
| GET | `/quiz/session` | 필요 | 전체 | 현재 문제 |
| POST | `/quiz/answer` | 필요 | 조각 | 채점 → 피드백 |
| POST | `/quiz/next` | 필요 | 조각 | 다음 문제 또는 결과 |
| GET | `/hard` | 필요 | 전체 | 어려운 단어 목록 |
| POST | `/hard/:cardId/note` | 필요 | 302 | 연상법 저장 |
| POST | `/hard/:cardId/resume` | 필요 | 302 | 학습 큐로 복귀 |
| POST | `/review/:cardId` | 필요 | 조각 | 평점(`rating`) 또는 입력 답안(`answer`) 처리 → 다음 카드 |
| GET | `/stats` | 필요 | 전체 | 통계 |
| GET | `/settings` | 필요 | 전체 | 일일 목표, 타임존 |
| POST | `/settings` | 필요 | 전체 | 설정 저장 |

## 데이터 흐름

```
GET /review
  └─ 큐 생성 → 첫 카드 렌더 → HTML 전체

POST /review/:id/reveal
  └─ 카드 뒷면 조각 반환

POST /review/:id  (rating=3)
  ├─ D1 batch: cards UPDATE + reviews INSERT
  ├─ 다음 카드 1장 조회
  └─ 다음 카드 조각 + 진행률 OOB 조각 반환
```

## 복습 화면 상세

### 마크업

```tsx
<div id="review-root">
  <div id="progress" class="...">7 / 20</div>

  <section id="card" class="...">
    <p class="text-3xl">ubiquitous</p>
    <p class="text-sm text-gray-500">/juːˈbɪkwɪtəs/</p>

    <button
      hx-post={`/review/${card.id}/reveal`}
      hx-target="#card"
      hx-swap="outerHTML"
      class="...">
      뜻 보기
    </button>
  </section>
</div>
```

### 뒷면 (reveal 응답)

```tsx
<section id="card" class="...">
  <p class="text-3xl">ubiquitous</p>
  <hr />
  <p class="text-xl">어디에나 있는</p>
  <p class="text-sm text-gray-600">Smartphones are ubiquitous these days.</p>

  <div class="grid grid-cols-4 gap-2 mt-6">
    {[1,2,3,4].map(r => (
      <button
        hx-post={`/review/${card.id}`}
        hx-vals={JSON.stringify({ rating: r })}
        hx-target="#review-root"
        hx-swap="innerHTML">
        <span>{LABEL[r]}</span>
        <small>{intervals[r]}</small>   {/* "10분" / "4일" / "2개월" */}
      </button>
    ))}
  </div>
</section>
```

### 다음 카드 응답 (평점 POST)

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

`recognition`은 자기평가지만, `recall`은 **서버가 채점**합니다. 평점 버튼이 없습니다.

```tsx
<form
  hx-post={`/review/${card.id}`}
  hx-target="#review-root"
  hx-swap="innerHTML"
  hx-disabled-elt="find button">
  <p class="text-2xl">어디에나 있는</p>
  <input name="answer" autocomplete="off" autocapitalize="off" spellcheck="false"
         class="..." autofocus />
  <button type="submit">확인</button>
</form>
```

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
| `Space` / `Enter` | 뜻 보기 |
| `1` | Again |
| `2` | Hard |
| `3` | Good |
| `4` | Easy |

구현은 "해당 버튼을 찾아 `.click()`"이면 끝. HTMX가 나머지를 처리합니다.

```js
document.addEventListener('keydown', (e) => {
  const map = { '1':'again', '2':'hard', '3':'good', '4':'easy' };
  if (e.key === ' ' || e.key === 'Enter') {
    document.querySelector('[data-reveal]')?.click();
  } else if (map[e.key]) {
    document.querySelector(`[data-rate="${map[e.key]}"]`)?.click();
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
│      오늘 남은 카드          │
│          23                 │
│   복습 18 · 신규 5           │
│                             │
│   [  학습 시작하기  ]        │
│                             │
├─────────────────────────────┤
│  최근 7일  ▂▃▅▂▇▄█          │
└─────────────────────────────┘
```

### 단어장 `/decks/:id`

- 상단: 단어장 이름, 단어 수, `CSV 가져오기` / `내보내기`
- 본문: 단어 리스트 (term / meaning / 다음 복습일 / 삭제)
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

- 평점 버튼은 실제 `<button>`. `div` + `onclick` 금지.
- 카드 뒤집기 후 포커스를 평점 영역으로 이동 (`autofocus`).
- 색만으로 평점을 구분하지 않기 (Again/Hard/Good/Easy 텍스트 병기).
- `prefers-reduced-motion` 존중 — 뒤집기 애니메이션 끄기.
