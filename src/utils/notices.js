// Pure builder for the panel's notices (stale data, derived candles, missing daily rows). No DOM, easy to test.
import { formatFetchedAt, formatShortDate } from './formatters.js';

const MISSING = {
  'null-price': 'provider returned empty prices',
  'partial-price': 'provider returned incomplete prices',
  'non-positive-price': 'provider returned zero or negative prices',
  'invalid-ohlc': 'provider returned inconsistent prices',
  'invalid-time': 'provider returned an unreadable date',
};
const SKIPPED = {
  'unsupported-exchange': 'trading hours unknown for this exchange',
  'session-not-complete': 'the trading session is not complete yet',
  'no-intraday-data': 'no intraday data for that day',
  'missing-bars': 'intraday data for that day is incomplete',
  'off-grid-bars': 'intraday bars do not match the normal trading schedule',
  'final-bar-empty': 'the closing intraday bar has no prices, so completeness cannot be verified',
  'no-valid-bars': 'no valid intraday bars',
  'intraday-data-stale': 'intraday data could not be refreshed',
};

export const missingReasonText = (r) => MISSING[r] || 'no valid prices';
export function skippedReasonText({ reason, detail }) {
  if (reason?.startsWith('provider-error:')) return `intraday request failed: ${reason.slice('provider-error:'.length)}`;
  return (SKIPPED[reason] || 'completeness could not be verified') + (detail ? ` (${detail})` : '');
}

const MAX_LINES = 3;

/** @returns {{kind:'warn'|'info', text:string}[]} */
export function buildNotices(p) {
  const out = [];
  if (!p) return out;

  if (p.stale) out.push({ kind: 'warn', text: `Provider unreachable. Showing cached data fetched ${formatFetchedAt(p.fetchedAt)}; it may be out of date.` });

  const derived = p.derived || [];
  if (derived.length) {
    const dates = derived.map((d) => formatShortDate(d.date)).join(', ');
    out.push({ kind: 'info', text: `${dates} candle${derived.length > 1 ? 's' : ''} derived from intraday data. Official daily candle unavailable.` });
    if (derived.some((d) => !d.volumeKnown)) out.push({ kind: 'info', text: 'Volume is not shown for derived candles with incomplete volume data.' });
  }

  const reasonByDate = new Map((p.missingDates || []).map((m) => [m.date, m.reason]));
  const notDerived = p.notDerived || [];
  for (const n of notDerived.slice(0, MAX_LINES)) {
    out.push({ kind: 'warn', text: `${formatShortDate(n.date)}: official daily candle missing (${missingReasonText(reasonByDate.get(n.date))}); not derived: ${skippedReasonText(n)}.` });
  }
  if (notDerived.length > MAX_LINES) out.push({ kind: 'warn', text: `…and ${notDerived.length - MAX_LINES} more missing day(s).` });

  const accounted = new Set([...derived.map((d) => d.date), ...notDerived.map((n) => n.date)]);
  const earlier = (p.missingDates || []).filter((m) => !accounted.has(m.date));
  if (earlier.length) out.push({ kind: 'info', text: `${earlier.length} earlier day(s) had no usable prices from the provider (e.g. ${formatShortDate(earlier[0].date)}).` });
  return out;
}
