-- M8.1: 플레이 세션 상태와 정책 스냅샷
-- 기존 completed_at 만으로는 active/completed/abandoned/expired 를 구분할 수 없다.

ALTER TABLE play_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE play_sessions ADD COLUMN review_target INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_sessions ADD COLUMN new_target INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_sessions ADD COLUMN weak_target INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_sessions ADD COLUMN policy TEXT NOT NULL DEFAULT 'session';
ALTER TABLE play_sessions ADD COLUMN policy_reason TEXT;
ALTER TABLE play_sessions ADD COLUMN last_activity_at TEXT;
ALTER TABLE play_sessions ADD COLUMN expires_at TEXT;

UPDATE play_sessions
   SET status = CASE WHEN completed_at IS NOT NULL THEN 'completed' ELSE 'active' END;

UPDATE play_sessions
   SET last_activity_at = COALESCE(completed_at, started_at);

-- SQLite date 함수는 ISO-8601 입력을 처리한다. 24시간 뒤를 Z 표기로 저장한다.
UPDATE play_sessions
   SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', started_at, '+24 hours');

UPDATE play_sessions
   SET review_target = target_size
 WHERE mode IN ('quick', 'typing', 'cloze', 'listening')
   AND review_target = 0 AND new_target = 0 AND weak_target = 0;

-- 기존 취약/커스텀 세션은 해당 버킷으로 백필한다.
UPDATE play_sessions
   SET weak_target = target_size, review_target = 0
 WHERE mode = 'weak' AND weak_target = 0;

UPDATE play_sessions
   SET new_target = target_size, review_target = 0
 WHERE mode = 'custom' AND new_target = 0;

-- 기존 세션 카운터를 리뷰 로그 기준으로 재계산한다.
-- M8부터는 answered/correct 를 읽기 시점에 play_session_stats 로 계산하지만,
-- 마이그레이션 기간 동안 저장 컬럼과 파생 값이 어긋나지 않게 맞춘다.
UPDATE play_sessions
   SET answered = (
         SELECT COUNT(*) FROM reviews r WHERE r.session_id = play_sessions.id
       ),
       correct = (
         SELECT COALESCE(SUM(r.is_correct), 0)
           FROM reviews r WHERE r.session_id = play_sessions.id
       );

CREATE INDEX idx_play_sessions_status
  ON play_sessions(user_id, status, started_at);
