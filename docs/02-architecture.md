# 02. 아키텍처

## 요청 흐름

```
브라우저
  │
  ├─ GET /styles.css  ──→ Cloudflare Static Assets (CDN, Worker 실행 안 됨)
  ├─ GET /htmx.min.js ──→ Cloudflare Static Assets
  │
  └─ GET /review       ──→ Worker
                            │ Hono router
                            ├─ middleware: 세션 검증
                            ├─ query: D1 (SQLite, 같은 리전)
                            └─ render: hono/jsx → HTML 문자열
                                │
                            ◄─── 완성된 HTML (CSS는 이미 캐시됨)
```

**핵심**: 화면 이동은 항상 서버 렌더. 상태는 DB에만 존재. 클라이언트에서 상태를 복제하지 않으므로 동기화 버그가 원천적으로 없다.

## 요청 처리 순서 (중요)

`wrangler.jsonc`에 `assets`와 `main`이 둘 다 있으면 **정적 파일을 먼저 찾고, 없으면 Worker로 넘깁니다.**

그래서:

- `public/` 안에 **`index.html`을 절대 두지 않습니다.** 두면 `/`가 Worker 대신 정적 파일로 서빙됩니다.
- CSS/JS/아이콘/manifest만 `public/`에 둡니다.
- 모든 HTML 라우트(`/`, `/review`, `/decks/...`)는 Hono가 처리합니다.

## 폴더 구조

```
wordy/
├── wrangler.jsonc
├── package.json
├── tsconfig.json
├── migrations/
│   └── 0001_init.sql
├── public/                      # 정적 자산 (Worker 거치지 않음)
│   ├── styles.css               # ← Tailwind 빌드 산출물 (gitignore)
│   ├── htmx.min.js
│   ├── manifest.webmanifest
│   ├── sw.js
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
└── src/
    ├── index.tsx                # 엔트리: 앱 조립 + 미들웨어 + 라우트 등록
    ├── types.ts                 # Bindings / Variables 타입
    ├── styles/
    │   └── input.css            # Tailwind 소스 (빌드 입력)
    ├── db/
    │   └── queries.ts           # SQL을 한 곳에 모음 (raw SQL, ORM 없음)
    ├── lib/
    │   ├── srs.ts               # ts-fsrs 래퍼
    │   ├── auth.ts              # 세션, OAuth
    │   ├── csv.ts               # 파싱/직렬화
    │   └── time.ts              # 사용자 로컬 날짜 계산
    ├── components/
    │   ├── layout.tsx           # <html> 껍데기, nav
    │   ├── review-card.tsx      # 복습 카드 (앞/뒤)
    │   └── ui.tsx               # 버튼, 배지 등 소품
    └── routes/
        ├── auth.tsx
        ├── decks.tsx
        ├── review.tsx
        ├── stats.tsx
        └── home.tsx
```

> **ORM을 쓰지 않는 이유**: D1은 SQLite이고 쿼리가 10개 남짓입니다.
> Drizzle을 붙이면 빌드·마이그레이션 도구가 하나 더 늘고, Worker 번들이 커집니다.
> SQL을 직접 쓰되 `db/queries.ts`에 모아서 타입만 손으로 붙입니다.

## wrangler.jsonc

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "wordy",
  "main": "src/index.tsx",
  "compatibility_date": "2026-10-01",
  "observability": { "enabled": true },

  // 정적 자산. Worker보다 먼저 매칭된다.
  "assets": {
    "directory": "./public",
    "binding": "ASSETS"
  },

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "wordy-db",
      "database_id": "<wrangler d1 create 로 발급받은 ID>",
      "migrations_dir": "migrations"
    }
  ],

  // v1.1에서 일일 리마인더용으로 사용
  "triggers": {
    "crons": ["0 12 * * *"]
  }
}
```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

> `jsxImportSource: "hono/jsx"` 가 핵심. 이 설정이 없으면 React JSX로 컴파일됩니다.

## Hono JSX 주의점 (React와 다름)

```tsx
// React 습관
<div className="p-4">{children}</div>

// Hono JSX — class 사용 (className도 동작하지만 class가 정석)
<div class="p-4">{children}</div>
```

- `hono/jsx`는 **서버 렌더 전용**입니다. `useState`, `useEffect`, 이벤트 핸들러 없음.
- 인터랙션은 전부 HTMX 속성으로:
  ```tsx
  <button hx-post={`/review/${card.id}`} hx-vals='{"rating":3}' hx-target="#card" hx-swap="outerHTML">
    Good
  </button>
  ```
- `dangerouslySetInnerHTML` 대신 `<>...</>` 프래그먼트 사용.

## Tailwind v4 설정

`src/styles/input.css`:

```css
@import "tailwindcss";

/* 소스 스캔 경로 명시 (v4는 자동 탐지하지만 명시가 안전) */
@source "../../src";

