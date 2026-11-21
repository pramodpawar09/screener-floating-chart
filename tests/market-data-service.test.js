import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketDataService } from '../src/services/market-data-service.js';
import { createSymbolResolver } from '../src/services/symbol-resolver.js';
import { createCache } from '../src/services/cache-service.js';
import { ExtError } from '../src/shared/errors.js';

const rows = [
  { time: 1761795300, open: 100, high: 110, low: 95, close: 105, volume: 10 },
  { time: 1761881700, open: 105, high: 112, low: 101, close: 111, volume: 12 },
];
function makeProvider(overrides = {}) {
  const calls = [];
  const p = {
    id: 'fake', name: 'Fake', requiresKey: false, calls,
    formatSymbol: ({ identifier, exchange }) => `${identifier}.${exchange === 'BSE' ? 'BO' : 'NS'}`,
    parseSymbol: (s) => { const m = /^(.+)\.(NS|BO)$/.exec(s); return m && { baseSymbol: m[1], exchange: m[2] === 'BO' ? 'BSE' : 'NSE' }; },
    async getHistoricalCandles(args) { calls.push(args); return { rows, meta: { symbol: args.symbol, currency: 'INR', gmtoffset: 19800 } }; },
    async searchSymbols() { return []; },
    ...overrides,
  };
  return p;
}
function makeService(provider, store = {}) {
  const overrides = { get: async (id) => store[id] || null, set: async (id, v) => void (store[id] = v) };
  const resolver = createSymbolResolver({ provider, overrides });
  return createMarketDataService({ provider, resolver, cache: createCache() });
}
const stock = (id) => ({ screenerIdentifier: id, companyName: id + ' Ltd' });

