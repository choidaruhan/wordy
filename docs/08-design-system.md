# 08. 디자인 시스템

값은 `src/styles/input.css`의 `@theme`에서 한 번만 정의하고, 화면에서는 유틸리티 클래스로만 사용합니다.
임의값(`p-[13px]`, `text-[15px]`)은 쓰지 않습니다.

**살아 있는 참조 화면: `/design`** — 토큰, 화면 설계, 컴포넌트, 모션, 로드맵을 실제 마크업으로 확인할 수 있습니다.

## 방향 — 조용한 몰입, 가벼운 게임감

- 화면 하나에 질문 하나. 학습 중에는 탭·배너·설정을 숨깁니다.
- 주요 버튼과 선택지는 화면 하단 60%(엄지존)에 둡니다.
- 평가는 **버튼이 기본**, 스와이프는 보조입니다.
- 축하는 세션 완료에만 가볍게. 하트·에너지로 학습을 막지 않습니다.
- 로그인은 저장이 필요할 때만 요청합니다. (온보딩 제안)

## 간격 — 4px 그리드

`--spacing: 4px`이므로 Tailwind 간격 유틸리티의 1단위가 4px입니다.

| 클래스 | 값 | 클래스 | 값 |
|---|---|---|---|
| `p-1` / `gap-1` | 4px | `p-6` / `gap-6` | 24px |
| `p-2` / `gap-2` | 8px | `p-8` / `gap-8` | 32px |
| `p-3` / `gap-3` | 12px | `p-10` / `gap-10` | 40px |
| `p-4` / `gap-4` | 16px | `p-12` / `gap-12` | 48px |
| `p-5` / `gap-5` | 20px | `p-16` / `gap-16` | 64px |

- 터치 가능한 버튼·입력은 최소 44px, 학습 선택지는 48px(`min-h-12`)로 맞춥니다.
- `py-2.5`, `gap-1.5`처럼 4px 배수가 아닌 값은 쓰지 않습니다. (테두리, `gap-px`는 예외)

## 글자 — 12px부터 2px 단위

| 토큰 | 크기 | 기본 줄 높이 | 용도 |
|---|---|---|---|
| `text-xs` | 12px | 16px | 메타 정보, 배지, 날짜 |
| `text-sm` | 14px | 20px | 목록, 폼, 보조 본문 |
| `text-base` | 16px | 24px | 본문, 긴 글 |
| `text-lg` | 18px | 28px | 카드 속 뜻, 단어장 속 단어 |
| `text-xl` | 20px | 28px | 구역 제목, 큰 뜻 |
| `text-2xl` | 24px | 32px | 화면 제목(`h1`) |
| `text-3xl` | 30px | 36px | 결과 화면의 단어 |
| `text-4xl` | 36px | 40px | 학습 카드 단어(모바일) |
| `text-5xl` | 48px | 56px | 학습 카드 단어(데스크톱), 히어로 |

- 영어 단어는 `font-word`(serif) + 큰 크기로 존재감을 만듭니다. UI·한국어는 `font-sans`(Pretendard).
- 화면 제목: `h1` + `text-2xl font-semibold`
- 구역 제목: `h2` + `text-base font-semibold`
- 보조 정보: `text-xs text-muted`

## 색

| 토큰 | Light | Dark | 용도 |
|---|---|---|---|
| `paper` | `#f5f7f4` | `#0e1412` | 페이지 배경 |
| `surface` | `#ffffff` | `#161d1a` | 카드, 입력 |
| `ink` | `#17211e` | `#e9efec` | 기본 글자 |
| `muted` | `#62706b` | `#9aa8a2` | 보조 글자 |
| `line` | `#dde3df` | `#29322e` | 테두리 |
| `line-strong` | `#c5cfc9` | `#3a4641` | 강한 구분선 |
| `accent` | `#0f766e` | `#0f766e` | 행동 채움(버튼) |
| `accent-strong` | `#0b5f58` | `#0b5f58` | 버튼 hover |
| `accent-text` | `#0b5f58` | `#5eead4` | 링크·강조 글자·테두리 |
| `accent-soft` | `#e1f3ef` | `#123a35` | 강조 배경 |
| `streak` | `#b45309` | `#fbbf24` | 연속 학습·에너지 |
| `streak-soft` | `#fff2da` | `#3a2a0e` | 스트릭 배경 |
| `mark` | `#f6c453` | `#f4c152` | 연상법, 주의 |
| `mark-soft` | `#fff7dd` | `#3a2f16` | 주의 배경 |
| `danger` | `#b8482f` | `#f08a74` | 오답, 삭제 |
| `danger-soft` | `#fbe9e4` | `#3a211b` | 오답 배경 |

