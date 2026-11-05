import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout } from '../components/layout';
import { parseFsrsParams } from '../lib/srs';

const settings = new Hono<Env>();

const NEW_OPTIONS = [5, 10, 20];

settings.get('/settings', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const saved = c.req.query('saved') === '1';
  const fsrsStatus = c.req.query('fsrs');

  const reviewCountRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM reviews WHERE user_id = ?'
  )
    .bind(user.id)
    .first<{ n: number }>();
  const reviewCount = reviewCountRow?.n ?? 0;
  const reviewGoal = 1000;

  return c.html(
    <Layout title="설정" user={user}>
      <h1 class="text-2xl font-semibold">설정</h1>

      {saved ? (
        <p class="mt-4 rounded-xl border border-accent-text/30 bg-accent-soft px-4 py-3 text-sm text-accent-text">
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
            class="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-3 text-sm"
          />
        </div>

        <fieldset>
          <legend class="text-sm font-medium">하루 신규 단어</legend>
          <div class="mt-2 grid grid-cols-3 gap-2">
            {NEW_OPTIONS.map((n) => (
              <label class="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
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

        <fieldset>
          <legend class="text-sm font-medium">신규 단어 배분</legend>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <label class="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
              <input
                type="radio"
                name="new_card_mode"
                value="auto"
                checked={user.new_card_mode === 'auto'}
                class="sr-only"
              />
              자동
            </label>
            <label class="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
              <input
                type="radio"
                name="new_card_mode"
                value="fixed"
                checked={user.new_card_mode === 'fixed'}
                class="sr-only"
              />
              고정
            </label>
          </div>
          <p class="mt-2 text-xs leading-5 text-muted">
            자동은 복습이 밀리면 신규 단어를 줄입니다. 고정은 설정한 수를 유지합니다.
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
            class="mt-2 w-32 rounded-xl border border-line bg-surface px-3 py-3 text-sm tabular-nums"
          />
        </div>

        <fieldset>
          <legend class="text-sm font-medium">듣기 카드</legend>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <label class="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
              <input
                type="radio"
                name="listening_enabled"
                value="0"
                checked={!user.listening_enabled}
                class="sr-only"
              />
              사용 안 함
            </label>
            <label class="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
              <input
                type="radio"
                name="listening_enabled"
                value="1"
                checked={user.listening_enabled}
                class="sr-only"
              />
              사용
            </label>
          </div>
          <p class="mt-2 text-xs leading-5 text-muted">
            기억이 안정된 단어에 듣기 카드를 추가합니다. 기기의 TTS 음성을 사용합니다.
            끄면 새 듣기 카드를 만들지 않으며, 이미 만든 카드는 계속 복습할 수 있습니다.
          </p>
        </fieldset>

        <fieldset>
          <legend class="text-sm font-medium">발음</legend>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <label class="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
              <input
                type="radio"
                name="voice_locale"
                value="en-US"
                checked={user.voice_locale === 'en-US'}
                class="sr-only"
              />
              미국식
            </label>
            <label class="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
              <input
                type="radio"
                name="voice_locale"
                value="en-GB"
                checked={user.voice_locale === 'en-GB'}
                class="sr-only"
              />
              영국식
            </label>
          </div>

          <label for="voice_rate" class="mt-4 block text-xs text-muted">
            재생 속도
          </label>
          <select
            id="voice_rate"
            name="voice_rate"
            class="mt-1 rounded-xl border border-line bg-surface px-3 py-3 text-sm"
          >
            {[0.7, 0.8, 0.9, 1.0, 1.1, 1.2].map((rate) => (
              <option value={String(rate)} selected={Math.abs(user.voice_rate - rate) < 0.01}>
                {rate.toFixed(1)}x
              </option>
            ))}
          </select>
        </fieldset>

        <button
          type="submit"
          class="w-full rounded-xl bg-accent px-5 py-3 text-sm font-medium text-white hover:bg-accent-strong"
        >
          저장
        </button>
      </form>

      <section class="mt-12 border-t border-line pt-6">
        <h2 class="text-base font-semibold">FSRS 개인화</h2>
        <p class="mt-1 text-sm leading-6 text-muted">
          리뷰가 1,000건 이상 쌓이면 개인 기억 패턴에 맞춘 파라미터를 적용할 수 있습니다.
        </p>

        <div class="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span>리뷰 {reviewCount}건</span>
          {user.fsrs_params ? (
            <span class="text-accent-text">개인 파라미터 적용 중</span>
          ) : reviewCount >= reviewGoal ? (
            <span class="text-accent-text">최적화 준비됨</span>
          ) : (
            <span class="text-muted">{reviewGoal - reviewCount}건 더 필요</span>
          )}
        </div>

        {fsrsStatus === 'saved' ? (
          <p class="mt-3 rounded-xl border border-accent-text/30 bg-accent-soft px-4 py-3 text-sm text-accent-text">
            FSRS 파라미터를 저장했습니다.
          </p>
        ) : null}
        {fsrsStatus === 'invalid' ? (
          <p class="mt-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            올바른 21개 숫자 배열이 아닙니다.
          </p>
        ) : null}

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <a
            href="/settings/fsrs/export"
            class="rounded-xl border border-line px-4 py-3 text-sm hover:border-accent-text"
          >
            리뷰 로그 내보내기 (JSON)
          </a>
          {user.fsrs_params ? (
            <form method="post" action="/settings/fsrs/reset">
              <button
                type="submit"
                class="rounded-xl border border-line px-4 py-3 text-sm text-muted hover:border-danger hover:text-danger"
              >
                기본값으로 초기화
              </button>
            </form>
          ) : null}
        </div>

        <form method="post" action="/settings/fsrs" class="mt-4">
          <label for="fsrs_params" class="text-sm font-medium">
            파라미터 JSON
          </label>
          <p class="mt-1 text-xs leading-5 text-muted">
            외부 FSRS 옵티마이저에서 계산한 21개 가중치 배열을 붙여넣으세요. 적용 전까지는
            기본값을 사용합니다.
          </p>
          <textarea
            id="fsrs_params"
            name="fsrs_params"
            rows={4}
            spellcheck={false}
            placeholder="[0.212, 1.2931, ...]"
            class="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-3 font-mono text-xs"
          >
            {user.fsrs_params ? JSON.stringify(user.fsrs_params) : ''}
          </textarea>
          <button
            type="submit"
            class="mt-2 rounded-xl bg-accent px-5 py-3 text-sm font-medium text-white hover:bg-accent-strong"
          >
            파라미터 적용
          </button>
        </form>
      </section>

      <section class="mt-12 border-t border-line pt-6">
        <h2 class="text-base font-semibold">계정</h2>
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

  const newCardMode = body['new_card_mode'] === 'fixed' ? 'fixed' : 'auto';

  const listeningEnabled = body['listening_enabled'] === '1' ? 1 : 0;
  const voiceLocale = body['voice_locale'] === 'en-GB' ? 'en-GB' : 'en-US';
  const requestedRate = Number(body['voice_rate']);
  const voiceRate = Number.isFinite(requestedRate)
    ? Math.min(1.2, Math.max(0.7, requestedRate))
    : user.voice_rate;

  const requestedReview = Number(body['daily_review']);
  const dailyReview = Number.isFinite(requestedReview)
    ? Math.min(1000, Math.max(10, Math.trunc(requestedReview)))
    : user.daily_review;

  await c.env.DB.prepare(
    `UPDATE users
        SET display_name = ?, daily_new = ?, daily_review = ?, new_card_mode = ?,
            listening_enabled = ?, voice_locale = ?, voice_rate = ?
      WHERE id = ?`
  )
    .bind(
      displayName,
      dailyNew,
      dailyReview,
      newCardMode,
      listeningEnabled,
      voiceLocale,
      voiceRate,
      user.id
    )
    .run();

  return c.redirect('/settings?saved=1');
});

/** FSRS 옵티마이저에 넣을 리뷰 로그를 JSON으로 내보낸다. */
settings.get('/settings/fsrs/export', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const { results } = await c.env.DB.prepare(
    `SELECT card_id, rating, reviewed_at, elapsed_days, scheduled_days,
            reps_before, prev_state, question_type, is_correct, source
       FROM reviews
      WHERE user_id = ?
      ORDER BY reviewed_at`
  )
    .bind(user.id)
    .all<Record<string, unknown>>();

  const payload = {
    exported_at: new Date().toISOString(),
    fsrs_version: '6.0',
    review_count: results.length,
    reviews: results,
  };

  c.header('Content-Type', 'application/json; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="wordy-fsrs-reviews.json"');
  return c.body(JSON.stringify(payload, null, 2));
});

/** 외부에서 계산한 21개 FSRS 가중치를 적용한다. */
settings.post('/settings/fsrs', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const body = await c.req.parseBody();
  const params = parseFsrsParams(String(body['fsrs_params'] ?? '').trim());

  if (!params) return c.redirect('/settings?fsrs=invalid');

  await c.env.DB.prepare(
    'UPDATE users SET fsrs_params = ?, fsrs_params_updated_at = ? WHERE id = ?'
  )
    .bind(JSON.stringify(params), new Date().toISOString(), user.id)
    .run();

  return c.redirect('/settings?fsrs=saved');
});

settings.post('/settings/fsrs/reset', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  await c.env.DB.prepare(
    'UPDATE users SET fsrs_params = NULL, fsrs_params_updated_at = NULL WHERE id = ?'
  )
    .bind(user.id)
    .run();

  return c.redirect('/settings?fsrs=saved');
});

export default settings;
