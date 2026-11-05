import { Hono } from 'hono';
import type { Env, User } from '../types';
import { Layout } from '../components/layout';

const design = new Hono<Env>();

/**
 * /design — Wordy Design 2.0
 *
 * 두 가지 UX 제안을 합친 결과를 화면 단위로 정리한다.
 * - Duolingo 톤: 큰 터치 타겟, 둥근 모서리, 가벼운 게임감
 * - 차분한 학습 노트: 정보 최소화, 버튼 중심 평가, 과하지 않은 축하
 */

const DECISIONS = [
  {
    axis: '평가 방식',
    a: '스와이프 중심',
    b: '버튼 중심',
    choice: '버튼 기본 + 스와이프 보조',
    why: '처음 쓰는 사람도 바로 이해하고, 잘못 넘길 위험이 없습니다. 스와이프는 익숙한 사용자를 위한 단축 동작으로 둡니다.',
  },
  {
    axis: '카드 전환',
    a: '3D 플립',
    b: '즉시 교체',
    choice: '짧은 페이드 + 4px 상승',
    why: '읽는 속도를 해치지 않고 멀미를 줄입니다. 180ms면 “바뀌었다”는 느낌은 충분합니다.',
  },
  {
    axis: '게임화 강도',
    a: '매 정답 콘파티',
    b: '조용한 진행',
    choice: '세션 완료에만 가볍게',
    why: '문제를 푸는 동안의 집중을 지키고, 성취는 한 번에 모아 보여줍니다. 하트·에너지로 학습을 막지 않습니다.',
  },
  {
    axis: '정보 구조',
    a: '4탭',
    b: '3탭',
    choice: '오늘 · 단어장 · 기록',
    why: '학습 진입은 “오늘”의 CTA 하나로 충분합니다. 학습 중에는 탭을 숨겨 몰입 모드로 전환합니다.',
  },
  {
    axis: '색',
    a: '블루',
    b: '인디고 / 민트',
    choice: '딥 틸 + 앰버 + 코랄',
    why: '기존 그린의 연속성을 지키면서 더 또렷하게. 초록은 행동, 앰버는 연속 학습, 코랄은 오답에만 씁니다.',
  },
  {
    axis: '로그인',
    a: '시작 전 로그인',
    b: '게스트 시작',
    choice: '게스트로 시작, 저장할 때 로그인',
    why: '첫 3분의 이탈을 막습니다. 학습을 마친 뒤 “이 기록을 저장할까요?”가 훨씬 자연스럽습니다.',
  },
];

const PALETTE = [
  { token: 'paper', use: '페이지 배경' },
  { token: 'surface', use: '카드 · 입력' },
  { token: 'ink', use: '기본 글자' },
  { token: 'muted', use: '보조 글자' },
  { token: 'line', use: '테두리' },
  { token: 'accent', use: '행동 채움' },
  { token: 'accent-text', use: '링크 · 강조' },
  { token: 'accent-soft', use: '강조 배경' },
  { token: 'streak', use: '연속 학습' },
  { token: 'streak-soft', use: '스트릭 배경' },
  { token: 'mark', use: '연상법 · 주의' },
  { token: 'danger', use: '오답 · 삭제' },
];

const SPACING = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];

const TIMING = [
  { name: '카드 교체', value: '180ms', ease: 'cubic-bezier(.2,.7,.3,1)', note: '페이드 + 4px 상승' },
  { name: '색 · 테두리', value: '120ms', ease: 'ease', note: 'hover, focus, 선택' },
  { name: '바텀시트', value: '240ms', ease: 'ease-out', note: '아래에서 올라옴' },
  { name: '세션 완료', value: '400ms', ease: 'ease-out', note: '한 번만, 짧게' },
];

const ROADMAP = [
  { label: '4지선다 즉시 채점', state: '완료' },
  { label: '응답 시간 기반 Hard/Good/Easy', state: '완료' },
  { label: 'TTS 발음 · 미국/영국 선택', state: '완료' },
  { label: '진행률 · 취약 단어 · 오프라인', state: '완료' },
  { label: '다크 모드 토큰', state: '완료' },
  { label: '48px 4지선다 · 햅틱', state: '완료' },
  { label: '3탭 + 몰입 모드', state: '다음' },
  { label: '이어하기 상태 저장', state: '다음' },
  { label: '온보딩 5단계', state: '다음' },
  { label: '잔디 히트맵 · 마스터리 도넛', state: '다음' },
  { label: '단어 상세 바텀시트', state: '다음' },
  { label: '스와이프 보조 · 글자 크기 설정', state: '다음' },
];

const CHECKLIST = [
  ['모든 단어에 발음 TTS', true],
  ['영미 발음 선택', true],
  ['한 손 엄지존 배치', true],
  ['48px 학습 선택지', true],
  ['다크 모드', true],
  ['모션 줄이기 존중', true],
  ['오프라인 학습', true],
  ['학습 중 이탈 확인', false],
  ['글자 크기 조절', false],
  ['방해금지 모드', false],
];

const BENCHMARKS = [
  {
    app: 'Duolingo',
    take: '큰 터치 타겟, 스트릭, 세션 완료의 성취감. 단, 하트로 학습을 막는 방식은 가져오지 않습니다.',
  },
  {
    app: 'Lingvist',
    take: '카드 하나에 집중하는 미니멀한 학습 화면. 선택지와 진행률의 균형.',
  },
  {
    app: 'Quizlet',
    take: '카드 앞·뒷면의 명확한 위계, 학습 모드 전환의 단순함.',
  },
  {
    app: '말해보카 · 망고보이스',
    take: '한국어 학습 문구의 친근함, “오늘은 N개만”처럼 부담을 낮추는 카피.',
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
    <section id={props.id} class="mt-14 scroll-mt-24">
      <div class="flex items-baseline gap-3 border-b border-line pb-3">
        <span class="font-mono text-xs text-accent-text">{props.no}</span>
        <h2 class="text-xl font-semibold tracking-tight">{props.title}</h2>
        {props.desc ? (
          <p class="ml-auto hidden text-xs text-muted sm:block">{props.desc}</p>
        ) : null}
      </div>
      {props.children}
    </section>
  );
}

function Phone(props: {
  title: string;
  desc?: string;
  dark?: boolean;
  light?: boolean;
  nav?: any;
  children?: any;
}) {
  const theme = props.dark ? 'theme-dark' : props.light ? 'theme-light' : '';

  return (
    <figure class="min-w-0">
      <div
        class={`overflow-hidden rounded-2xl border border-line bg-paper text-ink shadow-float ${theme}`}
      >
        <div class="flex items-center justify-between px-5 pt-3 pb-2 text-xs text-muted">
          <span class="font-medium">9:41</span>
          <span class="flex items-center gap-1">
            <span class="h-1 w-4 rounded-full bg-line-strong"></span>
            <span class="h-1 w-3 rounded-full bg-line-strong"></span>
            <span class="h-2 w-4 rounded-sm bg-ink"></span>
          </span>
        </div>
        <div class="flex min-h-96 flex-col px-5 pb-4">
          <div class="flex-1">{props.children}</div>
          {props.nav ?? null}
        </div>
      </div>
      <figcaption class="mt-3">
        <p class="text-sm font-semibold">{props.title}</p>
        {props.desc ? <p class="mt-1 text-xs leading-5 text-muted">{props.desc}</p> : null}
      </figcaption>
    </figure>
  );
}

