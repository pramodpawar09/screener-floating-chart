// Entry point: wires settings, hover detection, the state machine, the panel and the data client.
import { loadSettings, onSettingsChanged } from '../shared/settings.js';
import { toExtError } from '../shared/errors.js';
import { getCandles, selectSymbol, isContextValid } from '../services/api-client.js';
import { FloatingPanel } from './floating-panel.js';
import { HoverController } from './hover-controller.js';
import { debug } from '../shared/log.js';
import { initialState, reduce } from './interaction-state.js';

(async function main() {
  if (window.__sfcLoaded) return; // never inject twice
  window.__sfcLoaded = true;

  let settings = await loadSettings();
  let state = initialState;
  let currentStock = null;
  let timeframe = settings.defaultTimeframe;
  let requestSeq = 0; // stale-response guard: only the latest request may update the UI
  const dispatch = (event) => (state = reduce(state, event));

  async function load() {
    const id = ++requestSeq;
    const stock = currentStock;
    const tf = timeframe;
    panel.setTimeframe(tf);
    panel.showLoading(stock.companyName);
    try {
      const data = await getCandles({ stock, timeframeId: tf });
      if (id !== requestSeq) return; // user moved on; discard
      dispatch({ type: 'LOADED' });
      panel.showData(data);
    } catch (e) {
      if (id !== requestSeq) return;
      dispatch({ type: 'FAILED' });
      panel.showError(toExtError(e));
    }
  }

  function close() {
    requestSeq++; // invalidate in-flight work
    dispatch({ type: 'CLOSE' });
    panel.hide();
    panel.setPinned(false);
    hover.reset();
  }

  function openFor({ stock, anchorRect, cursor }) {
    if (!settings.enabled) return;
    debug('hover', { company: stock.companyName, identifier: stock.screenerIdentifier, variant: stock.variant });
    const wasClosed = state.phase === 'CLOSED';
    currentStock = stock;
    dispatch({ type: 'SHOW', key: stock.screenerIdentifier });
    panel.setStock(stock);
    panel.setPinned(state.pinned);
    panel.show();
    // Reposition only when opening, or when an unpinned, undragged panel would cover the new stock.
    if (wasClosed || (!state.pinned && !panel.moved && panel.intersects(anchorRect))) panel.positionNear(cursor, anchorRect);
    load();
  }

  const panel = new FloatingPanel({
    settings,
    callbacks: {
      onTimeframe: (id) => {
        if (!currentStock || id === timeframe) return;
        timeframe = id;
        dispatch({ type: 'RELOAD' });
        load();
      },
      onRetry: () => {
        dispatch({ type: 'RELOAD' });
        load();
      },
      onPickSymbol: async (symbol) => {
        try {
          await selectSymbol({ stock: currentStock, symbol });
        } catch (e) {
          return panel.showError(toExtError(e));
        }
        dispatch({ type: 'RELOAD' });
        load();
      },
      onPinToggle: () => {
        dispatch({ type: 'TOGGLE_PIN' });
        panel.setPinned(state.pinned);
      },
      onClose: close,
      onPointerEnter: () => hover.cancelHide(),
      onPointerLeave: () => hover.scheduleHide(),
    },
  });

  const hover = new HoverController({
    getSettings: () => settings,
    isOwnNode: (n) => panel.contains(n),
    isActive: (key) => state.phase !== 'CLOSED' && state.key === key,
    onHover: openFor,
    onPinRequest: (info) => {
      openFor(info);
      dispatch({ type: 'PIN' });
      panel.setPinned(true);
    },
    onHideRequest: () => {
      if (!isContextValid()) return teardown();
      dispatch({ type: 'HIDE' });
      if (state.phase === 'CLOSED') {
        requestSeq++;
        panel.hide();
        hover.reset();
      }
    },
    onEscape: () => state.phase !== 'CLOSED' && close(),
  });

  const stopSettings = onSettingsChanged((s) => {
    const prevDefault = settings.defaultTimeframe;
    settings = s;
    panel.applySettings(s);
    if (!s.enabled) close();
    else if (state.phase === 'CLOSED' && s.defaultTimeframe !== prevDefault) timeframe = s.defaultTimeframe;
  });

  // After an extension reload/update the old content script is orphaned; clean up quietly.
  function teardown() {
    stopSettings();
    hover.destroy();
    panel.destroy();
    window.__sfcLoaded = false;
  }

  hover.attach();
})();
