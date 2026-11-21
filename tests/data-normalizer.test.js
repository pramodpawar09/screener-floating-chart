import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandles, normalizeTime } from '../src/services/data-normalizer.js';

const IST = 19800;
const row = (o = {}) => ({ time: '2026-10-29', open: 100, high: 110, low: 95, close: 105, volume: 1000, ...o });

test('valid candles pass through, rounded and sorted chronologically', () => {
  const r = normalizeCandles([row({ time: '2026-10-30', close: 106.123 }), row({ time: '2026-10-29' })]);
  assert.deepEqual(r.candles.map((c) => c.time), ['2026-10-29', '2026-10-30']);
  assert.equal(r.candles[1].close, 106.12);
  assert.equal(r.rejected, 0);
  assert.equal(r.hasVolume, true);
});
test('duplicate timestamps are collapsed (last wins)', () => {
  const r = normalizeCandles([row({ close: 101 }), row({ close: 104 })]);
  assert.equal(r.candles.length, 1);
  assert.equal(r.candles[0].close, 104);
});
test('invalid OHLC is rejected', () => {
  const bad = [row({ high: 99 }), row({ low: 101, time: '2026-10-28' }), row({ open: null, time: '2026-10-27' }), row({ close: NaN, time: '2026-10-26' }), row({ open: 0, time: '2026-10-25' }), row({ high: 'x', time: '2026-10-24' })];
  const r = normalizeCandles(bad);
  assert.equal(r.candles.length, 0);
  assert.equal(r.rejected, bad.length);
});
test('missing volume becomes 0 and hasVolume is false', () => {
  const r = normalizeCandles([row({ volume: undefined }), row({ time: '2026-10-30', volume: null })]);
  assert.equal(r.candles[0].volume, 0);
  assert.equal(r.hasVolume, false);
});
test('empty / non-array input yields no candles without throwing', () => {
  assert.deepEqual(normalizeCandles([]).candles, []);
  assert.deepEqual(normalizeCandles(null).candles, []);
  assert.deepEqual(normalizeCandles(undefined).candles, []);
});
test('incorrect date formats are rejected', () => {
  const r = normalizeCandles([row({ time: '30/10/2026' }), row({ time: '2026-02-30' }), row({ time: 'abc' }), row({ time: -5 }), row({ time: '2026-10-30T09:15:00Z' })]);
  assert.equal(r.candles.length, 0);
  assert.equal(r.rejected, 5);
});
test('IST trading date is kept: NSE open 09:15 IST is 03:45 UTC, still the same date', () => {
  const ts = Date.UTC(2026, 9, 30, 3, 45) / 1000; // 30 Oct 2026 09:15 IST
  assert.equal(normalizeTime(ts, { gmtoffset: IST }), '2026-10-30');
  // Without applying the exchange offset, a late-evening-UTC stamp would shift the date — this is what we avoid:
  const late = Date.UTC(2026, 9, 30, 19, 0) / 1000; // 31 Oct 00:30 IST
  assert.equal(normalizeTime(late, { gmtoffset: IST }), '2026-10-31');
});
test('intraday candles use exchange-local seconds; millisecond timestamps are accepted', () => {
  const ts = Date.UTC(2026, 9, 30, 3, 45) / 1000;
  assert.equal(normalizeTime(ts, { intraday: true, gmtoffset: IST }), ts + IST);
  assert.equal(normalizeTime(ts * 1000, { intraday: true, gmtoffset: IST }), ts + IST);
  assert.equal(normalizeTime('2026-10-30', { intraday: true }), null);
});
