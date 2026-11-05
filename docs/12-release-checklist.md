# 12. 배포 전 최종 QA·릴리스 체크리스트

> 대상: Cloudflare Workers + D1 (`wordy-db`)
> 원칙: **백업 → 마이그레이션 → 배포 → 스모크 테스트 → 무결성 점검** 순서를 지킨다.

---

## 1. 사전 검증

```bash
npm run verify
```

`verify`가 실행하는 것:

- `npm run typecheck`
- `npm test`
- `npm run check:migrations` (0001부터 빠짐없이 이어지는지)
- `npm run check:seed` (기본 단어 1,000 + 기능어 100)

추가 수동 확인:

```bash
npm run check:integrity
```

- 로컬 D1 또는 현재 운영 DB 사본에서 오류 0건인지 확인한다.
- `unlock_candidates`는 info이므로 실패로 보지 않는다.

---

## 2. 백업

```bash
# 원격 백업
npm run db:backup

# 백업이 실제로 복원되는지 리허설
npm run db:restore:drill -- --file backups/wordy-remote-....sql
```

체크:

- [ ] 백업 파일 생성
- [ ] `PRAGMA integrity_check: ok`
- [ ] `db:restore:drill` 성공
- [ ] 백업 파일을 저장소 밖 암호화된 위치에 보관

> `backups/`는 `.gitignore`에 포함되어 있다. 절대 커밋하지 않는다.

---

## 3. 마이그레이션 순서

현재 마이그레이션:

| 구간 | 성격 |
|---|---|
| `0001~0012` | 초기 스키마, 퀴즈, 리뷰 계측, 플레이 세션 |
| `0013~0015` | `learning_mode`, 세션 상태, `play_session_items` (additive) |
| `0016` | **트리거 + `play_session_stats` 뷰** |
| `0017~0021` | 평점 신호, 시간대, confidence, rate limit, mastery (additive) |

### 3.1 주의: 0016이 호환 경계

- 0016 트리거는 `play_session_items`가 없는 구버전 앱의 리뷰 INSERT를 차단한다.
- 현재 앱은 `play_session_stats` 뷰를 사용하므로 0016이 먼저 적용되어야 한다.
- 따라서 0013~0021을 한 번에 적용하고 **곧바로 새 앱을 배포**하는 짧은 점검 창이 필요하다.

개인 프로젝트 권장 순서:

```bash
npm run db:backup
npm run db:remote
npm run deploy
```

운영 중 답안 제출이 실패하지 않게 하려면:

1. 구버전 호환 앱(item 생성 + view 미사용)을 먼저 배포
2. `0016` 적용
3. 최종 앱 배포

> 현재 코드는 1번 호환 빌드를 별도로 제공하지 않는다. 트래픽이 적은 시간에
> 짧은 점검 창을 두고 `db:remote` → `deploy`를 연속 실행한다.

### 3.2 신규 설치

```bash
npx wrangler d1 create wordy-db
# wrangler.jsonc 에 database_id 입력
npm run db:remote
npm run deploy
```

---

## 4. 배포

```bash
npm run deploy
```

`npm run deploy`는 자동으로 `predeploy`를 실행한다.

- `predeploy` = `verify` + `build`
- `deploy` = `wrangler deploy`

직접 `wrangler deploy`를 실행하지 않는다. CSS/htmx 빌드가 빠질 수 있다.

---

## 5. 배포 후 스모크 테스트

### 5.1 기본

- [ ] 로그인 (Google / DEV_LOGIN)
- [ ] 홈 로드
- [ ] `/play`에서 `바로 시작`
- [ ] 정답/오답 제출
- [ ] 결과 화면
- [ ] `/stats` 로드

### 5.2 학습 흐름

- [ ] `quick` / `typing` / `cloze` / `listening` / `weak` 모드
- [ ] `custom` (단어장 → 이 단어장의 새 단어로 한 판)
- [ ] 오답 2개 → 오답 마무리 → 결과 `오답 다시 보기 N / M`
- [ ] 새로고침 시 같은 문제 유지
- [ ] 같은 문제 두 탭 제출 → 1회만 저장
- [ ] 세션 이어하기/그만두기
- [ ] confidence `가끔 (1/5)` 프롬프트
- [ ] `/review` 접근 시 `/play`로 이동

### 5.3 데이터

- [ ] `/decks` 단어 추가/삭제
- [ ] 기본 단어장 임포트
- [ ] CSV 내보내기 (기본/전체)
- [ ] `/hard` 취약/관찰/격리
- [ ] `/quiz` 10/20문제
- [ ] FSRS 파라미터 export

### 5.4 운영·보안

- [ ] `Content-Security-Policy`, `X-Frame-Options` 헤더
- [ ] cross-site POST 403
- [ ] `/auth/dev` 반복 요청 429 (개발 환경만)
- [ ] `npm run check:integrity` 오류 0
- [ ] `npm run analyze:ratings` 실행

### 5.5 PWA

- [ ] 설치 프롬프트
- [ ] 오프라인 앱 셸
- [ ] 새 정적 자산 캐시 버전 갱신 여부

---

## 6. 롤백

### 6.1 앱 롤백

```bash
npx wrangler rollback
```

또는 Cloudflare 대시보드에서 이전 배포 버전 선택.

### 6.2 0016 트리거 롤백

구버전 앱으로 되돌릴 때 item을 만들지 않는 앱은 트리거 때문에 답안 저장이 실패한다.
긴급 시 트리거만 제거한다.

```sql
DROP TRIGGER IF EXISTS trg_reviews_require_play_item;
DROP TRIGGER IF EXISTS trg_reviews_mark_play_item;
DROP TRIGGER IF EXISTS trg_reviews_touch_play_session;
```

- `play_session_items` 테이블과 `play_session_stats` 뷰는 남겨도 된다.
- 컬럼/테이블은 삭제하지 않는다. 데이터 보존이 우선이다.

### 6.3 데이터 롤백

- 마이그레이션은 additive이므로 앱 롤백만으로 대부분 복구된다.
- 데이터가 손상됐다면 `docs/11-backup-restore.md`의 새 DB 복원 절차를 따른다.
- 기존 DB를 직접 덮어쓰지 않는다.

---

## 7. 배포 후 관찰

배포 직후 30분:

- Workers 오류 로그
- D1 실패 로그
- `rate limit failed` 로그
- `ensureUnlocks failed` 로그
- `play post-review task failed` 로그
- `/play` 이탈률
- 답안 저장 409/429 비율

24시간:

- 세션 완료율
- `check:integrity` 오류 0
- 오답 마무리 사용률
- 오늘 목표/세션 모드 분포

---

## 8. 최종 릴리스 체크

- [ ] `npm run verify` 통과
- [ ] `npm run check:integrity` 오류 0
- [ ] `npm run db:backup` 성공
- [ ] `npm run db:restore:drill` 성공
- [ ] `npm run db:remote` 성공
- [ ] `npm run deploy` 성공
- [ ] 배포 후 스모크 테스트 통과
- [ ] 롤백 경로 확인
- [ ] 백업 보관 위치 확인

> 배포는 **한 번에 하나씩**. 마이그레이션과 앱 배포 사이에 다른 변경을 끼워 넣지 않는다.