- `accent`는 **채움**, `accent-text`는 **글자·테두리**입니다. 다크 모드에서 채움은 흰 글자를 지키고, 글자는 밝은 민트로 바뀝니다.
- `streak`는 연속 학습에만. `danger`는 오답·삭제에만.
- 의미를 색만으로 전달하지 않고 항상 텍스트(정답/오답/취약)를 함께 둡니다.

## 다크 모드

- `prefers-color-scheme: dark`에서 `:root` 변수만 교체합니다. 화면 코드에 `dark:`를 붙이지 않습니다.
- `/design`의 팔레트는 `.theme-dark` / `.theme-light`로 강제해 나란히 미리 봅니다.
- `<meta name="theme-color">`도 라이트/다크 두 벌을 둡니다.
- 정적 CSS는 `?v=2` 쿼리와 서비스 워커 `wordy-v2`로 갱신합니다.

## 모서리 · 그림자

| 클래스 | 값 | 용도 |
|---|---|---|
| `rounded` | 4px | 작은 배지 (레거시) |
| `rounded-lg` | 14px | 카드, 패널 |
| `rounded-xl` | 16px | 버튼, 입력, 선택지 |
| `rounded-2xl` | 24px | 큰 패널, 바텀시트 |
| `rounded-full` | — | 칩, 진행 바, pill |
| `shadow-card` | 얕은 2단 그림자 | 종이 같은 카드 |
| `shadow-float` | 깊은 그림자 | 폰 프레임, 바텀시트, 메뉴 |

## 컴포넌트 패턴

```tsx
// 주요 버튼 — 48px
<button class="min-h-12 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white hover:bg-accent-strong">
  학습 시작
</button>

// 보조 버튼
<button class="min-h-11 rounded-xl border border-line bg-surface px-4 py-3 text-sm hover:border-accent-text">
  뜻 보기
</button>

// 학습 선택지 — 48px
<button class="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-paper px-4 text-left text-sm hover:border-accent-text hover:text-accent-text">
  <span class="grid h-6 w-6 place-items-center rounded-full border border-line text-xs text-muted">1</span>
  빌리다
</button>

// 카드
<article class="rounded-lg border border-line bg-surface shadow-card">...</article>

// 안내
<p class="rounded-xl border border-accent-text/30 bg-accent-soft px-4 py-3 text-sm text-accent-text">저장했습니다.</p>
<p class="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">오답입니다.</p>

// 진행률
<div class="h-1 overflow-hidden rounded-full bg-line">
  <div class="h-1 rounded-full bg-accent" style="width:35%"></div>
</div>
```

## 모션 · 햅틱

- 카드 교체: 180ms 페이드 + 4px 상승. `#review-root`, `#quiz-root`의 자식에 적용됩니다.
- 색·테두리: 120ms. 바텀시트: 240ms. 세션 완료: 400ms, 한 번만.
- 선택지·평점·다음 버튼 클릭 시 10ms 진동 (`navigator.vibrate`, 지원 기기만).
- `prefers-reduced-motion: reduce`에서 애니메이션·smooth scroll을 끕니다.
- 정답마다 콘파티를 띄우지 않습니다. 축하는 세션 완료 화면에서만.

## 내비게이션 · 접근성

- 상단 헤더는 sticky, 현재 경로는 `data-active`로 표시합니다.
- 모바일 하단 탭은 아이콘 + 라벨, iOS 안전 영역(`.safe-bottom`)을 피합니다.
- 학습 중에는 탭을 숨기는 **몰입 모드**를 목표로 합니다. (`/design` 로드맵)
- `:focus-visible`은 2px `accent-text` outline.
- 본문 시작에 “본문으로 건너뛰기” 링크를 둡니다.

## 화면별 원칙

| 화면 | 원칙 |
|---|---|
| `/` 오늘 | 오늘 할 양 + 시작 버튼 하나. 복습·신규를 한 카드에 묶고 이번 주 기록을 아래에. |
| `/review` 학습 | 한 번에 한 질문. 4지선다는 48px 버튼, 입력형은 하단 입력창. 오답은 읽을 시간을 준 뒤 다음. |
| 완료 | 정답률보다 “헷갈린 단어”와 “내일 복습”을 먼저. |
| `/decks` 단어장 | 검색 + 4개 필터. 상세는 새 화면이 아니라 바텀시트. |
| `/stats` 기록 | 연속 학습·이번 달 히트맵·자주 틀린 단어. 과한 예측 지표는 노출하지 않음. |
| 온보딩 | 목표 → 레벨 → 하루 목표 → 첫 카드. 로그인은 저장 시점에만. |
