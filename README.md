# Wordy

영어 단어 학습 PWA. **단어를 외우는 게 아니라, 기억하게 만든다.**
매일 정해진 양만, 잊어버릴 때쯤 다시. 광고 없고, 가볍고, 오프라인에서도 열립니다.

---

## 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 런타임 | Cloudflare Workers | 무료 10만 req/일 |
| 프레임워크 | Hono v4 | SSR + `hono/jsx` |
| 인터랙션 | HTMX 2.x | 서버가 HTML 조각 반환 |
| 스타일 | Tailwind CSS v4 | 빌드 타임 CLI로 CSS 생성 |
| DB | Cloudflare D1 (SQLite) | 바인딩 이름 `DB` |
| 복습 알고리즘 | FSRS (`ts-fsrs`) | 순수 TS, Workers에서 동작 |
| 배포 | `wrangler deploy` | |

**클라이언트 JS는 htmx 하나뿐입니다.** React도, 번들러도, hydration도 없습니다.

---

## 문서

`docs/` 번호 순서가 읽는 순서입니다.

| 문서 | 내용 | 상태 |
|---|---|---|
| [docs/01-plan.md](docs/01-plan.md) | 제품 기획, 타겟, 콘텐츠 전략, 마일스톤 | 갱신 |
| [docs/02-architecture.md](docs/02-architecture.md) | 아키텍처, 폴더 구조, wrangler 설정, 빌드 | |
| [docs/03-data-model.md](docs/03-data-model.md) | D1 스키마, 인덱스, 마이그레이션 | |
| [docs/04-srs.md](docs/04-srs.md) | FSRS 복습 알고리즘, 승급, 격리 | |
| [docs/05-ui-routes.md](docs/05-ui-routes.md) | 라우트 목록, HTMX 인터랙션 명세 | |
| [docs/06-learning-design.md](docs/06-learning-design.md) | **학습 설계 — 어떻게 외우게 할 것인가** | |

---

## 콘텐츠 (기본 단어장)

| 파일 | 내용 |
|---|---|
| `public/seeds/basic-1000.csv` | 기본 단어 1,000개 (명사·동사·형용사·부사·구동사) |
| `public/seeds/function-100.csv` | 기능어 100개 (관사·대명사·전치사·접속사·조동사) |

```bash
node scripts/check-seed.mjs public/seeds/basic-1000.csv --expect 1000
```

포맷과 규칙은 [docs/03-data-model.md](docs/03-data-model.md#csv-형식) 참고.

---

## 실행 방법

### 로컬 개발

```bash
npm install
npm run db:local      # 로컬 D1에 스키마 적용
npm run dev           # CSS/htmx 빌드 후 wrangler dev
```

`http://localhost:8787` 접속 → **"로컬 개발 계정으로 시작"** 버튼 (`.dev.vars`의 `DEV_LOGIN=true`).
Google OAuth 없이 바로 쓸 수 있습니다.

CSS를 고칠 때는 터미널을 하나 더 열어:

```bash
npm run dev:css       # Tailwind watch
```

### 원격 배포

```bash
# 1. D1 생성 후 출력된 database_id를 wrangler.jsonc 에 붙여넣기
npx wrangler d1 create english-learning-db

# 2. 스키마 적용
npm run db:remote

# 3. 시크릿 등록 (DEV_LOGIN 은 운영에서 쓰지 않음)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# 4. 배포
npm run deploy
```

Google OAuth 리디렉션 URI에 `https://<your-domain>/auth/google/callback` 을 등록해야 합니다.

### 스크립트

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 빌드 + 로컬 서버 |
| `npm run dev:css` | Tailwind watch |
| `npm run db:local` | 로컬 D1 마이그레이션 |
| `npm run db:remote` | 원격 D1 마이그레이션 |
| `npm run typecheck` | 타입 검사 |
| `npm run check:seed` | 시드 CSV 검수 |
| `npm run make:icons` | PWA 아이콘 재생성 |
| `npm run deploy` | 빌드 + 배포 |

> Tailwind v4의 CLI 실행 파일 이름은 `tailwindcss`입니다 (`@tailwindcss/cli` 패키지).
> CSS는 반드시 **배포 전에** 빌드되어 `public/`에 있어야 합니다. Workers 런타임에는 Node가 없습니다.

---

## 구현 상태

| 단계 | 범위 | 상태 |
|---|---|---|
| M1 | 스캐폴드, 인증(Google OAuth + 로컬 개발 로그인), 단어장/단어 CRUD, 기본 단어장 임포트 | ✅ |
| M2 | 복습 루프 (recognition + FSRS + 신규 소개 모드 + 발음) | ✅ |
| M3 | 한→영 타이핑 카드, 철자 채점, 승급, 어려운 단어 관리 | ✅ |
| M3.5 | cloze(빈칸) 카드 + 기능어 단어장 | ✅ |
| M4 | 통계 화면, PWA 설치, 오프라인 앱 셸, 하단 탭 | ✅ |
| M5 | 객관식 퀴즈, 설정, CSV 내보내기 | ✅ |

### M3에서 확인된 동작
- **승급**: 영→한 카드가 `review` 상태 + `scheduled_days >= 4` 가 되면 한→영 카드 자동 생성
- `POST /review/:id/answer` — 입력 채점 즉시 저장 (`Good` / `Again`)
  - 정확: `정답`
  - 오타 허용: `정답 (철자 확인)` — 8자 이상 2, 5~7자 1, 4자 이하 0
  - 오답: `오답` + 철자 단위 하이라이트
- `POST /review/next` — 결과 확인 후 다음 카드
- `GET /hard` — 8번 이상 틀린 단어 목록, 연상법 작성, 학습 복귀
- 승급된 한→영 카드는 **신규 단어 쿼터를 쓰지 않고** 먼저 나옵니다
- 연상법은 저장 후 해당 단어의 복습 화면에 함께 표시됩니다

> **알려진 제약**: `answer` 엔드포인트는 카드가 실제로 due 인지 확인하지 않습니다.
> 같은 답안을 재전송하면 리뷰가 한 번 더 기록될 수 있습니다. (브라우저 뒤로가기 정도의 위험)

> **로컬 D1 주의**: `wrangler dev`가 실행 중일 때 `wrangler d1 execute --local`을 같이 돌리면
> SQLite 락(`SQLITE_BUSY`)이 걸려 개발 서버가 죽을 수 있습니다. 서버를 내린 뒤 실행하세요.

---

## 비용

| 항목 | 무료 한도 | 이 앱 예상 |
|---|---|---|
| Workers | 10만 req/일 | 사용자 1명 = 하루 ~200 req |
| D1 reads | 500만 row/일 | 하루 ~2,000 row |
| D1 writes | 10만 row/일 | 하루 ~100 row |
| Static assets | 무제한 | — |

개인용·소규모는 **월 0원**. 유료 전환해도 $5/월.
