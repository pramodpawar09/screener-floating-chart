// Provider registry + contract check. To add a data source: create providers/<name>.js exporting an object
// with the members below, register it here, and select it in src/background/service-worker.js.
//
//   id, name, requiresKey
//   formatSymbol({ identifier, exchange: 'NSE'|'BSE' }) -> provider symbol   (must throw on unknown exchange)
//   parseSymbol(symbol) -> { baseSymbol, exchange } | null
//   getHistoricalCandles({ symbol, interval, range, signal }) -> { rows, meta: { symbol, currency, gmtoffset } }
//   searchSymbols(query, signal) -> [{ symbol, baseSymbol, exchange, name }]
import { yahooProvider } from './yahoo.js';

const FUNCTIONS = ['formatSymbol', 'parseSymbol', 'getHistoricalCandles', 'searchSymbols'];

export function assertProvider(p) {
  if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') throw new Error('Market data provider needs string "id" and "name".');
  for (const fn of FUNCTIONS) if (typeof p[fn] !== 'function') throw new Error(`Market data provider "${p.id}" is missing function "${fn}".`);
  return p;
}

export const providers = { yahoo: yahooProvider };
