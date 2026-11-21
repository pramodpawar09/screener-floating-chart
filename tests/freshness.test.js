import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketDataService } from '../src/services/market-data-service.js';
import { createSymbolResolver } from '../src/services/symbol-resolver.js';
import { createCache } from '../src/services/cache-service.js';
import { yahooProvider } from '../src/services/providers/yahoo.js';
import { normalizeCandles } from '../src/services/data-normalizer.js';
import { deriveDailyCandle, expectedSlots } from '../src/services/derived-candle.js';
import { buildNotices } from '../src/utils/notices.js';
import { MAX_STALE_MS } from '../src/shared/timeframes.js';
import { ExtError } from '../src/shared/errors.js';

const IST = 19800;
const raw = (date, h, m) => { const [y, mo, d] = date.split('-').map(Number); return Date.UTC(y, mo - 1, d, h, m) / 1000 - IST; }; // provider epoch for an IST wall-clock time
const local = (date, h, m) => raw(date, h, m) + IST; // exchange-local seconds (what the normalizer produces for intraday)
const NOV6_0930_IST = Date.UTC(2026, 10, 6, 4, 0);   // Nov 5 session is over; Nov 6 is in progress
const NOV6_1000_IST = Date.UTC(2026, 10, 6, 4, 30);

const OFFICIAL = { '2026-11-02': 2501.7, '2026-11-03': 2499.1, '2026-11-04': 2436 };
const dailyRow = (date, c) => ({ time: raw(date, 9, 15), open: c - 5, high: c + 10, low: c - 12, close: c, volume: 5000000 });
const nullRow = (date) => ({ time: raw(date, 9, 15), open: null, high: null, low: null, close: null, volume: null });
// bar i: open 100+i, high 102+i, low 99+i, close 100.5+i, volume 1000*(i+1)
const bar = (date, i) => ({ time: raw(date, 9, 15 + 15 * i), open: 100 + i, high: 102 + i, low: 99 + i, close: 100.5 + i, volume: 1000 * (i + 1) });
const emptyBar = (date, i) => ({ time: raw(date, 9, 15 + 15 * i), open: null, high: null, low: null, close: null, volume: null });
function session(date, { skip = [], empty = [], partial = [], zeroVolume = [], upTo = 24 } = {}) {
  const rows = [];
  for (let i = 0; i <= upTo; i++) {
    if (skip.includes(i)) continue;
    if (empty.includes(i)) rows.push(emptyBar(date, i));
    else if (partial.includes(i)) rows.push({ ...bar(date, i), close: null });
    else rows.push({ ...bar(date, i), ...(zeroVolume.includes(i) ? { volume: 0 } : {}) });
  }
  return rows;
}

function setup({ nov5 = 'null', nov6 = null, intraday = () => session('2026-11-05'), intradayError = null, now = NOV6_0930_IST, exchangeId = 'TCS' } = {}) {
  const env = { t: now, nov5, nov6, intraday, intradayError, dailyError: null, calls: [], extraDaily: {} };
  const provider = {
    id: 'fake', name: 'Fake', requiresKey: false,
    formatSymbol: (a) => yahooProvider.formatSymbol(a),
    parseSymbol: (s) => yahooProvider.parseSymbol(s),
    async getHistoricalCandles({ symbol, interval }) {
      env.calls.push(interval);
      if (interval === '1d') {
        if (env.dailyError) throw new ExtError(env.dailyError);
        const rows = Object.entries({ ...OFFICIAL, ...env.extraDaily }).map(([d, c]) => dailyRow(d, c));
        if (env.nov5 === 'null') rows.push(nullRow('2026-11-05'));
        if (typeof env.nov5 === 'number') rows.push(dailyRow('2026-11-05', env.nov5));
        if (env.nov6 === 'null') rows.push(nullRow('2026-11-06'));
        return { rows, meta: { symbol, currency: 'INR', gmtoffset: IST } };
      }
      if (env.intradayError) throw new ExtError(env.intradayError);
      return { rows: [...session('2026-11-03'), ...session('2026-11-04'), ...env.intraday()], meta: { symbol, currency: 'INR', gmtoffset: IST } };
    },
    async searchSymbols() { return []; },
  };
  const overrides = { get: async () => null, set: async () => {} };
  const resolver = createSymbolResolver({ provider, overrides, pageLookup: async () => ({ nse: null, bse: null }) });
  const svc = createMarketDataService({ provider, resolver, cache: createCache({ now: () => env.t }), now: () => env.t });
  env.get = (id = exchangeId) => svc.getCandles({ stock: { screenerIdentifier: id, companyName: id + ' Ltd' }, timeframeId: '6M' });
  return env;
}
const assertUniqueSorted = (candles) => {
  const times = candles.map((c) => c.time);
  assert.equal(new Set(times).size, times.length, 'duplicate candle dates');
  assert.deepEqual(times, [...times].sort(), 'candles not chronological');
};

