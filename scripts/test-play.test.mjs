import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampNewPerSession,
  clampSessionSize,
  modeCardTypes,
  normalizePlayMode,
} from '../src/lib/play.ts';

test('play: 잘못된 모드는 quick으로, 듣기 꺼짐도 quick으로', () => {
  assert.equal(normalizePlayMode('typing'), 'typing');
  assert.equal(normalizePlayMode('cloze'), 'cloze');
  assert.equal(normalizePlayMode('custom'), 'custom');
  assert.equal(normalizePlayMode('listening', false), 'quick');
  assert.equal(normalizePlayMode('listening', true), 'listening');
  assert.equal(normalizePlayMode('nope'), 'quick');
});

test('play: 세션 크기와 새 단어 수를 안전 범위로 제한한다', () => {
  assert.equal(clampSessionSize('10'), 10);
  assert.equal(clampSessionSize(0), 5);
  assert.equal(clampSessionSize(100), 20);
  assert.equal(clampNewPerSession(0), 0);
  assert.equal(clampNewPerSession(-1), 2);
  assert.equal(clampNewPerSession(99), 10);
});

test('play: 모드별 카드 유형', () => {
  assert.equal(modeCardTypes('quick'), null);
  assert.deepEqual(modeCardTypes('typing'), ['recall', 'cloze']);
  assert.deepEqual(modeCardTypes('cloze'), ['cloze']);
  assert.deepEqual(modeCardTypes('listening'), ['listening']);
});