function MiniProgress(props: { current: number; total: number; exit?: boolean }) {
  const pct = Math.round((props.current / props.total) * 100);

  return (
    <>
      <div class="flex items-center justify-between text-xs text-muted">
        <span class="font-medium text-ink">
          {props.current} / {props.total}
        </span>
        {props.exit === false ? null : <span>나가기</span>}
      </div>
      <div class="mt-2 h-1 overflow-hidden rounded-full bg-line">
        <div class="h-1 rounded-full bg-accent" style={`width:${pct}%`}></div>
      </div>
    </>
  );
}

function MiniWord(props: { term: string; ipa: string; prompt: string }) {
  return (
    <>
      <p class="mt-8 text-center font-word text-4xl leading-tight tracking-tight">
        {props.term}
      </p>
      <p class="mt-1 text-center text-xs text-muted">{props.ipa}</p>
      <p class="mt-3 text-center text-xs text-muted">🔊 발음 듣기</p>
      <p class="mt-4 text-center text-sm text-muted">{props.prompt}</p>
    </>
  );
}

function MiniCTA(props: { children?: any; tone?: 'primary' | 'secondary' }) {
  const tones = {
    primary: 'bg-accent text-white hover:bg-accent-strong',
    secondary: 'border border-line bg-surface text-ink hover:border-accent-text',
  };

  return (
    <div
      class={`mt-4 flex min-h-12 w-full items-center justify-center rounded-xl px-4 text-sm font-medium ${
        tones[props.tone ?? 'primary']
      }`}
    >
      {props.children}
    </div>
  );
}

function MiniChoice(props: {
  index: number;
  text: string;
  state?: 'idle' | 'correct' | 'wrong';
}) {
  const tones = {
    idle: 'border-line bg-paper text-ink',
    correct: 'border-accent-text bg-accent-soft text-accent-text',
    wrong: 'border-danger bg-danger-soft text-danger',
  };

  return (
    <div
      class={`flex min-h-12 items-center gap-3 rounded-xl border px-4 text-sm ${
        tones[props.state ?? 'idle']
      }`}
    >
      <span class="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-xs text-muted">
        {props.index}
      </span>
      <span>{props.text}</span>
    </div>
  );
}

function MiniIcon(props: { name: 'today' | 'decks' | 'record' }) {
  if (props.name === 'today') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-4 w-4"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </svg>
    );
  }

  if (props.name === 'decks') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-4 w-4"
        aria-hidden="true"
      >
        <path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z" />
        <path d="m3.5 12 8.5 4.5 8.5-4.5" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M4 20v-7M9 20V6M14 20v-4M19 20V9" />
    </svg>
  );
}

