-- P1.7: 요청 제한
-- key+window_start 단위로 카운트한다. 오래된 window는 다음 요청 때 자연스럽게 교체된다.

CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);

CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);
