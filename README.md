# Wordy

영어 단어를 직접 등록하고, **무한 4지선다**로 계속 풀어보는 단어 암기 앱입니다.

- 기본 단어장 없음. 내가 넣은 단어만 나옵니다.
- 복습 스케줄·통계·모드 선택 없음. 맞히면 다음, 틀리면 정답을 보여주고 다음.
- 화면은 두 개입니다: **퀴즈**와 **단어**.

**배포:** https://wordy.choidaruhan.workers.dev

---

## 화면

| 경로 | 역할 |
|---|---|
| `/` | 무작위 단어 4지선다. 정답/오답 피드백 후 다음 문제 |
| `/words` | 단어 등록·수정·삭제. 입력은 `영어 단어` + `뜻` 두 칸 |
| `/login` | Google 로그인 (로컬은 `DEV_LOGIN=true`) |

같은 단어를 다시 등록하면 새로 쌓지 않고 뜻만 갱신합니다.

---

## 스택

| 영역 | 선택 |
|---|---|
| 런타임 | Cloudflare Workers |
| 프레임워크 | Hono v4 + `hono/jsx` |
| 인터랙션 | HTMX 2.x |
| 스타일 | Tailwind CSS v4 |
| DB | Cloudflare D1 (SQLite) |

클라이언트 번들러도, React도, 복습 알고리즘도 없습니다.

---

## 데이터

새 단어는 `vocab` 테이블 하나에 저장합니다.

```sql
CREATE TABLE vocab (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  term TEXT NOT NULL,
  meaning TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_vocab_user_term ON vocab(user_id, lower(term));
```

마이그레이션 이력(`migrations/0001~0021`)은 기존 배포 DB를 위해 남아 있습니다.
현재 앱은 그 테이블들을 읽거나 쓰지 않습니다.

---

## 개발

```bash
npm install
npm run db:local     # 로컬 D1에 마이그레이션 적용
npm run dev          # CSS 빌드 후 wrangler dev
```

검증:

```bash
npm run verify       # typecheck + test + migrations
npm run build        # htmx 복사 + CSS 빌드
```

배포:

```bash
npm run deploy       # predeploy에서 verify + build
```

배포 인증은 OAuth 로그인 대신 API 토큰을 쓸 수 있습니다.

1. Cloudflare 대시보드 → My Profile → API Tokens → Create Token
2. 권한: Account · **Workers Scripts:Edit**, **D1:Edit**, **Account Settings:Read**
3. `.env.example`을 `.env`로 복사하고 `CLOUDFLARE_API_TOKEN`에 값을 넣습니다.

```bash
cp .env.example .env
```

`.env`는 `.gitignore`에 포함되어 있고, wrangler가 자동으로 읽습니다.
이후에는 `npx wrangler login` 없이 `npm run deploy`가 동작합니다.

---

## 참고

`docs/`는 이전 FSRS 기반 학습 시스템을 설계한 기록입니다.
현재 앱의 동작과는 다릅니다. 지금 구조는 이 README와 `src/`만 보면 됩니다.
