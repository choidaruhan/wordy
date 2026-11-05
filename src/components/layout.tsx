import type { User } from '../types';

const CLIENT_JS = `
document.addEventListener('click', function (e) {
  var press = e.target.closest('[data-choice],[data-act="rate"],[data-act="next"],[data-act="quiz-next"]');
  if (press && navigator.vibrate) navigator.vibrate(10);

  var speak = e.target.closest('[data-speak]');
  if (speak) {
    if (!('speechSynthesis' in window)) return;
    var word = speak.getAttribute('data-speak');
    var u = new SpeechSynthesisUtterance(word);
    var body = document.body;
    u.lang = body.getAttribute('data-voice-locale') || 'en-US';
    var rate = parseFloat(body.getAttribute('data-voice-rate') || '0.9');
    u.rate = isFinite(rate) ? rate : 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return;
  }
});

function markTtsSupport() {
  if ('speechSynthesis' in window) return;
  document.querySelectorAll('[data-tts-note]').forEach(function (el) {
    el.hidden = false;
  });
}
markTtsSupport();
document.addEventListener('htmx:afterSwap', markTtsSupport);

document.addEventListener('keydown', function (e) {
  var root = document.getElementById('review-root');
  if (!root) return;
  var tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.key === ' ' || e.key === 'Enter') {
    var next = root.querySelector('[data-act="reveal"],[data-act="hide"],[data-act="next"]');
    if (next) {
      e.preventDefault();
      next.click();
    }
    return;
  }

  if (e.key >= '1' && e.key <= '4') {
    var choice = root.querySelector('[data-choice="' + e.key + '"]');
    if (choice) {
      e.preventDefault();
      choice.click();
      return;
    }
    var rate = root.querySelector('[data-act="rate"][data-rating="' + e.key + '"]');
    if (rate) {
      e.preventDefault();
      rate.click();
    }
  }
});

document.addEventListener('htmx:afterSwap', function () {
  var el = document.querySelector('[data-autofocus]');
  if (el && el.focus) {
    el.focus();
    if (el.select) el.select();
  }
});

// 객관식 테스트 키보드
document.addEventListener('keydown', function (e) {
  var root = document.getElementById('quiz-root');
  if (!root) return;
  var tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.key >= '1' && e.key <= '4') {
    var choice = root.querySelector('[data-choice="' + e.key + '"]');
    if (choice) {
      e.preventDefault();
      choice.click();
    }
    return;
  }

  if (e.key === 'Enter' || e.key === ' ') {
    var next = root.querySelector('[data-act="quiz-next"]');
    if (next) {
      e.preventDefault();
      next.click();
    }
  }
});

// 현재 위치 표시 (상단 내비게이션 + 하단 탭)
(function () {
  var path = location.pathname;
  document.querySelectorAll('[data-tab],[data-nav]').forEach(function (a) {
    var href = a.getAttribute('href');
    var active = href === '/' ? path === '/' : path.indexOf(href) === 0;
    if (active) {
      a.setAttribute('data-active', '');
      a.setAttribute('aria-current', 'page');
    }
  });
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}
`;

function IconHome() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v10.5h13V9" />
      <path d="M9.5 19.5v-6h5v6" />
    </svg>
  );
}

function IconLearn() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M12 6.5c-1.8-1.4-4.2-2-7-2v13c2.8 0 5.2.6 7 2 1.8-1.4 4.2-2 7-2v-13c-2.8 0-5.2.6-7 2Z" />
      <path d="M12 6.5v13" />
    </svg>
  );
}

function IconDecks() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
    >
      <path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
    </svg>
  );
}

function IconStats() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M4 20v-7" />
      <path d="M9 20V6" />
      <path d="M14 20v-4" />
      <path d="M19 20V9" />
    </svg>
  );
}

