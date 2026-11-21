// Wraps TradingView Lightweight Charts v5: candlesticks + volume histogram + crosshair events.
// The chart is created once and reused; stock/timeframe changes only call setData().
import { createChart, CandlestickSeries, HistogramSeries, CrosshairMode, ColorType } from 'lightweight-charts';

export const CHART_THEMES = {
  dark: { bg: '#0f1420', text: '#98a2b8', grid: '#1b2235', border: '#252d40', cross: '#5b6785', up: '#26a69a', down: '#ef5350' },
  light: { bg: '#ffffff', text: '#4b5568', grid: '#eef0f5', border: '#d9dde7', cross: '#9aa3b5', up: '#14966f', down: '#d93a3a' },
};

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export class ChartManager {
  #chart;
  #candles;
  #volume;
  #theme;
  #last = [];
  #onCrosshair;
  #hasVolume = true;

  #volumeData(candles) {
    const t = this.#theme;
    if (!this.#hasVolume) return [];
    return candles.filter((c) => c.volumeKnown !== false).map((c) => ({ time: c.time, value: c.volume, color: (c.close >= c.open ? t.up : t.down) + '66' }));
  }

  constructor(container, { theme = 'dark', onCrosshair } = {}) {
    this.#theme = CHART_THEMES[theme] || CHART_THEMES.dark;
    this.#onCrosshair = onCrosshair;
    const t = this.#theme;

    // autoSize makes the library observe its container with a ResizeObserver and
    // disconnect it in chart.remove(), so panel resizing/dragging needs no extra code.
    this.#chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: t.bg }, textColor: t.text, fontFamily: FONT, fontSize: 11 },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: t.cross, labelBackgroundColor: t.border }, horzLine: { color: t.cross, labelBackgroundColor: t.border } },
      rightPriceScale: { borderColor: t.border },
      timeScale: { borderColor: t.border, timeVisible: false, secondsVisible: false, rightOffset: 4 },
    });

    this.#candles = this.#chart.addSeries(CandlestickSeries, {
      upColor: t.up,
      downColor: t.down,
      borderVisible: false,
      wickUpColor: t.up,
      wickDownColor: t.down,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    this.#candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.27 } });

    this.#volume = this.#chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '', // overlay scale: volume occupies the bottom ~20% under the candles
      lastValueVisible: false,
      priceLineVisible: false,
    });
    this.#volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    this.#chart.subscribeCrosshairMove((param) => {
      const c = param?.seriesData?.get(this.#candles);
      if (!param?.time || !c) return this.#onCrosshair?.(null);
      const v = param.seriesData.get(this.#volume);
      this.#onCrosshair?.({ time: param.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: v?.value ?? null });
    });
  }

  setData(candles, { intraday = false, hasVolume = true } = {}) {
    this.#last = candles;
    const t = this.#theme;
    this.#chart.applyOptions({ timeScale: { timeVisible: intraday, secondsVisible: false } });
    this.#hasVolume = hasVolume;
    // Derived candles are drawn with a translucent body so they are visibly different from official ones.
    this.#candles.setData(
      candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, ...(c.derived ? { color: (c.close >= c.open ? t.up : t.down) + '80' } : {}) })),
    );
    this.#volume.setData(this.#volumeData(candles));
    this.#chart.timeScale().fitContent();
  }

  clear() {
    this.#last = [];
    this.#candles.setData([]);
    this.#volume.setData([]);
  }

  setTheme(name) {
    this.#theme = CHART_THEMES[name] || CHART_THEMES.dark;
    const t = this.#theme;
    this.#chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: t.bg }, textColor: t.text },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      rightPriceScale: { borderColor: t.border },
      timeScale: { borderColor: t.border },
      crosshair: { vertLine: { color: t.cross, labelBackgroundColor: t.border }, horzLine: { color: t.cross, labelBackgroundColor: t.border } },
    });
    this.#candles.applyOptions({ upColor: t.up, downColor: t.down, wickUpColor: t.up, wickDownColor: t.down });
    if (this.#last.length) this.#volume.setData(this.#volumeData(this.#last));
  }

  destroy() {
    this.#chart.remove();
  }
}
