import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout } from '../components/layout';

const legal = new Hono<Env>();

/** 운영자 정보. 바꿀 때는 여기만 수정한다. */
const SITE = {
  name: 'Wordy',
  url: 'https://english-learning.choidaruhan.workers.dev',
  email: 'chl11wq12@gmail.com',
  effectiveDate: '2026년 11월 4일',
};

legal.get('/privacy', (c) => {
  return c.html(
    <Layout title="개인정보처리방침" user={c.get('user')}>
      <h1 class="text-xl font-semibold">개인정보처리방침</h1>
      <p class="mt-2 text-sm text-muted">
        {SITE.name} · 시행일 {SITE.effectiveDate}
      </p>

      <p class="mt-6 text-[15px] leading-7">
        {SITE.name}(이하 "서비스")는 이용자의 개인정보를 최소한으로 수집하고, 수집한 정보를
        학습 기능 제공 목적으로만 사용합니다. 광고·마케팅 목적의 판매나 공유는 하지 않습니다.
      </p>

      <Section title="1. 수집하는 개인정보">
        <ul class="list-disc space-y-1 pl-5">
          <li>필수: Google 계정 이메일, 프로필 이름(Google이 제공하는 경우)</li>
          <li>
            학습 과정에서 생성: 단어장, 카드 학습 상태, 복습 일정, 평점 기록, 퀴즈 응답, 학습 통계
          </li>
          <li>설정값: 하루 신규 단어 수, 하루 복습 상한, 표시 이름</li>
          <li>
            수집하지 않는 정보: 비밀번호, 전화번호, 위치 정보, 주민등록번호, 결제 정보
          </li>
        </ul>
      </Section>

      <Section title="2. 수집 방법">
        <ul class="list-disc space-y-1 pl-5">
          <li>Google OAuth 로그인 시 Google로부터 이메일과 프로필 이름을 제공받습니다.</li>
          <li>서비스를 이용하는 과정에서 학습 기록이 자동으로 생성됩니다.</li>
        </ul>
      </Section>

      <Section title="3. 이용 목적">
        <ul class="list-disc space-y-1 pl-5">
          <li>학습 진도 저장 및 기기 간 동기화</li>
          <li>간격 반복(FSRS) 알고리즘에 따른 복습 일정 계산</li>
          <li>학습 통계 제공</li>
          <li>서비스 운영, 오류 확인 및 대응</li>
        </ul>
        <p class="mt-3">
          Google 계정 정보는 <strong>인증 목적으로만</strong> 사용합니다. 연락처·캘린더 등 다른
          Google 데이터에 접근하지 않습니다.
        </p>
      </Section>

      <Section title="4. 보유 기간 및 파기">
        <p>
          개인정보는 회원 탈퇴(삭제 요청) 시까지 보유하며, 요청을 받으면 지체 없이
          데이터베이스에서 삭제합니다. 별도로 보존해야 하는 법령상 의무는 현재 없습니다.
        </p>
      </Section>

      <Section title="5. 제3자 제공">
        <p>
          원칙적으로 개인정보를 제3자에게 제공하지 않습니다. 법령에 따른 요청이 있는 경우를
          제외하고, 광고주나 데이터 브로커에 판매하지 않습니다.
        </p>
      </Section>

      <Section title="6. 처리 위탁 및 국외 이전">
        <p>서비스 운영을 위해 다음 업체에 처리를 위탁하며, 데이터가 국외에 저장됩니다.</p>
        <ul class="mt-2 list-disc space-y-1 pl-5">
          <li>
            Cloudflare, Inc. (미국) — 웹 호스팅 및 데이터베이스(D1). 이전 항목: 이메일, 학습 기록.
            보유 기간: 서비스 이용 기간
          </li>
          <li>
            Google LLC (미국) — OAuth 인증. 이전 항목: 인증 시점의 계정 식별자
          </li>
        </ul>
      </Section>

      <Section title="7. 쿠키">
        <p>
          로그인 유지를 위한 세션 쿠키 1개를 사용합니다(HttpOnly, SameSite=Lax). 광고·추적
          목적의 쿠키나 제3자 분석 도구는 사용하지 않습니다.
        </p>
      </Section>

      <Section title="8. 이용자의 권리">
        <p>
          언제든지 자신의 개인정보에 대한 열람, 정정, 삭제, 처리 정지를 요청할 수 있습니다.
          단어장은 서비스 내 "내보내기" 기능으로 CSV 형태로 직접 받을 수 있습니다. 계정 삭제는
          아래 이메일로 요청해 주세요.
        </p>
      </Section>

      <Section title="9. 개인정보 보호책임자">
        <p>
          이메일: <a href={`mailto:${SITE.email}`} class="text-accent hover:underline">{SITE.email}</a>
        </p>
      </Section>

      <Section title="10. 방침의 변경">
        <p>
          내용이 바뀌면 시행 7일 전에 서비스 내 공지로 알립니다. 중요한 변경이 있는 경우
          더 이른 시점에 안내할 수 있습니다.
        </p>
      </Section>

      <p class="mt-10 border-t border-line pt-5 text-sm text-muted">
        시행일: {SITE.effectiveDate}
      </p>
    </Layout>
  );
});

