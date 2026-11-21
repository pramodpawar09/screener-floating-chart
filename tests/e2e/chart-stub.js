// TEST ONLY: records what the extension asks the chart library to do. Not shipped; not used by real builds.
export const CandlestickSeries = 'Candlestick';
export const HistogramSeries = 'Histogram';
export const CrosshairMode = { Normal: 0, Magnet: 1 };
export const ColorType = { Solid: 'solid' };
export function createChart(container, options) {
  const rec = (window.__chart = { container, options, series: [], removed: false, fitted: 0, options_applied: [] });
  const el = document.createElement('div');
  el.className = 'stub-chart';
  el.style.cssText = 'position:absolute;inset:0';
  container.append(el);
  const makeSeries = (type) => {
    const s = { type, data: [] };
    rec.series.push(s);
    return {
      setData: (d) => { s.data = d; el.textContent = `${rec.series[0].data.length} candles`; },
      priceScale: () => ({ applyOptions() {} }),
      applyOptions() {},
    };
  };
  return {
    addSeries: (type) => makeSeries(type),
    applyOptions: (o) => rec.options_applied.push(o),
    timeScale: () => ({ fitContent: () => rec.fitted++ }),
    subscribeCrosshairMove: (cb) => (window.__crosshair = cb),
    remove: () => (rec.removed = true),
  };
}
