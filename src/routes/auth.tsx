import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../types';
import {
  createSession,
  destroySession,
  findOrCreateUser,
  isSecureRequest,
} from '../lib/auth';
import { Layout } from '../components/layout';

const auth = new Hono<Env>();

auth.get('/login', (c) => {
  if (c.get('user')) return c.redirect('/');

  const devLogin = c.env.DEV_LOGIN === 'true';
  const googleReady = Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET);

  return c.html(
    <Layout title="로그인" user={null}>
      <h1 class="text-2xl font-semibold">로그인</h1>
      <p class="mt-2 text-sm leading-6 text-muted">
        계정은 학습 기록을 기기 간에 이어가기 위해서만 씁니다. 광고나 메일은 보내지 않습니다.
      </p>

      <div class="mt-8 space-y-3">
        {googleReady ? (
          <a
            href="/auth/google"
            class="flex w-full items-center justify-center rounded border border-line bg-surface px-4 py-3 text-sm font-medium hover:border-accent"
          >
            Google로 계속하기
          </a>
        ) : null}

        {devLogin ? (
          <form method="post" action="/auth/dev">
            <button
              type="submit"
              class="w-full rounded bg-accent px-4 py-3 text-sm font-medium text-white hover:opacity-90"
            >
              로컬 개발 계정으로 시작
            </button>
          </form>
        ) : null}

        {!googleReady && !devLogin ? (
          <p class="rounded border border-line bg-surface p-4 text-sm leading-6 text-muted">
            로그인 수단이 설정되지 않았습니다. <code class="text-ink">.dev.vars</code>에{' '}
            <code class="text-ink">DEV_LOGIN=true</code>를 넣거나 Google OAuth 키를 설정하세요.
          </p>
        ) : null}
      </div>
    </Layout>
  );
});

auth.post('/auth/dev', async (c) => {
  if (c.env.DEV_LOGIN !== 'true') return c.notFound();

  const user = await findOrCreateUser(c, 'dev@local', '개발자');
  await createSession(c, user.id);
  return c.redirect('/');
});

auth.get('/auth/google', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  if (!clientId) return c.text('GOOGLE_CLIENT_ID 가 설정되지 않았습니다.', 500);

  const state = crypto.randomUUID();
  const redirectUri = new URL('/auth/google/callback', c.req.url).toString();

  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  });

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');

  return c.redirect(url.toString());
});

auth.get('/auth/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const saved = getCookie(c, 'oauth_state');

  deleteCookie(c, 'oauth_state', { path: '/' });

  if (!code || !state || !saved || state !== saved) {
    return c.text('로그인 요청이 올바르지 않습니다. 다시 시도해 주세요.', 400);
  }

  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return c.text('Google OAuth 설정이 없습니다.', 500);
  }

  const redirectUri = new URL('/auth/google/callback', c.req.url).toString();

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) return c.text('Google 토큰 교환에 실패했습니다.', 400);

  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) return c.text('액세스 토큰이 없습니다.', 400);

  const meRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!meRes.ok) return c.text('사용자 정보를 가져오지 못했습니다.', 400);

  const me = (await meRes.json()) as { email?: string; name?: string };
  if (!me.email) return c.text('이메일을 확인할 수 없습니다.', 400);

  const user = await findOrCreateUser(c, me.email, me.name ?? null);
  await createSession(c, user.id);
  return c.redirect('/');
});

auth.post('/logout', async (c) => {
  await destroySession(c);
  return c.redirect('/');
});

export default auth;
