# Wordy

영어 단어 학습 PWA. **단어를 외우는 게 아니라, 기억하게 만든다.**
매일 정해진 양만, 잊어버릴 때쯤 다시. 광고 없고, 가볍고, 오프라인에서도 열립니다.

**배포:** https://wordy.choidaruhan.workers.dev

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
| [docs/07-learning-engine.md](docs/07-learning-engine.md) | **M6 학습 엔진 명세 — 취약 단어·세션·적응형 배분** | M6.6 반영 |
| [docs/08-design-system.md](docs/08-design-system.md) | 4px 간격·글자 크기·색 토큰 | 신규 |

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

#### Google 계정으로 로컬 테스트

1. [Google Cloud Console → 사용자 인증 정보](https://console.cloud.google.com/apis/credentials)에서
   **OAuth 2.0 클라이언트 ID (웹 애플리케이션)** 를 만듭니다. 이미 배포용으로 만든 클라이언트가 있으면 재사용해도 됩니다.
2. 클라이언트의 **승인된 리디렉션 URI** 에 `http://localhost:8787/auth/google/callback` 을 추가합니다.
   리디렉션 URI는 요청 주소에서 그대로 만들어지므로, 다른 포트로 띄우면 그 포트로 등록해야 합니다.
3. `.dev.vars` 의 주석을 풀고 값을 채운 뒤 `npm run dev` 를 **재시작**합니다 (`.dev.vars` 는 시작할 때만 읽습니다).

```
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-....
```

`/login` 에 **"Google로 계속하기"** 버튼이 함께 보이면 성공입니다. 개발 계정 버튼은 그대로 둬도 됩니다.

- OAuth 동의 화면이 **Testing** 상태라면, 테스트 사용자에 로그인할 Google 계정을 추가해야 합니다.
- Google 계정으로 로그인하면 이메일 기준으로 **새 사용자 row** 가 생깁니다. 개발 계정과 학습 기록은 섞이지 않습니다.
- `redirect_uri_mismatch` 가 나면 ① 실제 포트(8787이 이미 사용 중이면 wrangler가 다른 포트로 뜹니다) ② 등록한 URI 문자열 ③ 클라이언트 ID/보안 비밀 짝을 확인하세요.

CSS를 고칠 때는 터미널을 하나 더 열어:

```bash
npm run dev:css       # Tailwind watch
```

### 원격 배포

```bash
# 1. D1 생성 후 출력된 database_id를 wrangler.jsonc 에 붙여넣기
npx wrangler d1 create wordy-db

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
| `npm test` | 쿼터·원자성·마이그레이션 테스트 |
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
| M6.1 | 리뷰 계측, 트랜잭션 원자성, 쿼터 수정 | ✅ |
| M6.2 | 취약 단어 분류, 관찰/격리 분리, 취약 연습 | ✅ |
| M6.3 | 하루 계획 스냅샷, 적응형 신규 배분, 세션 혼합 | ✅ |
| M6.4 | 단어 메타데이터, 다중 예문, CSV v2 | ✅ |
| M6.5 | 듣기 카드, 발음 설정, TTS 학습 | ✅ |
| M6.6 | FSRS 리뷰 로그 내보내기, 사용자별 파라미터 | ✅ |

### M3에서 확인된 동작
- **승급**: 영→한 카드가 `review` 상태 + `scheduled_days >= 4` 가 되면 한→영 카드 자동 생성
- `POST /review/:id/answer` — 입력 채점 즉시 저장 (`Good` / `Again`)
  - 정확: `정답`
  - 오타 허용: `정답 (철자 확인)` — 8자 이상 2, 5~7자 1, 4자 이하 0
  - 오답: `오답` + 철자 단위 하이라이트
- `POST /review/next` — 결과 확인 후 다음 카드
- `GET /hard` — 8번 이상 틀린 단어 목록, 연상법 작성, 학습 복귀
- 승급된 한→영 카드는 **신규 단어 쿼터(`daily_new`)를 쓰지 않고** 복습 다음에 나옵니다.
  `daily_review` 부담에는 포함됩니다.
- 연상법은 저장 후 해당 단어의 복습 화면에 함께 표시됩니다

### M6.2에서 확인된 동작
- `/hard`가 **취약 / 관찰 중 / 격리** 탭으로 나뉩니다.
- 취약 점수는 최근 20회 리뷰·lapses·stability·퀴즈 오답으로 계산합니다.
- 최근 5회 미만은 **관찰 중**, 90일 이상 지난 카드는 **재확인 필요**로 분류합니다.
- `/review?mode=weak`는 **기한이 도래한 취약 단어만** 연습하고 `source='weak'`로 기록합니다.
- 취약 연습도 기존 FSRS 일정을 당기지 않습니다.

### M6.3에서 확인된 동작
- `/review` 첫 로드에서 `daily_plans`에 그날 계획을 고정합니다.
- 홈과 복습 화면에 `복습 · 승급 · 신규 · 예상 N분`이 표시됩니다.
- 복습이 밀리면 신규 단어 수가 자동으로 줄고, 이유를 함께 보여줍니다.
- 복습 블록은 `영→한 50% · 한→영 30% · 빈칸 20%` 비율로 섞입니다.
- 계획 목표를 채우면 `completed_at`이 기록되고, 완료율 계산에 쓰입니다.
- 계획 완료 후 최근 Again 카드를 최대 5장까지 마무리 복습합니다.

### M6.4에서 확인된 동작
- 단어에 카테고리·CEFR 레벨·발음·콜로케이션·유의어·반의어를 저장할 수 있습니다.
- 추가 예문은 `word_examples`에 분리 저장하고, 복습 화면에서 최대 2개까지 보여줍니다.
- CSV 파서는 기존 5컬럼과 확장 16컬럼을 모두 읽습니다. (기본 단어장 임포트에 적용)
- 내보내기는 기본 5컬럼, `?full=1`이면 확장 컬럼을 포함합니다.
- 1,100개 단어의 실제 메타데이터 채우기는 콘텐츠 작업으로 분리합니다.

### M6.5에서 확인된 동작
- 설정에서 듣기 카드를 켜면, 영→한 카드가 14일 이상 안정된 단어에 `listening` 카드가 생깁니다.
- 듣기 카드는 단어를 보여주지 않고 TTS 음성만 재생합니다.
- “다시 듣기”는 제한 없이 가능하고, “들리지 않아요”는 `Again`으로 기록합니다.
- 발음은 미국식/영국식, 속도는 0.7~1.2배로 설정할 수 있습니다.
- TTS가 없는 기기에서는 안내 문구를 보여주고 “들리지 않아요”로 진행합니다.

### M6.6에서 확인된 동작
- 설정 화면에서 리뷰 건수와 1,000건 목표를 확인합니다.
- `/settings/fsrs/export`가 FSRS 최적화용 리뷰 로그를 JSON으로 내려줍니다.
- 외부 옵티마이저에서 계산한 21개 가중치 배열을 설정에 붙여넣어 적용합니다.
- 파라미터는 `users.fsrs_params`에 저장되고, 카드 스케줄과 다음 복습일 미리보기에 즉시 반영됩니다.
- 잘못된 배열은 거부하고 기본값을 유지합니다.
- 리뷰 1,000건 이전에는 기본 파라미터를 쓰는 것을 권장합니다.

> **중복 제출 방지**: 같은 프롬프트의 재전송은 `review_key = card_id:shown_at` 멱등키와
> `reps` 낙관적 락으로 한 번만 기록됩니다. (M6.1)
>
> **알려진 제약**: `answer` 엔드포인트는 카드가 실제로 due 인지 확인하지 않습니다.
> due가 아닌 카드에 대한 새 제출은 저장될 수 있습니다. (브라우저 뒤로가기 정도의 위험)

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
