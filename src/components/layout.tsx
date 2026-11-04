import type { User } from '../types';

const CLIENT_JS = `
document.addEventListener('click', function (e) {
  var speak = e.target.closest('[data-speak]');
  if (speak) {
    var word = speak.getAttribute('data-speak');
    var u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return;
  }
});

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

// 하단 탭 활성 표시
(function () {
  var path = location.pathname;
  document.querySelectorAll('[data-tab]').forEach(function (a) {
    var href = a.getAttribute('href');
    var active = href === '/' ? path === '/' : path.indexOf(href) === 0;
    if (active) a.setAttribute('data-active', '');
  });
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}
`;

function Tab(props: { href: string; label: string }) {
  return (
    <a
      href={props.href}
      data-tab
      class="flex-1 py-3 text-center text-xs text-muted hover:text-ink"
    >
      {props.label}
    </a>
  );
}

export function Layout(props: { title: string; user: User | null; children?: any }) {
  return (
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#12694f" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Wordy" />
        <title>{props.title} · Wordy</title>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icons/icon-192.png" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="stylesheet" href="/styles.css" />
        <script src="/htmx.min.js" defer></script>
      </head>
      <body class="min-h-dvh bg-paper font-sans text-ink antialiased">
        <header class="border-b border-line">
          <div class="mx-auto flex max-w-2xl items-baseline justify-between px-5 py-4">
            <a href="/" class="text-[15px] font-semibold tracking-tight">
              Wordy
            </a>
            {props.user ? (
              <nav class="flex items-baseline gap-5 text-sm text-muted">
                <a href="/decks" class="hover:text-ink">
                  단어장
                </a>
                <a href="/settings" class="hover:text-ink">
                  설정
                </a>
                <form method="post" action="/logout">
                  <button type="submit" class="hover:text-ink">
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

        <main class="mx-auto max-w-2xl px-5 py-10 pb-28 sm:pb-10">{props.children}</main>

        <footer class="mx-auto flex max-w-2xl flex-col gap-2 px-5 pt-6 pb-24 text-xs text-muted sm:flex-row sm:items-baseline sm:justify-between sm:pb-12">
          <span>Learn words. Remember forever.</span>
          <nav class="flex gap-4">
            <a href="/privacy" class="hover:text-ink">
              개인정보처리방침
            </a>
            <a href="/terms" class="hover:text-ink">
              이용약관
            </a>
          </nav>
        </footer>

        {props.user ? (
          <nav class="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-paper/95 backdrop-blur sm:hidden">
            <div class="mx-auto flex max-w-2xl">
              <Tab href="/" label="홈" />
              <Tab href="/review" label="학습" />
              <Tab href="/decks" label="단어장" />
              <Tab href="/stats" label="통계" />
            </div>
          </nav>
        ) : null}

        <script dangerouslySetInnerHTML={{ __html: CLIENT_JS }}></script>
      </body>
    </html>
  );
}
