export type QuizSession = {
  id: string;
  total: number;
  correct: number;
  created_at: string;
  completed_at: string | null;
};

export type QuizQuestion = {
  id: string;
  session_id: string;
  word_id: string;
  position: number;
  options: string[];
  answer_index: number;
  chosen_index: number | null;
  is_correct: number | null;
  term: string;
  meaning: string;
};

export type WrongAnswer = {
  term: string;
  meaning: string;
  chosen: string;
};

type RawQuestion = Omit<QuizQuestion, 'options'> & { options: string };

function parseQuestion(row: RawQuestion): QuizQuestion {
  return { ...row, options: JSON.parse(row.options) as string[] };
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 새 퀴즈를 만든다. 단어가 4개 미만이면 null.
 * 진행 중이던 세션은 버린다.
 */
export async function createQuiz(
  db: D1Database,
  userId: string,
  count: number
): Promise<string | null> {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.term, w.meaning
         FROM words w
         JOIN decks d ON d.id = w.deck_id
        WHERE d.user_id = ? AND w.meaning IS NOT NULL AND w.meaning <> ''`
    )
    .bind(userId)
    .all<{ id: string; term: string; meaning: string }>();

  const distinctMeanings = new Set(results.map((r) => r.meaning));
  if (distinctMeanings.size < 4) return null;

  await db
    .prepare('DELETE FROM quiz_sessions WHERE user_id = ? AND completed_at IS NULL')
    .bind(userId)
    .run();

  const shuffled = shuffle(results);
  const picked = shuffled.slice(0, Math.min(count, shuffled.length));

  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();

  const stmts: D1PreparedStatement[] = [
    db
      .prepare('INSERT INTO quiz_sessions (id, user_id, total, created_at) VALUES (?, ?, ?, ?)')
      .bind(sessionId, userId, picked.length, now),
  ];

  picked.forEach((word, position) => {
    const options = [word.meaning];
    const used = new Set(options);
    let guard = 0;

    while (options.length < 4 && guard++ < 300) {
      const candidate = shuffled[Math.floor(Math.random() * shuffled.length)].meaning;
      if (!used.has(candidate)) {
        used.add(candidate);
        options.push(candidate);
      }
    }

    const mixed = shuffle(options);

    stmts.push(
      db
        .prepare(
          `INSERT INTO quiz_questions
             (id, session_id, word_id, position, options, answer_index)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          sessionId,
          word.id,
          position,
          JSON.stringify(mixed),
          mixed.indexOf(word.meaning)
        )
    );
  });

  await db.batch(stmts);
  return sessionId;
}

export async function getActiveSession(
  db: D1Database,
  userId: string
): Promise<QuizSession | null> {
  return db
    .prepare(
      `SELECT id, total, correct, created_at, completed_at
         FROM quiz_sessions
        WHERE user_id = ? AND completed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .bind(userId)
    .first<QuizSession>();
}

export async function getNextQuestion(
  db: D1Database,
  sessionId: string
): Promise<QuizQuestion | null> {
  const row = await db
    .prepare(
      `SELECT q.id, q.session_id, q.word_id, q.position, q.options, q.answer_index,
              q.chosen_index, q.is_correct, w.term, w.meaning
         FROM quiz_questions q
         JOIN words w ON w.id = q.word_id
        WHERE q.session_id = ? AND q.chosen_index IS NULL
        ORDER BY q.position
        LIMIT 1`
    )
    .bind(sessionId)
    .first<RawQuestion>();

  return row ? parseQuestion(row) : null;
}

export async function answerQuestion(
  db: D1Database,
  userId: string,
  questionId: string,
  choice: number
): Promise<{ correct: boolean; question: QuizQuestion } | null> {
  const row = await db
    .prepare(
      `SELECT q.id, q.session_id, q.word_id, q.position, q.options, q.answer_index,
              q.chosen_index, q.is_correct, w.term, w.meaning
         FROM quiz_questions q
         JOIN words w ON w.id = q.word_id
         JOIN quiz_sessions s ON s.id = q.session_id
        WHERE q.id = ? AND s.user_id = ?`
    )
    .bind(questionId, userId)
    .first<RawQuestion>();

  if (!row) return null;

  const question = parseQuestion(row);
  if (question.chosen_index !== null) return null;
  if (choice < 0 || choice >= question.options.length) return null;

  const correct = choice === question.answer_index;
  const now = new Date().toISOString();

  const res = await db
    .prepare(
      `UPDATE quiz_questions
          SET chosen_index = ?, is_correct = ?, answered_at = ?
        WHERE id = ? AND chosen_index IS NULL`
    )
    .bind(choice, correct ? 1 : 0, now, question.id)
    .run();

  if ((res.meta.changes ?? 0) === 0) return null;

  await db
    .prepare('UPDATE quiz_sessions SET correct = correct + ? WHERE id = ?')
    .bind(correct ? 1 : 0, question.session_id)
    .run();

  const left = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM quiz_questions WHERE session_id = ? AND chosen_index IS NULL'
    )
    .bind(question.session_id)
    .first<{ n: number }>();

  if ((left?.n ?? 0) === 0) {
    await db
      .prepare('UPDATE quiz_sessions SET completed_at = ? WHERE id = ?')
      .bind(now, question.session_id)
      .run();
  }

  return {
    correct,
    question: { ...question, chosen_index: choice, is_correct: correct ? 1 : 0 },
  };
}

export type QuizResult = {
  total: number;
  correct: number;
  wrong: WrongAnswer[];
};

export async function getResult(db: D1Database, sessionId: string): Promise<QuizResult> {
  const session = await db
    .prepare('SELECT total, correct FROM quiz_sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ total: number; correct: number }>();

  const { results } = await db
    .prepare(
      `SELECT q.options, q.chosen_index, w.term, w.meaning
         FROM quiz_questions q
         JOIN words w ON w.id = q.word_id
        WHERE q.session_id = ? AND q.is_correct = 0
        ORDER BY q.position`
    )
    .bind(sessionId)
    .all<{ options: string; chosen_index: number | null; term: string; meaning: string }>();

  const wrong: WrongAnswer[] = results.map((r) => {
    const options = JSON.parse(r.options) as string[];
    return {
      term: r.term,
      meaning: r.meaning,
      chosen: r.chosen_index !== null ? (options[r.chosen_index] ?? '') : '',
    };
  });

  return {
    total: session?.total ?? 0,
    correct: session?.correct ?? 0,
    wrong,
  };
}

export async function getSession(
  db: D1Database,
  userId: string,
  sessionId: string
): Promise<QuizSession | null> {
  return db
    .prepare(
      `SELECT id, total, correct, created_at, completed_at
         FROM quiz_sessions
        WHERE id = ? AND user_id = ?`
    )
    .bind(sessionId, userId)
    .first<QuizSession>();
}

export async function countAnswered(db: D1Database, sessionId: string): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM quiz_questions WHERE session_id = ? AND chosen_index IS NOT NULL'
    )
    .bind(sessionId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
