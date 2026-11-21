// Converts a Screener company identifier into a provider symbol.
// Priority: (1) user-verified override -> (2) Screener identifier (NSE symbol, or numeric BSE code)
//           -> (3) provider ticker search (exact base-symbol match only) -> (4) unresolved.
// It NEVER guesses a ticker from a company name.
import { log } from '../shared/log.js';

export const IDENTIFIER_RE = /^[A-Z0-9][A-Z0-9&_.\-]{0,29}$/;

// Screener identifiers are NSE symbols, or numeric BSE scrip codes (5-6 digits) for BSE-only companies.
// Anything that is neither (empty, 4-digit/7-digit numbers, odd characters) is UNKNOWN (null) — never defaulted to NSE.
export function inferExchange(identifier) {
  if (typeof identifier !== 'string' || !identifier) return null;
  if (/^\d+$/.test(identifier)) return /^\d{5,6}$/.test(identifier) ? 'BSE' : null;
  return IDENTIFIER_RE.test(identifier) ? 'NSE' : null;
}

export function createSymbolResolver({ provider, overrides, pageLookup = null }) {
  return {
    async resolve(stock) {
      const id = stock.screenerIdentifier;
      const saved = await overrides.get(id);
      if (saved) return { symbol: saved.symbol, exchange: saved.exchange, via: 'saved' };
      const exchange = inferExchange(id);
      if (!exchange) return { symbol: null, exchange: null, via: 'screener-id' }; // unknown: go straight to discovery
      return { symbol: provider.formatSymbol({ identifier: id, exchange }), exchange, via: 'screener-id' };
    },

    // Candidate listings read from the company's own Screener page (NSE symbol, BSE code, BSE short name).
    async discover(stock) {
      if (!pageLookup) return [];
      const codes = await pageLookup(stock.screenerIdentifier);
      const out = [];
      const seen = new Set();
      const add = (identifier, exchange) => {
        if (!identifier || !IDENTIFIER_RE.test(identifier)) {
          log('skipping invalid listing code from Screener page:', identifier);
          return;
        }
        const symbol = provider.formatSymbol({ identifier, exchange });
        if (!seen.has(symbol)) {
          seen.add(symbol);
          out.push({ symbol, exchange, via: 'screener-page' });
        }
      };
      if (codes?.nse) add(codes.nse, 'NSE');
      if (codes?.bse) {
        add(codes.bse.code, 'BSE');
        add(codes.bse.name, 'BSE');
      }
      return out;
    },

    // Exact base-symbol matches only, de-duplicated.
    async search(stock) {
      const id = stock.screenerIdentifier;
      const found = await provider.searchSymbols(id);
      const seen = new Set();
      return found.filter((r) => {
        if (r.baseSymbol !== id || seen.has(r.symbol)) return false;
        seen.add(r.symbol);
        return true;
      });
    },

    async remember(stock, option) {
      await overrides.set(stock.screenerIdentifier, { symbol: option.symbol, exchange: option.exchange });
    },

    // Validate a user-chosen symbol: it must belong to this stock's identifier.
    async select(stock, symbol) {
      const parsed = provider.parseSymbol(symbol);
      if (!parsed || parsed.baseSymbol !== stock.screenerIdentifier) return false;
      await overrides.set(stock.screenerIdentifier, { symbol, exchange: parsed.exchange });
      return true;
    },
  };
}
