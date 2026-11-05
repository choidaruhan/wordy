-- M7.2: 플레이 점수/콤보 제거

ALTER TABLE play_sessions DROP COLUMN combo;
ALTER TABLE play_sessions DROP COLUMN best_combo;
ALTER TABLE play_sessions DROP COLUMN score;
