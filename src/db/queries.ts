import type { Deck, Stats, WordRow } from '../types';
import type { SeedWord } from '../lib/csv';

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

export async function addWord(
  db: D1Database,
  userId: string,
  deckId: string,
  input: { term: string; meaning: string; pos?: string; example?: string; exampleKo?: string }
): Promise<string> {
  const wordId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.batch([
    db
      .prepare(
        'INSERT INTO words (id, deck_id, term, meaning, pos, example, example_ko, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        wordId,
        deckId,
        input.term,
        input.meaning,
        input.pos || null,
        input.example || null,
        input.exampleKo || null,
        now
      ),
    db
      .prepare(
        `INSERT INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
         VALUES (?, ?, ?, 'recognition', ?, 'new', ?)`
      )
      .bind(crypto.randomUUID(), wordId, userId, now, now),
  ]);

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
  const now = new Date().toISOString();

  const [total, decks, due, learned, hard] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM words w JOIN decks d ON d.id = w.deck_id WHERE d.user_id = ?`
      )
      .bind(userId)
      .first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM decks WHERE user_id = ?').bind(userId).first<{ n: number }>(),
    db
      .prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND suspended = 0 AND due_at <= ?')
      .bind(userId, now)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM cards
          WHERE user_id = ? AND state = 'review' AND scheduled_days >= 21`
      )
      .bind(userId)
      .first<{ n: number }>(),
    db
      .prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND suspended = 1')
      .bind(userId)
      .first<{ n: number }>(),
  ]);

  return {
    total: total?.n ?? 0,
    decks: decks?.n ?? 0,
    due: due?.n ?? 0,
    learned: learned?.n ?? 0,
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
  const seen = new Set<string>();

  for (const w of words) {
    const key = w.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const wordId = crypto.randomUUID();
    wordStmts.push(
      db
        .prepare(
          'INSERT INTO words (id, deck_id, term, meaning, pos, example, example_ko, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(wordId, deckId, w.term, w.meaning, w.pos || null, w.example || null, w.example_ko || null, now)
    );
    cardStmts.push(
      db
        .prepare(
          `INSERT INTO cards (id, word_id, user_id, card_type, due_at, state, created_at)
           VALUES (?, ?, ?, 'recognition', ?, 'new', ?)`
        )
        .bind(crypto.randomUUID(), wordId, userId, now, now)
    );
  }

  for (const chunk of chunked([...wordStmts, ...cardStmts], 50)) {
    await db.batch(chunk);
  }

  return { deckId, count: wordStmts.length };
}
