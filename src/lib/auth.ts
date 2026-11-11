import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Env, User } from '../types';

const COOKIE = 'sid';
const SESSION_DAYS = 30;
const USER_COLS = 'id, email, display_name';

export function isSecureRequest(c: Context<Env>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSession(c: Context<Env>, userId: string): Promise<void> {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);

  await c.env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(hash, userId, expires.toISOString(), now.toISOString())
    .run();

  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function destroySession(c: Context<Env>): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) {
    const hash = await sha256Hex(token);
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
  }
  deleteCookie(c, COOKIE, { path: '/' });
}

export async function getSessionUser(c: Context<Env>): Promise<User | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;

  const hash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT u.${USER_COLS.replace(/, /g, ', u.')}, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  )
    .bind(hash)
    .first<User & { expires_at: string }>();

  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
  };
}

export async function findOrCreateUser(
  c: Context<Env>,
  email: string,
  displayName: string | null
): Promise<User> {
  const existing = await c.env.DB.prepare(
    `SELECT ${USER_COLS} FROM users WHERE email = ?`
  )
    .bind(email)
    .first<User>();

  if (existing) return existing;

  const user: User = {
    id: crypto.randomUUID(),
    email,
    display_name: displayName,
  };

  await c.env.DB.prepare(
    'INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(user.id, user.email, user.display_name, new Date().toISOString())
    .run();

  return user;
}

export async function requireUser(c: Context<Env>): Promise<User> {
  const user = c.get('user');
  if (!user) throw new Error('UNAUTHORIZED');
  return user;
}
