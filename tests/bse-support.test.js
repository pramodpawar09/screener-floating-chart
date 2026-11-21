import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketDataService } from '../src/services/market-data-service.js';
import { createSymbolResolver, inferExchange } from '../src/services/symbol-resolver.js';
import { createCache } from '../src/services/cache-service.js';
import { yahooProvider } from '../src/services/providers/yahoo.js';
import { assertProvider } from '../src/services/providers/index.js';
import { namesMatch } from '../src/services/name-match.js';
import { parseCompanyUrl } from '../src/content/stock-detector.js';
import { normalizeCandles } from '../src/services/data-normalizer.js';
import { ExtError } from '../src/shared/errors.js';

const rows = [{ time: 1761795300, open: 10, high: 11, low: 9, close: 10.5, volume: 100 }];

// Fake provider: `works` = symbols that "exist". Uses the REAL Yahoo symbol rules for format/parse.
function setup({ works = [], codes = { nse: null, bse: null }, search = [], saved = {} } = {}) {
  const calls = [];
  const provider = {
    id: 'fake', name: 'Fake', requiresKey: false,
    formatSymbol: (a) => yahooProvider.formatSymbol(a),
    parseSymbol: (s) => yahooProvider.parseSymbol(s),
    async getHistoricalCandles({ symbol }) { calls.push(symbol); if (!works.includes(symbol)) throw new ExtError('NOT_FOUND'); return { rows, meta: { symbol, currency: 'INR', gmtoffset: 19800 } }; },
    async searchSymbols() { return search; },
  };
  const store = { ...saved };
  const overrides = { get: async (id) => store[id] || null, set: async (id, v) => void (store[id] = v) };
  const resolver = createSymbolResolver({ provider, overrides, pageLookup: async () => codes });
  return { svc: createMarketDataService({ provider, resolver, cache: createCache() }), calls, store };
}
const stock = (id, companyName = id + ' Ltd') => ({ screenerIdentifier: id, companyName });
const get = (t, s, tf = '6M') => t.svc.getCandles({ stock: s, timeframeId: tf });

// ---------- BSE-only companies ----------
test('BSE-only: numeric Screener ID -> <code>.BO on BSE, no NSE attempt at all', async () => {
  const t = setup({ works: ['532540.BO'] });
  const r = await get(t, stock('532540'));
  assert.equal(r.symbol, '532540.BO');
  assert.equal(r.exchange, 'BSE');
  assert.equal(r.resolvedVia, 'screener-id');
  assert.ok(t.calls.every((c) => c.endsWith('.BO')));
});
test('BSE-only: numeric code unknown to provider -> BSE short name from Screener page, remembered', async () => {
  const t = setup({ works: ['DUDANI.BO'], codes: { nse: null, bse: { name: 'DUDANI', code: '544961' } } });
  const r = await get(t, stock('544961', 'Dudani Retail'));
  assert.equal(r.symbol, 'DUDANI.BO');
  assert.equal(r.exchange, 'BSE');
  assert.equal(r.resolvedVia, 'screener-page');
  assert.equal(t.store['544961'].symbol, 'DUDANI.BO');
});
test('BSE-only: provider has neither form -> UNRESOLVED with every symbol tried and an explicit BSE-coverage hint; no fake data', async () => {
  const t = setup({ works: [], codes: { nse: null, bse: { name: 'DUDANI', code: '544961' } } });
  await assert.rejects(get(t, stock('544961')), (e) => e.code === 'UNRESOLVED' && e.details.tried.join() === '544961.BO,DUDANI.BO' && /BSE listing/.test(e.details.hint));
});

// ---------- listed on both NSE and BSE ----------
test('dual-listed: NSE symbol URL -> NSE chart; BSE is never requested', async () => {
  const t = setup({ works: ['TCS.NS', 'TCS.BO'], codes: { nse: 'TCS', bse: { name: 'TCS', code: '532540' } } });
  const r = await get(t, stock('TCS'));
  assert.equal(r.exchange, 'NSE');
  assert.deepEqual(t.calls, ['TCS.NS']);
});
test('dual-listed: NSE ticker unavailable at provider -> falls to the BSE listing from the SAME Screener page, labelled as such', async () => {
  const t = setup({ works: ['532540.BO'], codes: { nse: 'TCS', bse: { name: 'TCS', code: '532540' } } });
  const r = await get(t, stock('TCS'));
  assert.equal(r.symbol, '532540.BO');
  assert.equal(r.exchange, 'BSE'); // visible in the header, not silent
  assert.equal(r.resolvedVia, 'screener-page');
});
test('cache keys are exchange-aware: same base symbol on NSE vs BSE never shares an entry', async () => {
  const t = setup({ works: ['ABC.NS', 'ABC.BO'], saved: { ABC: { symbol: 'ABC.NS', exchange: 'NSE' } } });
  const a = await get(t, stock('ABC'));
  assert.equal(a.exchange, 'NSE');
  t.store.ABC = { symbol: 'ABC.BO', exchange: 'BSE' };
  const b = await get(t, stock('ABC'));
  assert.equal(b.exchange, 'BSE');
  assert.equal(b.fromCache, false);
  assert.deepEqual(t.calls, ['ABC.NS', 'ABC.BO']);
});

