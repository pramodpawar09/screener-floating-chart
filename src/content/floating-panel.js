// The floating panel: a single Shadow-DOM-isolated element reused for every stock.
// Page CSS cannot leak in, and none of this CSS can leak out.
import panelCss from '../styles/floating-panel.css';
import themeCss from '../styles/chart-theme.css';
import { ChartManager } from '../chart/chart-manager.js';
import { TIMEFRAMES, TIMEFRAME_ORDER } from '../shared/timeframes.js';
import { ExtError, MESSAGES } from '../shared/errors.js';
import { h, svgIcon } from '../utils/dom-utils.js';
import { computePanelPosition, rectsIntersect } from '../utils/position-utils.js';
import { formatFetchedAt, formatPercent, formatPrice, formatTimeLabel, formatVolume, rangeChange } from '../utils/formatters.js';
import { buildNotices } from '../utils/notices.js';

const ICON_PIN = '<svg viewBox="0 0 24 24"><path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3H7l3-3-1-7z"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export class FloatingPanel {
  moved = false; // true once the user has dragged the panel this session
  #cb;
  #settings;
  #chart = null;
  #lastPayload = null;
  #drag = null;
  #ui = {};
  #onWinResize = () => this.#clampIntoViewport();

  constructor({ settings, callbacks }) {
    this.#settings = settings;
    this.#cb = callbacks;
    this.#build();
    this.applySettings(settings);
    window.addEventListener('resize', this.#onWinResize);
  }

  // ---------- construction ----------
  #build() {
    const ui = this.#ui;
    this.host = h('div', { 'data-sfc-root': '' });
    const root = this.host.attachShadow({ mode: 'open' });
    root.append(h('style', { text: themeCss + panelCss }));

    ui.name = h('div', { class: 'sfc-name' });
    ui.sub = h('div', { class: 'sfc-sub' });
    ui.price = h('div', { class: 'sfc-price' });
    ui.change = h('div', { class: 'sfc-change' });
    ui.pin = h('button', { class: 'sfc-btn', type: 'button', title: 'Pin chart (keeps it open)', 'aria-label': 'Pin chart', 'aria-pressed': 'false' }, svgIcon(ICON_PIN));
    ui.close = h('button', { class: 'sfc-btn', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close chart' }, svgIcon(ICON_CLOSE));
    ui.header = h('div', { class: 'sfc-header' }, h('div', { class: 'sfc-title' }, ui.name, ui.sub), h('div', { class: 'sfc-quote' }, ui.price, ui.change), ui.pin, ui.close);

    ui.tfButtons = {};
    ui.tf = h('div', { class: 'sfc-tf', role: 'group', 'aria-label': 'Timeframe' });
    for (const id of TIMEFRAME_ORDER) {
      const b = h('button', { type: 'button', 'aria-pressed': 'false', text: TIMEFRAMES[id].label });
      b.addEventListener('click', () => this.#cb.onTimeframe(id));
      ui.tfButtons[id] = b;
      ui.tf.append(b);
    }

    ui.notices = h('div', { class: 'sfc-notices', hidden: true, role: 'status', 'aria-live': 'polite' });
    ui.chartEl = h('div', { class: 'sfc-chart' });
    ui.legend = h('div', { class: 'sfc-legend' });
    ui.msg = h('div', { class: 'sfc-msg' });
    ui.actions = h('div', { class: 'sfc-actions' });
    ui.spinner = h('div', { class: 'sfc-spinner' });
    ui.overlay = h('div', { class: 'sfc-overlay', hidden: true, role: 'status' }, ui.spinner, ui.msg, ui.actions);
    ui.footer = h('div', { class: 'sfc-footer' });

    this.el = h(
      'div',
      { class: 'sfc-panel', role: 'dialog', 'aria-label': 'Stock chart', hidden: true },
      ui.header,
      ui.tf,
      ui.notices,
      h('div', { class: 'sfc-chartwrap' }, ui.chartEl, ui.legend, ui.overlay),
      ui.footer,
    );
    root.append(this.el);

    ui.pin.addEventListener('click', () => this.#cb.onPinToggle());
    ui.close.addEventListener('click', () => this.#cb.onClose());
    this.el.addEventListener('pointerenter', () => this.#cb.onPointerEnter());
    this.el.addEventListener('pointerleave', () => this.#cb.onPointerLeave());
    this.#wireDrag();
  }

  #wireDrag() {
    const { header } = this.#ui;
    header.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const r = this.el.getBoundingClientRect();
      this.#drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      header.setPointerCapture(e.pointerId);
      header.classList.add('sfc-dragging');
      e.preventDefault();
    });
    header.addEventListener('pointermove', (e) => {
      if (!this.#drag) return;
      this.#moveTo(e.clientX - this.#drag.dx, e.clientY - this.#drag.dy);
      this.moved = true;
    });
    const end = () => {
      this.#drag = null;
      header.classList.remove('sfc-dragging');
    };
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
  }

  #moveTo(left, top) {
    const r = this.el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    this.el.style.left = Math.min(Math.max(0, left), Math.max(0, vw - r.width)) + 'px';
    this.el.style.top = Math.min(Math.max(0, top), Math.max(0, vh - r.height)) + 'px';
  }

  #clampIntoViewport() {
    if (this.el.hidden) return;
    const r = this.el.getBoundingClientRect();
    this.#moveTo(r.left, r.top);
  }

  // ---------- lifecycle ----------
  mount() {
    if (!this.host.isConnected) document.documentElement.append(this.host);
  }

  show() {
    this.mount();
    this.el.hidden = false;
  }

  hide() {
    this.el.hidden = true;
    this.moved = false;
  }

  get visible() {
    return !this.el.hidden;
  }

  contains(node) {
    return !!node && (node === this.host || this.host.contains(node));
  }

  intersects(rect) {
    return !this.el.hidden && rectsIntersect(this.el.getBoundingClientRect(), rect);
  }

  positionNear(cursor, anchorRect) {
    const r = this.el.getBoundingClientRect();
    const pos = computePanelPosition({
      cursor,
      anchor: anchorRect,
      panel: { width: r.width, height: r.height },
      viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
    });
    this.el.style.left = pos.left + 'px';
    this.el.style.top = pos.top + 'px';
  }

  destroy() {
    window.removeEventListener('resize', this.#onWinResize);
    this.#chart?.destroy();
    this.#chart = null;
    this.host.remove();
  }

  // ---------- settings & state ----------
  applySettings(s) {
    this.#settings = s;
    this.el.dataset.theme = s.theme;
    this.el.style.width = s.width + 'px';
    this.el.style.height = s.height + 'px';
    this.#chart?.setTheme(s.theme);
  }

  setPinned(pinned) {
    this.#ui.pin.setAttribute('aria-pressed', String(pinned));
    this.#ui.pin.title = pinned ? 'Unpin chart' : 'Pin chart (keeps it open)';
  }

  setTimeframe(id) {
    for (const [k, b] of Object.entries(this.#ui.tfButtons)) b.setAttribute('aria-pressed', String(k === id));
  }

  setStock(stock) {
    const u = this.#ui;
    u.name.textContent = stock.companyName;
    u.name.title = stock.companyName;
    u.sub.textContent = stock.screenerIdentifier;
    u.price.textContent = '';
    u.change.textContent = '';
    u.change.className = 'sfc-change';
    u.footer.textContent = '';
    u.legend.replaceChildren();
    this.#setNotices([]);
  }

  // ---------- content states ----------
  #overlay({ message, spinner = false, actions = [] }) {
    const u = this.#ui;
    u.spinner.hidden = !spinner;
    u.msg.textContent = message;
    u.actions.replaceChildren(
      ...actions.map(({ label, onClick }) => {
        const b = h('button', { class: 'sfc-action', type: 'button', text: label });
        b.addEventListener('click', onClick);
        return b;
      }),
    );
    u.overlay.hidden = false;
  }

  #setNotices(list) {
    const el = this.#ui.notices;
    el.replaceChildren(...list.map((n) => h('div', { class: `sfc-notice sfc-${n.kind}`, text: n.text })));
    el.hidden = list.length === 0;
  }

  showLoading(name) {
    this.#setNotices([]);
    this.#chart?.clear();
    this.#ui.legend.replaceChildren();
    this.#overlay({ message: `Loading ${name}…`, spinner: true });
  }

  showError(err) {
    const e = err instanceof ExtError || err?.code ? err : new ExtError('UNKNOWN');
    this.#setNotices([]);
    this.#chart?.clear();
    this.#ui.legend.replaceChildren();
    let message = e.message || MESSAGES[e.code] || MESSAGES.UNKNOWN;
    if (e.code === 'UNRESOLVED' && e.details?.tried?.length) message += `\nTried: ${e.details.tried.join(', ')} — no data from the provider.`;
    if (e.code === 'UNRESOLVED' && e.details?.hint) message += `\n${e.details.hint}`;
    if (e.code === 'AMBIGUOUS' && e.details?.options?.length) {
      this.#overlay({
        message,
        actions: e.details.options.map((o) => ({ label: `${o.exchange} · ${o.symbol}${o.name ? ' · ' + o.name : ''}`, onClick: () => this.#cb.onPickSymbol(o.symbol) })),
      });
    } else {
      this.#overlay({ message, actions: e.code === 'EXTENSION_RELOADED' ? [] : [{ label: 'Retry', onClick: () => this.#cb.onRetry() }] });
    }
  }

  showData(p) {
    const u = this.#ui;
    this.#lastPayload = p;
    u.sub.textContent = `${p.symbol} · ${p.exchange}`;

    try {
      if (!this.#chart) this.#chart = new ChartManager(u.chartEl, { theme: this.#settings.theme, onCrosshair: (c) => this.#renderLegend(c) });
    } catch (e) {
      console.error('[Screener Floating Chart] chart init failed', e);
      return this.showError(new ExtError('CHART_INIT'));
    }
    this.#chart.setData(p.candles, { intraday: p.intraday, hasVolume: p.hasVolume });
    u.overlay.hidden = true;

    const last = p.candles[p.candles.length - 1];
    u.price.textContent = '₹' + formatPrice(last.close) + (last.derived ? ' (derived)' : '');
    u.price.title = last.derived ? 'Derived from intraday data; not the official close' : '';
    const ch = rangeChange(p.candles);
    if (ch) {
      u.change.textContent = `${ch.abs >= 0 ? '+' : ''}${formatPrice(ch.abs)} (${formatPercent(ch.pct)}) · ${p.timeframeId}`;
      u.change.className = 'sfc-change ' + (ch.abs >= 0 ? 'sfc-up' : 'sfc-down');
    }
    const fetched = ` · fetched ${formatFetchedAt(p.fetchedAt)}${p.fromCache ? ' (cache)' : ''}`;
    const stale = p.stale ? ' · STALE' : '';
    const via = p.resolvedVia && p.resolvedVia !== 'screener-id' ? ` · symbol via ${p.resolvedVia}` : '';
    u.footer.textContent = `${p.providerName} · ${p.intervalLabel} candles · last ${formatTimeLabel(last.time)} · historical, not live${fetched}${stale}${via}`;
    this.#setNotices(buildNotices(p));
    this.#renderLegend(null);
  }

  #renderLegend(c) {
    const u = this.#ui;
    const p = this.#lastPayload;
    const d = c || (p && { ...p.candles[p.candles.length - 1] });
    if (!d) return u.legend.replaceChildren();
    const cls = d.close >= d.open ? 'sfc-up' : 'sfc-down';
    const isDerived = d.derived || (p?.derived || []).some((x) => formatTimeLabel(x.date) === formatTimeLabel(d.time));
    const item = (label, val, klass = '') => {
      const b = h('b', { text: formatPrice(val) });
      if (klass) b.className = klass;
      return h('span', {}, `${label} `, b);
    };
    u.legend.replaceChildren(
      h('span', { class: 'sfc-date', text: formatTimeLabel(d.time) }),
      isDerived ? h('span', { class: 'sfc-tag', text: 'derived' }) : null,
      item('O', d.open, cls),
      item('H', d.high, cls),
      item('L', d.low, cls),
      item('C', d.close, cls),
      p?.hasVolume ? h('span', {}, 'Vol ', h('b', { text: formatVolume(d.volume) })) : null,
    );
  }
}
