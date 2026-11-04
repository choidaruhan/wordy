import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { parseFsrsParams } from './srs';

const COOKIE = 'sid';
const SESSION_DAYS = 30;

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

const USER_COLS =
  'id, email, display_name, tz_offset_min, daily_new, daily_review, new_card_mode, listening_enabled, voice_locale, voice_rate, fsrs_params';

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
    tz_offset_min: row.tz_offset_min,
    daily_new: row.daily_new,
    daily_review: row.daily_review,
    new_card_mode: row.new_card_mode === 'fixed' ? 'fixed' : 'auto',
    listening_enabled: Boolean(row.listening_enabled),
    voice_locale: row.voice_locale === 'en-GB' ? 'en-GB' : 'en-US',
    voice_rate: Number(row.voice_rate) || 0.9,
    fsrs_params: parseFsrsParams(row.fsrs_params),
  };
}

export async function findOrCreateUser(
  c: Context<Env>,
  email: string,
  displayName: string | null
): Promise<User> {
  const existing = await c.env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE email = ?`)
    .bind(email)
    .first<User>();

  if (existing) {
    return {
      ...existing,
      new_card_mode: existing.new_card_mode === 'fixed' ? 'fixed' : 'auto',
      listening_enabled: Boolean(existing.listening_enabled),
      voice_locale: existing.voice_locale === 'en-GB' ? 'en-GB' : 'en-US',
      voice_rate: Number(existing.voice_rate) || 0.9,
      fsrs_params: parseFsrsParams(existing.fsrs_params),
    };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare('INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, email, displayName, now)
    .run();

  return {
    id,
    email,
    display_name: displayName,
    tz_offset_min: 540,
    daily_new: 10,
    daily_review: 200,
    new_card_mode: 'auto',
    listening_enabled: false,
    voice_locale: 'en-US',
    voice_rate: 0.9,
    fsrs_params: null,
  };
}

export async function requireUser(c: Context<Env>): Promise<User> {
  const user = c.get('user');
  if (!user) throw new Error('UNAUTHORIZED');
  return user;
}
