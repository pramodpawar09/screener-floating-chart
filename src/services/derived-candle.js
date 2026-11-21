// Builds ONE daily candle from a COMPLETE intraday session, for when the provider's official daily row is empty.
// This is derived data, never the official exchange close (NSE/BSE closing prices are volume-weighted over the last
// 30 minutes, so the derived close can differ). It refuses unless completeness can be verified:
//   1. the session has ended (exchange local time >= close),
//   2. every expected bar slot (09:15 ... 15:15 for 15-minute bars = 25 slots) is present in the provider response,
//      either as a valid bar or as an all-empty row (= no trades in that slot),
//   3. no bar lies off the expected schedule (special sessions such as Muhurat trading are therefore refused),
//   4. the FINAL slot holds a valid bar. An empty tail is indistinguishable from data the provider has not published yet.
const IST = { offsetSec: 19800, open: [9, 15], close: [15, 30] };
export const SESSIONS = { NSE: IST, BSE: IST };

const round2 = (n) => Math.round(n * 100) / 100;

export function expectedSlots(date, exchange, barMinutes) {
  const s = SESSIONS[exchange];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!s || !m || !(barMinutes > 0)) return null;
  const dayStart = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000;
  const openSec = dayStart + s.open[0] * 3600 + s.open[1] * 60;
  const closeSec = dayStart + s.close[0] * 3600 + s.close[1] * 60;
  const step = barMinutes * 60;
  if ((closeSec - openSec) % step !== 0) return null;
  const slots = [];
  for (let t = openSec; t < closeSec; t += step) slots.push(t);
  return { dayStart, closeSec, slots, offsetSec: s.offsetSec };
}

/**
 * @param {string}   date        'YYYY-MM-DD' trading date to derive
 * @param {string}   exchange    'NSE' | 'BSE'
 * @param {object[]} bars        valid intraday candles; time = exchange-local unix seconds
 * @param {number[]} emptyTimes  local-seconds of intraday rows whose prices were ALL empty (no-trade slots)
 * @param {number}   barMinutes  intraday bar length
 * @param {number}   nowMs       current time (injectable for tests)
 * @returns {{ok:true,candle:object,barCount:number,expectedBars:number}|{ok:false,reason:string,detail?:string}}
 */
export function deriveDailyCandle({ date, exchange, bars = [], emptyTimes = [], barMinutes = 15, nowMs = Date.now() }) {
  if (!SESSIONS[exchange]) return { ok: false, reason: 'unsupported-exchange' };
  const grid = expectedSlots(date, exchange, barMinutes);
  if (!grid) return { ok: false, reason: 'unsupported-exchange', detail: 'cannot build the expected bar schedule' };

  if (Math.floor(nowMs / 1000) + grid.offsetSec < grid.closeSec) return { ok: false, reason: 'session-not-complete' };

  const inDay = (t) => typeof t === 'number' && t >= grid.dayStart && t < grid.dayStart + 86400;
  const dayBars = bars.filter((b) => inDay(b.time)).sort((a, b) => a.time - b.time);
  const dayEmpty = emptyTimes.filter(inDay);
  if (dayBars.length === 0 && dayEmpty.length === 0) return { ok: false, reason: 'no-intraday-data' };

  const slotSet = new Set(grid.slots);
  if ([...dayBars.map((b) => b.time), ...dayEmpty].some((t) => !slotSet.has(t))) return { ok: false, reason: 'off-grid-bars' };

  const present = new Set([...dayBars.map((b) => b.time), ...dayEmpty]);
  const missing = grid.slots.filter((t) => !present.has(t));
  if (missing.length) return { ok: false, reason: 'missing-bars', detail: `${grid.slots.length - missing.length} of ${grid.slots.length} bars present` };

  if (dayBars.length === 0) return { ok: false, reason: 'no-valid-bars' };
  if (dayBars[dayBars.length - 1].time !== grid.slots[grid.slots.length - 1]) return { ok: false, reason: 'final-bar-empty' };

  const volumeKnown = dayBars.every((b) => Number.isFinite(b.volume) && b.volume > 0); // a priced bar always has volume
  return {
    ok: true,
    barCount: dayBars.length,
    expectedBars: grid.slots.length,
    candle: {
      time: date,
      open: dayBars[0].open,
      high: round2(Math.max(...dayBars.map((b) => b.high))),
      low: round2(Math.min(...dayBars.map((b) => b.low))),
      close: dayBars[dayBars.length - 1].close,
      volume: volumeKnown ? dayBars.reduce((sum, b) => sum + b.volume, 0) : 0,
      volumeKnown,
      derived: true,
    },
  };
}
