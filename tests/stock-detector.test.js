import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCompanyUrl } from '../src/content/stock-detector.js';

test('valid company links (standalone and consolidated)', () => {
  assert.deepEqual(parseCompanyUrl('https://www.screener.in/company/TCS/'), { screenerIdentifier: 'TCS', variant: 'standalone' });
  assert.deepEqual(parseCompanyUrl('https://www.screener.in/company/BAJAJ-AUTO/consolidated/'), { screenerIdentifier: 'BAJAJ-AUTO', variant: 'consolidated' });
});
test('relative hrefs, missing trailing slash, query and hash are normalised', () => {
  assert.equal(parseCompanyUrl('/company/INFY/consolidated?foo=1#profit-loss').screenerIdentifier, 'INFY');
  assert.equal(parseCompanyUrl('/company/INFY').screenerIdentifier, 'INFY');
});
test('numeric BSE codes and encoded symbols', () => {
  assert.equal(parseCompanyUrl('/company/532540/').screenerIdentifier, '532540');
  assert.equal(parseCompanyUrl('/company/M%26M/consolidated/').screenerIdentifier, 'M&M');
});
test('invalid / unrelated links return null', () => {
  for (const href of ['/screens/59/top-ten/', '/company/', '/company/compare/', '/company/TCS/extra/path/', 'https://evil.example/company/TCS/', 'mailto:a@b.c', 'javascript:void(0)', '/company/%E0%A4%A/', '/company/ba d/'])
    assert.equal(parseCompanyUrl(href), null, href);
});