// ---------- derived candle: complete intraday ----------
test('missing Nov 5 daily candle + complete intraday session -> labelled derived candle appended; official candles untouched', async () => {
  const env = setup();
  const r = await env.get();
  assert.deepEqual(r.candles.slice(0, 3).map((c) => [c.time, c.close]), Object.entries(OFFICIAL)); // official unchanged
  assert.ok(r.candles.slice(0, 3).every((c) => !c.derived));
  const last = r.candles.at(-1);
  assert.equal(last.time, '2026-11-05');
  assert.equal(last.derived, true);
  assert.deepEqual(r.derived, [{ date: '2026-11-05', barCount: 25, expectedBars: 25, volumeKnown: true, intervalLabel: '15-minute' }]);
  assert.deepEqual(r.missingDates, [{ date: '2026-11-05', reason: 'null-price' }]);
  assert.deepEqual(r.notDerived, []);
  assertUniqueSorted(r.candles);
});
test('derived OHLCV: open=first bar open, high=max high, low=min low, close=last bar close, volume=sum', async () => {
  const c = (await setup().get()).candles.at(-1);
  assert.deepEqual([c.open, c.high, c.low, c.close, c.volume, c.volumeKnown], [100, 126, 99, 124.5, 325000, true]);
});
test('pure derivation: no-trade (all-empty) slots are allowed; a gap in volume makes volume unknown instead of guessed', () => {
  const norm = (rows) => normalizeCandles(rows, { intraday: true, gmtoffset: IST });
  const a = norm(session('2026-11-05', { empty: [3, 4, 5] }));
  const emptyTimes = a.rejectedRows.filter((r) => r.reason === 'null-price').map((r) => r.time);
  const ok = deriveDailyCandle({ date: '2026-11-05', exchange: 'NSE', bars: a.candles, emptyTimes, nowMs: NOV6_0930_IST });
  assert.equal(ok.ok, true);
  assert.equal(ok.barCount, 22);
  assert.equal(ok.candle.volume, 325000 - 1000 * (4 + 5 + 6));
  const b = norm(session('2026-11-05', { zeroVolume: [7] }));
  const noVol = deriveDailyCandle({ date: '2026-11-05', exchange: 'NSE', bars: b.candles, emptyTimes: [], nowMs: NOV6_0930_IST });
  assert.equal(noVol.ok, true);
  assert.equal(noVol.candle.volumeKnown, false);
  assert.equal(noVol.candle.volume, 0);
});
test('expected schedule: 25 fifteen-minute slots from 09:15 to 15:15 IST', () => {
  const g = expectedSlots('2026-11-05', 'NSE', 15);
  assert.equal(g.slots.length, 25);
  assert.equal(g.slots[0], local('2026-11-05', 9, 15));
  assert.equal(g.slots.at(-1), local('2026-11-05', 15, 15));
});

