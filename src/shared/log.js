// Prefixed console logging. Worker logs show in chrome://extensions → "service worker" → Console.
// Page logs (hover detection) use console.debug: enable the "Verbose" level in DevTools to see them.
export const log = (...args) => {
  try {
    console.info('[SFC]', ...args);
  } catch {
    /* ignore */
  }
};
export const debug = (...args) => {
  try {
    console.debug('[SFC]', ...args);
  } catch {
    /* ignore */
  }
};