test('known NSE ticker resolves from the Screener identifier and returns normalised candles', async () => {
  const p = makeProvider();
  const r = await makeService(p).getCandles({ stock: stock('TCS'), timeframeId: '6M' });
  assert.equal(r.symbol, 'TCS.NS');
  assert.equal(r.exchange, 'NSE');
  assert.equal(r.candles.length, 2);
  assert.equal(r.candles[0].time, '2025-10-30');
  assert.equal(r.fromCache, false);
});
test('numeric Screener code maps to BSE', async () => {
  const r = await makeService(makeProvider()).getCandles({ stock: stock('532540'), timeframeId: '1M' });
  assert.equal(r.symbol, '532540.BO');
  assert.equal(r.exchange, 'BSE');
});
test('cache hit avoids a second provider call; different timeframe is a miss', async () => {
  const p = makeProvider();
  const s = makeService(p);
  await s.getCandles({ stock: stock('TCS'), timeframeId: '6M' });
  const again = await s.getCandles({ stock: stock('TCS'), timeframeId: '6M' });
  assert.equal(again.fromCache, true);
  assert.equal(p.calls.length, 1);
  await s.getCandles({ stock: stock('TCS'), timeframeId: '1Y' });
  assert.equal(p.calls.length, 2);
});
test('simultaneous identical requests share one in-flight provider call', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const p = makeProvider({ async getHistoricalCandles(a) { p.calls.push(a); await gate; return { rows, meta: { symbol: a.symbol, currency: 'INR', gmtoffset: 19800 } }; } });
  const s = makeService(p);
  const all = Promise.all([1, 2, 3].map(() => s.getCandles({ stock: stock('INFY'), timeframeId: '6M' })));
  await new Promise((r) => setTimeout(r, 10));
  release();
  await all;
  assert.equal(p.calls.length, 1);
});
test('unknown ticker with no search match -> UNRESOLVED', async () => {
  const p = makeProvider({ async getHistoricalCandles() { throw new ExtError('NOT_FOUND'); } });
  await assert.rejects(makeService(p).getCandles({ stock: stock('ZZZZ'), timeframeId: '6M' }), { code: 'UNRESOLVED' });
});
test('ambiguous search matches -> AMBIGUOUS with options; selecting one is validated and stored', async () => {
  const store = {};
  const p = makeProvider({
    async getHistoricalCandles(a) { if (a.symbol === 'ABC.NS') throw new ExtError('NOT_FOUND'); p.calls.push(a); return { rows, meta: { symbol: a.symbol, currency: 'INR', gmtoffset: 19800 } }; },
    async searchSymbols() { return [{ symbol: 'ABC.BO', baseSymbol: 'ABC', exchange: 'BSE', name: 'A' }, { symbol: 'ABC-B.BO', baseSymbol: 'ABC', exchange: 'BSE', name: 'B' }, { symbol: 'ABCD.NS', baseSymbol: 'ABCD', exchange: 'NSE', name: 'C' }]; },
  });
  const s = makeService(p, store);
  await assert.rejects(s.getCandles({ stock: stock('ABC'), timeframeId: '6M' }), (e) => e.code === 'AMBIGUOUS' && e.details.options.length === 2 && e.details.options.every((o) => o.symbol.startsWith('ABC')));
  await assert.rejects(s.selectSymbol({ stock: stock('ABC'), symbol: 'OTHER.NS' }), { code: 'INVALID_REQUEST' }); // not this stock's ticker
  await s.selectSymbol({ stock: stock('ABC'), symbol: 'ABC.BO' });
  assert.equal(store.ABC.symbol, 'ABC.BO');
  const r = await s.getCandles({ stock: stock('ABC'), timeframeId: '6M' });
  assert.equal(r.symbol, 'ABC.BO');
});
test('single exact search match is used and remembered', async () => {
  const store = {};
  const p = makeProvider({
    async getHistoricalCandles(a) { if (a.symbol === 'XYZ.NS') throw new ExtError('NOT_FOUND'); return { rows, meta: { symbol: a.symbol, currency: 'INR', gmtoffset: 19800 } }; },
    async searchSymbols() { return [{ symbol: 'XYZ.BO', baseSymbol: 'XYZ', exchange: 'BSE', name: 'XYZ Limited' }]; },
  });
  const r = await makeService(p, store).getCandles({ stock: stock('XYZ'), timeframeId: '6M' });
  assert.equal(r.symbol, 'XYZ.BO');
  assert.equal(store.XYZ.symbol, 'XYZ.BO');
});
test('provider errors propagate with their codes (rate limit, network, empty)', async () => {
  for (const code of ['RATE_LIMIT', 'NETWORK', 'EMPTY', 'PROVIDER']) {
    const p = makeProvider({ async getHistoricalCandles() { throw new ExtError(code); } });
    await assert.rejects(makeService(p).getCandles({ stock: stock('TCS'), timeframeId: '6M' }), { code });
  }
});
test('all-invalid provider data -> EMPTY, never fake candles', async () => {
  const p = makeProvider({ async getHistoricalCandles() { return { rows: [{ time: 1761795300, open: 1, high: 0, low: 5, close: 1 }], meta: { gmtoffset: 19800 } }; } });
  await assert.rejects(makeService(p).getCandles({ stock: stock('TCS'), timeframeId: '6M' }), { code: 'EMPTY' });
});
test('expired cache is served as stale when the provider is unreachable', async () => {
  let fail = false;
  const p = makeProvider({ async getHistoricalCandles(a) { if (fail) throw new ExtError('NETWORK'); return { rows, meta: { symbol: a.symbol, currency: 'INR', gmtoffset: 19800 } }; } });
  let t = 0;
  const overrides = { get: async () => null, set: async () => {} };
  const svc = createMarketDataService({ provider: p, resolver: createSymbolResolver({ provider: p, overrides }), cache: createCache({ now: () => t }), now: () => t });
  await svc.getCandles({ stock: stock('TCS'), timeframeId: '1D' });
  t += 10 * 60 * 1000; fail = true; // past the 1-minute intraday TTL
  const r = await svc.getCandles({ stock: stock('TCS'), timeframeId: '1D' });
  assert.equal(r.stale, true);
  assert.equal(r.candles.length, 2);
});
test('invalid requests are rejected before any network call', async () => {
  const p = makeProvider();
  const s = makeService(p);
  await assert.rejects(s.getCandles({ stock: stock('tcs; drop'), timeframeId: '6M' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(s.getCandles({ stock: stock('TCS'), timeframeId: '99Y' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(s.getCandles({ stock: null, timeframeId: '6M' }), { code: 'INVALID_REQUEST' });
  assert.equal(p.calls.length, 0);
});