// ---------- derived candle: refusals (never a misleading candle) ----------
const refused = async (env, reason) => {
  const r = await env.get();
  assert.equal(r.candles.at(-1).time, '2026-11-04', 'must not add a candle');
  assert.ok(r.candles.every((c) => !c.derived));
  assert.deepEqual(r.derived, []);
  assert.equal(r.notDerived.length, 1);
  assert.equal(r.notDerived[0].reason, reason);
  assert.deepEqual(r.missingDates, [{ date: '2026-11-05', reason: 'null-price' }]); // still visible
  return r;
};
test('incomplete intraday: missing bars in the middle -> not derived', async () => {
  const r = await refused(setup({ intraday: () => session('2026-11-05', { skip: [10, 11, 12] }) }), 'missing-bars');
  assert.match(r.notDerived[0].detail, /22 of 25/);
});
test('incomplete intraday: session cut short (no closing bars yet) -> not derived', () => refused(setup({ intraday: () => session('2026-11-05', { upTo: 18 }) }), 'missing-bars'));
test('empty closing bar (cannot tell no-trade from not-yet-published) -> not derived', () => refused(setup({ intraday: () => session('2026-11-05', { empty: [24] }) }), 'final-bar-empty'));
test('bar with partial prices -> its slot is unverified -> not derived', () => refused(setup({ intraday: () => session('2026-11-05', { partial: [6] }) }), 'missing-bars'));
test('no intraday data for that date -> not derived', () => refused(setup({ intraday: () => [] }), 'no-intraday-data'));
test('intraday request fails -> not derived, and the provider error stays visible in the payload', async () => {
  for (const code of ['NETWORK', 'RATE_LIMIT', 'EMPTY']) {
    const env = setup({ intradayError: code });
    const r = await refused(env, `provider-error:${code}`);
    assert.equal(r.candles.length, 3); // daily series still returned
  }
});
test('session still in progress (today, before the close) -> not derived, even though today\'s daily row is empty', async () => {
  const env = setup({ nov5: 2450, nov6: 'null', now: NOV6_1000_IST, intraday: () => session('2026-11-06', { upTo: 3 }) });
  const r = await env.get();
  assert.equal(r.candles.at(-1).time, '2026-11-05'); // official Nov 5 kept; nothing invented for Nov 6
  assert.deepEqual(r.derived, []);
  assert.deepEqual(r.notDerived.map((n) => [n.date, n.reason]), [['2026-11-06', 'session-not-complete']]);
  assert.deepEqual(deriveDailyCandle({ date: '2026-11-06', exchange: 'NSE', bars: [], emptyTimes: [], nowMs: NOV6_1000_IST }), { ok: false, reason: 'session-not-complete' });
});
test('special/off-schedule sessions and unknown exchanges are refused', () => {
  const bars = normalizeCandles([...session('2026-11-08').slice(0, 3)], { intraday: true, gmtoffset: IST }).candles;
  assert.equal(deriveDailyCandle({ date: '2026-11-08', exchange: 'NSE', bars: [{ ...bars[0], time: local('2026-11-08', 18, 15) }], nowMs: Date.UTC(2026, 10, 9) }).reason, 'off-grid-bars');
  assert.equal(deriveDailyCandle({ date: '2026-11-05', exchange: 'LSE', bars, nowMs: NOV6_0930_IST }).reason, 'unsupported-exchange');
});

// ---------- precedence and chart-data correctness ----------
test('official daily candle takes precedence: intraday is never even requested, nothing derived', async () => {
  const env = setup({ nov5: 2450 });
  const r = await env.get();
  const last = r.candles.at(-1);
  assert.deepEqual([last.time, last.close, last.derived], ['2026-11-05', 2450, undefined]);
  assert.deepEqual(r.derived, []);
  assert.deepEqual(r.missingDates, []);
  assert.ok(!env.calls.includes('15m'));
  assertUniqueSorted(r.candles);
});
test('when Yahoo later publishes the official candle it replaces the derived one: same date, no duplicate, official numbers', async () => {
  const env = setup();
  const first = await env.get();
  assert.equal(first.candles.at(-1).derived, true);
  env.t += 16 * 60 * 1000;      // past the 15-minute daily TTL
  env.nov5 = 2450;              // Yahoo now returns a valid official row
  const second = await env.get();
  assert.equal(second.fromCache, false);
  assert.equal(second.candles.length, first.candles.length);
  const last = second.candles.at(-1);
  assert.deepEqual([last.time, last.close, last.derived], ['2026-11-05', 2450, undefined]);
  assert.deepEqual(second.derived, []);
  assert.deepEqual(buildNotices(second), []); // derived notice disappears
  assertUniqueSorted(second.candles);
});
test('derived data is never cached as if official: the cached daily series still shows the row as missing', async () => {
  const env = setup();
  await env.get();
  env.t += 5 * 60 * 1000; // inside the TTL: served from cache
  const again = await env.get();
  assert.equal(again.fromCache, true);
  assert.equal(again.candles.at(-1).derived, true); // recomputed from verified intraday, still flagged
  assert.deepEqual(again.missingDates, [{ date: '2026-11-05', reason: 'null-price' }]);
});
test('cache refresh updates the latest candle; a cache hit is reported as such with its fetch time', async () => {
  const env = setup({ nov5: 'absent' });
  const a = await env.get();
  assert.equal(a.candles.at(-1).time, '2026-11-04');
  env.t += 10 * 60 * 1000; env.extraDaily = { '2026-11-05': 2450 };
  const hit = await env.get();
  assert.equal(hit.fromCache, true);               // inside TTL: not proof of freshness...
  assert.equal(hit.fetchedAt, a.fetchedAt);        // ...so the fetch time is exposed
  assert.equal(hit.candles.at(-1).time, '2026-11-04');
  env.t += 6 * 60 * 1000;                          // TTL expired
  const fresh = await env.get();
  assert.equal(fresh.fromCache, false);
  assert.equal(fresh.candles.at(-1).time, '2026-11-05');
  assert.ok(fresh.fetchedAt > a.fetchedAt);
});

