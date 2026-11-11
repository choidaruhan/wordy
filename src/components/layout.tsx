import type { Child } from 'hono/jsx';
import type { User } from '../types';

const KEYBOARD_JS = `
document.addEventListener('keydown', function (event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  var target = event.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

  if (/^[1-4]$/.test(event.key)) {
    var choice = document.querySelector('[data-choice="' + event.key + '"]');
    if (choice) { event.preventDefault(); choice.click(); }
    return;
  }

  if (event.key === 'Enter' || event.key === ' ') {
    var next = document.querySelector('[data-next]');
    if (next) { event.preventDefault(); next.click(); }
  }
});

document.body.addEventListener('htmx:afterSwap', function () {
  var next = document.querySelector('[data-next]');
  if (next) next.focus();
});
`;

/** 헤더와 favicon이 같은 도형을 쓰도록 한 곳에서 정의한다. */
function Mark() {
  return (
    <svg viewBox="0 0 100 100" class="h-8 w-8" aria-hidden="true">
      <rect width="100" height="100" rx="22" fill="#5f2eea" />
      <path
        d="M27 34L38.5 67L50 47L61.5 67L73 34"
        fill="none"
        stroke="#ffffff"
        stroke-width="6.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function NavLink(props: { href: string; active: boolean; children: Child }) {
  return (
    <a
      href={props.href}
      class={
        props.active
          ? 'rounded-lg bg-accent-soft px-3 py-1.5 text-sm font-bold text-accent-text'
          : 'rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:text-ink'
      }
    >
      {props.children}
    </a>
  );
}

export function Layout(props: {
  title: string;
  user: User | null;
  active?: 'quiz' | 'words';
  description?: string;
  children: Child;
}) {
  return (
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · Wordy</title>
        <meta
          name="description"
          content={
            props.description ??
            '단어를 등록하고, 무한 4지선다로 외웁니다.'
          }
        />
        <meta name="theme-color" content="#5f2eea" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml" />
        <link
          rel="icon"
          href="/favicon-32.png?v=2"
          sizes="32x32"
          type="image/png"
        />
        <link
          rel="icon"
          href="/favicon-16.png?v=2"
          sizes="16x16"
          type="image/png"
        />
        <link
          rel="apple-touch-icon"
          href="/icons/apple-touch-icon.png?v=2"
        />
        <link
          rel="preload"
          href="/fonts/pretendard/PretendardVariable.subset.0.woff2"
          as="font"
          type="font/woff2"
          crossorigin="anonymous"
        />
        <link rel="stylesheet" href="/styles.css?v=11" />
        <script src="/htmx.min.js" defer></script>
      </head>
      <body class="min-h-dvh bg-paper text-ink antialiased">
        <header class="border-b border-line bg-surface">
          <div class="mx-auto flex w-full max-w-xl items-center justify-between px-4 py-3">
            <a href="/" class="flex items-center gap-2">
              <Mark />
              <span class="text-base font-extrabold tracking-tight">Wordy</span>
            </a>

            {props.user ? (
              <nav class="flex items-center gap-1">
                <NavLink href="/" active={props.active === 'quiz'}>
                  퀴즈
                </NavLink>
                <NavLink href="/words" active={props.active === 'words'}>
                  단어
                </NavLink>
                <form method="post" action="/logout" class="ml-1">
                  <button
                    type="submit"
                    class="rounded-lg px-2 py-1.5 text-xs font-semibold text-muted hover:text-ink"
                  >
                    나가기
                  </button>
                </form>
              </nav>
            ) : (
              <a
                href="/login"
                class="rounded-xl bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-strong"
              >
                로그인
              </a>
            )}
          </div>
        </header>

        <main class="mx-auto w-full max-w-xl px-4 pt-6 pb-20">
          {props.children}
        </main>

        <script dangerouslySetInnerHTML={{ __html: KEYBOARD_JS }} />
      </body>
    </html>
  );
}
