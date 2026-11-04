import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout } from '../components/layout';

const settings = new Hono<Env>();

const NEW_OPTIONS = [5, 10, 20];

settings.get('/settings', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const saved = c.req.query('saved') === '1';

  return c.html(
    <Layout title="설정" user={user}>
      <h1 class="text-xl font-semibold">설정</h1>

      {saved ? (
        <p class="mt-4 rounded border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">
          저장했습니다.
        </p>
      ) : null}

      <form method="post" action="/settings" class="mt-8 space-y-8">
        <div>
          <label for="display_name" class="text-sm font-medium">
            표시 이름
          </label>
          <input
            id="display_name"
            name="display_name"
            value={user.display_name ?? ''}
            maxlength={40}
            autocomplete="nickname"
            class="mt-2 w-full rounded border border-line bg-surface px-3 py-2 text-sm"
          />
        </div>

        <fieldset>
          <legend class="text-sm font-medium">하루 신규 단어</legend>
          <div class="mt-2 grid grid-cols-3 gap-2">
            {NEW_OPTIONS.map((n) => (
              <label class="cursor-pointer rounded border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent has-[:checked]:text-accent">
                <input
                  type="radio"
                  name="daily_new"
                  value={String(n)}
                  checked={user.daily_new === n}
                  class="sr-only"
                />
                {n}개
              </label>
            ))}
          </div>
          <p class="mt-2 text-xs leading-5 text-muted">
            복습이 밀릴 때는 줄이세요. 신규를 늘리면 복습 부담이 함께 늘어납니다.
          </p>
        </fieldset>

        <div>
          <label for="daily_review" class="text-sm font-medium">
            하루 복습 상한
          </label>
          <input
            id="daily_review"
            name="daily_review"
            type="number"
            min={10}
            max={1000}
            step={10}
            value={String(user.daily_review)}
            class="mt-2 w-32 rounded border border-line bg-surface px-3 py-2 text-sm tabular-nums"
          />
        </div>

        <button
          type="submit"
          class="w-full rounded bg-accent px-5 py-3 text-sm font-medium text-white hover:opacity-90"
        >
          저장
        </button>
      </form>

      <section class="mt-12 border-t border-line pt-6">
        <h2 class="text-sm font-semibold">계정</h2>
        <p class="mt-1 text-sm text-muted">{user.email}</p>
        <form method="post" action="/logout" class="mt-3">
          <button type="submit" class="text-sm text-muted hover:text-danger">
            로그아웃
          </button>
        </form>
      </section>
    </Layout>
  );
});

settings.post('/settings', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const body = await c.req.parseBody();

  const displayName = String(body['display_name'] ?? '').trim().slice(0, 40) || null;

  const requestedNew = Number(body['daily_new']);
  const dailyNew = NEW_OPTIONS.includes(requestedNew) ? requestedNew : user.daily_new;

  const requestedReview = Number(body['daily_review']);
  const dailyReview = Number.isFinite(requestedReview)
    ? Math.min(1000, Math.max(10, Math.trunc(requestedReview)))
    : user.daily_review;

  await c.env.DB.prepare(
    'UPDATE users SET display_name = ?, daily_new = ?, daily_review = ? WHERE id = ?'
  )
    .bind(displayName, dailyNew, dailyReview, user.id)
    .run();

  return c.redirect('/settings?saved=1');
});

export default settings;