legal.get('/terms', (c) => {
  return c.html(
    <Layout title="이용약관" user={c.get('user')}>
      <h1 class="text-xl font-semibold">이용약관</h1>
      <p class="mt-2 text-sm text-muted">
        {SITE.name} · 시행일 {SITE.effectiveDate}
      </p>

      <Section title="1. 목적">
        <p>
          이 약관은 {SITE.name}(이하 "서비스")의 이용 조건과 절차, 이용자와 운영자의 권리·의무를
          정합니다.
        </p>
      </Section>

      <Section title="2. 서비스의 내용">
        <p>
          서비스는 영어 단어 학습을 위한 웹 애플리케이션으로, 간격 반복 복습, 단어장 관리,
          학습 통계, 퀴즈 기능을 무료로 제공합니다. 서비스는 별도의 유료 결제나 광고를 포함하지
          않습니다.
        </p>
      </Section>

      <Section title="3. 계정">
        <ul class="list-disc space-y-1 pl-5">
          <li>이용은 Google 계정 로그인으로 시작됩니다.</li>
          <li>계정 접근 권한 관리 책임은 이용자에게 있습니다.</li>
          <li>타인의 계정을 사용하거나 계정을 양도할 수 없습니다.</li>
        </ul>
      </Section>

      <Section title="4. 금지 행위">
        <ul class="list-disc space-y-1 pl-5">
          <li>자동화된 수단으로 과도한 요청을 보내 서비스 운영을 방해하는 행위</li>
          <li>서비스를 역설계하거나 무단으로 복제·배포하는 행위</li>
          <li>타인의 개인정보에 접근하려는 행위</li>
          <li>관련 법령을 위반하는 행위</li>
        </ul>
      </Section>

      <Section title="5. 지식재산권">
        <p>
          서비스의 코드와 디자인, 기본 단어 콘텐츠는 운영자에게 권리가 있습니다. 이용자가 직접
          입력한 단어와 학습 기록은 이용자에게 있으며, 언제든지 CSV로 내려받을 수 있습니다.
        </p>
      </Section>

      <Section title="6. 서비스의 변경 및 중단">
        <p>
          서비스는 개인 프로젝트로 운영되며, 사정에 따라 기능이 바뀌거나 사전 예고 없이 중단될
          수 있습니다. 중단 시 이용자는 데이터를 CSV로 내려받아 보관할 수 있습니다.
        </p>
      </Section>

      <Section title="7. 보증의 부재">
        <p>
          서비스는 학습 도구로 제공되며, 특정한 학습 성과나 시험 결과를 보장하지 않습니다.
          학습 효과는 이용자의 사용 방식에 따라 달라집니다.
        </p>
      </Section>

      <Section title="8. 책임의 제한">
        <p>
          운영자는 서비스 이용 중 발생한 데이터 손실, 학습 중단 등에 대해 고의 또는 중대한
          과실이 없는 한 책임을 지지 않습니다. 다만 관련 법령이 정한 책임은 배제되지 않습니다.
        </p>
      </Section>

      <Section title="9. 준거법 및 분쟁">
        <p>
          이 약관은 대한민국 법령에 따르며, 분쟁이 발생하면 상호 협의로 해결합니다.
        </p>
      </Section>

      <Section title="10. 문의">
        <p>
          이메일: <a href={`mailto:${SITE.email}`} class="text-accent hover:underline">{SITE.email}</a>
        </p>
      </Section>

      <p class="mt-10 border-t border-line pt-5 text-sm text-muted">
        시행일: {SITE.effectiveDate}
      </p>
    </Layout>
  );
});

function Section(props: { title: string; children?: any }) {
  return (
    <section class="mt-8">
      <h2 class="text-sm font-semibold">{props.title}</h2>
      <div class="mt-2 text-[15px] leading-7">{props.children}</div>
    </section>
  );
}

export default legal;
