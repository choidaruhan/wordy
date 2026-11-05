import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const bundleDir = mkdtempSync(join(tmpdir(), 'wordy-m8-policy-'));
buildSync({
  entryPoints: ['src/lib/learning-policy.ts'],
  outdir: bundleDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});

const { buildSessionPlan, backlogDaysToClear, computeBacklogWarning } = await import(
  pathToFileURL(join(bundleDir, 'learning-policy.js')).href
);

test.after(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});

function input(overrides = {}) {
  return {
    mode: 'session',
    kind: 'quick',
    sessionSize: 5,
    newPerSession: 2,
    dailyNew: 10,
    dailyReview: 200,
    newCardMode: 'auto',
    dueCount: 0,
    dueByType: {},
    newCount: 0,
    weakDueCount: 0,
    deckNewCount: 0,
    todayDone: 0,
    todayNewDone: 0,
    todayReviewDone: 0,
    overdue: 0,
    throughput7: 10,
    adherence7: 1,
    dailyPlan: null,
    ...overrides,
  };
}

function assertPlan(plan, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(plan[key], value, `${key}: ${plan[key]} !== ${value}`);
  }
  assert.equal(
    plan.targetSize,
    plan.reviewTarget + plan.newTarget + plan.weakTarget,
    'targetSize must equal the sum of buckets'
  );
}

test('session quick: 복습이 가득 차면 신규를 넣지 않는다', () => {
  const plan = buildSessionPlan(input({ dueCount: 10, newCount: 5 }));
  assertPlan(plan, {
    targetSize: 5,
    reviewTarget: 5,
    newTarget: 0,
    weakTarget: 0,
    reason: 'session',
    dailyPlanUsed: false,
  });
});

test('session quick: 복습이 적으면 남은 자리에 신규를 섞는다', () => {
  const plan = buildSessionPlan(input({ dueCount: 2, newCount: 5 }));
  assertPlan(plan, {
    targetSize: 4,
    reviewTarget: 2,
    newTarget: 2,
  });
});

test('session quick: 복습이 없으면 신규로 채운다', () => {
  const plan = buildSessionPlan(input({ dueCount: 0, newCount: 5 }));
  assertPlan(plan, {
    targetSize: 2,
    reviewTarget: 0,
    newTarget: 2,
  });
});

test('session quick: 카드가 없으면 목표가 0이다', () => {
  const plan = buildSessionPlan(input({ dueCount: 0, newCount: 0 }));
  assert.equal(plan.targetSize, 0);
});

test('session typing: recall + cloze 를 함께 낸다', () => {
  const plan = buildSessionPlan(
    input({ kind: 'typing', dueByType: { recall: 3, cloze: 2 } })
  );
  assertPlan(plan, {
    targetSize: 5,
    reviewTarget: 5,
    newTarget: 0,
  });
});

test('session cloze/listening: 해당 유형만 낸다', () => {
  const cloze = buildSessionPlan(
    input({ kind: 'cloze', dueByType: { cloze: 3, recognition: 10 } })
  );
  assertPlan(cloze, { targetSize: 3, reviewTarget: 3 });

  const listening = buildSessionPlan(
    input({ kind: 'listening', dueByType: { listening: 4 } })
  );
  assertPlan(listening, { targetSize: 4, reviewTarget: 4 });
});

test('session weak: 취약 버킷만 사용한다', () => {
  const plan = buildSessionPlan(input({ kind: 'weak', weakDueCount: 7 }));
  assertPlan(plan, {
    targetSize: 5,
    reviewTarget: 0,
    newTarget: 0,
    weakTarget: 5,
  });
});

test('session custom: 지정 단어장의 새 단어만 낸다', () => {
  const plan = buildSessionPlan(input({ kind: 'custom', deckNewCount: 3 }));
  assertPlan(plan, {
    targetSize: 3,
    reviewTarget: 0,
    newTarget: 3,
  });
});

test('session: 세션 크기와 신규 수는 안전 범위로 보정된다', () => {
  const fallback = buildSessionPlan(
    input({ dueCount: 10, sessionSize: 0, newCount: 10 })
  );
  assert.equal(fallback.reviewTarget, 5);

  const capped = buildSessionPlan(
    input({
      dueCount: 0,
      newCount: 20,
      sessionSize: 20,
      newPerSession: 99,
    })
  );
  assert.equal(capped.newTarget, 10);
  assert.equal(capped.targetSize, 10);
});