// ---------- stale fallback age limit ----------
test('stale fallback under 24h: old data returned, flagged stale, with the last successful fetch time', async () => {
  const env = setup({ nov5: 'absent' });
  const a = await env.get();
  env.t += 23 * 3600e3; env.dailyError = 'NETWORK';
  const r = await env.get();
  assert.equal(r.stale, true);
  assert.equal(r.fromCache, true);
  assert.equal(r.fetchedAt, a.fetchedAt);
  assert.ok(!env.calls.includes('15m'), 'no derivation from stale data');
  const [warn] = buildNotices(r);
  assert.equal(warn.kind, 'warn');
  assert.match(warn.text, /Provider unreachable.*cached data fetched/);
});
test('stale fallback beyond 24h: NOT returned, the provider error surfaces', async () => {
  for (const code of ['NETWORK', 'RATE_LIMIT', 'PROVIDER']) {
    const env = setup({ nov5: 'absent' });
    await env.get();
    env.t += MAX_STALE_MS + 60 * 1000; env.dailyError = code;
    await assert.rejects(env.get(), { code });
  }
});
test('stale limit is exactly 24 hours', async () => {
  const env = setup({ nov5: 'absent' });
  await env.get();
  env.t += MAX_STALE_MS; env.dailyError = 'NETWORK';
  assert.equal((await env.get()).stale, true);
});

// ---------- NSE and BSE ----------
test('NSE and BSE symbols both get a derived candle, each from its own symbol/exchange', async () => {
  for (const [id, symbol, exchange] of [['TCS', 'TCS.NS', 'NSE'], ['532540', '532540.BO', 'BSE']]) {
    const r = await setup().get(id);
    assert.equal(r.symbol, symbol);
    assert.equal(r.exchange, exchange);
    assert.equal(r.candles.at(-1).derived, true, symbol);
    assert.equal(r.derived[0].date, '2026-11-05');
  }
});

// ---------- visibility: rejection records and notices ----------
test('normalizer records the trading date and reason of every rejected row', () => {
  const n = normalizeCandles([
    dailyRow('2026-11-04', 2436), nullRow('2026-11-05'),
    { ...dailyRow('2026-11-06', 100), close: null },
    { ...dailyRow('2026-11-07', 100), open: 0 },
    { ...dailyRow('2026-11-08', 100), high: 1 },
    { time: 'junk', open: 1, high: 1, low: 1, close: 1 },
  ], { gmtoffset: IST });
  assert.equal(n.candles.length, 1);
  assert.equal(n.rejected, 5);
  assert.deepEqual(n.rejectedRows, [
    { time: '2026-11-05', date: '2026-11-05', reason: 'null-price' },
    { time: '2026-11-06', date: '2026-11-06', reason: 'partial-price' },
    { time: '2026-11-07', date: '2026-11-07', reason: 'non-positive-price' },
    { time: '2026-11-08', date: '2026-11-08', reason: 'invalid-ohlc' },
    { time: null, date: null, reason: 'invalid-time' },
  ]);
});
test('derived candle label: notice names the date, says it is derived and that the official candle is unavailable', async () => {
  const notes = buildNotices(await setup().get());
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, 'Nov 5 candle derived from intraday data. Official daily candle unavailable.');
});
test('missing date is displayed with the reason even when nothing could be derived', async () => {
  const notes = buildNotices(await setup({ intraday: () => session('2026-11-05', { empty: [24] }) }).get());
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /^Nov 5: official daily candle missing \(provider returned empty prices\); not derived: .*closing intraday bar has no prices/);
  assert.equal(notes[0].kind, 'warn');
});
test('no notices for clean, fresh, official data', async () => {
  assert.deepEqual(buildNotices(await setup({ nov5: 2450 }).get()), []);
});