// ---------- no silent substitution / verification ----------
test('search hit with a DIFFERENT company name is not auto-used: user must confirm', async () => {
  const t = setup({ works: ['ZED.BO'], search: [{ symbol: 'ZED.BO', baseSymbol: 'ZED', exchange: 'BSE', name: 'Zed Totally Different Industries' }] }); // primary ZED.NS does not exist
  await assert.rejects(get(t, stock('ZED', 'Zed Retail')), (e) => e.code === 'AMBIGUOUS' && e.details.options[0].name.includes('Different'));
});
test('search hit with a MATCHING company name is verified and used', async () => {
  const t = setup({ works: ['ZED.BO'], search: [{ symbol: 'ZED.BO', baseSymbol: 'ZED', exchange: 'BSE', name: 'Zed Retail Limited' }] }); // primary ZED.NS does not exist
  const r = await get(t, stock('ZED', 'Zed Retail Ltd'));
  assert.equal(r.symbol, 'ZED.BO');
  assert.equal(r.resolvedVia, 'search-verified');
});
test('namesMatch is conservative', () => {
  assert.equal(namesMatch('XYZ Ltd', 'XYZ Limited'), true);
  assert.equal(namesMatch('Tata Motors Ltd', 'Tata Motors Limited'), true);
  assert.equal(namesMatch('Tata Motors', 'Tata Steel'), false);
  assert.equal(namesMatch('', 'Tata'), false);
  assert.equal(namesMatch('Natl. Aluminium', 'National Aluminium Company Ltd'), false); // unsure -> ask user
});

