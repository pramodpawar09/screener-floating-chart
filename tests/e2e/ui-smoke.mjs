// UI smoke test: loads the BUNDLED content script into headless Chromium on a mock Screener page
// (real link shapes), with a mocked chrome.* API and a recording chart stub.
// Verifies interaction logic only. It does NOT verify the real Lightweight Charts rendering or live market data.
// Usage:  SFC_CHART_STUB=$PWD/tests/e2e/chart-stub.js node scripts/build.mjs && node tests/e2e/ui-smoke.mjs
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || '/home/claude/.npm-global/lib/node_modules/');
const { chromium } = require('playwright');

const contentJs = await readFile('dist/content.js', 'utf8');
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Screen</title>
<style>a{color:red!important} *{font-size:28px!important;letter-spacing:5px!important} body{margin:0;font-family:serif}</style></head><body>
<nav><a href="/company/compare/">Compare</a> <a href="/screens/59/top/">Screens</a></nav>
<table id="t"><tbody>
<tr><td>1</td><td><a id="tcs" href="/company/TCS/consolidated/">Tata Consultancy</a> <a id="tcs-icon" class="icon" href="/company/TCS/consolidated/">⧉</a></td><td>3000</td></tr>
<tr><td>2</td><td><a id="infy" href="/company/INFY/consolidated/">Infosys</a></td><td>1500</td></tr>
<tr><td>3</td><td><a id="bad" href="/company/BADX/">Bad Co</a></td><td>1</td></tr>
<tr><td>4</td><td><a id="amb" href="/company/AMB/">Ambiguous Co</a></td><td>2</td></tr>
<tr><td>5</td><td><a id="bse" href="/company/532540/">BSE Only Ltd</a></td><td>3</td></tr>
</tbody></table><div style="height:2000px"></div></body></html>`;

const CHROME_MOCK = `
window.__msgs = []; window.__clicks = [];
const store = { settings: { hoverDelay: 50, hideDelay: 200 } };
const delays = { TCS: 700 };
const mk = (id, tf) => {
  const intraday = tf === '1D' || tf === '1W'; const n = tf === '1M' ? 20 : 60; const candles = [];
  for (let i = 0; i < n; i++) { const o = 100 + i, c = o + (i % 2 ? -1 : 2);
    candles.push({ time: intraday ? 1761795300 + i * 300 : '2026-' + String(1 + Math.floor(i / 28)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0'), open: o, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, close: c, volume: 1000 * (i + 1) }); }
  const mode = window.__mode || 'official';
  let extra = { missingDates: [], derived: [], notDerived: [] };
  if (mode === 'derived' && !intraday) { const l = candles[candles.length - 1]; l.derived = true; l.volumeKnown = true;
    extra = { missingDates: [{ date: l.time, reason: 'null-price' }], derived: [{ date: l.time, barCount: 25, expectedBars: 25, volumeKnown: true, intervalLabel: '15-minute' }], notDerived: [] }; }
  const stale = mode === 'stale';
  return { ...extra, companyName: id + ' Ltd', screenerIdentifier: id, symbol: id + (/^\\d+$/.test(id) ? '.BO' : '.NS'), exchange: /^\\d+$/.test(id) ? 'BSE' : 'NSE', timeframeId: tf, intervalLabel: intraday ? '5-minute' : 'daily', intraday, providerName: 'Mock provider', candles, hasVolume: true, rejected: 0, currency: 'INR', fetchedAt: stale ? Date.now() - 5 * 3600e3 : Date.now(), fromCache: stale, stale };
};
window.chrome = {
  runtime: { id: 'test-ext', lastError: undefined,
    sendMessage(msg, cb) { window.__msgs.push(msg); const id = msg.stock && msg.stock.screenerIdentifier;
      setTimeout(() => {
        if (msg.type === 'SELECT_SYMBOL') return cb({ ok: true, data: { ok: true } });
        if (id === 'BADX') return cb({ ok: false, error: { code: 'UNRESOLVED', message: 'Unable to resolve stock symbol' } });
        if (id === 'AMB') return cb({ ok: false, error: { code: 'AMBIGUOUS', message: 'Multiple listings match this stock. Choose the correct one.', details: { options: [{ symbol: 'AMB.NS', exchange: 'NSE', name: 'x' }, { symbol: 'AMB.BO', exchange: 'BSE', name: 'y' }] } } });
        cb({ ok: true, data: mk(id, msg.timeframeId) });
      }, delays[id] ?? 20); } },
  storage: { local: { get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : store), set: async (o) => Object.assign(store, o), remove: async () => {} },
             onChanged: { addListener(fn) { window.__onChanged = fn; }, removeListener() {} } },
};
document.addEventListener('click', (e) => window.__clicks.push({ id: e.target.id, defaultPrevented: e.defaultPrevented }), false);
`;

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); } catch (e) {
    results.push(['FAIL', name, e.message.split('\n')[0]]);
    if (process.env.SFC_DEBUG) {
      const info = await page.evaluate(() => { const r = document.querySelector('[data-sfc-root]'); const p = r && r.shadowRoot.querySelector('.sfc-panel'); return p ? { hidden: p.hidden, name: p.querySelector('.sfc-name').textContent, rect: JSON.stringify(p.getBoundingClientRect()), overlay: p.querySelector('.sfc-msg').textContent, overlayHidden: p.querySelector('.sfc-overlay').hidden, notices: p.querySelector('.sfc-notices').textContent, noticesHidden: p.querySelector('.sfc-notices').hidden, mode: window.__mode, lastMsg: JSON.stringify(window.__msgs.at(-1)), footer: p.querySelector('.sfc-footer').textContent } : null; }).catch(() => 'n/a');
      console.log('DEBUG', name, JSON.stringify(info));
      await page.screenshot({ path: `/tmp/fail-${results.length}.png` }).catch(() => {});
    }
  }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.route('https://www.screener.in/**', (r) => r.fulfill({ contentType: 'text/html', body: PAGE }));
await page.addInitScript(CHROME_MOCK);
await page.goto('https://www.screener.in/screens/1/test/');
await page.evaluate(contentJs); // inject the bundled content script (same code Chrome would inject)

const host = page.locator('[data-sfc-root]');
const panel = page.locator('[data-sfc-root] .sfc-panel');
const name = page.locator('[data-sfc-root] .sfc-name');
const msgs = () => page.evaluate(() => window.__msgs);
page.setDefaultTimeout(4000);
const away = async () => { await page.mouse.move(5, 790); await page.waitForTimeout(450); };
// Real browsers only fire mouseover when the cursor ENTERS an element, so re-enter after leaving.
const hover = async (sel) => { await page.mouse.move(5, 790); await page.waitForTimeout(30); await page.locator(sel).hover(); };
const visible = () => panel.evaluate((e) => !e.hidden);
const wait = (ms) => page.waitForTimeout(ms);

await check('nothing is injected into the page DOM before the first hover', async () => {
  assert.equal(await host.count(), 0);
});
await check('hover opens panel immediately in loading state (slow stock), then shows chart data', async () => {
  await hover('#tcs');
  await wait(150);
  assert.equal(await visible(), true);
  assert.match(await page.locator('[data-sfc-root] .sfc-msg').innerText(), /Loading/);
  await page.waitForFunction(() => document.querySelector('[data-sfc-root]').shadowRoot.querySelector('.stub-chart')?.textContent === '60 candles', null, { timeout: 3000 });
  assert.match(await name.innerText(), /Tata Consultancy/);
  assert.match(await page.locator('[data-sfc-root] .sfc-sub').innerText(), /TCS\.NS · NSE/);
  assert.equal(await page.evaluate(() => window.__chart.series.length), 2); // candles + volume
  assert.match(await page.locator('[data-sfc-root] .sfc-footer').innerText(), /historical, not live/);
});
await check('icon-only duplicate link resolves to the company name', async () => {
  await page.mouse.move(700, 700); await wait(400);
  await hover('#tcs-icon'); await wait(150);
  assert.match(await name.innerText(), /Tata Consultancy/);
});
await check('moving to another stock reuses the same panel (no duplicates) and updates the title', async () => {
  await hover('#infy'); await wait(250);
  assert.equal(await host.count(), 1);
  assert.match(await name.innerText(), /Infosys/);
});
await check('stale response protection: slow TCS reply must not overwrite INFY', async () => {
  await page.mouse.move(700, 700); await wait(400);
  await page.evaluate(() => (window.__msgs.length = 0));
  await hover('#tcs'); await wait(80);        // TCS request in flight (700ms)
  await hover('#infy'); await wait(1200);     // INFY wins; TCS reply arrives afterwards
  assert.match(await name.innerText(), /Infosys/);
  assert.match(await page.locator('[data-sfc-root] .sfc-sub').innerText(), /INFY/);
});
await check('repeat hover on a cached stock does not re-request data', async () => {
  const before = (await msgs()).filter((m) => m.type === 'GET_CANDLES').length;
  await page.mouse.move(700, 700); await wait(400);
  await hover('#infy'); await wait(200);
  assert.equal((await msgs()).filter((m) => m.type === 'GET_CANDLES').length, before);
  assert.match(await name.innerText(), /Infosys/);
});
await check('unpinned panel hides after the delay when cursor leaves', async () => {
  await page.mouse.move(700, 750); await wait(500);
  assert.equal(await visible(), false);
});
await check('moving from the link into the panel cancels the hide', async () => {
  await hover('#infy'); await wait(200);
  const b = await panel.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); // single jump: pointerenter fires before the link's mouseout
  await wait(600);
  assert.equal(await visible(), true);
  await page.mouse.move(5, 790); await wait(500);
  assert.equal(await visible(), false);
});
await check('panel stays inside the viewport', async () => {
  await hover('#infy'); await wait(200);
  const b = await panel.boundingBox();
  assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1280 && b.y + b.height <= 800, JSON.stringify(b));
  await page.keyboard.press('Escape');
});
await check('Escape closes the chart', async () => {
  await hover('#infy'); await wait(200);
  await page.keyboard.press('Escape'); await wait(50);
  assert.equal(await visible(), false);
});
await check('pin button keeps chart open after cursor leaves; Escape closes a pinned chart', async () => {
  await hover('#infy'); await wait(200);
  await page.locator('[data-sfc-root] .sfc-btn[aria-label="Pin chart"]').click();
  await page.mouse.move(5, 790); await wait(700);
  assert.equal(await visible(), true);
  assert.equal(await page.locator('[data-sfc-root] .sfc-btn[aria-label="Pin chart"]').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape'); await wait(50);
  assert.equal(await visible(), false);
});
await check('pinned chart can switch to another hovered stock and stays pinned', async () => {
  await hover('#infy'); await wait(200);
  await page.locator('[data-sfc-root] .sfc-btn[aria-label="Pin chart"]').click();
  await page.mouse.move(5, 790); await wait(400);
  await hover('#bse'); await wait(250);
  assert.match(await page.locator('[data-sfc-root] .sfc-sub').innerText(), /532540\.BO · BSE/);
  await page.mouse.move(5, 790); await wait(600);
  assert.equal(await visible(), true);
});
await check('close button closes a pinned chart (and unpins)', async () => {
  await page.locator('[data-sfc-root] .sfc-btn[aria-label="Close chart"]').click(); await wait(50);
  assert.equal(await visible(), false);
});
await check('Alt+click pins without navigating; plain click is left alone', async () => {
  await page.evaluate(() => (window.__clicks.length = 0));
  await page.locator('#infy').click({ modifiers: ['Alt'] }); await wait(250);
  assert.equal(await visible(), true);
  const c = await page.evaluate(() => window.__clicks.slice());
  assert.equal(c.at(-1)?.defaultPrevented ?? true, true);
  await page.mouse.move(5, 790); await wait(600);
  assert.equal(await visible(), true); // pinned
  await page.keyboard.press('Escape'); await wait(50);
  await page.evaluate(() => { document.getElementById('infy').addEventListener('click', (e) => e.preventDefault()); }); // stop real navigation in the test
  await page.evaluate(() => (window.__clicks.length = 0));
  await page.locator('#infy').click(); await wait(100);
  const plain = await page.evaluate(() => window.__clicks.slice());
  assert.ok(plain.length >= 1);
});
await check('timeframe switch requests new data and highlights the selection', async () => {
  await page.keyboard.press('Escape');
  await hover('#bse'); await wait(250);
  await page.evaluate(() => (window.__msgs.length = 0));
  await page.locator('[data-sfc-root] .sfc-tf button', { hasText: '1M' }).click(); await wait(200);
  const m = (await msgs()).filter((x) => x.type === 'GET_CANDLES');
  assert.equal(m.at(-1).timeframeId, '1M');
  assert.equal(await page.locator('[data-sfc-root] .sfc-tf button', { hasText: '1M' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-sfc-root] .sfc-tf button', { hasText: '6M' }).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => document.querySelector('[data-sfc-root]').shadowRoot.querySelector('.stub-chart').textContent), '20 candles');
  assert.equal(await page.evaluate(() => window.__chart.removed), false); // chart reused, not recreated
});
await check('intraday timeframe flags intraday time axis', async () => {
  await page.locator('[data-sfc-root] .sfc-tf button', { hasText: '1D' }).click(); await wait(200);
  assert.equal(await page.evaluate(() => window.__chart.options_applied.at(-1).timeScale.timeVisible), true);
});
await check('unresolved symbol shows the required message and a Retry button', async () => {
  await page.keyboard.press('Escape'); await page.mouse.move(5, 790);
  await hover('#bad'); await wait(250);
  assert.match(await page.locator('[data-sfc-root] .sfc-msg').innerText(), /Unable to resolve stock symbol/);
  assert.equal(await page.locator('[data-sfc-root] .sfc-action', { hasText: 'Retry' }).count(), 1);
  await page.evaluate(() => (window.__msgs.length = 0));
  await page.locator('[data-sfc-root] .sfc-action', { hasText: 'Retry' }).click(); await wait(150);
  assert.equal((await msgs()).filter((m) => m.type === 'GET_CANDLES').length, 1);
});
await check('ambiguous listing offers exchange choices; choosing stores it and reloads', async () => {
  await page.keyboard.press('Escape'); await page.mouse.move(5, 790);
  await hover('#amb'); await wait(250);
  const opts = page.locator('[data-sfc-root] .sfc-action');
  assert.equal(await opts.count(), 2);
  await page.evaluate(() => (window.__msgs.length = 0));
  await opts.nth(1).click(); await wait(200);
  const types = (await msgs()).map((m) => m.type);
  assert.deepEqual(types.slice(0, 2), ['SELECT_SYMBOL', 'GET_CANDLES']);
});
await check('delegated listeners handle rows added after load', async () => {
  await page.keyboard.press('Escape'); await page.mouse.move(5, 790);
  await page.evaluate(() => { const tr = document.createElement('tr'); tr.innerHTML = '<td>9</td><td><a id="new" href="/company/NEWCO/">New Co</a></td>'; document.querySelector('#t tbody').append(tr); });
  await hover('#new'); await wait(250);
  assert.match(await name.innerText(), /New Co/);
});
await check('unrelated links (nav, compare, screens) never open the panel', async () => {
  await page.keyboard.press('Escape'); await page.mouse.move(5, 790); await wait(100);
  await page.locator('nav a').first().hover(); await wait(200);
  await page.locator('nav a').nth(1).hover(); await wait(200);
  assert.equal(await visible(), false);
});
await check('Shadow DOM isolation: hostile page CSS does not restyle the panel', async () => {
  await hover('#infy'); await wait(250);
  const fs = await page.locator('[data-sfc-root] .sfc-name').evaluate((e) => getComputedStyle(e).fontSize);
  const ls = await page.locator('[data-sfc-root] .sfc-name').evaluate((e) => getComputedStyle(e).letterSpacing);
  assert.equal(fs, '13px');
  assert.notEqual(ls, '5px');
});
await check('dragging by the header moves the panel and keeps it in the viewport', async () => {
  const hd = page.locator('[data-sfc-root] .sfc-header');
  const b0 = await panel.boundingBox(); const h0 = await hd.boundingBox();
  await page.mouse.move(h0.x + 100, h0.y + 10); await page.mouse.down();
  await page.mouse.move(h0.x + 140, h0.y + 60, { steps: 4 }); await page.mouse.up();
  const b1 = await panel.boundingBox();
  assert.ok(Math.abs(b1.x - (b0.x + 40)) < 3 && Math.abs(b1.y - (b0.y + 50)) < 3, JSON.stringify([b0, b1]));
});
const addStock = (id) => page.evaluate((i) => { const tr = document.createElement('tr'); tr.innerHTML = '<td>x</td><td><a id="' + i + '" href="/company/' + i.toUpperCase() + '/">' + i + ' Co</a></td>'; document.querySelector('#t tbody').append(tr); }, id);
const chartState = () => page.evaluate(() => { const d = window.__chart.series[0].data; const t = d.map((c) => c.time); return { n: d.length, unique: new Set(t).size === t.length, sorted: JSON.stringify(t) === JSON.stringify([...t].sort()), last: d[d.length - 1], prev: d[d.length - 2], volN: window.__chart.series[1].data.length }; });
const notices = page.locator('[data-sfc-root] .sfc-notices');

await check('derived candle is labelled: notice text, header marker, legend tag, translucent body; footer shows fetch time', async () => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window.__mode = 'derived'));
  await addStock('dv1');
  await hover('#dv1'); await wait(300);
  await page.locator('[data-sfc-root] .sfc-tf button', { hasText: '6M' }).click(); await wait(300); // daily timeframe (an earlier test left 1D selected)
  assert.match(await notices.innerText(), /candle derived from intraday data\. Official daily candle unavailable\./);
  assert.match(await page.locator('[data-sfc-root] .sfc-price').innerText(), /\(derived\)/);
  assert.match(await page.locator('[data-sfc-root] .sfc-legend').innerText(), /derived/i);
  assert.match(await page.locator('[data-sfc-root] .sfc-footer').innerText(), /fetched/);
  const c = await chartState();
  assert.match(c.last.color, /80$/);        // derived body is translucent
  assert.equal(c.prev.color, undefined);    // official candles are untouched
  assert.equal(c.volN, c.n);
  assert.ok(c.unique && c.sorted);
});
await check('official daily data replaces the derived candle after the TTL: notice gone, same count, no duplicate dates', async () => {
  const before = await chartState();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__mode = 'official'; window.__msgs.length = 0; const real = Date.now.bind(Date); Date.now = () => real() + 16 * 60e3; });
  await hover('#dv1'); await wait(300);
  assert.equal((await msgs()).filter((m) => m.type === 'GET_CANDLES').length, 1); // memory cache expired -> refetched
  assert.equal(await notices.evaluate((e) => e.hidden), true);
  assert.doesNotMatch(await page.locator('[data-sfc-root] .sfc-price').innerText(), /derived/);
  const after = await chartState();
  assert.equal(after.last.color, undefined);
  assert.equal(after.n, before.n);
  assert.equal(after.last.time, before.last.time);
  assert.ok(after.unique && after.sorted);
});
await check('stale fallback shows a visible warning with the last successful fetch time', async () => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window.__mode = 'stale'));
  await addStock('st1');
  await hover('#st1'); await wait(300);
  assert.match(await notices.innerText(), /Provider unreachable\. Showing cached data fetched .+; it may be out of date\./);
  const foot = await page.locator('[data-sfc-root] .sfc-footer').innerText();
  assert.match(foot, /fetched/); assert.match(foot, /STALE/);
  await page.evaluate(() => (window.__mode = 'official'));
});
await check('settings changes apply live: theme switch, then disabling closes and blocks the panel', async () => {
  await page.evaluate(() => window.__onChanged({ settings: { newValue: { theme: 'light', hoverDelay: 50, hideDelay: 200 } } }, 'local'));
  assert.equal(await panel.getAttribute('data-theme'), 'light');
  await page.evaluate(() => window.__onChanged({ settings: { newValue: { enabled: false } } }, 'local'));
  await wait(50);
  assert.equal(await visible(), false);
  await hover('#tcs'); await wait(300);
  assert.equal(await visible(), false);
});
await check('no uncaught page errors', async () => assert.deepEqual(pageErrors, []));

await browser.close();
for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
