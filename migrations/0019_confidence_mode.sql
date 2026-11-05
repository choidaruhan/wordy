-- P1.6: 선택적 확신도 질문
-- off    = 묻지 않음
-- sample = 5문제마다 1번
-- always = 매 문제

ALTER TABLE users ADD COLUMN confidence_mode TEXT NOT NULL DEFAULT 'sample';