@theme {
  --color-ink-950: oklch(0.18 0.02 260);
  --color-paper: oklch(0.98 0.005 90);
  --color-accent-600: oklch(0.55 0.19 265);
  --font-sans: "Pretendard Variable", system-ui, sans-serif;
}
```

빌드: `tailwindcss -i src/styles/input.css -o public/styles.css --minify`

> v4에는 `tailwind.config.js`가 필수가 아닙니다. 테마는 CSS의 `@theme`에서 정의합니다.

## 인증 — CPU 10ms 함정

Workers **무료 플랜은 요청당 CPU 시간 10ms**입니다. PBKDF2 10만 회는 이 한도를 넘길 수 있습니다.

| 방식 | 판정 | 비고 |
|---|---|---|
| Google OAuth (권장) | ✅ | 해싱 없음. `arctic` 라이브러리 또는 직접 구현 |
| 이메일 + 비밀번호 | ⚠️ | PBKDF2 반복 5만 회 이하로 낮추거나 유료 플랜($5) 필요 |
| 매직 링크 | ⚠️ | 이메일 발송 서비스(Resend 등) 의존 추가 |

**MVP 권장: Google OAuth 단일.** 계정 개념은 유지하되 비밀번호 관리 부담을 없앱니다.

세션은 D1 테이블 + `HttpOnly`, `Secure`, `SameSite=Lax` 쿠키. 쿠키에는 랜덤 토큰만 담고 해시를 DB에 저장합니다.

## CSRF

쿠키 인증 + HTMX 조합이므로 `SameSite=Lax`만으로는 부족한 경우가 있습니다.

- 모든 상태 변경 요청은 **POST/DELETE만** 사용 (GET으로 변경 금지)
- 폼에 `_csrf` hidden input, 세션에 CSRF 토큰 저장, 미들웨어에서 검증
- HTMX 요청은 `hx-headers` 로 헤더에 토큰을 실어도 됨

## 캐싱 / PWA

구현된 구성입니다.

| 파일 | 역할 |
|---|---|
| `public/manifest.webmanifest` | 설치 정보. `display: standalone`, 테마 `#12694f` |
| `public/icons/icon-{192,512}.png` | 마스커블 아이콘. `scripts/make-icons.mjs` 로 생성 (의존성 없음) |
| `public/sw.js` | 앱 셸 캐시 + 오프라인 폴백 |
| `public/offline.html` | 네트워크 실패 시 보여줄 정적 페이지 (스타일 인라인) |
| `public/_headers` | `sw.js` 는 `no-cache`, 정적 자산은 캐시 |

### 서비스 워커 전략

| 요청 | 전략 |
|---|---|
| 화면 이동 (`mode === 'navigate'`) | network-first → 실패 시 `/offline.html` |
| `styles.css`, `htmx.min.js`, `/icons/*` | 캐시 먼저 → 뒤에서 갱신 (stale-while-revalidate) |
| 그 외 (HTML 조각, POST) | 가로채지 않음 |

> HTMX와 서비스 워커를 같이 쓸 때 가장 흔한 버그는 **오래된 HTML 조각이 캐시되어 복습 카드가 안 넘어가는 것**입니다. HTML은 절대 캐시하지 않습니다.
> `sw.js` 자체가 캐시되면 업데이트가 영원히 안 되므로 `no-cache` 를 겁니다.

### static assets 설정 주의

`wrangler.jsonc` 에 `"html_handling": "none"` 을 지정했습니다.
기본값(`auto-trailing-slash`)은 `/offline.html` 요청을 `/offline` 으로 **307 리다이렉트**합니다.
리다이렉트된 응답은 서비스 워커가 화면 이동에 재사용할 수 없어 오프라인 폴백이 깨집니다.

### 오프라인 범위

- 가능: 앱 셸 열기, 오프라인 안내 화면
- 불가능: 카드 학습·기록 저장 (서버 저장이 원칙)
- 학습 오프라인은 IndexedDB 이벤트 큐 + 동기화가 필요하므로 v1 범위에서 제외했습니다.

## 로컬 개발

```bash
npm run dev   # = build:css && wrangler dev
```

`wrangler dev`는 Miniflare 위에서 실제 D1(SQLite 파일)을 로컬에 만듭니다.
**원격 D1을 건드리지 않으므로 마음껏 테스트하세요.** 초기화는 `.wrangler/state` 삭제 후 재적용.

## 테스트

`@cloudflare/vitest-pool-workers` 로 D1까지 포함한 통합 테스트가 가능합니다.

우선순위:
1. `lib/srs.ts` — 순수 함수이므로 단위 테스트 (가장 중요)
2. `lib/csv.ts` — 인코딩/따옴표 엣지 케이스
3. `routes/review.tsx` — POST 후 다음 카드가 바뀌는지
