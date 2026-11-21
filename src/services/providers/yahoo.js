// Yahoo Finance chart API provider (UNOFFICIAL, keyless).
// Implements the provider interface used by market-data-service:
//   id, name, requiresKey, formatSymbol, parseSymbol, getHistoricalCandles, searchSymbols
// Runs only in the service worker (host_permissions grant cross-origin access).
import { ExtError } from '../../shared/errors.js';

const BASE = 'https://query1.finance.yahoo.com';
const RANGE = { '1D': '1d', '1W': '5d', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y' };
const INTERVAL = { '5m': '5m', '15m': '15m', '1d': '1d', '1w': '1wk' };
const IST_OFFSET = 19800; // Indian exchanges: UTC+5:30, no DST. Used only if the provider omits gmtoffset.

async function getJson(url, signal) {
  let res;
  try {
    res = await fetch(url, { signal, credentials: 'omit', headers: { Accept: 'application/json' } });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ExtError('NETWORK');
  }
  if (res.status === 404) throw new ExtError('NOT_FOUND');
  if (res.status === 429) throw new ExtError('RATE_LIMIT');
  if (!res.ok) throw new ExtError('PROVIDER', `The market data provider returned HTTP ${res.status}.`);
  try {
    return await res.json();
  } catch {
    throw new ExtError('INVALID_RESPONSE');
  }
}

export const yahooProvider = {
  id: 'yahoo',
  name: 'Yahoo Finance (unofficial)',
  requiresKey: false,

  // Strict: an unknown/missing exchange is an error, never a silent NSE default.
  formatSymbol({ identifier, exchange }) {
    if (!identifier || (exchange !== 'NSE' && exchange !== 'BSE')) throw new ExtError('INVALID_REQUEST', 'Exchange must be NSE or BSE.');
    return `${identifier}.${exchange === 'BSE' ? 'BO' : 'NS'}`;
  },

  parseSymbol(symbol) {
    const m = /^(.+)\.(NS|BO)$/i.exec(symbol || '');
    return m ? { baseSymbol: m[1].toUpperCase(), exchange: m[2].toUpperCase() === 'BO' ? 'BSE' : 'NSE' } : null;
  },

  async getHistoricalCandles({ symbol, interval, range, signal }) {
    if (!RANGE[range] || !INTERVAL[interval]) throw new ExtError('INVALID_REQUEST');
    const url =
      `${BASE}/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?range=${RANGE[range]}&interval=${INTERVAL[interval]}&includePrePost=false`;
    const json = await getJson(url, signal);

    const result = json?.chart?.result?.[0];
    if (!result) {
      if (/not found/i.test(json?.chart?.error?.code || json?.chart?.error?.description || '')) throw new ExtError('NOT_FOUND');
      throw new ExtError('INVALID_RESPONSE');
    }
    const ts = result.timestamp;
    const q = result.indicators?.quote?.[0];
    if (!Array.isArray(ts) || ts.length === 0) throw new ExtError('EMPTY');
    if (!q) throw new ExtError('INVALID_RESPONSE');

    const rows = ts.map((t, i) => ({
      time: t,
      open: q.open?.[i],
      high: q.high?.[i],
      low: q.low?.[i],
      close: q.close?.[i],
      volume: q.volume?.[i],
    }));
    const g = Number(result.meta?.gmtoffset);
    return {
      rows,
      meta: {
        symbol: result.meta?.symbol || symbol,
        currency: result.meta?.currency || 'INR',
        gmtoffset: Number.isFinite(g) ? g : IST_OFFSET,
      },
    };
  },

  // Symbol search by *ticker text* (never by company name). Returns Indian equity listings only.
  async searchSymbols(query, signal) {
    const url = `${BASE}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
    const json = await getJson(url, signal);
    const out = [];
    for (const item of json?.quotes || []) {
      if (item?.quoteType !== 'EQUITY') continue;
      const parsed = this.parseSymbol(item.symbol);
      if (!parsed) continue;
      out.push({
        symbol: item.symbol,
        baseSymbol: parsed.baseSymbol,
        exchange: parsed.exchange,
        name: item.longname || item.shortname || item.symbol,
      });
    }
    return out;
  },
};
