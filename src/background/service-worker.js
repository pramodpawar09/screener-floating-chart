// MV3 service worker. It may be stopped at any time, so it keeps no essential state in memory:
// cache + symbol overrides live in chrome.storage.local; in-flight de-duplication is best-effort.
import { providers, assertProvider } from '../services/providers/index.js';
import { createCache } from '../services/cache-service.js';
import { fetchListingCodes } from '../services/screener-page.js';
import { createSymbolResolver } from '../services/symbol-resolver.js';
import { createMarketDataService } from '../services/market-data-service.js';
import { toExtError } from '../shared/errors.js';

const storage = {
  get: async (k) => (await chrome.storage.local.get(k))[k],
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
  remove: (k) => chrome.storage.local.remove(k),
};

const overrides = {
  async get(id) {
    return ((await storage.get('symbolOverrides')) || {})[id] || null;
  },
  async set(id, value) {
    const all = (await storage.get('symbolOverrides')) || {};
    all[id] = value;
    await storage.set('symbolOverrides', all);
  },
};

const provider = assertProvider(providers.yahoo); // swap here to change data source
const resolver = createSymbolResolver({ provider, overrides, pageLookup: (id) => fetchListingCodes(id) });
const service = createMarketDataService({ provider, resolver, cache: createCache({ storage }) });

const handlers = {
  GET_CANDLES: (m) => service.getCandles({ stock: m.stock, timeframeId: m.timeframeId }),
  SELECT_SYMBOL: (m) => service.selectSymbol({ stock: m.stock, symbol: m.symbol }),
  PROVIDER_STATUS: () => service.checkProvider(),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = msg && handlers[msg.type];
  if (!handler || sender.id !== chrome.runtime.id) return false;
  handler(msg)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: toExtError(e).toJSON() }));
  return true; // async response
});