// ---------- invalid BSE symbols ----------
test('invalid BSE symbols are rejected by the provider symbol rules', () => {
  for (const bad of ['544961.XX', '544961', '.BO', '', null, undefined, '544961.BSE']) assert.equal(yahooProvider.parseSymbol(bad), null, String(bad));
  assert.deepEqual(yahooProvider.parseSymbol('544961.BO'), { baseSymbol: '544961', exchange: 'BSE' });
});
test('user cannot select a symbol that belongs to a different identifier', async () => {
  const t = setup();
  await assert.rejects(t.svc.selectSymbol({ stock: stock('544961'), symbol: '500325.BO' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(t.svc.selectSymbol({ stock: stock('544961'), symbol: '544961.XX' }), { code: 'INVALID_REQUEST' });
});
test('numeric IDs that are not valid BSE codes (4 or 7 digits) are not treated as NSE or BSE', async () => {
  assert.equal(inferExchange('1234'), null);
  assert.equal(inferExchange('1234567'), null);
  const t = setup({ works: ['X.NS'] }); // even though something "works", nothing is guessed
  await assert.rejects(get(t, stock('1234')), { code: 'UNRESOLVED' });
  assert.deepEqual(t.calls, []);
});

// ---------- missing exchange information ----------
test('missing exchange info is never defaulted to NSE', () => {
  assert.equal(inferExchange(''), null);
  assert.equal(inferExchange(undefined), null);
  assert.equal(inferExchange('bad id!'), null);
  assert.throws(() => yahooProvider.formatSymbol({ identifier: 'X', exchange: undefined }), { code: 'INVALID_REQUEST' });
  assert.throws(() => yahooProvider.formatSymbol({ identifier: 'X', exchange: 'LSE' }), { code: 'INVALID_REQUEST' });
});
test('Screener page with no exchange links and provider with no match -> UNRESOLVED (visible), not a guess', async () => {
  const t = setup({ works: [], codes: { nse: null, bse: null } });
  await assert.rejects(get(t, stock('QQQ')), (e) => e.code === 'UNRESOLVED' && e.details.tried.join() === 'QQQ.NS');
});
test('invalid codes on the Screener page are skipped, not requested', async () => {
  const t = setup({ works: [], codes: { nse: 'bad symbol!', bse: { name: '???', code: '544961' } } });
  await assert.rejects(get(t, stock('544961')), { code: 'UNRESOLVED' });
  assert.deepEqual(t.calls, ['544961.BO']);
});

// ---------- Yahoo provider against a fake fetch ----------
function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url, init) => { urls.push(String(url)); return handler(String(url), init); };
  return fn(urls).finally(() => { globalThis.fetch = original; });
}
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const chart = (extra = {}) => ({ chart: { result: [{ meta: { symbol: '544961.BO', currency: 'INR', gmtoffset: 19800 }, timestamp: [1761795300, 1761881700], indicators: { quote: [{ open: [10, null], high: [11, null], low: [9, null], close: [10.5, null], volume: [100, null] }] }, ...extra }], error: null } });

test('yahoo: requests the BSE symbol, parses rows; null BSE rows are dropped by the normalizer, not the whole series', () =>
  withFetch(() => json(chart()), async (urls) => {
    const r = await yahooProvider.getHistoricalCandles({ symbol: '544961.BO', interval: '1d', range: '6M' });
    assert.match(urls[0], /\/v8\/finance\/chart\/544961\.BO\?range=6mo&interval=1d/);
    assert.equal(r.rows.length, 2);
    const n = normalizeCandles(r.rows, { gmtoffset: r.meta.gmtoffset });
    assert.equal(n.candles.length, 1);
    assert.equal(n.rejected, 1);
  }));
test('yahoo: 404 and "Not Found" bodies -> NOT_FOUND; 429 -> RATE_LIMIT; 500 -> PROVIDER; thrown fetch -> NETWORK', async () => {
  const args = { symbol: 'X.BO', interval: '1d', range: '6M' };
  await withFetch(() => json({}, 404), () => assert.rejects(yahooProvider.getHistoricalCandles(args), { code: 'NOT_FOUND' }));
  await withFetch(() => json({ chart: { result: null, error: { code: 'Not Found' } } }), () => assert.rejects(yahooProvider.getHistoricalCandles(args), { code: 'NOT_FOUND' }));
  await withFetch(() => json({}, 429), () => assert.rejects(yahooProvider.getHistoricalCandles(args), { code: 'RATE_LIMIT' }));
  await withFetch(() => json({}, 500), () => assert.rejects(yahooProvider.getHistoricalCandles(args), { code: 'PROVIDER' }));
  await withFetch(() => { throw new TypeError('offline'); }, () => assert.rejects(yahooProvider.getHistoricalCandles(args), { code: 'NETWORK' }));
});
test('yahoo: valid symbol with no candles -> EMPTY; garbage JSON shape -> INVALID_RESPONSE', async () => {
  const args = { symbol: 'X.BO', interval: '1d', range: '6M' };
  await withFetch(() => json({ chart: { result: [{ meta: {}, indicators: { quote: [{}] } }] } }), () => assert.rejects(yahooProvider.getHistoricalCandles(args), { code: 'EMPTY' }));
  await withFetch(() => json({ nope: true }), () => assert.rejects(yahooProvider.getHistoricalCandles(args), { code: 'INVALID_RESPONSE' }));
});
test('yahoo: search keeps only Indian equity listings (.NS/.BO)', () =>
  withFetch(() => json({ quotes: [{ symbol: 'DUDANI.BO', quoteType: 'EQUITY', longname: 'Dudani Retail Ltd' }, { symbol: 'DUDA.L', quoteType: 'EQUITY' }, { symbol: 'DUDANI.NS', quoteType: 'ETF' }] }), async () => {
    const out = await yahooProvider.searchSymbols('DUDANI');
    assert.deepEqual(out.map((o) => [o.symbol, o.exchange]), [['DUDANI.BO', 'BSE']]);
  }));

// ---------- detector + provider contract ----------
test('detector: BSE numeric links, with and without /consolidated/', () => {
  assert.equal(parseCompanyUrl('https://www.screener.in/company/544961/').screenerIdentifier, '544961');
  assert.equal(parseCompanyUrl('/company/532540/consolidated/').variant, 'consolidated');
});
test('provider contract: Yahoo satisfies it; incomplete providers are rejected at startup', () => {
  assert.equal(assertProvider(yahooProvider), yahooProvider);
  assert.throws(() => assertProvider({ id: 'x', name: 'X' }), /missing function/);
  assert.throws(() => assertProvider(null), /needs string/);
});
