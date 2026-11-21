// Orchestrates: resolve symbol -> cache lookup -> de-duplicated provider fetch -> normalise -> cache.
// The chart only ever sees the normalised payload, never provider-specific data.
import { ExtError } from '../shared/errors.js';
import { TIMEFRAMES, ttlMsFor, MAX_STALE_MS } from '../shared/timeframes.js';
import { normalizeCandles } from './data-normalizer.js';
import { IDENTIFIER_RE } from './symbol-resolver.js';
import { namesMatch } from './name-match.js';
import { deriveDailyCandle } from './derived-candle.js';
import { log } from '../shared/log.js';

const RETRY_WITH_STALE = new Set(['NETWORK', 'RATE_LIMIT', 'PROVIDER']);
const INTRADAY_TF = TIMEFRAMES['1W']; // 15-minute bars over 5 trading days: used only to complete a missing latest daily candle
const byTime = (a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0);

export function createMarketDataService({ provider, resolver, cache, now = () => Date.now() }) {
  const inflight = new Map();
  const unresolvedUntil = new Map(); // short negative cache so failing stocks don't re-hit the network on every hover
  const NEGATIVE_TTL_MS = 2 * 60 * 1000;
  const unresolvedError = (id, tried) =>
    new ExtError('UNRESOLVED', undefined, {
      tried,
      identifier: id,
      hint: tried.some((sym) => provider.parseSymbol(sym)?.exchange === 'BSE')
        ? `${provider.name} may not cover this BSE listing (common for SME or newly listed companies). Another data provider can be added in src/services/providers/.`
        : undefined,
    });

  async function loadSeries({ symbol, exchange, tf }) {
    const key = [provider.id, symbol, exchange, tf.interval, tf.range].join('|');
    const cached = await cache.get(key, ttlMsFor(tf.interval));
    if (cached?.fresh) return { ...cached.data, fetchedAt: cached.fetchedAt, fromCache: true, stale: false };

    let promise = inflight.get(key); // request de-duplication
    if (!promise) {
      promise = (async () => {
        const raw = await provider.getHistoricalCandles({ symbol, interval: tf.interval, range: tf.range });
        const { candles, rejected, rejectedRows, hasVolume } = normalizeCandles(raw.rows, { intraday: tf.intraday, gmtoffset: raw.meta.gmtoffset });
        if (candles.length === 0) throw new ExtError('EMPTY');
        const data = { candles, rejected, rejectedRows, hasVolume, currency: raw.meta.currency };
        await cache.set(key, data);
        return { data, fetchedAt: now() };
      })();
      inflight.set(key, promise);
      const done = () => inflight.delete(key);
      promise.then(done, done);
    }

    try {
      const { data, fetchedAt } = await promise;
      return { ...data, fetchedAt, fromCache: false, stale: false };
    } catch (err) {
      if (cached && RETRY_WITH_STALE.has(err.code)) {
        const ageMs = now() - cached.fetchedAt;
        if (ageMs <= MAX_STALE_MS) {
          log('serving STALE cache after provider failure', { key, error: err.code, ageMinutes: Math.round(ageMs / 60000), fetchedAt: new Date(cached.fetchedAt).toISOString() });
          return { ...cached.data, fetchedAt: cached.fetchedAt, fromCache: true, stale: true };
        }
        log('cached data is older than the stale limit; NOT used', { key, error: err.code, ageHours: Math.round(ageMs / 3600000) });
      }
      throw err;
    }
  }

  // For daily timeframes: report rejected rows, and complete a missing LATEST daily candle from a verified complete
  // intraday session. Official candles always win; derived candles are flagged and never cached with official data.
  async function completeDaily({ series, target, tf }) {
    const out = { candles: series.candles, missingDates: [], derived: [], notDerived: [] };
    if (tf.intraday) return out;

    const official = new Set(series.candles.map((c) => c.time));
    const seen = new Set();
    for (const r of series.rejectedRows || []) {
      if (!r.date || official.has(r.date) || seen.has(r.date)) continue;
      seen.add(r.date);
      out.missingDates.push({ date: r.date, reason: r.reason });
    }
    if (out.missingDates.length) log('rows rejected, no official candle for', { symbol: target.symbol, exchange: target.exchange, interval: tf.interval, missing: out.missingDates });
    if (tf.interval !== '1d' || series.stale) return out;

    const lastOfficial = series.candles[series.candles.length - 1].time;
    const trailing = out.missingDates.filter((m) => m.date > lastOfficial);
    if (!trailing.length) return out;

    let intraday = null;
    let failure = null;
    try {
      intraday = await loadSeries({ symbol: target.symbol, exchange: target.exchange, tf: INTRADAY_TF });
      if (intraday.stale) failure = 'intraday-data-stale';
    } catch (e) {
      failure = `provider-error:${e.code || 'UNKNOWN'}`; // surfaced to the user, not swallowed
    }

    const emptyTimes = (intraday?.rejectedRows || []).filter((r) => r.reason === 'null-price' && typeof r.time === 'number').map((r) => r.time);
    const derivedCandles = [];
    for (const m of trailing) {
      const r = failure
        ? { ok: false, reason: failure }
        : deriveDailyCandle({ date: m.date, exchange: target.exchange, bars: intraday.candles, emptyTimes, barMinutes: 15, nowMs: now() });
      if (r.ok) {
        derivedCandles.push(r.candle);
        out.derived.push({ date: m.date, barCount: r.barCount, expectedBars: r.expectedBars, volumeKnown: r.candle.volumeKnown, intervalLabel: INTRADAY_TF.intervalLabel });
        const { open, high, low, close, volume } = r.candle;
        log('DERIVED daily candle from intraday (not official)', { symbol: target.symbol, exchange: target.exchange, date: m.date, open, high, low, close, volume, bars: `${r.barCount}/${r.expectedBars}` });
      } else {
        out.notDerived.push({ date: m.date, reason: r.reason, detail: r.detail });
        log('NOT derived', { symbol: target.symbol, exchange: target.exchange, date: m.date, reason: r.reason, detail: r.detail });
      }
    }
    if (derivedCandles.length) {
      const merged = new Map(series.candles.map((c) => [c.time, c]));
      for (const d of derivedCandles) if (!merged.has(d.time)) merged.set(d.time, d); // official wins; one candle per date
      out.candles = [...merged.values()].sort(byTime);
    }
    return out;
  }

  async function getCandles({ stock, timeframeId }) {
    const tf = TIMEFRAMES[timeframeId];
    const id = stock?.screenerIdentifier;
    if (!tf || typeof id !== 'string' || !IDENTIFIER_RE.test(id)) throw new ExtError('INVALID_REQUEST');
    const clean = { screenerIdentifier: id, companyName: String(stock.companyName || id).slice(0, 120) };

    let target = await resolver.resolve(clean);
    log('resolve', { company: clean.companyName, identifier: id, exchange: target.exchange, symbol: target.symbol, via: target.via });
    const negative = unresolvedUntil.get(id);
    if (target.via === 'screener-id' && negative && negative.until > Date.now()) throw unresolvedError(id, negative.tried);

    const tried = [];
    const attempt = async (cand) => {
      tried.push(cand.symbol);
      try {
        const loaded = await loadSeries({ symbol: cand.symbol, exchange: cand.exchange, tf });
        log('data ok', { symbol: cand.symbol, exchange: cand.exchange, interval: tf.interval, candles: loaded.candles.length, lastCandle: loaded.candles[loaded.candles.length - 1].time, rejectedRows: loaded.rejected, fromCache: loaded.fromCache, stale: loaded.stale, fetchedAt: new Date(loaded.fetchedAt).toISOString() });
        return loaded;
      } catch (e) {
        if (e.code !== 'NOT_FOUND') throw e;
        log('provider has no such symbol:', cand.symbol);
        return null;
      }
    };

    let series = target.symbol ? await attempt(target) : null;
    if (!series && target.via === 'saved') throw unresolvedError(id, tried); // a saved choice no longer works

    // 1) Listing codes published on the company's own Screener page: same company by construction.
    if (!series) {
      for (const cand of await resolver.discover(clean)) {
        if (tried.includes(cand.symbol)) continue;
        series = await attempt(cand);
        if (series) {
          target = cand;
          await resolver.remember(clean, cand);
          break;
        }
      }
    }

    // 2) Provider ticker search. Never auto-accepted unless the provider's company name matches Screener's;
    //    otherwise the user must confirm the listing. No silent NSE<->BSE substitution.
    if (!series) {
      const found = (await resolver.search(clean)).filter((o) => !tried.includes(o.symbol));
      const verified = found.filter((o) => namesMatch(o.name, clean.companyName));
      if (verified.length === 1) {
        series = await attempt(verified[0]);
        if (series) {
          target = { ...verified[0], via: 'search-verified' };
          await resolver.remember(clean, verified[0]);
        }
      }
      if (!series) {
        const rest = found.filter((o) => !tried.includes(o.symbol));
        if (rest.length > 0) throw new ExtError('AMBIGUOUS', undefined, { options: rest.map(({ symbol, exchange, name }) => ({ symbol, exchange, name })) });
      }
    }

    if (!series) {
      log('UNRESOLVED', { identifier: id, tried });
      unresolvedUntil.set(id, { until: Date.now() + NEGATIVE_TTL_MS, tried });
      throw unresolvedError(id, tried);
    }

    const { rejectedRows, ...seriesRest } = series; // keep the payload small; details are logged and summarised below
    const completed = await completeDaily({ series, target, tf });
    return {
      companyName: clean.companyName,
      screenerIdentifier: id,
      symbol: target.symbol,
      exchange: target.exchange,
      timeframeId: tf.id,
      intervalLabel: tf.intervalLabel,
      intraday: tf.intraday,
      providerName: provider.name,
      resolvedVia: target.via,
      ...seriesRest,
      candles: completed.candles,
      missingDates: completed.missingDates,
      derived: completed.derived,
      notDerived: completed.notDerived,
    };
  }

  async function selectSymbol({ stock, symbol }) {
    const id = stock?.screenerIdentifier;
    if (typeof id !== 'string' || !IDENTIFIER_RE.test(id)) throw new ExtError('INVALID_REQUEST');
    if (!(await resolver.select({ screenerIdentifier: id }, symbol))) throw new ExtError('INVALID_REQUEST');
    return { ok: true };
  }

  async function checkProvider() {
    const started = Date.now();
    try {
      await provider.getHistoricalCandles({ symbol: provider.formatSymbol({ identifier: 'RELIANCE', exchange: 'NSE' }), interval: '1d', range: '1W' });
      return { ok: true, provider: provider.name, requiresKey: provider.requiresKey, latencyMs: Date.now() - started };
    } catch (e) {
      return { ok: false, provider: provider.name, requiresKey: provider.requiresKey, code: e.code || 'UNKNOWN', message: e.message };
    }
  }

  return { getCandles, selectSymbol, checkProvider };
}
