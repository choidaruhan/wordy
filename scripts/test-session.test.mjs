import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAdaptiveNew } from '../src/lib/adaptive.ts';
import { selectNextType, estimateMinutes, DEFAULT_REVIEW_RATIOS } from '../src/lib/session.ts';

function adaptive(overrides = {}) {
  return computeAdaptiveNew({
    base: 10,
    overdue: 0,
    throughput7: 10,
    adherence7: 1,
    mode: 'auto',
    ...overrides,
  });
}

test('adaptive: 복습 밀림이 없으면 기본값 유지', () => {
  const result = adaptive({ overdue: 0, adherence7: 0.2 });
  assert.equal(result.effectiveNew, 10);
  assert.equal(result.reason, 'no_backlog');
});

test('adaptive: 5.8일치 밀림이면 25% 줄인다', () => {
  const result = adaptive({ overdue: 120, throughput7: 20.57, adherence7: 0.714 });
  assert.equal(result.effectiveNew, 7);
  assert.equal(result.reason, 'light_backlog');
});

test('adaptive: 2주치 이상 밀리면 신규 0', () => {
  const result = adaptive({ overdue: 100, throughput7: 5 });
  assert.equal(result.effectiveNew, 0);
  assert.equal(result.reason, 'heavy_backlog');
});

test('adaptive: 완료율이 낮아도 최대 15%만 줄인다', () => {
  const result = adaptive({ overdue: 10, throughput7: 10, adherence7: 0.3 });
  assert.equal(result.effectiveNew, 8);
  assert.equal(result.reason, 'low_adherence');
});

test('adaptive: 고정 모드는 기본값을 유지하고 backlog 경고를 남긴다', () => {
  const result = adaptive({ mode: 'fixed', overdue: 100, throughput7: 5 });
  assert.equal(result.effectiveNew, 10);
  assert.equal(result.reason, 'fixed');
  assert.equal(result.backlogWarning, true);
});

test('adaptive: 기본값을 넘지 않는다', () => {
  const result = adaptive({ overdue: 1, throughput7: 1000, adherence7: 2 });
  assert.ok(result.effectiveNew <= 10);
});

test('selectNextType: 목표 비율에서 가장 부족한 유형을 고른다', () => {
  assert.equal(
    selectNextType(DEFAULT_REVIEW_RATIOS, { recognition: 10, recall: 10, cloze: 10 }, {}),
    'recognition'
  );

  assert.equal(
    selectNextType(
      DEFAULT_REVIEW_RATIOS,
      { recognition: 10, recall: 10, cloze: 10 },
      { recognition: 5 }
    ),
    'recall'
  );
});

test('selectNextType: due가 없는 유형은 제외하고 남은 유형에서 고른다', () => {
  assert.equal(
    selectNextType(DEFAULT_REVIEW_RATIOS, { recognition: 0, recall: 0, cloze: 3 }, {}),
    'cloze'
  );
  assert.equal(selectNextType(DEFAULT_REVIEW_RATIOS, {}, {}), null);
});

test('estimateMinutes: 유형별 응답 시간으로 예상 시간을 계산한다', () => {
  const minutes = estimateMinutes({
    reviewTarget: 10,
    promotedTarget: 2,
    newTarget: 4,
    dueCounts: { recognition: 5, recall: 3, cloze: 2 },
    averages: { recognition: 8, recall: 18, cloze: 20 },
  });

  // 10 * 13.4초 + 2 * 19초 + 4 * 25초 = 272초 → 5분
  assert.equal(minutes, 5);
});

test('estimateMinutes: 목표가 없으면 0분', () => {
  assert.equal(
    estimateMinutes({
      reviewTarget: 0,
      promotedTarget: 0,
      newTarget: 0,
      dueCounts: {},
      averages: {},
    }),
    0
  );
});