function MiniTabBar(props: { active: 'today' | 'decks' | 'record' }) {
  const items = [
    { id: 'today' as const, label: '오늘' },
    { id: 'decks' as const, label: '단어장' },
    { id: 'record' as const, label: '기록' },
  ];

  return (
    <div class="mt-4 flex border-t border-line pt-2">
      {items.map((item) => (
        <span
          class={`flex flex-1 flex-col items-center gap-1 py-1 text-xs ${
            item.id === props.active ? 'font-medium text-accent-text' : 'text-muted'
          }`}
        >
          <MiniIcon name={item.id} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

const HEAT = [
  0, 1, 1, 2, 3, 2, 0,
  1, 2, 3, 4, 3, 1, 0,
  2, 3, 4, 4, 3, 2, 1,
  1, 2, 3, 4, 2, 1, 0,
];

function MiniHeatmap() {
  const levels = [
    'bg-line',
    'bg-accent/20',
    'bg-accent/40',
    'bg-accent/60',
    'bg-accent',
  ];

  return (
    <div class="mt-2 grid grid-cols-7 gap-1">
      {HEAT.map((level) => (
        <span class={`aspect-square rounded-sm ${levels[level]}`}></span>
      ))}
    </div>
  );
}

function MiniDonut(props: { pct: number }) {
  return (
    <div
      class="grid h-20 w-20 shrink-0 place-items-center rounded-full"
      style={`background:conic-gradient(var(--color-accent) ${props.pct}%, var(--color-line) 0)`}
    >
      <div class="grid h-14 w-14 place-items-center rounded-full bg-surface">
        <span class="font-word text-lg">{props.pct}%</span>
      </div>
    </div>
  );
}

function MockToday() {
  return (
    <>
      <div class="flex items-center justify-between">
        <span class="inline-flex items-center gap-1 rounded-full bg-streak-soft px-2 py-1 text-xs font-medium text-streak">
          🔥 12일
        </span>
        <span class="text-xs text-muted">설정</span>
      </div>

      <p class="mt-4 text-xs text-muted">오늘의 미션</p>
      <div class="mt-2 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <div class="flex items-baseline justify-between">
          <p class="font-word text-4xl leading-none">
            25<span class="ml-1 text-sm text-muted">장</span>
          </p>
          <span class="text-xs text-muted">약 6분</span>
        </div>

        <div class="mt-3 grid grid-cols-2 gap-2">
          <div class="rounded-xl bg-accent-soft px-3 py-2">
            <p class="text-xs text-muted">복습</p>
            <p class="mt-1 font-word text-xl text-accent-text">15</p>
          </div>
          <div class="rounded-xl bg-streak-soft px-3 py-2">
            <p class="text-xs text-muted">신규</p>
            <p class="mt-1 font-word text-xl text-streak">10</p>
          </div>
        </div>

        <MiniCTA>학습 시작</MiniCTA>
        <p class="mt-2 text-center text-xs text-muted">8 / 25 완료 · 이어서 하기</p>
      </div>

      <div class="mt-3 rounded-2xl border border-line bg-surface p-3">
        <div class="flex items-center justify-between text-xs text-muted">
          <span>이번 주</span>
          <span>5 / 7일</span>
        </div>
        <MiniHeatmap />
      </div>
    </>
  );
}

function MockIntro() {
  return (
    <>
      <MiniProgress current={3} total={20} />

      <div class="mt-6 text-center">
        <p class="text-xs text-muted">새 단어</p>
        <p class="mt-4 font-word text-4xl leading-tight tracking-tight">abandon</p>
        <p class="mt-1 text-xs text-muted">/əˈbændən/</p>
        <p class="mt-3 text-xs text-muted">🔊 발음 듣기</p>
      </div>

      <div class="mt-5 rounded-xl border border-line bg-surface p-4">
        <p class="text-xs text-muted">뜻</p>
        <p class="mt-1 text-lg">버리다, 포기하다</p>
        <p class="mt-3 text-xs text-muted">예문</p>
        <p class="mt-1 font-word text-sm leading-6">Don’t abandon your plan.</p>
        <p class="text-xs text-muted">계획을 포기하지 마세요.</p>
      </div>

      <MiniCTA>가리고 확인하기</MiniCTA>
      <p class="mt-2 text-center text-xs text-muted">Space</p>
    </>
  );
}

function MockChoice() {
  return (
    <>
      <MiniProgress current={6} total={20} />
      <MiniWord term="borrow" ipa="/ˈbɒrəʊ/" prompt="뜻을 고르세요" />

      <div class="mt-auto space-y-2 pt-4">
        <MiniChoice index={1} text="빌리다" />
        <MiniChoice index={2} text="고치다" />
        <MiniChoice index={3} text="숨기다" />
        <MiniChoice index={4} text="나누다" />
      </div>
      <p class="mt-2 text-center text-xs text-muted">1 · 2 · 3 · 4</p>
    </>
  );
}

function MockFeedback() {
  return (
    <>
      <MiniProgress current={7} total={20} />

      <div class="mt-6 text-center">
        <p class="text-sm font-medium text-danger">오답</p>
        <p class="mt-3 font-word text-3xl leading-tight tracking-tight">borrow</p>
        <p class="mt-1 text-lg">빌리다</p>
      </div>

      <div class="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
        내 답: 빌려주다
      </div>

      <div class="mt-3 rounded-xl border border-line bg-surface p-3">
        <p class="text-xs text-muted">예문</p>
        <p class="mt-1 font-word text-sm leading-6">Can I borrow your pen?</p>
        <p class="text-xs text-muted">펜 좀 빌릴 수 있을까요?</p>
      </div>

      <p class="mt-3 text-center text-xs text-muted">괜찮아요. 내일 다시 볼게요.</p>
      <MiniCTA>계속</MiniCTA>
    </>
  );
}

function MockTyping() {
  return (
    <>
      <MiniProgress current={11} total={20} />

      <p class="mt-8 text-center text-xs text-muted">뜻을 보고 영어로 쓰세요</p>
      <p class="mt-3 text-center text-2xl">빌리다</p>
      <p class="mt-2 text-center font-word text-sm text-muted">Can I ____ your pen?</p>

      <div class="mt-auto">
        <div class="rounded-xl border border-line bg-surface px-3 py-3 text-center font-word text-lg text-muted">
          borrow<span class="text-accent-text">|</span>
        </div>
        <MiniCTA>확인</MiniCTA>
      </div>
    </>
  );
}

function MockDone() {
  return (
    <div class="flex flex-col items-center py-6 text-center">
      <p class="text-xs text-muted">오늘 학습 완료</p>
      <p class="mt-2 font-word text-5xl leading-none tracking-tight">15</p>
      <p class="mt-1 text-sm text-muted">4분 · 헷갈린 단어 2개</p>

      <div class="mt-5 w-full rounded-xl border border-line bg-surface p-4 text-left">
        <div class="flex justify-between text-sm">
          <span>내일 복습</span>
          <span class="font-medium">8개</span>
        </div>
        <div class="mt-2 flex justify-between text-sm">
          <span>연속 학습</span>
          <span class="font-medium text-streak">12일</span>
        </div>
      </div>

      <div class="mt-5 w-full">
        <MiniCTA>헷갈린 단어 다시 보기</MiniCTA>
      </div>
      <p class="mt-3 text-xs text-muted">마치기</p>
    </div>
  );
}

function MockOnboarding() {
  return (
    <>
      <div class="flex gap-1">
        {[1, 2, 3, 4, 5].map((step) => (
          <span
            class={`h-1 flex-1 rounded-full ${step <= 2 ? 'bg-accent' : 'bg-line'}`}
          ></span>
        ))}
      </div>

      <p class="mt-6 text-xs text-muted">2 / 5 · 목표</p>
      <p class="mt-2 text-2xl leading-tight font-semibold tracking-tight">
        무엇을 위해
        <br />
        외우고 있나요?
      </p>
      <p class="mt-1 text-sm leading-6 text-muted">목표에 맞는 단어부터 보여드려요.</p>

      <div class="mt-4 grid grid-cols-2 gap-2">
        <div class="rounded-xl border border-accent-text bg-accent-soft px-3 py-3 text-center text-sm text-accent-text">
          토익
        </div>
        <div class="rounded-xl border border-line bg-surface px-3 py-3 text-center text-sm">
          회화
        </div>
        <div class="rounded-xl border border-line bg-surface px-3 py-3 text-center text-sm">
          수험
        </div>
        <div class="rounded-xl border border-line bg-surface px-3 py-3 text-center text-sm">
          취미
        </div>
      </div>

      <MiniCTA>계속</MiniCTA>
      <p class="mt-2 text-center text-xs text-muted">건너뛰기</p>
    </>
  );
}

function MockRecord() {
  const stats = [
    ['연속', '12일'],
    ['이번 주', '5일'],
    ['완료', '120'],
  ];

  return (
    <>
      <div class="flex items-baseline justify-between">
        <p class="text-xl font-semibold tracking-tight">기록</p>
        <span class="text-xs text-muted">11월</span>
      </div>

      <div class="mt-3 grid grid-cols-3 gap-2">
        {stats.map(([label, value]) => (
          <div class="rounded-xl border border-line bg-surface px-2 py-3 text-center">
            <p class="text-xs text-muted">{label}</p>
            <p class="mt-1 font-word text-lg">{value}</p>
          </div>
        ))}
      </div>

      <div class="mt-3 rounded-xl border border-line bg-surface p-3">
        <div class="flex items-center justify-between text-xs text-muted">
          <span>최근 4주</span>
          <span>꾸준히</span>
        </div>
        <MiniHeatmap />
      </div>

      <div class="mt-3 flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
        <MiniDonut pct={72} />
        <div class="min-w-0">
          <p class="text-sm font-medium">단어장 마스터리</p>
          <p class="mt-1 text-xs leading-5 text-muted">1,000개 중 720개를 외웠어요.</p>
        </div>
      </div>

      <div class="mt-3 rounded-xl border border-line bg-surface p-3">
        <p class="text-xs text-muted">자주 틀린 단어</p>
        <p class="mt-1 text-sm">
          <span class="font-word">borrow</span>{' '}
          <span class="text-muted">빌리다 · 4회</span>
        </p>
      </div>
    </>
  );
}

function MockDeck() {
  const rows = [
    ['borrow', '빌리다', '오늘', 'text-streak'],
    ['resilient', '회복력 있는', '3일 뒤', 'text-muted'],
    ['abandon', '버리다', '취약', 'text-danger'],
  ];

  return (
    <>
      <div class="flex items-baseline justify-between">
        <p class="text-xl font-semibold tracking-tight">단어장</p>
        <span class="text-xs text-muted">1,000</span>
      </div>

      <div class="mt-3 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted">
        검색
      </div>

      <div class="mt-2 flex gap-1 text-xs">
        <span class="rounded-full bg-accent-soft px-3 py-1 text-accent-text">전체</span>
        <span class="rounded-full border border-line px-3 py-1 text-muted">복습 예정</span>
        <span class="rounded-full border border-line px-3 py-1 text-muted">자주 틀림</span>
      </div>

      <ul class="mt-3 divide-y divide-line">
        {rows.map(([term, meaning, due, tone]) => (
          <li class="flex items-baseline justify-between gap-2 py-2">
            <span class="min-w-0">
              <span class="font-word text-base">{term}</span>
              <span class="ml-2 text-xs text-muted">{meaning}</span>
            </span>
            <span class={`shrink-0 text-xs ${tone}`}>{due}</span>
          </li>
        ))}
      </ul>

      <div class="-mx-5 -mb-4 mt-3 rounded-t-2xl border-t border-line bg-surface p-4 shadow-float">
        <div class="mx-auto h-1 w-10 rounded-full bg-line-strong"></div>
        <div class="mt-3 flex items-baseline justify-between">
          <p class="font-word text-xl">borrow</p>
          <span class="text-xs text-streak">오늘 복습</span>
        </div>
        <p class="text-sm text-muted">빌리다</p>
        <p class="mt-2 font-word text-xs leading-5">Can I borrow your pen?</p>
        <p class="mt-2 rounded-lg bg-paper px-3 py-2 text-xs text-muted">
          내 메모 · pen과 함께
        </p>
      </div>
    </>
  );
}

function MockResult() {
  return (
    <>
      <MiniProgress current={6} total={20} />

      <div class="mt-6 text-center">
        <p class="text-sm font-medium text-accent-text">정답</p>
        <p class="mt-3 font-word text-3xl leading-tight tracking-tight">borrow</p>
        <p class="mt-1 text-lg">빌리다</p>
      </div>

      <div class="mt-4 rounded-xl bg-accent-soft px-3 py-2 text-center text-sm text-accent-text">
        Can I borrow your pen?
      </div>

      <p class="mt-3 text-center text-xs text-muted">다음 복습 4일 뒤</p>
      <div class="mt-auto">
        <MiniCTA>계속</MiniCTA>
      </div>
    </>
  );
}

function DecisionCard(props: {
  axis: string;
  a: string;
  b: string;
  choice: string;
  why: string;
}) {
  return (
    <article class="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <p class="text-xs font-medium tracking-wide text-muted uppercase">{props.axis}</p>
      <p class="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted">
        <span>{props.a}</span>
        <span class="text-line-strong">vs</span>
        <span>{props.b}</span>
      </p>
      <p class="mt-2 text-sm font-semibold text-accent-text">→ {props.choice}</p>
      <p class="mt-1 text-xs leading-5 text-muted">{props.why}</p>
    </article>
  );
}

function ThumbDiagram() {
  return (
    <div class="mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-paper shadow-float">
      <div class="flex items-center justify-between px-5 pt-3 pb-2 text-xs text-muted">
        <span class="font-medium">9:41</span>
        <span class="flex items-center gap-1">
          <span class="h-1 w-4 rounded-full bg-line-strong"></span>
          <span class="h-1 w-3 rounded-full bg-line-strong"></span>
          <span class="h-2 w-4 rounded-sm bg-ink"></span>
        </span>
      </div>

      <div class="relative h-96">
        <div class="absolute inset-x-0 top-0 flex h-2/5 flex-col border-b border-dashed border-line bg-surface px-4 py-4">
          <p class="text-xs font-medium text-muted">읽기 존 · 40%</p>
          <p class="mt-2 text-sm">진행률 · 단어 · 발음</p>
          <p class="mt-1 text-xs text-muted">바뀌지 않는 정보</p>
        </div>

        <div class="absolute inset-x-0 bottom-0 flex h-3/5 flex-col bg-accent-soft px-4 py-4">
          <p class="text-xs font-medium text-accent-text">엄지 존 · 60%</p>
          <div class="mt-3 space-y-2">
            <div class="flex min-h-12 items-center justify-center rounded-xl bg-accent text-sm font-medium text-white">
              학습 시작
            </div>
            <div class="flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface text-sm">
              보조 행동
            </div>
          </div>
          <p class="mt-2 text-xs text-muted">주요 버튼은 항상 이 안에</p>
        </div>
      </div>
    </div>
  );
}

function Palette(props: { dark?: boolean }) {
  return (
    <div
      class={`rounded-2xl border border-line p-4 ${
        props.dark ? 'theme-dark bg-paper text-ink' : 'theme-light bg-surface text-ink'
      }`}
    >
      <div class="flex items-baseline justify-between">
        <p class="text-xs font-medium tracking-widest text-muted uppercase">
          {props.dark ? 'Dark' : 'Light'}
        </p>
        <span class="text-xs text-muted">{props.dark ? '시스템 다크' : '기본'}</span>
      </div>

      <div class="mt-3 grid grid-cols-2 gap-2">
        {PALETTE.map((color) => (
          <div class="rounded-xl border border-line bg-surface p-2">
            <div
              class="h-8 rounded-sm border border-line"
              style={`background:var(--color-${color.token})`}
            ></div>
            <p class="mt-2 text-xs font-medium">{color.token}</p>
            <p class="text-xs text-muted">{color.use}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DesignPage(props: { user: User | null }) {
  return (
    <Layout title="디자인 시스템" user={props.user} wide>
      <header>
        <p class="text-xs font-medium tracking-widest text-accent-text uppercase">
          Wordy Design 2.0
        </p>
        <h1 class="mt-3 font-word text-4xl leading-tight tracking-tight break-keep sm:text-5xl">
          3초에 시작하고,
          <br />
          카드 하나에 집중합니다.
        </h1>
        <p class="mt-4 max-w-2xl text-base leading-7 text-muted">
          두 제안을 그대로 섞지 않았습니다. <span class="text-ink">차분한 학습 노트</span>의
          시각 언어에 <span class="text-ink">가벼운 게임감</span>의 상호작용만 얹었습니다.
          버튼은 엄지가 닿는 곳에, 화면에는 한 번에 한 질문만 둡니다.
        </p>

        <div class="mt-5 flex flex-wrap items-center gap-2 text-xs">
          <span class="rounded-full bg-accent-soft px-2 py-1 text-accent-text">v2 제안</span>
          <span class="rounded-full bg-streak-soft px-2 py-1 text-streak">3탭 · 몰입 모드</span>
          <span class="rounded-full border border-line px-2 py-1 text-muted">다크 모드</span>
          <span class="rounded-full border border-line px-2 py-1 text-muted">48px 터치</span>
          <span class="rounded-full border border-line px-2 py-1 text-muted">2026.11</span>
        </div>
      </header>

      <nav class="mt-8 flex flex-wrap gap-2 border-y border-line py-3 text-xs">
        {[
          ['direction', '방향'],
          ['thumb', '엄지존'],
          ['ia', '구조'],
          ['screens', '화면'],
          ['onboarding', '온보딩'],
          ['motivation', '동기'],
          ['deck', '단어장'],
          ['tokens', '토큰'],
          ['motion', '모션'],
          ['components', '컴포넌트'],
          ['roadmap', '로드맵'],
        ].map(([id, label]) => (
          <a
            href={`#${id}`}
            class="rounded-full border border-line bg-surface px-3 py-2 text-muted hover:border-accent-text hover:text-accent-text"
          >
            {label}
          </a>
        ))}
      </nav>

      <Section
        id="direction"
        no="01"
        title="두 제안을 합치는 기준"
        desc="서로 충돌하는 지점은 제품 기준으로 결정"
      >
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          {DECISIONS.map((decision) => (
            <DecisionCard {...decision} />
          ))}
        </div>
        <p class="mt-3 text-xs leading-5 text-muted">
          원칙: <span class="text-ink">버튼은 명확하게, 제스처는 보조로.</span> 정답을 맞히는
          순간보다 <span class="text-ink">스스로 꺼내는 과정</span>을 방해하지 않는 쪽을
          선택합니다.
        </p>
      </Section>

      <Section
        id="thumb"
        no="02"
        title="한 손 조작 — 엄지존"
        desc="출퇴근 지하철, 한 손"
      >
        <div class="mt-5 grid items-start gap-5 sm:grid-cols-2">
          <ThumbDiagram />

          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-semibold">배치 규칙</p>
            <ul class="mt-3 space-y-2 text-sm leading-6 text-muted">
              <li class="flex gap-2">
                <span class="text-accent-text">·</span>
                <span>
                  주요 CTA와 선택지는 <span class="text-ink">화면 하단 60%</span> 안에 둡니다.
                </span>
              </li>
              <li class="flex gap-2">
                <span class="text-accent-text">·</span>
                <span>
                  학습 선택지는 최소 <span class="text-ink">48px</span>, 간격은 8px.
                </span>
              </li>
              <li class="flex gap-2">
                <span class="text-accent-text">·</span>
                <span>상단에는 진행률과 나가기만. 설정·배너·탭은 숨깁니다.</span>
              </li>
              <li class="flex gap-2">
                <span class="text-accent-text">·</span>
                <span>한 화면에 같은 무게의 주요 버튼을 두 개 두지 않습니다.</span>
              </li>
              <li class="flex gap-2">
                <span class="text-accent-text">·</span>
                <span>왼손·오른손 모두 닿도록 버튼은 중앙 정렬합니다.</span>
              </li>
            </ul>
            <p class="mt-4 rounded-xl bg-accent-soft px-3 py-2 text-xs leading-5 text-accent-text">
              “다음”은 항상 같은 자리. 사용자가 위치를 다시 찾지 않게 합니다.
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="ia"
        no="03"
        title="구조 — 3탭, 그리고 몰입 모드"
        desc="학습을 시작하면 탭이 사라짐"
      >
        <div class="mt-5 grid gap-4 sm:grid-cols-2">
          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div class="flex items-baseline justify-between">
              <p class="text-sm font-semibold">일반 모드 · 3탭</p>
              <span class="rounded-full bg-accent-soft px-2 py-1 text-xs text-accent-text">
                제안
              </span>
            </div>
            <p class="mt-1 text-xs leading-5 text-muted">
              현재 4탭(홈·학습·단어장·통계)에서 학습 탭을 “오늘”의 CTA로 흡수합니다.
            </p>
            <div class="mt-4 rounded-2xl border border-line bg-paper px-3 py-2">
              <MiniTabBar active="today" />
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>현재</span>
              <span class="line-through">홈 · 학습 · 단어장 · 통계</span>
            </div>
            <p class="mt-3 text-sm">
              <span class="font-medium">오늘</span> · 오늘 할 양과 시작 버튼
            </p>
            <p class="mt-1 text-sm">
              <span class="font-medium">단어장</span> · 검색·필터·단어 상세
            </p>
            <p class="mt-1 text-sm">
              <span class="font-medium">기록</span> · 스트릭·히트맵·자주 틀린 단어
            </p>
          </div>

          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-semibold">몰입 모드 · 학습 중</p>
            <p class="mt-1 text-xs leading-5 text-muted">
              학습을 시작하면 하단 탭과 푸터를 숨깁니다. 상단에는 진행률과 나가기만 남깁니다.
            </p>
            <div class="mt-4 rounded-2xl border border-line bg-paper p-4">
              <MiniProgress current={6} total={20} />
              <p class="mt-4 text-center font-word text-3xl tracking-tight">borrow</p>
              <p class="mt-1 text-center text-xs text-muted">/ˈbɒrəʊ/</p>
              <p class="mt-3 text-center text-xs text-muted">몰입 모드에서는 탭이 보이지 않습니다.</p>
            </div>
            <div class="mt-3 grid gap-2 text-xs leading-5 text-muted">
              <p class="rounded-xl border border-line bg-paper px-3 py-2">
                <span class="font-medium text-ink">이어하기</span> · 마지막 카드와 응답을 저장해
                재진입 시 그 자리에서 재개
              </p>
              <p class="rounded-xl border border-line bg-paper px-3 py-2">
                <span class="font-medium text-ink">나가기</span> · “진행 상황은 저장돼요” 확인 후
                오늘로 복귀
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section
        id="screens"
        no="04"
        title="핵심 화면"
        desc="한 화면에 한 질문"
      >
        <div class="mt-5 grid gap-5 sm:grid-cols-2">
          <Phone
            title="오늘"
            desc="앱을 열면 1탭으로 학습 시작. 복습·신규를 한 카드에 묶고, 이번 주 기록을 아래에 둡니다."
            nav={<MiniTabBar active="today" />}
          >
            <MockToday />
          </Phone>

          <Phone
            title="새 단어 소개"
            desc="처음 보는 단어만 뜻과 예문을 먼저 보여줍니다. 확인 후 바로 4지선다로 넘어갑니다."
          >
            <MockIntro />
          </Phone>

          <Phone
            title="4지선다 복습"
            desc="기본은 버튼. 선택 즉시 채점하고, 정답·오답 모두 다음 복습일을 함께 보여줍니다."
          >
            <MockChoice />
          </Phone>

          <Phone
            title="오답 피드백"
            desc="바로 넘기지 않습니다. 내 답 → 정답 → 예문을 읽을 시간을 주고, 부담 없는 문구를 씁니다."
          >
            <MockFeedback />
          </Phone>

          <Phone
            title="철자 입력"
            desc="한→영·빈칸·듣기는 입력으로 채점합니다. 입력창은 항상 화면 하단, 키보드 바로 위에."
          >
            <MockTyping />
          </Phone>

          <Phone
            title="완료"
            desc="정답률보다 “무엇을 다시 보면 되는지”를 먼저 보여줍니다. 축하는 이 순간에만 가볍게."
          >
            <MockDone />
          </Phone>
        </div>

        <div class="mt-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <p class="text-sm font-semibold">카드 해부</p>
          <div class="mt-3 grid gap-2 text-xs leading-5 text-muted sm:grid-cols-2">
            <p class="rounded-xl border border-line bg-paper px-3 py-2">
              <span class="font-medium text-ink">① 진행률 + 나가기</span> · 상단 고정, 학습 중
              유일한 메타 정보
            </p>
            <p class="rounded-xl border border-line bg-paper px-3 py-2">
              <span class="font-medium text-ink">② 단어 + 발음</span> · 가장 큰 요소, TTS는 항상
              같은 위치
            </p>
            <p class="rounded-xl border border-line bg-paper px-3 py-2">
              <span class="font-medium text-ink">③ 질문</span> · 한 문장. “뜻을 고르세요”처럼
              행동을 지시
            </p>
            <p class="rounded-xl border border-line bg-paper px-3 py-2">
              <span class="font-medium text-ink">④ 선택지</span> · 4개, 48px, 번호 + 텍스트
            </p>
            <p class="rounded-xl border border-line bg-paper px-3 py-2">
              <span class="font-medium text-ink">⑤ 피드백</span> · 정답/오답 + 다음 복습일
            </p>
            <p class="rounded-xl border border-line bg-paper px-3 py-2">
              <span class="font-medium text-ink">⑥ 다음 행동</span> · 하단 전체 너비 CTA
            </p>
          </div>
          <p class="mt-3 text-xs leading-5 text-muted">
            스와이프는 보조 동작입니다. 카드를 오른쪽으로 96px 이상 끌면 “알아요”, 왼쪽은
            “모름”. 30% 이내에서 놓으면 제자리로 돌아옵니다.
          </p>
        </div>
      </Section>

      <Section
        id="onboarding"
        no="05"
        title="온보딩 — 첫 3분"
        desc="로그인보다 첫 카드가 먼저"
      >
        <div class="mt-5 grid items-start gap-5 sm:grid-cols-2">
          <Phone
            title="목표 선택"
            desc="5단계 중 2단계. 모든 단계는 건너뛸 수 있고, 목표는 나중에 바꿀 수 있습니다."
          >
            <MockOnboarding />
          </Phone>

          <div class="space-y-2">
            {[
              ['01', '바로 시작', '로그인 없이 첫 카드부터. 계정은 학습 기록을 저장할 때만 요청합니다.'],
              ['02', '목표', '토익 · 회화 · 수험 · 취미 중 하나. 홈의 추천 단어 순서에만 사용합니다.'],
              ['03', '레벨 테스트', '10문제, 30초. 정답률로 신규 단어 난이도를 조정합니다.'],
              ['04', '하루 목표', '10 / 20 / 30 / 50개 중 선택. 언제든 설정에서 변경합니다.'],
              ['05', '첫 학습', '빈 홈을 보여주지 않고, 바로 첫 카드로 이동합니다.'],
            ].map(([no, title, body]) => (
              <div class="flex gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
                <span class="font-mono text-xs text-accent-text">{no}</span>
                <div>
                  <p class="text-sm font-medium">{title}</p>
                  <p class="mt-1 text-xs leading-5 text-muted">{body}</p>
                </div>
              </div>
            ))}
            <p class="rounded-xl bg-accent-soft px-4 py-3 text-xs leading-5 text-accent-text">
              첫 세션을 마친 뒤: “이 기록을 저장할까요?” → Google 로그인. 그 전에는 아무것도
              요구하지 않습니다.
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="motivation"
        no="06"
        title="동기부여 — 세게 밀지 않기"
        desc="스트릭은 초대장, 감옥이 아님"
      >
        <div class="mt-5 grid items-start gap-5 sm:grid-cols-2">
          <Phone
            title="기록"
            desc="잔디 히트맵과 마스터리 도넛. 정확한 기억 유지율보다 “이번 달에 얼마나 했는지”를 보여줍니다."
            nav={<MiniTabBar active="record" />}
          >
            <MockRecord />
          </Phone>

          <div class="space-y-2">
            <div class="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <p class="text-sm font-semibold">쓰는 것</p>
              <ul class="mt-2 space-y-1 text-sm leading-6 text-muted">
                <li>· 연속 학습일, 주간 목표, 이번 달 히트맵</li>
                <li>· “오늘은 15개만”처럼 적정량을 제안하는 카피</li>
                <li>· 세션 완료 시 한 번의 가벼운 축하</li>
                <li>· 망각 곡선에 맞춘 복습 알림</li>
              </ul>
            </div>
            <div class="rounded-2xl border border-danger/30 bg-danger-soft p-4">
              <p class="text-sm font-semibold text-danger">쓰지 않는 것</p>
              <ul class="mt-2 space-y-1 text-sm leading-6 text-danger">
                <li>· 하트·에너지로 학습을 막는 장치</li>
                <li>· 하루 놓쳤다고 전체 기록을 잃는 설계</li>
                <li>· 문제마다 콘파티·팝업</li>
                <li>· “복습 84개”처럼 부담을 키우는 숫자</li>
              </ul>
            </div>
            <div class="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <p class="text-sm font-semibold">카피 예시</p>
              <div class="mt-2 space-y-2 text-xs leading-5">
                <p class="rounded-xl bg-paper px-3 py-2 text-muted line-through">
                  복습 84개가 밀렸어요
                </p>
                <p class="rounded-xl bg-accent-soft px-3 py-2 text-accent-text">
                  오늘은 15개만 학습해요. 나머지는 내일 이어서.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section
        id="deck"
        no="07"
        title="단어장 — 학습 흐름을 끊지 않기"
        desc="상세는 바텀시트로"
      >
        <div class="mt-5 grid items-start gap-5 sm:grid-cols-2">
          <Phone
            title="검색 · 필터 · 바텀시트"
            desc="단어를 누르면 새 화면이 아니라 바텀시트가 올라옵니다. 뜻·예문·메모·다음 복습일만 보여줍니다."
          >
            <MockDeck />
          </Phone>

          <div class="space-y-2">
            <div class="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <p class="text-sm font-semibold">필터는 4개면 충분</p>
              <div class="mt-3 flex flex-wrap gap-1 text-xs">
                <span class="rounded-full bg-accent-soft px-3 py-1 text-accent-text">전체</span>
                <span class="rounded-full border border-line px-3 py-1 text-muted">복습 예정</span>
                <span class="rounded-full border border-line px-3 py-1 text-muted">자주 틀림</span>
                <span class="rounded-full border border-line px-3 py-1 text-muted">보관함</span>
              </div>
            </div>

            <div class="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <p class="text-sm font-semibold">상태 색</p>
              <div class="mt-3 space-y-2 text-sm">
                <p class="flex items-center gap-2">
                  <span class="h-2 w-2 rounded-full bg-accent"></span>외운 단어 · 복습 간격이 긴
                  카드
                </p>
                <p class="flex items-center gap-2">
                  <span class="h-2 w-2 rounded-full bg-streak"></span>오늘 복습 · 기한 도래
                </p>
                <p class="flex items-center gap-2">
                  <span class="h-2 w-2 rounded-full bg-line-strong"></span>미학습 · 아직 큐에 없음
                </p>
                <p class="flex items-center gap-2">
                  <span class="h-2 w-2 rounded-full bg-danger"></span>취약 · 자주 틀림
                </p>
              </div>
            </div>

            <p class="rounded-xl bg-accent-soft px-4 py-3 text-xs leading-5 text-accent-text">
              상세 화면에서 학습을 시작하더라도, 닫으면 원래 목록 위치로 돌아옵니다. 탐색과
              학습을 한 흐름 안에 둡니다.
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="tokens"
        no="08"
        title="색 · 글자 · 다크 모드"
        desc="토큰 하나로 테마가 바뀜"
      >
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <Palette />
          <Palette dark />
        </div>

        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-semibold">색의 역할</p>
            <ul class="mt-2 space-y-1 text-sm leading-6 text-muted">
              <li>· <span class="text-ink">accent</span> — 지금 눌러야 할 행동의 채움</li>
              <li>· <span class="text-accent-text">accent-text</span> — 링크·선택·강조 글자</li>
              <li>· <span class="text-streak">streak</span> — 연속 학습, 에너지</li>
              <li>· <span class="text-danger">danger</span> — 오답·삭제</li>
              <li>· 나머지는 종이·먹색·회색으로 해결</li>
            </ul>
            <p class="mt-3 text-xs leading-5 text-muted">
              채움과 글자를 분리한 이유: 다크 모드에서 초록 버튼 위의 흰 글자와, 어두운
              배경 위의 링크 글자가 동시에 읽혀야 하기 때문입니다.
            </p>
          </div>

          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-semibold">글자</p>
            <div class="mt-3 space-y-2">
              <div class="flex items-baseline justify-between gap-2">
                <span class="font-word text-3xl">remember</span>
                <span class="font-mono text-xs text-muted">text-3xl · 단어</span>
              </div>
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-xl">버리다, 포기하다</span>
                <span class="font-mono text-xs text-muted">text-xl · 뜻</span>
              </div>
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-sm">뜻을 고르세요</span>
                <span class="font-mono text-xs text-muted">text-sm · 질문</span>
              </div>
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-xs text-muted">3 / 20</span>
                <span class="font-mono text-xs text-muted">text-xs · 메타</span>
              </div>
            </div>
            <p class="mt-3 text-xs leading-5 text-muted">
              영단어는 화면에서 가장 크게, serif로 존재감을 만듭니다. UI와 한국어는
              Pretendard. Inter/SF Pro 전환은 A/B 후보로 남깁니다.
            </p>
          </div>
        </div>

        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-semibold">간격 · 라운드</p>
            <div class="mt-3 space-y-2">
              {SPACING.slice(0, 8).map((n) => (
                <div class="flex items-center gap-3">
                  <span class="w-12 shrink-0 font-mono text-xs text-muted">p-{n}</span>
                  <span class="h-2 rounded-full bg-accent" style={`width:${n * 8}px`}></span>
                  <span class="text-xs text-muted">{n * 4}px</span>
                </div>
              ))}
            </div>
            <div class="mt-4 flex flex-wrap gap-2">
              <span class="rounded-lg border border-line bg-paper px-3 py-2 text-xs">14px 카드</span>
              <span class="rounded-xl border border-line bg-paper px-3 py-2 text-xs">16px 컨트롤</span>
              <span class="rounded-full border border-line bg-paper px-3 py-2 text-xs">full 칩</span>
            </div>
          </div>

          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-semibold">다크 모드</p>
            <p class="mt-1 text-xs leading-5 text-muted">
              시스템 설정을 따릅니다. 별도 토글 없이도 모든 화면이 같은 토큰으로 전환됩니다.
            </p>
            <div class="mt-3 rounded-xl bg-paper p-3">
              <p class="font-mono text-xs leading-5 text-muted">
                @media (prefers-color-scheme: dark) {'{'}
                <br />
                &nbsp;&nbsp;:root {'{'} --color-paper: #0e1412; ... {'}'}
                <br />
                {'}'}
              </p>
            </div>
            <p class="mt-3 text-xs leading-5 text-muted">
              이 화면의 다크 팔레트는 실제 토큰을 <span class="text-ink">.theme-dark</span>로
              강제해 미리 본 것입니다.
            </p>
          </div>
        </div>

        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <Phone
            title="라이트 모드"
            desc="낮에는 밝은 종이. 카드와 선택지의 경계는 테두리와 얕은 그림자로만 만듭니다."
            light
          >
            <MockResult />
          </Phone>
          <Phone
            title="다크 모드"
            desc="밤에는 어두운 표면. 강조색은 밝은 민트, 버튼 채움은 딥 틸로 유지해 흰 글자를 지킵니다."
            dark
          >
            <MockResult />
          </Phone>
        </div>
      </Section>

      <Section
        id="motion"
        no="09"
        title="모션 · 햅틱"
        desc="빠르고, 줄일 수 있게"
      >
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <div class="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <div class="grid grid-cols-4 gap-2 border-b border-line px-4 py-2 text-xs text-muted">
              <span>동작</span>
              <span>시간</span>
              <span>이징</span>
              <span>메모</span>
            </div>
            {TIMING.map((row) => (
              <div class="grid grid-cols-4 gap-2 border-b border-line px-4 py-3 text-xs last:border-b-0">
                <span class="font-medium">{row.name}</span>
                <span class="font-mono text-muted">{row.value}</span>
                <span class="font-mono text-muted">{row.ease}</span>
                <span class="text-muted">{row.note}</span>
              </div>
            ))}
          </div>

          <div class="space-y-2">
            <div class="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <p class="text-sm font-semibold">햅틱</p>
              <p class="mt-1 text-xs leading-5 text-muted">
                선택지·평점·다음 버튼에 10ms 진동. Android는 Vibration API, iOS Safari는
                미지원이므로 없어도 학습이 완결되어야 합니다.
              </p>
            </div>
            <div class="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <p class="text-sm font-semibold">스와이프는 보조</p>
              <p class="mt-1 text-xs leading-5 text-muted">
                오른쪽 = 알아요, 왼쪽 = 모름. 96px 이상 끌면 확정, 30% 이내에서 놓으면 취소.
                버튼과 같은 결과를 냅니다.
              </p>
            </div>
            <div class="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <p class="text-sm font-semibold">축하는 한 번</p>
              <p class="mt-1 text-xs leading-5 text-muted">
                정답마다 이펙트를 띄우지 않습니다. 세션 완료 화면에서만 가볍게. 모션 줄이기
                설정이면 애니메이션을 모두 끕니다.
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section
        id="components"
        no="10"
        title="컴포넌트"
        desc="12–16px 라운드, 48px 학습 선택지"
      >
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-semibold">버튼</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <span class="inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-white">
                학습 시작
              </span>
              <span class="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface px-4 text-sm">
                뜻 보기
              </span>
              <span class="inline-flex min-h-12 items-center justify-center rounded-full border border-accent-text/40 bg-accent-soft px-4 text-sm text-accent-text">
                🔊 발음
              </span>
              <span class="text-sm text-muted">삭제</span>
            </div>
            <p class="mt-3 text-xs leading-5 text-muted">
              주요 행동은 하나. 보조 행동은 테두리, 파괴 행동은 텍스트 + danger.
            </p>
          </div>

          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-semibold">선택지</p>
            <div class="mt-3 space-y-2">
              <MiniChoice index={1} text="빌리다" state="correct" />
              <MiniChoice index={2} text="고치다" />
              <MiniChoice index={3} text="숨기다" state="wrong" />
            </div>
          </div>

          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-semibold">진행 · 배지</p>
            <div class="mt-3 flex items-baseline justify-between text-xs text-muted">
              <span>6장 완료</span>
              <span>14장 남음</span>
            </div>
            <div class="mt-2 h-1 overflow-hidden rounded-full bg-line">
              <div class="h-1 rounded-full bg-accent" style="width:30%"></div>
            </div>
            <div class="mt-3 flex flex-wrap gap-2 text-xs">
              <span class="rounded-full bg-accent-soft px-2 py-1 text-accent-text">정답</span>
              <span class="rounded-full bg-danger-soft px-2 py-1 text-danger">오답</span>
              <span class="rounded-full bg-streak-soft px-2 py-1 text-streak">🔥 12일</span>
              <span class="rounded-full border border-line px-2 py-1 text-muted">B2</span>
            </div>
          </div>

          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-semibold">안내</p>
            <div class="mt-3 space-y-2 text-sm">
              <p class="rounded-xl border border-accent-text/30 bg-accent-soft px-3 py-2 text-accent-text">
                저장했습니다.
              </p>
              <p class="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
                내 답: 빌려주다
              </p>
              <p class="rounded-xl border border-mark/50 bg-mark-soft px-3 py-2 text-xs leading-5">
                연상법은 이렇게 적어두면 다음 복습에 함께 나옵니다.
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section
        id="roadmap"
        no="11"
        title="로드맵 · 체크리스트"
        desc="학습 시작까지의 속도가 1순위"
      >
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p class="text-sm font-semibold">지금 · 다음</p>
            <ul class="mt-3 divide-y divide-line">
              {ROADMAP.map((item) => (
                <li class="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{item.label}</span>
                  <span
                    class={`shrink-0 rounded-full px-2 py-1 text-xs ${
                      item.state === '완료'
                        ? 'bg-accent-soft text-accent-text'
                        : 'border border-line text-muted'
                    }`}
                  >
                    {item.state}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div class="space-y-2">
            <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
              <p class="text-sm font-semibold">MVP 우선순위</p>
              <ol class="mt-3 space-y-2 text-sm leading-6">
                <li><span class="font-mono text-xs text-accent-text">1</span> 카드 + 4지선다 + TTS + 햅틱</li>
                <li><span class="font-mono text-xs text-accent-text">2</span> 오늘 화면 + 진행률 + 이어하기</li>
                <li><span class="font-mono text-xs text-accent-text">3</span> 완료 화면 + 헷갈린 단어</li>
                <li><span class="font-mono text-xs text-accent-text">4</span> 스트릭 + 히트맵</li>
                <li><span class="font-mono text-xs text-accent-text">5</span> 온보딩 · 다크 모드 · 접근성</li>
              </ol>
            </div>

            <div class="rounded-2xl border border-line bg-surface p-5 shadow-card">
              <p class="text-sm font-semibold">체크리스트</p>
              <ul class="mt-3 grid gap-1 text-xs leading-5 text-muted sm:grid-cols-2">
                {CHECKLIST.map(([label, done]) => (
                  <li class="flex items-center gap-2">
                    <span class={done ? 'text-accent-text' : 'text-line-strong'}>
                      {done ? '☑' : '☐'}
                    </span>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div class="mt-3 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div class="border-b border-line px-4 py-2 text-xs text-muted">벤치마크</div>
          {BENCHMARKS.map((row) => (
            <div class="grid gap-1 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-4 sm:gap-3">
              <p class="text-sm font-medium">{row.app}</p>
              <p class="text-xs leading-5 text-muted sm:col-span-3">{row.take}</p>
            </div>
          ))}
        </div>

        <div class="mt-3 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <p class="text-sm font-semibold">실제 화면에 먼저 반영한 것</p>
          <ul class="mt-3 grid gap-2 text-xs leading-5 text-muted sm:grid-cols-2">
            <li>· 딥 틸 · 앰버 · 코랄 팔레트로 토큰 교체</li>
            <li>· 카드 14px / 컨트롤 16px 라운드</li>
            <li>· 시스템 다크 모드 (색 변수만 전환)</li>
            <li>· 학습 카드 교체 시 180ms 페이드 + 상승</li>
            <li>· 선택지·다음 버튼 10ms 햅틱 (지원 기기)</li>
            <li>· 4지선다 선택지 48px · 키보드 1–4 유지</li>
          </ul>
        </div>
      </Section>

      <p class="mt-14 border-t border-line pt-5 text-xs text-muted">
        Wordy Design 2.0 · 2026.11 · 두 제안을 제품 기준으로 합친 참조 화면 ·{' '}
        <a href="/" class="text-accent-text hover:underline">
          오늘로 돌아가기
        </a>
      </p>
    </Layout>
  );
}

design.get('/design', (c) => {
  return c.html(<DesignPage user={c.get('user')} />);
});

export default design;
