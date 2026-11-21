import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, viewState } from '../src/content/interaction-state.js';

const run = (...events) => events.reduce((s, e) => reduce(s, typeof e === 'string' ? { type: e } : e), initialState);

test('hover -> loading -> open', () => {
  const s = run({ type: 'SHOW', key: 'TCS' }, 'LOADED');
  assert.equal(viewState(s), 'OPEN');
  assert.equal(s.key, 'TCS');
});
test('failure -> ERROR; retry returns to LOADING', () => {
  assert.equal(viewState(run({ type: 'SHOW', key: 'A' }, 'FAILED')), 'ERROR');
  assert.equal(viewState(run({ type: 'SHOW', key: 'A' }, 'FAILED', 'RELOAD')), 'LOADING');
});
test('hide timer closes an unpinned chart but not a pinned one', () => {
  assert.equal(viewState(run({ type: 'SHOW', key: 'A' }, 'LOADED', 'HIDE')), 'CLOSED');
  const pinned = run({ type: 'SHOW', key: 'A' }, 'LOADED', 'PIN', 'HIDE');
  assert.equal(viewState(pinned), 'PINNED');
});
test('pin, unpin, toggle', () => {
  const base = run({ type: 'SHOW', key: 'A' }, 'LOADED');
  assert.equal(reduce(base, { type: 'TOGGLE_PIN' }).pinned, true);
  assert.equal(reduce(reduce(base, { type: 'PIN' }), { type: 'UNPIN' }).pinned, false);
  assert.equal(viewState(reduce(reduce(reduce(base, { type: 'PIN' }), { type: 'UNPIN' }), { type: 'HIDE' })), 'CLOSED');
});
test('cannot pin a closed chart', () => {
  assert.equal(reduce(initialState, { type: 'PIN' }).pinned, false);
  assert.equal(reduce(initialState, { type: 'TOGGLE_PIN' }).pinned, false);
});
test('close / Escape always closes and unpins', () => {
  assert.deepEqual(run({ type: 'SHOW', key: 'A' }, 'LOADED', 'PIN', 'CLOSE'), initialState);
});
test('switching stock while pinned keeps it pinned and reuses the same panel state', () => {
  const s = run({ type: 'SHOW', key: 'A' }, 'LOADED', 'PIN', { type: 'SHOW', key: 'B' });
  assert.equal(s.pinned, true);
  assert.equal(s.key, 'B');
  assert.equal(s.phase, 'LOADING');
});
test('late LOADED/FAILED after close are ignored', () => {
  assert.equal(viewState(run({ type: 'SHOW', key: 'A' }, 'CLOSE', 'LOADED')), 'CLOSED');
  assert.equal(viewState(run({ type: 'SHOW', key: 'A' }, 'CLOSE', 'FAILED')), 'CLOSED');
});
