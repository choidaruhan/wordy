import { Hono } from 'hono';
import type { Env, User } from '../types';
import { Layout } from '../components/layout';

const design = new Hono<Env>();

const COLORS = [
  { token: 'paper', use: '페이지 배경' },
  { token: 'surface', use: '카드 · 입력' },
  { token: 'ink', use: '기본 글자' },
  { token: 'muted', use: '보조 글자' },
  { token: 'line', use: '테두리' },
  { token: 'accent', use: '주요 행동' },
  { token: 'accent-soft', use: '강조 배경' },
  { token: 'accent-text', use: '링크 · 강조' },
  { token: 'success', use: '정답 · 성공' },
  { token: 'streak', use: '연속 학습' },
  { token: 'streak-soft', use: '스트릭 배경' },
  { token: 'danger', use: '오답 · 삭제' },
];

const TYPE = [
  {
    token: 'font-word text-3xl',
    sample: 'abandon',
    use: '학습 카드 단어',
    class: 'font-word text-3xl',
  },
  {
    token: 'text-2xl font-extrabold',
    sample: '오늘의 학습',
    use: '화면 제목',
    class: 'text-2xl font-extrabold tracking-tight',
  },
  {
    token: 'text-base font-bold',
    sample: '오늘의 미션',
    use: '구역 제목',
    class: 'text-base font-bold',
  },
  {
    token: 'text-sm',
    sample: '뜻을 고르세요',
    use: '본문 · 질문',
    class: 'text-sm',
  },
  {
    token: 'text-xs',
    sample: '3 / 20 · 예상 5분',
    use: '메타 정보',
    class: 'text-xs text-muted',
  },
];

function Section(props: {
  id: string;
  no: string;
  title: string;
  desc?: string;
  children?: any;
}) {
  return (
    <section id={props.id} class="mt-12 scroll-mt-24">
      <div class="flex items-baseline gap-3 border-b border-line pb-3">
        <span class="font-mono text-xs text-accent-text">{props.no}</span>
        <h2 class="text-xl font-extrabold tracking-tight">{props.title}</h2>
        {props.desc ? (
          <p class="ml-auto hidden text-xs text-muted sm:block">{props.desc}</p>
        ) : null}
      </div>
      {props.children}
    </section>
  );
}

function Demo(props: { title: string; desc?: string; full?: boolean; children?: any }) {
  return (
    <div
      class={`rounded-2xl border border-line bg-surface p-5 shadow-card ${
        props.full ? 'sm:col-span-2' : ''
      }`}
    >
      <p class="text-sm font-bold">{props.title}</p>
      {props.desc ? <p class="mt-1 text-xs leading-5 text-muted">{props.desc}</p> : null}
      <div class="mt-4">{props.children}</div>
    </div>
  );
}

function Icon(props: { name: 'check' | 'flame' | 'volume' | 'book' | 'chevron' }) {
  if (props.name === 'check') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="m5 12 5 5L20 7" />
      </svg>
    );
  }
  if (props.name === 'flame') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="M12 22c4 0 7-2.7 7-6.5 0-3-1.8-5-3.5-6.8C13.8 6.9 13 5 13 2c-2.8 1.2-4.5 3.8-4.5 6.2 0 1.2.4 2.2 1 3.1-.9.2-1.7-.2-2.3-.9C6.3 11.8 5 13.4 5 15.5 5 19.3 8 22 12 22Z" />
      </svg>
    );
  }
  if (props.name === 'volume') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    );
  }
  if (props.name === 'book') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" />
        <path d="M8 7h8M8 11h8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

