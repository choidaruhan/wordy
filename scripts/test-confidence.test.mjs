import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIDENCE_SAMPLE_EVERY,
  shouldAskConfidence,
} from '../src/lib/confidence.ts';

test('confidence: off는 항상 묻지 않는다', () => {
  for (const n of [1, 5, 10, 99]) {
    assert.equal(shouldAskConfidence('off', n), false);
  }
});

test('confidence: sample은 5문제마다 묻는다', () => {
  assert.equal(CONFIDENCE_SAMPLE_EVERY, 5);
  assert.equal(shouldAskConfidence('sample', 1), false);
  assert.equal(shouldAskConfidence('sample', 4), false);
  assert.equal(shouldAskConfidence('sample', 5), true);
  assert.equal(shouldAskConfidence('sample', 10), true);
  assert.equal(shouldAskConfidence('sample', 15), true);
});

test('confidence: always는 매 문제 묻는다', () => {
  assert.equal(shouldAskConfidence('always', 1), true);
  assert.equal(shouldAskConfidence('always', 7), true);
});

test('confidence: 알 수 없는 모드는 묻지 않는다', () => {
  assert.equal(shouldAskConfidence('nope', 5), false);
});
