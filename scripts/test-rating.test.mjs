import test from 'node:test';
import assert from 'node:assert/strict';
import { ratingFromQuiz } from '../src/lib/rating.ts';

function rate(overrides = {}) {
  return ratingFromQuiz({
    correct: true,
    responseMs: 5_000,
    cardType: 'recognition',
    ...overrides,
  });
}

test('rating: 오답은 언제나 Again', () => {
  assert.equal(rate({ correct: false, responseMs: 1_000 }), 1);
  assert.equal(rate({ correct: false, responseMs: 20_000 }), 1);
});

test('rating: 객관식은 빨라도 Easy를 주지 않는다', () => {
  assert.equal(rate({ responseMs: 1_000, cardType: 'recognition' }), 3);
});

test('rating: 생산형 입력은 빠른 정답을 Easy로 인정한다', () => {
  assert.equal(rate({ responseMs: 1_000, cardType: 'recall' }), 4);
  assert.equal(rate({ responseMs: 1_000, cardType: 'cloze' }), 4);
});

test('rating: 응답 시간으로 Hard/Good을 나눈다', () => {
  assert.equal(rate({ responseMs: 3_000 }), 3);
  assert.equal(rate({ responseMs: 3_001 }), 3);
  assert.equal(rate({ responseMs: 8_000 }), 3);
  assert.equal(rate({ responseMs: 8_001 }), 2);
});

test('rating: 오타는 Hard, 응답 시간이 없으면 Good', () => {
  assert.equal(rate({ typo: true, responseMs: 500 }), 2);
  assert.equal(rate({ responseMs: null }), 3);
});
