-- P1.4: IANA 시간대
-- 기존 오프셋은 fallback으로 유지하고, 식별 가능한 사용자만 IANA로 백필한다.
-- DST가 있는 지역은 오프셋만으로 정확히 계산할 수 없다.

ALTER TABLE users ADD COLUMN timezone TEXT;

UPDATE users SET timezone = 'Asia/Seoul' WHERE tz_offset_min = 540;
UPDATE users SET timezone = 'UTC'        WHERE tz_offset_min = 0;