function DesignPage(props: { user: User | null }) {
  return (
    <Layout title="디자인 시스템" user={props.user} wide>
      <header>
        <p class="text-xs font-bold tracking-widest text-accent-text uppercase">Wordy UI</p>
        <h1 class="mt-2 text-3xl font-extrabold tracking-tight break-keep sm:text-4xl">
          퍼플로 정리한 학습 화면.
        </h1>
        <p class="mt-4 max-w-2xl text-base leading-7 text-muted">
          레퍼런스의 라이트 인디고 배경, 퍼플 CTA, 부드러운 카드, 초록 성공과 앰버 스트릭을
          Wordy의 실제 화면에 적용한 기준입니다. 모든 화면은 이 토큰과 컴포넌트로 조립합니다.
        </p>
        <div class="mt-5 flex flex-wrap items-center gap-2 text-xs">
          <span class="rounded-full bg-accent-soft px-3 py-1 font-bold text-accent-text">
            Plus Jakarta Sans
          </span>
          <span class="rounded-full border border-line px-3 py-1 text-muted">16px 컨트롤</span>
          <span class="rounded-full border border-line px-3 py-1 text-muted">24px 카드</span>
          <span class="rounded-full border border-line px-3 py-1 text-muted">다크 모드</span>
        </div>
      </header>

      <nav class="mt-8 flex flex-wrap gap-2 border-y border-line py-3 text-xs">
        {[
          ['color', '색'],
          ['type', '글자'],
          ['shape', '모양'],
          ['components', '컴포넌트'],
          ['patterns', '화면 패턴'],
          ['motion', '모션 · 접근성'],
        ].map(([id, label]) => (
          <a
            href={`#${id}`}
            class="rounded-full border border-line bg-surface px-3 py-1.5 font-semibold text-muted hover:border-accent-text hover:text-accent-text"
          >
            {label}
          </a>
        ))}
      </nav>

      <Section id="color" no="01" title="색" desc="배경은 라이트 인디고, 행동은 퍼플 하나">
        <div class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {COLORS.map((color) => (
            <div class="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              <div
                class="h-14 border-b border-line"
                style={`background:var(--color-${color.token})`}
              ></div>
              <div class="p-3">
                <p class="text-sm font-bold">{color.token}</p>
                <p class="mt-1 text-xs text-muted">{color.use}</p>
              </div>
            </div>
          ))}
        </div>
        <p class="mt-3 text-xs leading-5 text-muted">
          <span class="font-semibold text-ink">accent</span>는 버튼 채움,{' '}
          <span class="font-semibold text-accent-text">accent-text</span>는 링크·강조 글자에
          씁니다. 초록은 정답, 앰버는 연속 학습, 레드는 오답에만 사용합니다.
        </p>
      </Section>

      <Section id="type" no="02" title="글자" desc="영단어는 굵은 산세리프">
        <div class="mt-5 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          {TYPE.map((row) => (
            <div class="flex flex-wrap items-baseline gap-x-4 gap-y-2 px-4 py-4">
              <span class="w-36 shrink-0 font-mono text-xs text-muted">{row.token}</span>
              <span class={`min-w-0 flex-1 break-keep ${row.class}`}>{row.sample}</span>
              <span class="text-xs text-muted">{row.use}</span>
            </div>
          ))}
        </div>
        <p class="mt-3 text-xs leading-5 text-muted">
          본문은 Pretendard 계열, 영단어와 숫자는 Plus Jakarta Sans/Inter 계열의 굵은
          산세리프를 씁니다. 단어는 화면에서 가장 큰 요소입니다.
        </p>
      </Section>

      <Section id="shape" no="03" title="모양 · 그림자" desc="둥근 카드, 퍼플 틴트의 얕은 그림자">
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-bold">라운드</p>
            <div class="mt-4 flex flex-wrap items-end gap-4">
              {[
                ['rounded-xl', '16px'],
                ['rounded-2xl', '24px'],
                ['rounded-full', 'full'],
              ].map(([cls, label]) => (
                <div class="text-center">
                  <div class={`h-12 w-16 border border-line-strong bg-paper ${cls}`}></div>
                  <p class="mt-1 font-mono text-xs text-muted">{label}</p>
                </div>
              ))}
            </div>
          </div>
          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-bold">그림자</p>
            <div class="mt-4 grid grid-cols-2 gap-3">
              <div class="rounded-xl border border-line bg-surface p-4 text-xs text-muted shadow-card">
                shadow-card
              </div>
              <div class="rounded-xl border border-line bg-surface p-4 text-xs text-muted shadow-brand">
                shadow-brand
              </div>
            </div>
            <p class="mt-3 text-xs leading-5 text-muted">
              카드는 얕게, 주요 버튼은 퍼플 글로우로 한 단계 띄웁니다.
            </p>
          </div>
        </div>
      </Section>

      <Section id="components" no="04" title="컴포넌트" desc="실제 화면에서 쓰는 마크업">
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <Demo title="버튼" desc="주요 행동은 퍼플 채움 + shadow-brand." full>
            <div class="flex flex-wrap items-center gap-2">
              <span class="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-bold text-white shadow-brand">
                학습 시작
                <Icon name="chevron" />
              </span>
              <span class="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface px-4 text-sm font-bold hover:border-accent-text">
                보조 행동
              </span>
              <span class="inline-flex min-h-12 items-center justify-center rounded-full bg-accent-soft px-4 text-sm font-bold text-accent-text">
                <Icon name="volume" />
                발음
              </span>
              <span class="text-sm font-semibold text-muted">삭제</span>
            </div>
          </Demo>

          <Demo title="선택지" desc="48px, 선택 전에는 흰 배경.">
            <div class="space-y-2">
              <div class="flex min-h-12 items-center gap-3 rounded-xl border border-accent-text bg-accent-soft px-4 text-sm font-semibold text-accent-text">
                <span class="grid h-6 w-6 place-items-center rounded-full border border-accent-text/40 text-xs">
                  1
                </span>
                빌리다
              </div>
              <div class="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-surface px-4 text-sm font-medium">
                <span class="grid h-6 w-6 place-items-center rounded-full border border-line text-xs text-muted">
                  2
                </span>
                고치다
              </div>
              <div class="flex min-h-12 items-center gap-3 rounded-xl border border-danger/40 bg-danger-soft px-4 text-sm font-semibold text-danger">
                <span class="grid h-6 w-6 place-items-center rounded-full border border-danger/30 text-xs">
                  3
                </span>
                숨기다
              </div>
            </div>
          </Demo>

          <Demo title="지표 카드" desc="아이콘 + 숫자. 한 화면에 3개까지.">
            <div class="grid grid-cols-3 gap-2">
              {[
                ['외운 단어', '120', 'bg-accent-soft text-accent-text', 'book'],
                ['연속', '12일', 'bg-streak-soft text-streak', 'flame'],
                ['오늘', '8장', 'bg-success-soft text-success', 'check'],
              ].map(([label, value, tone, icon]) => (
                <div class="rounded-2xl border border-line bg-surface px-2 py-3 text-center shadow-card">
                  <span class={`mx-auto grid h-8 w-8 place-items-center rounded-full ${tone}`}>
                    <Icon name={icon as any} />
                  </span>
                  <p class="mt-2 text-xs text-muted">{label}</p>
                  <p class="mt-0.5 text-sm font-extrabold">{value}</p>
                </div>
              ))}
            </div>
          </Demo>

          <Demo title="진행 · 배지" desc="진행은 퍼플, 상태는 텍스트와 함께.">
            <div class="flex items-baseline justify-between text-xs text-muted">
              <span>7장 완료</span>
              <span>13장 남음</span>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-line">
              <div class="h-2 rounded-full bg-accent" style="width:35%"></div>
            </div>
            <div class="mt-3 flex flex-wrap gap-2 text-xs">
              <span class="rounded-full bg-success-soft px-3 py-1 font-bold text-success">정답</span>
              <span class="rounded-full bg-danger-soft px-3 py-1 font-bold text-danger">오답</span>
              <span class="rounded-full bg-streak-soft px-3 py-1 font-bold text-streak">
                🔥 12일
              </span>
              <span class="rounded-full border border-line px-3 py-1 font-semibold text-muted">
                B2
              </span>
            </div>
          </Demo>

          <Demo title="입력 · 안내" desc="입력은 흰 카드, 안내는 소프트 배경." full>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="text-sm font-bold">단어</label>
                <input
                  class="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-3 text-sm placeholder:text-muted/70"
                  placeholder="ubiquitous"
                />
                <p class="mt-2 text-xs leading-5 text-muted">
                  채점은 대소문자를 구분하지 않습니다. 철자가 비슷하면 오타로 인정합니다.
                </p>
              </div>
              <div class="space-y-2">
                <p class="rounded-xl border border-success/30 bg-success-soft px-3 py-2 text-sm font-semibold text-success">
                  정답 (철자 확인)
                </p>
                <p class="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
                  오답 · 내 답: ubiquitos
                </p>
                <p class="rounded-xl border border-mark/40 bg-mark-soft px-3 py-2 text-xs leading-5">
                  연상법은 다음 복습에 함께 나옵니다.
                </p>
              </div>
            </div>
          </Demo>
        </div>
      </Section>

      <Section id="patterns" no="05" title="화면 패턴" desc="한 화면에 한 질문">
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <article class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="inline-block rounded-full bg-line px-3 py-1 text-xs font-semibold text-muted">
              뜻을 고르세요
            </p>
            <p class="mt-5 text-center font-word text-3xl">borrow</p>
            <p class="mt-1 text-center text-xs text-muted">/ˈbɒrəʊ/</p>
            <div class="mt-3 flex justify-center">
              <span class="grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-accent-text">
                <Icon name="volume" />
              </span>
            </div>
            <div class="mt-5 space-y-2">
              {['빌리다', '고치다', '숨기다', '나누다'].map((option, index) => (
                <div
                  class={`flex min-h-12 items-center gap-3 rounded-xl border px-4 text-sm ${
                    index === 0
                      ? 'border-accent-text bg-accent-soft font-semibold text-accent-text'
                      : 'border-line bg-surface font-medium'
                  }`}
                >
                  <span class="grid h-6 w-6 place-items-center rounded-full border border-line text-xs text-muted">
                    {index + 1}
                  </span>
                  {option}
                </div>
              ))}
            </div>
          </article>

          <article class="rounded-2xl border border-line bg-surface p-5 text-center shadow-card">
            <div class="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-success-soft text-success">
              <Icon name="check" />
            </div>
            <p class="mt-3 text-sm font-bold text-success">정답!</p>
            <p class="mt-3 font-word text-3xl">borrow</p>
            <p class="mt-1 text-lg">빌리다</p>
            <div class="mt-4 rounded-xl border border-line bg-paper p-4 text-left">
              <p class="text-xs font-bold text-accent-text">예문</p>
              <p class="mt-1 text-sm leading-6">Can I borrow your pen?</p>
              <p class="text-xs text-muted">펜 좀 빌릴 수 있을까요?</p>
            </div>
            <p class="mt-3 text-xs text-muted">다음 복습 4일 뒤</p>
            <div class="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-white shadow-brand">
              계속
              <Icon name="chevron" />
            </div>
          </article>
        </div>
        <p class="mt-3 rounded-xl bg-accent-soft px-4 py-3 text-xs leading-5 text-accent-text">
          학습 화면은 하단 탭을 숨기고, 상단에는 진행률과 나가기만 남깁니다. 주요 선택지는
          화면 하단 60%에 둡니다.
        </p>
      </Section>

      <Section id="motion" no="06" title="모션 · 접근성" desc="빠르고, 줄일 수 있게">
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-bold">모션</p>
            <ul class="mt-3 space-y-2 text-sm leading-6 text-muted">
              <li>· 카드 교체 180ms 페이드 + 4px 상승</li>
              <li>· 색·테두리 120ms, 바텀시트 240ms</li>
              <li>· 세션 완료 축하는 한 번만</li>
              <li>· `prefers-reduced-motion`에서 모두 끔</li>
            </ul>
          </div>
          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-bold">접근성</p>
            <ul class="mt-3 space-y-2 text-sm leading-6 text-muted">
              <li>· 학습 선택지 최소 48px</li>
              <li>· 정답/오답을 색만으로 구분하지 않음</li>
              <li>· 2px accent-text 포커스 링</li>
              <li>· 키보드 1–4, Enter 유지</li>
            </ul>
          </div>
        </div>
      </Section>

      <p class="mt-12 border-t border-line pt-5 text-xs text-muted">
        Wordy UI · 2026.11 · 실제 화면의 토큰과 컴포넌트를 그대로 사용합니다.
      </p>
    </Layout>
  );
}

design.get('/design', (c) => {
  return c.html(<DesignPage user={c.get('user')} />);
});

export default design;
