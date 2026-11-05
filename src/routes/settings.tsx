import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout } from '../components/layout';
import { parseFsrsParams } from '../lib/srs';
import { isValidTimeZone } from '../lib/time';

const settings = new Hono<Env>();

const NEW_OPTIONS = [5, 10, 20];
const SESSION_SIZES = [5, 10, 20];
const NEW_PER_SESSION_OPTIONS = [0, 1, 2, 3, 5];

settings.get('/settings', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const saved = c.req.query('saved') === '1';
  const fsrsStatus = c.req.query('fsrs');
  const tzStatus = c.req.query('tz');
  const dailyMode = user.learning_mode === 'daily';
  const offsetSign = user.tz_offset_min >= 0 ? '+' : '-';
  const offsetHours = String(
    Math.floor(Math.abs(user.tz_offset_min) / 60)
  ).padStart(2, '0');
  const offsetMinutes = String(Math.abs(user.tz_offset_min) % 60).padStart(2, '0');
  const offsetLabel = `UTC${offsetSign}${offsetHours}:${offsetMinutes}`;

  const reviewCountRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM reviews WHERE user_id = ?'
  )
    .bind(user.id)
    .first<{ n: number }>();
  const reviewCount = reviewCountRow?.n ?? 0;
  const reviewGoal = 1000;
  const fsrsLabel = user.fsrs_params
    ? '개인 파라미터 적용 중'
    : reviewCount >= reviewGoal
      ? '최적화 준비됨'
      : `${reviewGoal - reviewCount}건 더 필요`;

  return c.html(
    <Layout title="설정" user={user}>
      <h1 class="text-2xl font-extrabold tracking-tight">설정</h1>

      {saved ? (
        <p class="mt-4 rounded-xl border border-accent-text/30 bg-accent-soft px-4 py-3 text-sm text-accent-text">
          저장했습니다.
        </p>
      ) : null}

      {tzStatus === 'invalid' ? (
        <p class="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          유효한 IANA 시간대가 아닙니다. 기존 시간대를 유지했습니다.
        </p>
      ) : null}

      <form id="settings-form" method="post" action="/settings" class="mt-8 space-y-8">
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
          <legend class="text-sm font-medium">화면 테마</legend>
          <div class="mt-2 grid grid-cols-3 gap-2">
            {[
              ['system', '시스템'],
              ['light', '라이트'],
              ['dark', '다크'],
            ].map(([value, label]) => (
              <label class="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={value === 'system'}
                  class="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
          <p class="mt-2 text-xs leading-5 text-muted">
            이 기기에만 저장됩니다. 시스템은 OS의 라이트·다크 설정을 따릅니다.
          </p>
        </fieldset>

        <fieldset>
          <legend class="text-sm font-medium">학습 방식</legend>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <label class="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
              <input
                type="radio"
                name="learning_mode"
                value="session"
                checked={user.learning_mode !== 'daily'}
                class="sr-only"
              />
              한 판씩
            </label>
            <label class="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
              <input
                type="radio"
                name="learning_mode"
                value="daily"
                checked={user.learning_mode === 'daily'}
                class="sr-only"
              />
              하루 목표
            </label>
          </div>
          <p class="mt-2 text-xs leading-5 text-muted">
            한 판씩은 하루 목표 없이 가볍게, 하루 목표는 오늘 할 양을 정해두고 학습합니다.
          </p>
        </fieldset>

        <fieldset>
          <legend class="text-sm font-medium">확신도 질문</legend>
          <div class="mt-2 grid grid-cols-3 gap-2">
            {([
              ['off', '묻지 않음'],
              ['sample', '가끔 (1/5)'],
              ['always', '항상'],
            ] as const).map(([value, label]) => (
              <label class="cursor-pointer rounded-xl border border-line bg-surface px-2 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
                <input
                  type="radio"
                  name="confidence_mode"
                  value={value}
                  checked={user.confidence_mode === value}
                  class="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
          <p class="mt-2 text-xs leading-5 text-muted">
            정답을 맞힌 뒤 “얼마나 확신했나요?”를 선택적으로 기록합니다.
            가끔은 5문제마다 1번 묻습니다.
          </p>
        </fieldset>

        <div>
          <label for="timezone" class="text-sm font-medium">
            시간대
          </label>
          <input
            id="timezone"
            name="timezone"
            list="timezone-options"
            value={user.timezone ?? ''}
            placeholder="Asia/Seoul"
            autocomplete="off"
            spellcheck={false}
            class="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-3 text-sm"
          />
          <datalist id="timezone-options">
            {[
              'Asia/Seoul',
              'UTC',
              'Asia/Tokyo',
              'Asia/Shanghai',
              'Asia/Kolkata',
              'America/New_York',
              'America/Los_Angeles',
              'Europe/London',
              'Europe/Paris',
              'Australia/Sydney',
            ].map((zone) => (
              <option value={zone}>{zone}</option>
            ))}
          </datalist>
          <p class="mt-2 text-xs leading-5 text-muted">
            IANA 시간대입니다. 비워두면 UTC 오프셋({offsetLabel})을 사용합니다.
          </p>
        </div>

        <fieldset>
          <legend class="text-sm font-medium">한 판 문제 수</legend>
          <div class="mt-2 grid grid-cols-3 gap-2">
            {SESSION_SIZES.map((n) => (
              <label class="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
                <input
                  type="radio"
                  name="session_size"
                  value={String(n)}
                  checked={user.session_size === n}
                  class="sr-only"
                />
                {n}문제
              </label>
            ))}
          </div>
          <p class="mt-2 text-xs leading-5 text-muted">
            하루 목표가 아니라, 한 판에서 풀 문제 수입니다.
          </p>
        </fieldset>

        <fieldset>
          <legend class="text-sm font-medium">한 판에 섞을 새 단어</legend>
          <div class="mt-2 grid grid-cols-5 gap-2">
            {NEW_PER_SESSION_OPTIONS.map((n) => (
              <label class="cursor-pointer rounded-xl border border-line bg-surface px-2 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
                <input
                  type="radio"
                  name="new_per_session"
                  value={String(n)}
                  checked={user.new_per_session === n}
                  class="sr-only"
                />
                {n}개
              </label>
            ))}
          </div>
          <p class="mt-2 text-xs leading-5 text-muted">
            복습이 남아 있을 때 한 판에 섞을 새 단어 수입니다. 복습이 없으면 새 단어로 채웁니다.
          </p>
        </fieldset>

        <div data-daily-settings hidden={!dailyMode} class="space-y-8">
          <div class="border-t border-line pt-2">
            <h2 class="text-base font-extrabold tracking-tight">하루 목표 설정</h2>
            <p class="mt-1 text-xs leading-5 text-muted">
              하루 목표 모드에서만 적용됩니다.
            </p>
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

        <fieldset>
          <legend class="text-sm font-medium">햅틱</legend>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <label class="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
              <input
                type="radio"
                name="haptic"
                value="on"
                checked
                class="sr-only"
              />
              사용
            </label>
            <label class="cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm has-[:checked]:border-accent-text has-[:checked]:text-accent-text">
              <input
                type="radio"
                name="haptic"
                value="off"
                class="sr-only"
              />
              사용 안 함
            </label>
          </div>
          <p class="mt-2 text-xs leading-5 text-muted">
            선택·평점·다음 버튼에서 짧게 진동합니다. 지원 기기에서만 동작하며 이
            기기에만 저장됩니다.
          </p>
        </fieldset>

        <button
          type="submit"
          class="w-full rounded-xl bg-accent shadow-brand px-5 py-3 text-sm font-medium text-white hover:bg-accent-strong"
        >
          저장
        </button>
      </form>

      <div class="settings-save-bar fixed inset-x-0 z-10 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur sm:hidden">
        <div class="mx-auto max-w-2xl">
          <button
            type="submit"
            form="settings-form"
            class="w-full rounded-xl bg-accent px-5 py-3 text-sm font-bold text-white shadow-brand hover:bg-accent-strong"
          >
            저장
          </button>
        </div>
      </div>

      <details
        open={fsrsStatus === 'saved' || fsrsStatus === 'invalid'}
        class="mt-12 border-t border-line pt-6"
      >
        <summary class="cursor-pointer">
          <span class="text-base font-extrabold tracking-tight">
            고급 · FSRS 개인화
          </span>
          <span class="mt-1 block text-xs leading-5 text-muted">
            리뷰 {reviewCount}건 · {fsrsLabel}
          </span>
        </summary>

        <p class="mt-3 text-sm leading-6 text-muted">
          리뷰가 1,000건 이상 쌓이면 개인 기억 패턴에 맞춘 파라미터를 적용할 수 있습니다.
        </p>

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
            class="mt-2 rounded-xl bg-accent shadow-brand px-5 py-3 text-sm font-medium text-white hover:bg-accent-strong"
          >
            파라미터 적용
          </button>
        </form>
      </details>

      <section data-install-root class="mt-12 border-t border-line pt-6">
        <h2 class="text-base font-extrabold tracking-tight">앱 설치</h2>
        <p class="mt-1 text-sm leading-6 text-muted">
          홈 화면에 추가하면 앱처럼 열리고, 오프라인에서도 앱 셸이 유지됩니다.
        </p>

        <button
          type="button"
          data-install-button
          hidden
          class="mt-4 rounded-xl bg-accent px-5 py-3 text-sm font-bold text-white shadow-brand hover:bg-accent-strong"
        >
          홈 화면에 추가
        </button>

        <p
          data-install-ios
          hidden
          class="mt-4 rounded-xl bg-paper px-4 py-3 text-xs leading-5 text-muted"
        >
          iPhone·iPad는 Safari의 공유 버튼을 누른 뒤{' '}
          <span class="font-semibold text-ink">홈 화면에 추가</span>를 선택하세요.
        </p>

        <p
          data-install-done
          hidden
          class="mt-4 rounded-xl bg-accent-soft px-4 py-3 text-sm font-semibold text-accent-text"
        >
          이미 앱으로 설치되어 있습니다.
        </p>

        <p
          data-install-unavailable
          hidden
          class="mt-4 text-xs leading-5 text-muted"
        >
          자동 설치 창이 열리지 않으면 브라우저 메뉴에서 “앱 설치” 또는 “홈
          화면에 추가”를 선택하세요.
        </p>
      </section>

      <section class="mt-12 border-t border-line pt-6">
        <h2 class="text-base font-extrabold tracking-tight">계정</h2>
        <p class="mt-1 text-sm text-muted">{user.email}</p>
        <form method="post" action="/logout" class="mt-3">
          <button type="submit" class="text-sm text-muted hover:text-danger">
            로그아웃
          </button>
        </form>
      </section>

      <div class="h-16 sm:hidden" aria-hidden="true"></div>
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

  const learningMode = body['learning_mode'] === 'daily' ? 'daily' : 'session';

  const requestedConfidence = body['confidence_mode'];
  const confidenceMode =
    requestedConfidence === 'off' ||
    requestedConfidence === 'sample' ||
    requestedConfidence === 'always'
      ? requestedConfidence
      : user.confidence_mode;

  const requestedTimezone = String(body['timezone'] ?? '').trim();
  const timezoneInvalid =
    requestedTimezone !== '' && !isValidTimeZone(requestedTimezone);
  const timezone =
    requestedTimezone === ''
      ? null
      : timezoneInvalid
        ? user.timezone
        : requestedTimezone;

  const newCardMode =
    body['new_card_mode'] === 'fixed'
      ? 'fixed'
      : body['new_card_mode'] === 'auto'
        ? 'auto'
        : user.new_card_mode;

  const requestedSessionSize = Number(body['session_size']);
  const sessionSize = SESSION_SIZES.includes(requestedSessionSize)
    ? requestedSessionSize
    : user.session_size;

  const requestedNewPerSession = Number(body['new_per_session']);
  const newPerSession = NEW_PER_SESSION_OPTIONS.includes(requestedNewPerSession)
    ? requestedNewPerSession
    : user.new_per_session;

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
        SET display_name = ?, daily_new = ?, daily_review = ?, learning_mode = ?,
            confidence_mode = ?, timezone = ?, session_size = ?, new_per_session = ?,
            new_card_mode = ?, listening_enabled = ?, voice_locale = ?, voice_rate = ?
      WHERE id = ?`
  )
    .bind(
      displayName,
      dailyNew,
      dailyReview,
      learningMode,
      confidenceMode,
      timezone,
      sessionSize,
      newPerSession,
      newCardMode,
      listeningEnabled,
      voiceLocale,
      voiceRate,
      user.id
    )
    .run();

  return c.redirect(timezoneInvalid ? '/settings?tz=invalid' : '/settings?saved=1');
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