test('daily: 남은 목표 안에서만 세션을 만든다', () => {
  const plan = buildSessionPlan(
    input({
      mode: 'daily',
      dailyPlan: {
        target: 10,
        done: 6,
        reviewTarget: 6,
        reviewDone: 4,
        effectiveNew: 4,
        newDone: 2,
        reason: 'no_backlog',
      },
      dueCount: 10,
      newCount: 10,
    })
  );
  assertPlan(plan, {
    targetSize: 4,
    reviewTarget: 2,
    newTarget: 2,
    reason: 'no_backlog',
    dailyPlanUsed: true,
  });
});

test('daily: 목표를 완료했으면 세션을 만들지 않는다', () => {
  const plan = buildSessionPlan(
    input({
      mode: 'daily',
      dailyPlan: {
        target: 10,
        done: 10,
        reviewTarget: 6,
        reviewDone: 6,
        effectiveNew: 4,
        newDone: 4,
        reason: 'no_backlog',
      },
    })
  );
  assertPlan(plan, {
    targetSize: 0,
    reviewTarget: 0,
    newTarget: 0,
    reason: 'goal_done',
  });
});

test('daily: 계획 스냅샷이 없으면 일일 설정으로 폴백한다', () => {
  const plan = buildSessionPlan(
    input({
      mode: 'daily',
      dailyReview: 5,
      todayReviewDone: 2,
      dailyNew: 10,
      todayNewDone: 0,
      dueCount: 10,
      newCount: 10,
      sessionSize: 5,
    })
  );
  assertPlan(plan, {
    targetSize: 5,
    reviewTarget: 3,
    newTarget: 2,
    reason: 'daily_plan',
  });
});

test('daily custom: 남은 신규 목표를 넘지 않는다', () => {
  const plan = buildSessionPlan(
    input({
      mode: 'daily',
      kind: 'custom',
      dailyPlan: {
        target: 10,
        done: 0,
        reviewTarget: 5,
        reviewDone: 0,
        effectiveNew: 1,
        newDone: 0,
        reason: 'no_backlog',
      },
      deckNewCount: 3,
    })
  );
  assertPlan(plan, { targetSize: 1, newTarget: 1 });
});

test('daily weak: 하루 복습 상한의 남은 양을 넘지 않는다', () => {
  const plan = buildSessionPlan(
    input({
      mode: 'daily',
      kind: 'weak',
      dailyReview: 3,
      todayReviewDone: 2,
      weakDueCount: 7,
      dailyPlan: {
        target: 10,
        done: 0,
        reviewTarget: 5,
        reviewDone: 0,
        effectiveNew: 5,
        newDone: 0,
        reason: 'no_backlog',
      },
    })
  );
  assertPlan(plan, { targetSize: 1, weakTarget: 1 });
});

test('daily: 계획 이유를 그대로 전달한다', () => {
  const plan = buildSessionPlan(
    input({
      mode: 'daily',
      dailyPlan: {
        target: 20,
        done: 0,
        reviewTarget: 20,
        reviewDone: 0,
        effectiveNew: 0,
        newDone: 0,
        reason: 'heavy_backlog',
      },
      dueCount: 20,
    })
  );
  assert.equal(plan.reason, 'heavy_backlog');
});

test('backlog: 7일치 이상 밀리면 경고한다', () => {
  assert.equal(backlogDaysToClear(100, 5), 20);
  assert.equal(computeBacklogWarning(100, 5), true);
  assert.equal(computeBacklogWarning(0, 5), false);
  assert.equal(computeBacklogWarning(5, 10), false);
  assert.equal(computeBacklogWarning(100, 20), false);
});

test('모든 계획은 음수 목표를 만들지 않는다', () => {
  for (const kind of ['quick', 'typing', 'cloze', 'listening', 'weak', 'custom']) {
    const plan = buildSessionPlan(
      input({
        kind,
        dueCount: -10,
        newCount: -3,
        weakDueCount: -2,
        deckNewCount: -1,
        sessionSize: -5,
        newPerSession: -2,
      })
    );
    assert.ok(plan.targetSize >= 0);
    assert.ok(plan.reviewTarget >= 0);
    assert.ok(plan.newTarget >= 0);
    assert.ok(plan.weakTarget >= 0);
  }
});
