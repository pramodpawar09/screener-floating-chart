// Detects Screener company links from real DOM anchors.
// Verified URL shapes (inspected on live Screener screen pages):
//   /company/BAJAJ-AUTO/consolidated/   /company/SCHAEFFLER/   (identifier = NSE symbol)
// Companies without an NSE listing use a numeric BSE scrip code, e.g. /company/532540/.
import { cleanText, closestAnchor } from '../utils/dom-utils.js';

const RESERVED = new Set(['compare', 'source', 'add', 'new', 'search', 'screen', 'export', 'results']);
const ID_RE = /^[A-Z0-9][A-Z0-9&_.\-]{0,29}$/;
const HOST_RE = /^(www\.)?screener\.in$/i;

export function parseCompanyUrl(href, baseUrl = 'https://www.screener.in/') {
  let url;
  try {
    url = new URL(href, baseUrl);
  } catch {
    return null;
  }
  if (!HOST_RE.test(url.hostname)) return null;
  const m = /^\/company\/([^/]+)(?:\/(consolidated))?\/?$/.exec(url.pathname); // query + hash ignored
  if (!m) return null;
  let id;
  try {
    id = decodeURIComponent(m[1]).trim().toUpperCase();
  } catch {
    return null;
  }
  if (!ID_RE.test(id) || RESERVED.has(id.toLowerCase())) return null;
  return { screenerIdentifier: id, variant: m[2] ? 'consolidated' : 'standalone' };
}

// Some rows render an icon-only link next to the name link; fall back to a sibling link's text.
function nameFor(anchor, identifier) {
  const hasWord = (t) => /[\p{L}\p{N}]/u.test(t); // ignore icon glyphs such as "⧉"
  const own = cleanText(anchor.textContent);
  if (hasWord(own)) return own;
  const row = anchor.closest('tr, li, td, div');
  if (row) {
    for (const a of row.querySelectorAll('a[href]')) {
      const t = cleanText(a.textContent);
      if (hasWord(t) && parseCompanyUrl(a.href, location.href)?.screenerIdentifier === identifier) return t;
    }
  }
  return identifier;
}

export function detectStock(target, baseUrl = location.href) {
  const anchor = closestAnchor(target);
  if (!anchor) return null;
  const parsed = parseCompanyUrl(anchor.href, baseUrl);
  if (!parsed) return null;
  return { companyName: nameFor(anchor, parsed.screenerIdentifier), ...parsed, anchor };
}