function Tab(props: { href: string; label: string; icon: any }) {
  return (
    <a
      href={props.href}
      data-tab
      class="flex flex-1 flex-col items-center gap-1 py-2 text-xs text-muted hover:text-ink"
    >
      <span class="grid h-6 w-6 place-items-center">{props.icon}</span>
      <span>{props.label}</span>
    </a>
  );
}

export function Layout(props: {
  title: string;
  user: User | null;
  wide?: boolean;
  children?: any;
}) {
  const container = props.wide ? 'max-w-4xl' : 'max-w-2xl';

  return (
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0f766e" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0e1412" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Wordy" />
        <title>{props.title} · Wordy</title>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icons/icon-192.png" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="stylesheet" href="/styles.css?v=2" />
        <script src="/htmx.min.js" defer></script>
      </head>
      <body
        class="min-h-dvh bg-paper font-sans text-ink antialiased"
        data-voice-locale={props.user?.voice_locale ?? 'en-US'}
        data-voice-rate={String(props.user?.voice_rate ?? 0.9)}
      >
        <a
          href="#main"
          class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded focus:bg-surface focus:px-4 focus:py-3 focus:text-sm focus:shadow-float"
        >
          본문으로 건너뛰기
        </a>

        <header class="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
          <div
            class={`mx-auto flex ${container} items-center justify-between gap-4 px-5 py-3`}
          >
            <a href="/" class="flex items-center gap-2">
              <span class="grid h-7 w-7 place-items-center rounded-lg bg-accent font-word text-sm text-white">
                W
              </span>
              <span class="text-base font-semibold tracking-tight">Wordy</span>
              <span class="hidden text-xs text-muted sm:inline">영어 단어, 기억하게</span>
            </a>

            {props.user ? (
              <nav class="flex items-center gap-5 text-sm text-muted">
                <a href="/review" data-nav class="hidden hover:text-ink sm:inline">
                  학습
                </a>
                <a href="/decks" data-nav class="hover:text-ink">
                  단어장
                </a>
                <a href="/stats" data-nav class="hidden hover:text-ink sm:inline">
                  통계
                </a>
                <a href="/settings" data-nav class="hover:text-ink">
                  설정
                </a>
                <form method="post" action="/logout" class="hidden sm:block">
                  <button type="submit" class="text-muted hover:text-ink">
                    나가기
                  </button>
                </form>
              </nav>
            ) : (
              <a href="/login" class="text-sm text-muted hover:text-ink">
                로그인
              </a>
            )}
          </div>
        </header>

        <main
          id="main"
          class={`mx-auto ${container} px-5 py-8 ${
            props.user ? 'pb-28 sm:py-10 sm:pb-10' : 'pb-12 sm:py-10 sm:pb-12'
          }`}
        >
          {props.children}
        </main>

        <footer
          class={`mx-auto flex ${container} flex-col gap-2 px-5 pt-6 text-xs text-muted sm:flex-row sm:items-baseline sm:justify-between ${
            props.user ? 'pb-24 sm:pb-12' : 'pb-12'
          }`}
        >
          <span>Learn words. Remember forever.</span>
          <nav class="flex gap-4">
            <a href="/design" class="hover:text-ink">
              디자인 시스템
            </a>
            <a href="/privacy" class="hover:text-ink">
              개인정보처리방침
            </a>
            <a href="/terms" class="hover:text-ink">
              이용약관
            </a>
          </nav>
        </footer>

        {props.user ? (
          <nav
            class="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 backdrop-blur sm:hidden"
            aria-label="주요 메뉴"
          >
            <div class="mx-auto flex max-w-2xl">
              <Tab href="/" label="홈" icon={<IconHome />} />
              <Tab href="/review" label="학습" icon={<IconLearn />} />
              <Tab href="/decks" label="단어장" icon={<IconDecks />} />
              <Tab href="/stats" label="통계" icon={<IconStats />} />
            </div>
          </nav>
        ) : null}

        <script dangerouslySetInnerHTML={{ __html: CLIENT_JS }}></script>
      </body>
    </html>
  );
}
