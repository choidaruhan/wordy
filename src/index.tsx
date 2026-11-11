import { Hono } from 'hono';
import type { Env } from './types';
import { Layout } from './components/layout';
import { getSessionUser } from './lib/auth';
import { isAllowedMutationOrigin } from './lib/security';
import { checkRateLimit, rateLimitPolicy } from './lib/rate-limit';
import auth from './routes/auth';
import quiz from './routes/quiz';
import words from './routes/words';
import legal from './routes/legal';

const app = new Hono<Env>();

app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=()'
  );
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data:",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );

  const method = c.req.method.toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const allowed = isAllowedMutationOrigin({
      requestUrl: c.req.url,
      origin: c.req.header('origin') ?? null,
      referer: c.req.header('referer') ?? null,
      secFetchSite: c.req.header('sec-fetch-site') ?? null,
    });
    if (!allowed) {
      return c.text('허용되지 않은 요청입니다.', 403);
    }
  }

  const user = await getSessionUser(c);
  c.set('user', user);

  const policy = rateLimitPolicy(method, c.req.path);
  if (policy) {
    const identity =
      policy.scope === 'ip'
        ? (c.req.header('cf-connecting-ip') ??
          c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
          'unknown')
        : user?.id;

    if (identity) {
      try {
        const result = await checkRateLimit(
          c.env.DB,
          `${policy.key}:${identity}`,
          policy.limit,
          policy.windowSeconds
        );
        if (!result.allowed) {
          c.header('Retry-After', String(result.retryAfter));
          return c.text(
            '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
            429
          );
        }
      } catch (err) {
        console.error('rate limit failed', err);
      }
    }
  }

  await next();
  c.header('Cache-Control', 'no-store');
});

app.route('/', auth);
app.route('/', quiz);
app.route('/', words);
app.route('/', legal);

app.notFound((c) => {
  const user = c.get('user') ?? null;

  return c.html(
    <Layout title="페이지를 찾을 수 없습니다" user={user}>
      <div class="pt-10 text-center">
        <p class="text-xs font-bold tracking-widest text-accent-text uppercase">
          404
        </p>
        <h1 class="mt-2 text-2xl font-extrabold tracking-tight">
          페이지를 찾을 수 없습니다
        </h1>
        <p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
          주소가 바뀌었거나 삭제된 페이지입니다.
        </p>
        <a
          href="/"
          class="mt-8 inline-flex rounded-2xl bg-accent px-5 py-3.5 text-sm font-bold text-white shadow-brand hover:bg-accent-strong"
        >
          홈으로
        </a>
      </div>
    </Layout>,
    404
  );
});

app.onError((err, c) => {
  console.error(err);
  const user = c.get('user') ?? null;

  return c.html(
    <Layout title="문제가 발생했습니다" user={user}>
      <div class="pt-10 text-center">
        <p class="text-xs font-bold tracking-widest text-accent-text uppercase">
          500
        </p>
        <h1 class="mt-2 text-2xl font-extrabold tracking-tight">
          문제가 발생했습니다
        </h1>
        <p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
          잠시 후 다시 시도해 주세요.
        </p>
        <button
          type="button"
          onclick="location.reload()"
          class="mt-8 rounded-2xl bg-accent px-5 py-3.5 text-sm font-bold text-white shadow-brand hover:bg-accent-strong"
        >
          다시 시도
        </button>
      </div>
    </Layout>,
    500
  );
});

export default app;
