# 08. 디자인 시스템

값은 `src/styles/input.css`의 `@theme`에서 한 번만 정의하고, 화면에서는 유틸리티 클래스로만 사용합니다.
임의값(`p-[13px]`, `text-[15px]`)은 쓰지 않습니다.

## 간격 — 4px 그리드

`--spacing: 4px`이므로 Tailwind 간격 유틸리티의 1단위가 4px입니다.

| 클래스 | 값 | 클래스 | 값 |
|---|---|---|---|
| `p-1` / `gap-1` | 4px | `p-6` / `gap-6` | 24px |
| `p-2` / `gap-2` | 8px | `p-8` / `gap-8` | 32px |
| `p-3` / `gap-3` | 12px | `p-10` / `gap-10` | 40px |
| `p-4` / `gap-4` | 16px | `p-12` / `gap-12` | 48px |
| `p-5` / `gap-5` | 20px | `p-16` / `gap-16` | 64px |

- 화면 여백, 카드 패딩, 요소 사이 간격은 모두 위 단위를 씁니다.
- `py-2.5`, `gap-1.5`, `py-0.5`처럼 4px 배수가 아닌 값은 쓰지 않습니다. (테두리 두께 `border`, 구분선 `gap-px`는 예외)
- 터치 가능한 버튼·입력은 높이 44px 이상(`py-3` + `text-sm`, 또는 `min-h-11`)으로 맞춥니다.

## 글자 — 12px부터 2px 단위

| 토큰 | 크기 | 기본 줄 높이 | 용도 |
|---|---|---|---|
| `text-xs` | 12px | 16px | 메타 정보, 배지, 날짜, 보조 설명 |
| `text-sm` | 14px | 20px | 본문 기본, 목록, 폼 |
| `text-base` | 16px | 24px | 단어·문장, 긴 글(약관), 강조 본문 |
| `text-lg` | 18px | 28px | 카드 속 뜻, 단어장 속 단어 |
| `text-xl` | 20px | 28px | 큰 단위·보조 숫자 |
| `text-2xl` | 24px | 32px | 화면 제목(`h1`) |
| `text-3xl` | 30px | 36px | 결과 화면의 단어 |
| `text-4xl` | 36px | 40px | 학습 카드 앞면(모바일), 랜딩 제목(모바일) |
| `text-5xl` | 48px | 56px | 학습 카드 앞면(데스크톱), 랜딩 제목(데스크톱) |

### 위계 규칙

- 화면 제목: `h1` + `text-2xl font-semibold`
- 구역 제목: `h2` + `text-base font-semibold`
- 본문: `text-sm`, 읽는 글이 길면 `text-base leading-7`
- 보조 정보: `text-xs text-muted`
- 숫자 강조: `font-word text-5xl`, 단위는 `text-lg text-muted`

## 색

| 토큰 | 값 | 용도 |
|---|---|---|
| `paper` | `#f3f5f3` | 페이지 배경 |
| `surface` | `#ffffff` | 카드, 입력 |
| `ink` | `#16211e` | 기본 글자 |
| `muted` | `#5f6c68` | 보조 글자 |
| `line` | `#d9dfdc` | 테두리, 구분선 |
| `accent` | `#12694f` | 주요 동작, 진행 |
| `accent-soft` | `#e2efe9` | 강조 배경 |
| `mark` | `#ffe08a` | 연상법, 주의 |
| `danger` | `#a33a2a` | 오답, 삭제 |

## 적용 예시

```tsx
<h1 class="text-2xl font-semibold">단어장</h1>
<p class="mt-2 text-sm leading-6 text-muted">설명</p>

<button class="rounded bg-accent px-4 py-3 text-sm font-medium text-white">
  저장
</button>

<input class="w-full rounded border border-line bg-surface px-3 py-3 text-sm" />
```
