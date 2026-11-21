import test from 'node:test';
import assert from 'node:assert/strict';
import { computePanelPosition, rectsIntersect } from '../src/utils/position-utils.js';
import { formatVolume, formatTimeLabel, rangeChange } from '../src/utils/formatters.js';

const vp = { width: 1200, height: 800 };
const panel = { width: 560, height: 400 };
const anchor = (l, t, w = 120, h = 20) => ({ left: l, top: t, right: l + w, bottom: t + h });

test('prefers right of the link and below the cursor', () => {
  const a = anchor(100, 100);
  const p = computePanelPosition({ cursor: { x: 150, y: 110 }, anchor: a, panel, viewport: vp });
  assert.equal(p.left, a.right + 14);
  assert.equal(p.top, 110 + 14);
});
test('flips left when there is no room on the right', () => {
  const a = anchor(900, 100);
  const p = computePanelPosition({ cursor: { x: 950, y: 110 }, anchor: a, panel, viewport: vp });
  assert.equal(p.left, a.left - 14 - panel.width);
});
test('flips above when there is no room below', () => {
  const p = computePanelPosition({ cursor: { x: 150, y: 700 }, anchor: anchor(100, 690), panel, viewport: vp });
  assert.equal(p.top, 700 - 14 - panel.height);
});
test('always stays inside the viewport, even in tiny windows', () => {
  for (const c of [{ x: 5, y: 5 }, { x: 1195, y: 795 }, { x: 600, y: 400 }]) {
    const p = computePanelPosition({ cursor: c, anchor: anchor(c.x - 20, c.y - 5), panel, viewport: { width: 700, height: 450 } });
    assert.ok(p.left >= 8 && p.top >= 8 && p.left + panel.width <= 700 - 0 && p.top + panel.height <= 450);
  }
});
test('rectsIntersect', () => {
  assert.equal(rectsIntersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 5, top: 5, right: 20, bottom: 20 }), true);
  assert.equal(rectsIntersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 }), false);
});
test('formatters', () => {
  assert.equal(formatVolume(51084119), '5.11 Cr');
  assert.equal(formatVolume(620000), '6.20 L');
  assert.equal(formatTimeLabel('2026-10-30'), '30 Oct 2026');
  assert.equal(formatTimeLabel({ year: 2026, month: 10, day: 30 }), '30 Oct 2026');
  assert.equal(rangeChange([]), null);
  assert.equal(Math.round(rangeChange([{ open: 100, close: 101 }, { open: 101, close: 110 }]).pct), 10);
});
