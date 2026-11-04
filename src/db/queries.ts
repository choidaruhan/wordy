import type { Deck, Stats, WordRow } from '../types';
import type { SeedWord } from '../lib/csv';
import { serializeJsonList } from '../lib/word-meta';
import { learnedCount } from './stats';

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function listDecks(db: D1Database, userId: string): Promise<Deck[]> {
  const { results } = await db
    .prepare(
      `SELECT d.id, d.name, d.created_at, COUNT(w.id) AS word_count
         FROM decks d
         LEFT JOIN words w ON w.deck_id = d.id
        WHERE d.user_id = ?
        GROUP BY d.id
        ORDER BY d.created_at DESC`
    )
    .bind(userId)
    .all<Deck>();
  return results;
}

export async function getDeck(db: D1Database, userId: string, deckId: string) {
  return db
    .prepare('SELECT id, name, created_at FROM decks WHERE id = ? AND user_id = ?')
    .bind(deckId, userId)
    .first<{ id: string; name: string; created_at: string }>();
}

export async function createDeck(
  db: D1Database,
  userId: string,
  name: string
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO decks (id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, userId, name, new Date().toISOString())
    .run();
  return id;
}

export async function deleteDeck(db: D1Database, userId: string, deckId: string) {
  await db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?').bind(deckId, userId).run();
}

export async function listWords(db: D1Database, deckId: string): Promise<WordRow[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.term, w.meaning, w.pos, w.example, w.example_ko,
              w.category, w.level, w.pronunciation, w.audio_url,
              w.collocations, w.synonyms, w.antonyms,
              (
                SELECT GROUP_CONCAT(line, char(10))
                  FROM (
                    SELECT e.sentence || char(9) || COALESCE(e.translation, '') AS line
                      FROM word_examples e
                     WHERE e.word_id = w.id
                     ORDER BY e.created_at
                  )
              ) AS extra_examples_raw,
              c.due_at, c.state
         FROM words w
         LEFT JOIN cards c ON c.word_id = w.id AND c.card_type = 'recognition'
        WHERE w.deck_id = ?
        ORDER BY w.created_at ASC`
    )
    .bind(deckId)
    .all<WordRow>();
  return results;
}

export type WordInput = {
  term: string;
  meaning: string;
  pos?: string;
  example?: string;
  exampleKo?: string;
  category?: string;
  level?: string;
  pronunciation?: string;
  audioUrl?: string;
  collocations?: string[];
  synonyms?: string[];
  antonyms?: string[];
  extraExamples?: { sentence: string; translation?: string | null }[];
};

export async function addWord(
  db: D1Database,
  userId: string,
  deckId: string,
  input: WordInput
): Promise<string> {
  const wordId = crypto.randomUUID();
  const now = new Date().toISOString();

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO words (
           id, deck_id, term, meaning, pos, example, example_ko,
           category, level, pronunciation, audio_url,
           collocations, synonyms, antonyms, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        wordId,
        deckId,
        input.term,
        input.meaning,
        input.pos || null,
        input.example || null,
        input.exampleKo || null,
        input.category || null,
        input.level || null,
        input.pronunciation || null,
        input.audioUrl || null,
        serializeJsonList(input.collocations),
        serializeJsonList(input.synonyms),
        serializeJsonList(input.antonyms),
        now
      ),
    db
      .prepare(
        `INSERT INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
         VALUES (?, ?, ?, 'recognition', ?, 'new', ?)`
      )
      .bind(crypto.randomUUID(), wordId, userId, now, now),
  ];

  for (const example of input.extraExamples ?? []) {
    const sentence = example.sentence.trim();
    if (!sentence) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO word_examples (id, word_id, sentence, translation, is_primary, created_at)
           VALUES (?, ?, ?, ?, 0, ?)`
        )
        .bind(
          crypto.randomUUID(),
          wordId,
          sentence,
          example.translation?.trim() || null,
          now
        )
    );
  }

  await db.batch(stmts);

  return wordId;
}

export async function deleteWord(db: D1Database, userId: string, wordId: string) {
  await db
    .prepare(
      `DELETE FROM words
        WHERE id = ?
          AND deck_id IN (SELECT id FROM decks WHERE user_id = ?)`
    )
    .bind(wordId, userId)
    .run();
}

export async function getStats(db: D1Database, userId: string): Promise<Stats> {
  const [total, decks, learned, hard] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM words w JOIN decks d ON d.id = w.deck_id WHERE d.user_id = ?`
      )
      .bind(userId)
      .first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM decks WHERE user_id = ?').bind(userId).first<{ n: number }>(),
    learnedCount(db, userId),
    db
      .prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND suspended = 1')
      .bind(userId)
      .first<{ n: number }>(),
  ]);

  return {
    total: total?.n ?? 0,
    decks: decks?.n ?? 0,
    learned,
    hard: hard?.n ?? 0,
  };
}

export async function importSeed(
  db: D1Database,
  userId: string,
  deckName: string,
  words: SeedWord[]
): Promise<{ deckId: string; count: number }> {
  const deckId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare('INSERT INTO decks (id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(deckId, userId, deckName, now)
    .run();

  const wordStmts: D1PreparedStatement[] = [];
  const cardStmts: D1PreparedStatement[] = [];
  const exampleStmts: D1PreparedStatement[] = [];
  const seen = new Set<string>();

  for (const w of words) {
    const key = w.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const wordId = crypto.randomUUID();

    wordStmts.push(
      db
        .prepare(
          `INSERT INTO words (
             id, deck_id, term, meaning, pos, example, example_ko,
             category, level, pronunciation, audio_url,
             collocations, synonyms, antonyms, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          wordId,
          deckId,
          w.term,
          w.meaning,
          w.pos || null,
          w.example || null,
          w.example_ko || null,
          w.category || null,
          w.level || null,
          w.pronunciation || null,
          w.audio_url || null,
          serializeJsonList(w.collocations),
          serializeJsonList(w.synonyms),
          serializeJsonList(w.antonyms),
          now
        )
    );

    cardStmts.push(
      db
        .prepare(
          `INSERT INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
           VALUES (?, ?, ?, 'recognition', ?, 'new', ?)`
        )
        .bind(crypto.randomUUID(), wordId, userId, now, now)
    );

    for (const example of w.extraExamples) {
      const sentence = example.sentence.trim();
      if (!sentence) continue;
      exampleStmts.push(
        db
          .prepare(
            `INSERT INTO word_examples (id, word_id, sentence, translation, is_primary, created_at)
             VALUES (?, ?, ?, ?, 0, ?)`
          )
          .bind(
            crypto.randomUUID(),
            wordId,
            sentence,
            example.translation.trim() || null,
            now
          )
      );
    }
  }

  for (const chunk of chunked([...wordStmts, ...cardStmts, ...exampleStmts], 50)) {
    await db.batch(chunk);
  }

  return { deckId, count: wordStmts.length };
}
