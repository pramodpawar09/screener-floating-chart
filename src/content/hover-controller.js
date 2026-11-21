// Event-delegated hover handling (three document listeners total, regardless of row count).
// It only detects intent and reports it; the owner decides what to do via callbacks.
import { createTimer } from '../utils/debounce.js';
import { closestAnchor } from '../utils/dom-utils.js';
import { detectStock } from './stock-detector.js';

export class HoverController {
  #opts;
  #openTimer = createTimer();
  #hideTimer = createTimer();
  #pendingKey = null;
  #listeners = [];

  /**
   * @param {object} opts
   * @param {() => object} opts.getSettings
   * @param {(n: Node) => boolean} opts.isOwnNode  true for nodes inside the extension's panel
   * @param {(key: string) => boolean} opts.isActive  true if that stock is already displayed
   * @param {(info) => void} opts.onHover  { stock, anchorRect, cursor }
   * @param {(info) => void} opts.onPinRequest  Alt+click on a stock name
   * @param {() => void} opts.onHideRequest  hide delay elapsed
   * @param {() => void} opts.onEscape
   */
  constructor(opts) {
    this.#opts = opts;
  }

  attach() {
    const on = (type, fn, capture = true) => {
      document.addEventListener(type, fn, capture);
      this.#listeners.push([type, fn, capture]);
    };
    on('mouseover', (e) => this.#over(e));
    on('mouseout', (e) => this.#out(e));
    on('click', (e) => this.#click(e));
    on('keydown', (e) => e.key === 'Escape' && this.#opts.onEscape());
  }

  destroy() {
    for (const [t, fn, c] of this.#listeners) document.removeEventListener(t, fn, c);
    this.#listeners = [];
    this.#openTimer.clear();
    this.#hideTimer.clear();
  }

  cancelHide() {
    this.#hideTimer.clear();
  }

  scheduleHide() {
    this.#hideTimer.set(() => this.#opts.onHideRequest(), this.#opts.getSettings().hideDelay);
  }

  reset() {
    this.#openTimer.clear();
    this.#hideTimer.clear();
    this.#pendingKey = null;
  }

  #stockFrom(e) {
    if (!this.#opts.getSettings().enabled || this.#opts.isOwnNode(e.target)) return null;
    return detectStock(e.target);
  }

  #over(e) {
    const stock = this.#stockFrom(e);
    if (!stock) return;
    const key = stock.screenerIdentifier;
    this.#hideTimer.clear();
    if (this.#opts.isActive(key) || this.#pendingKey === key) return; // same stock: nothing to do

    this.#pendingKey = key;
    const cursor = { x: e.clientX, y: e.clientY };
    this.#openTimer.set(() => {
      this.#pendingKey = null;
      const anchorRect = stock.anchor.getBoundingClientRect();
      this.#opts.onHover({ stock, anchorRect, cursor });
    }, this.#opts.getSettings().hoverDelay);
  }

  #out(e) {
    if (this.#opts.isOwnNode(e.target)) return;
    const anchor = closestAnchor(e.target);
    if (!anchor || !detectStock(anchor)) return;
    const to = e.relatedTarget;
    if (to && anchor.contains(to)) return; // still inside the same link
    // Moving into our own panel: never hide. (Chromium fires the panel's pointerenter *before* this
    // mouseout, so relying on pointerenter alone to cancel the hide would be a race.)
    if (to && this.#opts.isOwnNode(to)) return;
    this.#openTimer.clear();
    this.#pendingKey = null;
    if (to && detectStock(to)) return; // moving to another stock link: its mouseover takes over
    this.scheduleHide();
  }

  #click(e) {
    if (!e.altKey) return; // plain clicks keep Screener's normal navigation
    const stock = this.#stockFrom(e);
    if (!stock) return;
    e.preventDefault();
    e.stopPropagation();
    this.#openTimer.clear();
    this.#pendingKey = null;
    this.#opts.onPinRequest({
      stock,
      anchorRect: stock.anchor.getBoundingClientRect(),
      cursor: { x: e.clientX, y: e.clientY },
    });
  }
}
