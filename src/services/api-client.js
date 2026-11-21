// Content-script side: talks to the service worker (which owns all network access).
// Adds a short-lived in-memory cache so re-hovering a stock shows its chart instantly.
import { ExtError, toExtError } from '../shared/errors.js';
import { TIMEFRAMES, ttlMsFor } from '../shared/timeframes.js';
import { createCache } from './cache-service.js';

const memory = createCache({ maxEntries: 40 });

export const isContextValid = () => {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
};

function send(message) {
  return new Promise((resolve, reject) => {
    if (!isContextValid()) return reject(new ExtError('EXTENSION_RELOADED'));
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError || !response) return reject(new ExtError(isContextValid() ? 'UNKNOWN' : 'EXTENSION_RELOADED'));
        if (!response.ok) return reject(toExtError(response.error));
        resolve(response.data);
      });
    } catch {
      reject(new ExtError('EXTENSION_RELOADED'));
    }
  });
}

const memKey = (id, tfId) => `${id}|${tfId}`;

export async function getCandles({ stock, timeframeId }) {
  const tf = TIMEFRAMES[timeframeId];
  const key = memKey(stock.screenerIdentifier, timeframeId);
  const hit = tf && (await memory.get(key, ttlMsFor(tf.interval)));
  if (hit?.fresh) return hit.data;
  const data = await send({
    type: 'GET_CANDLES',
    stock: { screenerIdentifier: stock.screenerIdentifier, companyName: stock.companyName },
    timeframeId,
  });
  if (!data.stale) await memory.set(key, data);
  return data;
}

export async function selectSymbol({ stock, symbol }) {
  await send({ type: 'SELECT_SYMBOL', stock: { screenerIdentifier: stock.screenerIdentifier }, symbol });
  await memory.clear(); // the chosen listing changes what every timeframe should show
}

export const getProviderStatus = () => send({ type: 'PROVIDER_STATUS' });
