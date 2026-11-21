// Turns raw provider rows into strictly valid, sorted, de-duplicated candles.
// Row shape in:  { time, open, high, low, close, volume }
//   time = unix seconds (number) or 'YYYY-MM-DD' (string)
// Candle out:    { time, open, high, low, close, volume }
//   time = 'YYYY-MM-DD' (daily/weekly: the exchange-local trading date)
//        | exchange-local unix seconds (intraday: shifted by gmtoffset so the chart's UTC axis reads as exchange time)
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDate(s) {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const toNum = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const round2 = (n) => Math.round(n * 100) / 100;

export function normalizeTime(t, { intraday = false, gmtoffset = 0 } = {}) {
  if (typeof t === 'string') return !intraday && isValidDate(t) ? t : null;
  const n = toNum(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  const sec = Math.floor(n > 1e12 ? n / 1000 : n);
  const local = sec + gmtoffset; // exchange-local wall clock expressed as UTC fields
  return intraday ? local : new Date(local * 1000).toISOString().slice(0, 10);
}

const dateOf = (time) => (typeof time === 'string' ? time : typeof time === 'number' ? new Date(time * 1000).toISOString().slice(0, 10) : null);
const MAX_REJECTED_ROWS = 500;

// Result: { candles, rejected, rejectedRows: [{ time, date, reason }], hasVolume }
// Reasons: invalid-time | null-price (all four prices empty) | partial-price | non-positive-price | invalid-ohlc
// Rejected rows are never silently forgotten: callers surface them (panel notice + [SFC] log).
export function normalizeCandles(rows, opts = {}) {
  const result = { candles: [], rejected: 0, rejectedRows: [], hasVolume: false };
  if (!Array.isArray(rows)) return result;

  const byTime = new Map();
  for (const r of rows) {
    const time = r ? normalizeTime(r.time, opts) : null;
    const open = toNum(r?.open);
    const high = toNum(r?.high);
    const low = toNum(r?.low);
    const close = toNum(r?.close);
    const prices = [open, high, low, close];

    let reason = null;
    if (time === null) reason = 'invalid-time';
    else if (prices.every((v) => !Number.isFinite(v))) reason = 'null-price';
    else if (prices.some((v) => !Number.isFinite(v))) reason = 'partial-price';
    else if (prices.some((v) => v <= 0)) reason = 'non-positive-price';
    else if (!(high >= Math.max(open, close, low) && low <= Math.min(open, close, high))) reason = 'invalid-ohlc';

    if (reason) {
      result.rejected++;
      if (result.rejectedRows.length < MAX_REJECTED_ROWS) result.rejectedRows.push({ time, date: dateOf(time), reason });
      continue;
    }
    const vol = toNum(r.volume);
    byTime.set(time, {
      time,
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume: Number.isFinite(vol) && vol >= 0 ? vol : 0,
    }); // later duplicates overwrite earlier ones: one candle per time
  }

  result.candles = [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  result.hasVolume = result.candles.some((c) => c.volume > 0);
  return result;
}
