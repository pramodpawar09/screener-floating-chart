const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

export const formatPrice = (n) => (Number.isFinite(n) ? inr.format(n) : '—');

export function formatVolume(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e7) return (n / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return (n / 1e5).toFixed(2) + ' L';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + ' K';
  return String(Math.round(n));
}

export const formatPercent = (p) => (Number.isFinite(p) ? (p >= 0 ? '+' : '') + p.toFixed(2) + '%' : '');

// Accepts 'YYYY-MM-DD', exchange-local unix seconds (shifted so UTC fields read as IST), or a BusinessDay object.
export function formatTimeLabel(time) {
  if (typeof time === 'string') {
    const [y, m, d] = time.split('-').map(Number);
    return MONTHS[m - 1] ? `${d} ${MONTHS[m - 1]} ${y}` : time;
  }
  if (typeof time === 'number') {
    const dt = new Date(time * 1000);
    return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
  }
  if (time && typeof time === 'object') return `${time.day} ${MONTHS[time.month - 1]} ${time.year}`;
  return '';
}

// Change across the displayed range: last close vs first open.
export function rangeChange(candles) {
  if (!candles?.length) return null;
  const first = candles[0].open;
  const last = candles[candles.length - 1].close;
  if (!(first > 0)) return null;
  return { abs: last - first, pct: ((last - first) / first) * 100 };
}

// '2026-11-05' -> 'Nov 5'
export function formatShortDate(date) {
  const [, m, d] = String(date).split('-').map(Number);
  return MONTHS[m - 1] ? `${MONTHS[m - 1]} ${d}` : String(date);
}

// Fetch time in the viewer's local time zone, e.g. '6 Nov, 2:05 pm'
export function formatFetchedAt(ms) {
  if (!Number.isFinite(ms)) return 'at an unknown time';
  return new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}
