// Reads a company's own exchange listing codes from its Screener page (the "BSE: …" / "NSE: …" links).
// Used only as a fallback when the identifier in the URL is not recognised by the data provider.
// Verified link shape (live page): https://www.bseindia.com/stock-share-price/dudani-retail-ltd/DUDANI/544961/
import { ExtError } from '../shared/errors.js';

const BSE_RE = /bseindia\.com\/stock-share-price\/[^/"'\s]+\/([A-Za-z0-9&_.%\-]+)\/(\d{5,6})\//i;
const NSE_RE = /nseindia\.com\/get-quotes\/equity\?symbol=([A-Za-z0-9&_.%\-]+)/i;

const dec = (s) => {
  try {
    return decodeURIComponent(s).toUpperCase();
  } catch {
    return null;
  }
};

export function parseListingCodes(html) {
  const text = typeof html === 'string' ? html : '';
  const bse = BSE_RE.exec(text);
  const nse = NSE_RE.exec(text);
  return {
    nse: nse ? dec(nse[1]) : null,
    bse: bse ? { name: dec(bse[1]), code: bse[2] } : null,
  };
}

export async function fetchListingCodes(identifier, signal) {
  let res;
  try {
    res = await fetch(`https://www.screener.in/company/${encodeURIComponent(identifier)}/`, { credentials: 'omit', signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ExtError('NETWORK');
  }
  if (!res.ok) throw new ExtError('PROVIDER', `Screener returned HTTP ${res.status} while looking up listing codes.`);
  return parseListingCodes(await res.text());
}
