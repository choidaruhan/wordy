-- M8.1: 학습 방식 선택
-- session = 한 판 단위, daily = 하루 목표 단위
-- 기존 /review 사용자는 최근 30일 daily_plans 이력으로 daily 로 백필한다.

ALTER TABLE users ADD COLUMN learning_mode TEXT NOT NULL DEFAULT 'session';
ALTER TABLE users ADD COLUMN last_unlock_check_at TEXT;

UPDATE users
   SET learning_mode = 'daily'
 WHERE id IN (
   SELECT DISTINCT user_id
     FROM daily_plans
    WHERE local_date >= date('now', '-30 day')
 );
