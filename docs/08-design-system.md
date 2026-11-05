# 08. 디자인 시스템

값은 `src/styles/input.css`의 `@theme`에서 한 번만 정의하고, 화면에서는 유틸리티 클래스로만 사용합니다.
임의값(`p-[13px]`, `text-[15px]`)은 쓰지 않습니다.

**살아 있는 참조 화면: `/design`** — 실제 화면의 토큰과 컴포넌트를 확인할 수 있습니다.

## 방향 — 라이트 인디고, 퍼플 CTA

- 배경은 `#F7F8FC` 라이트 인디고, 카드는 흰색, 글자는 딥 인디고.
- 주요 행동은 퍼플 하나. 버튼에는 퍼플 틴트의 `shadow-brand` 글로우.
- 정답은 그린, 연속 학습은 앰버, 오답은 레드. 의미는 색 + 텍스트로 함께 전달.
- 카드는 16–24px 라운드, 얕은 `shadow-card`. 한 화면에 주요 행동 하나.
- 영단어는 화면에서 가장 크게, 굵은 산세리프(Plus Jakarta Sans 계열).

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
- 학습 화면은 하단 탭을 숨기는 **몰입 모드**를 사용합니다. (`hideNav`)

## 글자 — 12px부터 2px 단위

폰트는 `public/fonts/`에서 셀프호스팅합니다. Plus Jakarta Sans는 영문·단어, Pretendard Variable은 한글에 사용하며 외부 폰트 요청은 없습니다.

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

- 영단어는 `font-word`(Plus Jakarta Sans, 800)로 가장 크게.
- 화면 제목: `h1` + `text-2xl font-extrabold tracking-tight`
- 구역 제목: `h2` + `text-base font-extrabold tracking-tight`
- 보조 정보: `text-xs text-muted`

## 색

| 토큰 | Light | Dark | 용도 |
|---|---|---|---|
| `paper` | `#f7f8fc` | `#0f0b1f` | 페이지 배경 |
| `surface` | `#ffffff` | `#17122b` | 카드, 입력 |
| `ink` | `#1e1b4b` | `#f3f0ff` | 기본 글자 |
| `muted` | `#6b7280` | `#a8a1c4` | 보조 글자 |
| `line` | `#e9e5f8` | `#2a2145` | 테두리 |
| `line-strong` | `#d5c7ff` | `#3d3260` | 강한 구분선 |
| `accent` | `#5f2eea` | `#5f2eea` | 행동 채움(버튼) |
| `accent-strong` | `#4b1ec6` | `#4b1ec6` | 버튼 hover |
| `accent-soft` | `#f4f0ff` | `#261a4f` | 강조 배경 |
| `accent-text` | `#5f2eea` | `#c4b5fd` | 링크·강조 글자 |
| `streak` | `#f59e0b` | `#fbbf24` | 연속 학습 |
| `streak-soft` | `#fef3c7` | `#3a2a0e` | 스트릭 배경 |
| `success` | `#10b981` | `#34d399` | 정답·성공 |
| `success-soft` | `#d1fae5` | `#103a2e` | 정답 배경 |
| `mark` | `#f6c453` | `#f4c152` | 연상법, 주의 |
| `mark-soft` | `#fff7dd` | `#3a2f16` | 주의 배경 |
| `danger` | `#ef4444` | `#f87171` | 오답, 삭제 |
| `danger-soft` | `#fee2e2` | `#3a1d1d` | 오답 배경 |

- `accent`는 **채움**, `accent-text`는 **글자·테두리**입니다. 다크 모드에서 채움은 흰 글자를 지키고, 글자는 라벤더로 바뀝니다.
- `success`는 정답, `streak`는 연속 학습, `danger`는 오답·삭제에만.

## 다크 모드

- `<html data-theme="system|light|dark">`로 제어합니다. 기본은 `system`입니다.
- 설정에서 **시스템 / 라이트 / 다크**를 기기별로 선택합니다. 선택값은 `localStorage`에 저장됩니다.
- `<head>`의 작은 초기화 스크립트가 첫 페인트 전에 실제 `light`/`dark`를 확정해 깜빡임을 막습니다.
- 화면 코드에 `dark:`를 붙이지 않고 `:root` 변수만 교체합니다.
- `<meta name="theme-color">`도 현재 테마에 맞춰 갱신합니다.

## 모서리 · 그림자

| 클래스 | 값 | 용도 |
|---|---|---|
| `rounded` | 4px | 작은 배지 (레거시) |
| `rounded-xl` | 16px | 버튼, 입력, 선택지 |
| `rounded-2xl` | 24px | 카드, 패널 |
| `rounded-full` | — | 칩, 진행 바, pill |
| `shadow-card` | 얕은 퍼플 틴트 | 카드 |
| `shadow-brand` | 퍼플 글로우 | 주요 버튼 |
| `shadow-float` | 깊은 그림자 | 떠 있는 메뉴 |

## 컴포넌트 패턴

```tsx
// 주요 버튼
<button class="min-h-12 rounded-xl bg-accent px-5 py-3 text-sm font-bold text-white shadow-brand hover:bg-accent-strong">
  학습 시작
</button>

// 학습 선택지
<button class="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-surface px-4 text-left text-sm font-medium hover:border-accent-text hover:bg-accent-soft/40">
  <span class="grid h-6 w-6 place-items-center rounded-full border border-line text-xs text-muted">1</span>
  빌리다
</button>

// 카드
<article class="rounded-2xl border border-line bg-surface shadow-card">...</article>

// 안내
<p class="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-semibold text-success">정답</p>
<p class="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">오답</p>

// 진행률
<div class="h-2 overflow-hidden rounded-full bg-line">
  <div class="h-2 rounded-full bg-accent" style="width:35%"></div>
</div>
```

## 모션 · 햅틱

- 카드 교체: 180ms 페이드 + 4px 상승. `#review-root`, `#quiz-root`의 자식에 적용됩니다.
- 색·테두리: 120ms. 세션 완료: 400ms, 한 번만.
- 선택지·평점·다음 버튼 클릭 시 10ms 진동 (`navigator.vibrate`, 지원 기기만). 설정에서 끌 수 있습니다.
- `prefers-reduced-motion: reduce`에서 애니메이션·smooth scroll을 끕니다.

## 화면별 원칙

| 화면 | 원칙 |
|---|---|
| `/` 오늘 | 지금 풀 수 있는 문제 수 + 바로 시작. 4지선다·복습·듣기 모드를 카드로. |
| `/review` 학습 | 상단 진행률 + 나가기. 하단 탭을 숨기고 한 번에 한 질문. 4지선다는 48px 버튼. |
| 결과 | 큰 정답/오답 마크 + 단어·뜻·예문 + 다음 복습일. 오답은 읽을 시간을 준 뒤 다음. |
| `/stats` 기록 | 7/14/30일 전환, 정확도 링, 3개 지표, 기간별 막대 차트. |
| `/decks` 단어장 | 검색 + 카드형 목록. 상세는 같은 페이지에서 이어짐. |
| `/login` | 로고 + 로그인 카드. 계정은 기록 저장 목적으로만 설명. |
