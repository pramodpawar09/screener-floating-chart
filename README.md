# Screener Floating Chart

A Chrome extension (Manifest V3) that shows a floating **candlestick + volume chart** when you hover a company name on [Screener.in](https://www.screener.in/) — without leaving the page.

> **Status honesty:** the interaction logic, data pipeline and UI were verified with automated tests (see *Testing*). The extension has **not** been loaded into a real Chrome profile, the real `lightweight-charts` library has **not** been exercised, and the Yahoo Finance endpoint has **not** been called live — the build sandbox had no network. Follow *Verify it yourself* below on first run.

## Features (implemented)

- Hover any company link (screens, search results, peers tables, anywhere on screener.in) → floating chart opens near the cursor. One reused panel; no duplicates.
- Candlesticks + volume histogram (TradingView Lightweight Charts v5), crosshair with live O/H/L/C/Vol legend, zoom/scroll, auto-resize.
- Timeframes `1D 1W 1M 3M 6M 1Y 5Y` — each changes *both* range and candle interval (see table).
- Pin (button, or **Alt+click** a name), close (button / **Esc**), drag by header, native corner-resize.
- Switch stocks while pinned; unpinned chart hides after a configurable delay, and moving the cursor into the chart cancels the hide.
- Symbol resolution with unresolved / ambiguous states (exchange picker, choice remembered).
- Two-layer cache (memory + `chrome.storage.local`), in-flight request de-duplication, stale-response protection, stale-cache fallback when the provider is unreachable.
- Popup: enable/disable, theme, default timeframe, hover/hide delay, chart size, provider test. Settings apply live.
- Shadow-DOM isolation: Screener's CSS cannot restyle the panel and vice-versa.

| Button | Range | Candle interval |
|---|---|---|
| 1D | 1 day | 5-minute |
| 1W | 5 trading days | 15-minute |
| 1M / 3M / 6M / 1Y | as labelled | daily |
| 5Y | 5 years | weekly |

## Design decisions you should know about

- **Click does not pin.** A plain click on a company name keeps Screener's normal navigation (hijacking it would break the site). Pin with the 📌 button or **Alt+click**.
- **esbuild instead of Vite.** MV3 content scripts must be classic (non-module) scripts, so each entry is bundled to a self-contained IIFE. `scripts/build.mjs` does this with esbuild (the bundler Vite uses) in ~20 lines.
- **Network calls happen in the service worker**, not the page, so Screener's CSP/CORS never matter and host permissions stay narrow.
- **No fake data anywhere.** There is no sample-data mode; if data can't be loaded you see an error state.
- Prices shown are the **last historical candle**, labelled "historical, not live". Header change = last close vs first open of the displayed range.

## Architecture

```
src/
  content/      stock-detector · hover-controller · interaction-state (pure FSM) · floating-panel · content (wiring)
  chart/        chart-manager  (Lightweight Charts wrapper)
  services/     api-client (content→worker) · market-data-service · symbol-resolver · data-normalizer · cache-service
                providers/yahoo.js   ← the only provider-specific file
  background/   service-worker (message router, storage adapters)
  popup/        popup.html/css/js
  shared/       settings · timeframes · errors
  utils/        position · formatters · dom · timer
```

**State machine** (`interaction-state.js`): `CLOSED → LOADING → OPEN | ERROR`, plus an orthogonal `pinned` flag (reported as `PINNED`).
`SHOW`→LOADING · `LOADED`→OPEN · `FAILED`→ERROR · `RELOAD`→LOADING · `HIDE` (timer) closes unless pinned · `CLOSE` (button/Esc) always closes and unpins.

**Stock detection** was checked against a live Screener screen page: company links look like `/company/BAJAJ-AUTO/consolidated/` or `/company/SCHAEFFLER/`; the identifier is the **NSE symbol**. Companies with no NSE listing use a **numeric BSE code** (`/company/532540/`). Detection is a single delegated listener set on `document`; query strings, hashes, trailing slashes, encoded symbols (`M%26M`) are handled; reserved paths (`/company/compare/`) and sub-paths are ignored.

**Symbol resolution order:** user-confirmed override → Screener identifier (`TCS`→`TCS.NS`, `532540`→`532540.BO`) → **listing codes read from the company's own Screener page** (NSE symbol, BSE code, BSE short name — e.g. `…/DUDANI/544961/` → tries `544961.BO`, then `DUDANI.BO`; the working one is remembered) → provider *ticker* search (exact base-symbol match, and **only auto-used when the provider's company name matches Screener's**; otherwise you pick the listing) → "Unable to resolve stock symbol" listing every symbol tried + Retry. The Screener-page lookup only happens when the first guess fails, and a failing stock is not re-queried for 2 minutes. Company names are never used to guess tickers. Multiple exact matches show an exchange picker.

**Normalisation:** rejects non-positive/NaN prices and impossible OHLC (high < open/close/low, low > open/close/high), de-duplicates timestamps, sorts, zero-fills missing volume. Daily dates are computed in exchange time (provider `gmtoffset`, IST = +05:30) so a trading date never shifts a day. Intraday candles are shifted to exchange-local wall-clock so the axis reads IST.

## Data freshness, derived candles and stale data
- **Rejected rows are never hidden.** If the provider's daily row has no usable prices (this happened for the latest session on Yahoo), the normalizer records its date and reason (`null-price`, `partial-price`, `non-positive-price`, `invalid-ohlc`, `invalid-time`). The panel shows the missing date and the `[SFC]` log lists it.
- **Derived candle (only when verifiable).** If the *latest* daily row is empty, the extension may build that one candle from the provider's own 15-minute bars for that date: open = first bar's open, high/low = extremes, close = last bar's close, volume = sum (only if every priced bar has volume). It refuses unless the session has ended, all 25 expected slots (09:15–15:15 IST) are present (valid bars, or all-empty "no trade" rows), no bar is off-schedule, and the **final 15:15 bar has real prices** (an empty tail looks the same as data not yet published). It is drawn with a translucent body, tagged "derived", and is **not the official exchange close** (the official close is volume-weighted over the last 30 minutes). Official candles always win; the derived candle is never cached as official data and disappears when the official row arrives (after the 15-minute TTL).
- **Stale data.** After a provider failure the last cached data may be shown only if it was fetched within **24 hours**; the panel shows a warning with the fetch time. Older cache is not used and the provider error is shown. Every footer shows the fetch time and whether it came from cache — a cache hit is not proof of freshness.
- Known limit: an illiquid stock with no trade in the last 15 minutes of a session cannot be derived (reported as "closing intraday bar has no prices"). Special sessions (e.g. Muhurat trading) are refused.

## BSE support notes
- Exchange is never defaulted: NSE symbol → NSE, 5–6 digit code → BSE, anything else → unknown → resolved from the Screener page or reported as unresolved.
- Yahoo may list a BSE stock under its numeric code (`544961.BO`), its short name (`DUDANI.BO`), or not at all (typical for SME/new listings). The resolver tries what Screener's own page publishes and keeps the one that returns data.
- Every attempt is logged: `chrome://extensions` → your extension → **service worker** → Console, lines prefixed `[SFC]`. The panel footer shows `symbol via …` when the symbol did not come straight from the URL.
- If Yahoo has no data, the panel lists the symbols tried. Add another provider (see *Changing provider*) to cover those.
- `npm run verify` checks that `dist/manifest.json` only references files present in `dist/`.

## Install & build

Requires Node 18+ and npm.

```bash
npm install
npm run build        # → dist/
npm test             # unit tests (node:test, no browser needed)
```
PowerShell: identical commands.

Load in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the **`dist`** folder → open a Screener screen/list and hover a company name.
After code changes: `npm run build`, click ⟳ on the extension card, refresh the Screener tab. (`npm run dev` rebuilds on save.)

### Verify it yourself (first run)
1. Hover a company on a screen → panel opens with a spinner, then candles. If you see a *provider* error, open the popup → **Test connection**.
2. DevTools → *Service worker* (on `chrome://extensions`) shows network requests to `query1.finance.yahoo.com`.
3. Try a BSE-only company (numeric URL) and a name with `&`/`-` (e.g. M&M, BAJAJ-AUTO).

## Market data provider

**Default: Yahoo Finance chart API (unofficial, no API key).** Real historical OHLCV, NSE (`.NS`) and BSE (`.BO`), intraday/daily/weekly intervals.

**Not verified in this build:** current rate limits, whether Yahoo accepts requests from the extension origin without extra headers/consent, and Yahoo's terms of use for your usage. This is an *undocumented* endpoint that can change or block clients at any time and is generally intended for personal use. For anything beyond personal use, switch to a licensed provider.

**Changing provider:** implement the interface in `src/services/providers/yahoo.js` (`id, name, requiresKey, formatSymbol, parseSymbol, getHistoricalCandles({symbol, interval, range}) → {rows, meta}, searchSymbols`) in a new file, then change one line in `src/background/service-worker.js`. Also add its host to `host_permissions`. The chart and UI never see provider data.

**API keys:** none needed for the default. If you add a keyed provider: never commit keys, and don't treat `chrome.storage` as secret — a key shipped in an extension is extractable by any user. For a shared/published extension, put the key on a small backend proxy and have the provider call that.

## Privacy & permissions
- `storage`; host access to `query1/query2.finance.yahoo.com` (prices) and `www.screener.in` (the service worker reads a company's public page only to find its exchange codes when needed).
- No analytics, no remote code (everything is bundled), no account data read or modified, no trading features.
- Symbols you hover are sent to the data provider to fetch prices.

## Testing

| Suite | Command | Covers |
|---|---|---|
| Unit (92 tests) | `npm test` | URL/identifier parsing, normalisation (dupes, invalid OHLC, missing volume, empty, bad dates, IST date semantics), symbol resolution (known / unknown / ambiguous / NSE / BSE / provider errors), cache (hit/miss/TTL/prune/persist), request de-duplication, stale fallback, state machine, positioning |
| UI smoke (27 checks) | see below | hover/hide/pin/unpin/close/Esc, same-panel reuse, stale-response guard, cache reuse, timeframe switch, error + retry, ambiguous picker, dynamic rows, Shadow-DOM isolation, drag, live settings |

The UI smoke test needs Playwright and runs against a **chart stub** and a **mocked `chrome.*` API** on a mock page with real Screener link shapes:
```bash
SFC_CHART_STUB=$PWD/tests/e2e/chart-stub.js npm run build
node tests/e2e/ui-smoke.mjs      # then `npm run build` again (without the env var) for the real build
```
It does **not** validate Lightweight Charts rendering, live data, or behaviour inside a real extension context.

## Known limitations
- Unofficial data source (see above); data is historical/possibly delayed, never labelled live.
- Very new or SME-segment BSE listings (e.g. Dudani Retail, BSE SME) may simply not exist at Yahoo Finance; the panel then reports which symbols were tried instead of showing a wrong chart. A different provider is the fix for those.
- Hover on Screener's own *search-as-you-type* dropdown works only if its items are real `/company/…` anchors.
- Company names are taken from link text (Screener abbreviates, e.g. "Natl. Aluminium"); the header also shows the market symbol.
- 5Y uses weekly candles; 1D/1W intraday availability depends on the provider.
- Chrome only (Manifest V3, Chrome ≥ 110).
- Not tested on mobile/touch (hover is a pointer feature).

## Future improvements (not implemented)
Indicators (SMA/EMA/RSI/MACD/Bollinger), drawing tools, additional providers, remembered panel size/position, watchlists, keyboard-only activation, Firefox build.

Charts by [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/) (Apache-2.0; the library's attribution logo is left enabled as its licence requires).
