export const MESSAGES = {
  NO_STOCK: 'Stock symbol could not be identified.',
  UNRESOLVED: 'Unable to resolve stock symbol',
  AMBIGUOUS: 'Multiple listings match this stock. Choose the correct one.',
  NOT_FOUND: 'Symbol not found at the market data provider.',
  EMPTY: 'Historical data is unavailable.',
  NETWORK: 'Network error while contacting the market data provider.',
  RATE_LIMIT: 'Market data provider rate limit reached. Try again shortly.',
  PROVIDER: 'The market data provider returned an error.',
  INVALID_RESPONSE: 'The market data provider returned an unreadable response.',
  INVALID_REQUEST: 'Invalid request.',
  NO_API_KEY: 'Configure your market data provider to load real candles.',
  CHART_INIT: 'The chart could not be initialised.',
  EXTENSION_RELOADED: 'The extension was updated or reloaded. Refresh this page to continue.',
  UNKNOWN: 'Something went wrong while loading the chart.',
};

export class ExtError extends Error {
  constructor(code, message, details) {
    super(message || MESSAGES[code] || MESSAGES.UNKNOWN);
    this.name = 'ExtError';
    this.code = code;
    this.details = details;
  }
  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function toExtError(e) {
  if (e instanceof ExtError) return e;
  if (e && typeof e === 'object' && e.code && MESSAGES[e.code]) return new ExtError(e.code, e.message, e.details);
  return new ExtError('UNKNOWN');
}
