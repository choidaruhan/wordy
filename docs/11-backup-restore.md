# 11. D1 백업·복구 절차

> 대상: `wordy-db` (Cloudflare D1)
> 목표: 개인 학습 기록을 잃지 않고, 백업이 실제로 복원 가능한지 주기적으로 검증한다.

---

## 1. 원칙

1. **백업은 복원 리허설까지 통과해야 백업이다.**
2. 백업 파일은 개인정보를 포함하므로 저장소에 커밋하지 않는다. (`backups/`는 `.gitignore`)
3. 원격 백업은 암호화된 저장소에 보관한다.
4. 복원은 **기존 DB를 덮어쓰지 않고 새 DB에 복원**하는 것을 기본으로 한다.
5. 복원 후에는 `npm run check:integrity`와 앱 smoke test를 실행한다.

---

## 2. 백업

### 2.1 명령

```bash
# 원격 wordy-db
npm run db:backup

# 로컬 D1
npm run db:backup:local

# 저장 위치 지정
npm run db:backup -- --out-dir /secure/wordy-backups

# DB 이름 지정
npm run db:backup -- --database wordy-db
```

결과:

```text
backups/wordy-remote-2026-11-05_12-25-06.sql
```

`wrangler d1 export`가 스키마와 데이터를 모두 포함해 내보낸다.

### 2.2 보관 정책

권장:

| 주기 | 보관 |
|---|---|
| 매일 | 7개 |
| 매주 | 4개 |
| 매월 | 12개 |

- 원격 저장소는 암호화한다.
- 파일명에 날짜와 모드(local/remote)를 남긴다.
- 백업 파일에는 `users`, `reviews`, `words` 등 개인 데이터가 포함된다.

### 2.3 D1 Time Travel

Cloudflare D1은 플랜/설정에 따라 Time Travel로 최근 시점 복구를 제공한다.
가능하면 대시보드에서 복구 가능 범위를 확인하고, **정기 export 백업과 함께** 사용한다.
Time Travel만 있으면 장기 보관·외부 보관 요구를 충족하지 못할 수 있다.

---

## 3. 복구 리허설

실제 DB를 건드리지 않고 백업을 임시 SQLite에 복원해 검증한다.

```bash
# 로컬 DB를 새로 export해서 리허설
npm run db:restore:drill

# 원격 DB를 export해서 리허설
npm run db:restore:drill:remote

# 이미 받은 백업 파일로 리허설
npm run db:restore:drill -- --file backups/wordy-local-2026-11-05_12-25-06.sql
```

검사 항목:

- `PRAGMA integrity_check`
- 주요 테이블 row count
- 사용자별 앱 무결성 점검
  - 카드/최신 리뷰 불일치
  - 세션 문항/리뷰 불일치
  - 고아 데이터
  - 승급 후보(info)

성공 예:

```text
PRAGMA integrity_check: ok
users=3 · decks=7 · words=3002 · cards=3022 · reviews=93
play_sessions=23 · play_session_items=66 · daily_plans=3 · quiz_sessions=5

앱 무결성 점검:
  OK  user@example.com
복구 리허설 성공
```

실패하면 해당 백업은 사용하지 말고 이전 백업으로 되돌아간다.

---

## 4. 원격 복구 절차

> 기존 `wordy-db`를 직접 덮어쓰지 않는다.

1. **현재 DB를 먼저 백업한다.**
   ```bash
   npm run db:backup
   ```

2. **새 D1 데이터베이스를 만든다.**
   ```bash
   npx wrangler d1 create wordy-db-restore
   ```
   출력된 `database_id`를 기록한다.

3. **백업 SQL을 새 DB에 적용한다.**
   ```bash
   npx wrangler d1 execute wordy-db-restore \
     --remote \
     --file=backups/wordy-remote-2026-11-05_12-25-06.sql
   ```

4. **새 DB로 리허설한다.**
   ```bash
   npx wrangler d1 export wordy-db-restore --remote \
     --output=backups/restore-check.sql -y
   npm run db:restore:drill -- --file backups/restore-check.sql
   ```

5. **`wrangler.jsonc`의 D1 `database_id`를 새 DB로 바꾼다.**
   - 바인딩 이름은 `DB`로 유지한다.

6. **배포한다.**
   ```bash
   npm run deploy
   ```

7. **배포 후 확인한다.**
   ```bash
   npm run check:integrity
   ```
   - 로그인
   - `/play`에서 한 판 시작/답안 저장
   - `/stats`에서 기존 기록 확인

8. 문제가 있으면 `wrangler.jsonc`의 `database_id`를 원래 DB로 되돌리고 재배포한다.

---

## 5. 로컬 복구 절차

> `wrangler dev`가 실행 중이면 먼저 종료한다.

1. 현재 로컬 상태를 백업/이동한다.
   ```bash
   mv .wrangler/state/v3/d1 .wrangler/state/v3/d1.backup-$(date +%Y%m%d-%H%M%S)
   ```

2. 백업 SQL을 로컬 D1에 적용한다.
   ```bash
   npx wrangler d1 execute wordy-db --local \
     --file=backups/wordy-local-2026-11-05_12-25-06.sql
   ```

3. 서버를 띄운다.
   ```bash
   npm run dev
   ```

4. 확인한다.
   ```bash
   npm run check:integrity
   ```

> 백업 SQL은 스키마를 포함한다. 기존 로컬 DB에 그대로 적용하면 테이블 중복 오류가 날 수 있으므로
> 반드시 새 로컬 상태(또는 새 persist 디렉터리)에서 적용한다.

---

## 6. 복구 후 체크리스트

- [ ] `npm run db:restore:drill -- --file <backup>` 성공
- [ ] `npm run check:integrity` 성공
- [ ] 로그인 성공
- [ ] `/play`에서 답안 저장 성공
- [ ] `/stats`의 리뷰·외운 단어 수가 기대와 일치
- [ ] `/hard`의 취약/격리 목록 정상
- [ ] `/settings/fsrs/export`가 정상 JSON 반환
- [ ] PWA 앱 셸 로드

---

## 7. 장애 대응 요약

| 상황 | 대응 |
|---|---|
| 잘못된 마이그레이션 | 배포 중단 → 이전 백업으로 새 DB 복원 |
| 데이터 일부 손상 | `check:integrity`로 범위 확인 → 최근 백업과 비교 |
| D1 장애 | Cloudflare 상태 확인 → Time Travel/백업 복원 |
| 실수로 단어장 삭제 | 최근 백업에서 해당 테이블만 추출해 복원 검토 |
| 랜섬/계정 탈취 | 백업 저장소 접근 차단, 자격 증명 교체, 새 DB로 복원 |

---

## 8. 자동화 권장

- 매일 원격 백업: GitHub Actions / cron + `npm run db:backup`
- 백업 후 `db:restore:drill` 자동 실행
- 실패 시 알림
- 30일 이상 된 로컬 `backups/` 정리 (원격 보관은 별도 정책)

> 자동화가 없어도 **월 1회 수동 백업 + 복구 리허설**을 권장한다.
