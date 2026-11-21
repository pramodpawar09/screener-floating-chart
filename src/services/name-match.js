// Conservative company-name comparison, used ONLY to verify that a provider search hit is the same
// company as the Screener page — never to pick a ticker. Unsure => no match => the user is asked.
const STOP = new Set(['ltd', 'limited', 'pvt', 'private', 'inc', 'corp', 'corporation', 'co', 'company', 'the', 'and']);

export const nameTokens = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));

// True when one name's significant words are all contained in the other's (e.g. "XYZ Ltd" vs "XYZ Limited").
export function namesMatch(a, b) {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (!A.length || !B.length) return false;
  const [small, big] = A.length <= B.length ? [A, B] : [B, A];
  return small.every((t) => big.includes(t));
}
