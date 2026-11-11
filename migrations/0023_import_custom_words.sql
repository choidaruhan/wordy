-- 기존 앱에서 사용자가 직접 등록한 단어만 새 단어장으로 옮긴다.
-- 기본 단어장(기본 단어 1,000 / 기능어 100)은 제외한다.
INSERT INTO vocab (id, user_id, term, meaning, created_at)
SELECT
  lower(hex(randomblob(16))),
  d.user_id,
  trim(w.term),
  trim(w.meaning),
  w.created_at
FROM words w
JOIN decks d ON d.id = w.deck_id
WHERE d.name NOT IN ('기본 단어 1,000', '기능어 100')
  AND trim(w.term) != ''
  AND trim(w.meaning) != ''
  AND NOT EXISTS (
    SELECT 1
      FROM vocab v
     WHERE v.user_id = d.user_id
       AND lower(v.term) = lower(trim(w.term))
  );
