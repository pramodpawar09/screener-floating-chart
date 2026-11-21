// Each timeframe is a *range* paired with the *candle interval* used to fill it.
// Abstract values ('1D'..'5Y', '5m'|'15m'|'1d'|'1w') are mapped to provider syntax inside the provider.
export const TIMEFRAMES = {
  '1D': { id: '1D', label: '1D', range: '1D', interval: '5m', intraday: true, intervalLabel: '5-minute' },
  '1W': { id: '1W', label: '1W', range: '1W', interval: '15m', intraday: true, intervalLabel: '15-minute' },
  '1M': { id: '1M', label: '1M', range: '1M', interval: '1d', intraday: false, intervalLabel: 'daily' },
  '3M': { id: '3M', label: '3M', range: '3M', interval: '1d', intraday: false, intervalLabel: 'daily' },
  '6M': { id: '6M', label: '6M', range: '6M', interval: '1d', intraday: false, intervalLabel: 'daily' },
  '1Y': { id: '1Y', label: '1Y', range: '1Y', interval: '1d', intraday: false, intervalLabel: 'daily' },
  '5Y': { id: '5Y', label: '5Y', range: '5Y', interval: '1w', intraday: false, intervalLabel: 'weekly' },
};
export const TIMEFRAME_ORDER = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y'];

export function ttlMsFor(interval) {
  if (interval === '5m' || interval === '15m') return 60 * 1000;
  if (interval === '1d') return 15 * 60 * 1000;
  return 60 * 60 * 1000;
}

// Expired cache entries may be served after a provider failure only if they were fetched within this window.
export const MAX_STALE_MS = 24 * 60 * 60 * 1000;
