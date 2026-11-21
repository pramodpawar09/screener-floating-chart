import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListingCodes } from '../src/services/screener-page.js';
import { createMarketDataService } from '../src/services/market-data-service.js';
import { createSymbolResolver } from '../src/services/symbol-resolver.js';
import { createCache } from '../src/services/cache-service.js';
import { ExtError } from '../src/shared/errors.js';

// Link taken from the real Screener page for company 544961 (Dudani Retail, BSE SME)
const DUDANI = '<a href="https://www.bseindia.com/stock-share-price/dudani-retail-ltd/DUDANI/544961/" target="_blank">BSE - SME: 544961</a>';

test('parses BSE short name and code from the real Screener link shape', () => {
  assert.deepEqual(parseListingCodes(DUDANI), { nse: null, bse: { name: 'DUDANI', code: '544961' } });
});
test('parses NSE symbol, including encoded characters', () => {
  assert.equal(parseListingCodes('<a href="https://www.nseindia.com/get-quotes/equity?symbol=M%26M">').nse, 'M&M');
  assert.equal(parseListingCodes('<a href="https://www.nseindia.com/get-quotes/equity?symbol=TCS">').nse, 'TCS');
});
test('missing / junk input yields nulls', () => {
  assert.deepEqual(parseListingCodes('<html></html>'), { nse: null, bse: null });
  assert.deepEqual(parseListingCodes(undefined), { nse: null, bse: null });
});

const rows = [{ time: 1761795300, open: 10, high: 11, low: 9, close: 10.5, volume: 100 }];
function setup({ works, codes }) {
  const calls = [];
  const provider = {
    id: 'f', name: 'F', requiresKey: false,
    formatSymbol: ({ identifier, exchange }) => `${identifier}.${exchange === 'BSE' ? 'BO' : 'NS'}`,
    parseSymbol: (s) => { const m = /^(.+)\.(NS|BO)$/.exec(s); return m && { baseSymbol: m[1], exchange: m[2] === 'BO' ? 'BSE' : 'NSE' }; },
    async getHistoricalCandles({ symbol }) { calls.push(symbol); if (!works.includes(symbol)) throw new ExtError('NOT_FOUND'); return { rows, meta: { symbol, currency: 'INR', gmtoffset: 19800 } }; },
    async searchSymbols() { return []; },
  };
  const store = {};
  const overrides = { get: async (id) => store[id] || null, set: async (id, v) => void (store[id] = v) };
  let lookups = 0;
  const resolver = createSymbolResolver({ provider, overrides, pageLookup: async () => { lookups++; return codes; } });
  return { svc: createMarketDataService({ provider, resolver, cache: createCache() }), calls, store, lookups: () => lookups };
}
const stock = { screenerIdentifier: '544961', companyName: 'Dudani Retail' };

test('numeric code unknown to provider -> falls back to the BSE short name from the Screener page and remembers it', async () => {
  const t = setup({ works: ['DUDANI.BO'], codes: { nse: null, bse: { name: 'DUDANI', code: '544961' } } });
  const r = await t.svc.getCandles({ stock, timeframeId: '6M' });
  assert.equal(r.symbol, 'DUDANI.BO');
  assert.equal(t.store['544961'].symbol, 'DUDANI.BO');
  assert.deepEqual(t.calls, ['544961.BO', 'DUDANI.BO']); // 544961.BO is not retried
  const again = await t.svc.getCandles({ stock, timeframeId: '1Y' });
  assert.equal(again.symbol, 'DUDANI.BO');
  assert.equal(t.lookups(), 1); // saved choice used; no more page lookups
});
test('nothing works -> UNRESOLVED listing every symbol tried; then a short negative cache avoids repeat network calls', async () => {
  const t = setup({ works: [], codes: { nse: null, bse: { name: 'DUDANI', code: '544961' } } });
  await assert.rejects(t.svc.getCandles({ stock, timeframeId: '6M' }), (e) => e.code === 'UNRESOLVED' && e.details.tried.join() === '544961.BO,DUDANI.BO');
  const n = t.calls.length;
  await assert.rejects(t.svc.getCandles({ stock, timeframeId: '6M' }), { code: 'UNRESOLVED' });
  assert.equal(t.calls.length, n);
});
test('page lookup network failure surfaces as NETWORK, not a wrong symbol', async () => {
  const t = setup({ works: [], codes: null });
  const provider = null; void provider;
  const failing = createSymbolResolver({
    provider: { formatSymbol: () => 'X', parseSymbol: () => null, searchSymbols: async () => [] },
    overrides: { get: async () => null, set: async () => {} },
    pageLookup: async () => { throw new ExtError('NETWORK'); },
  });
  await assert.rejects(failing.discover(stock), { code: 'NETWORK' });
  void t;
});
