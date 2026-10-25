/**
 * Technical indicators computed from daily close series.
 * All functions expect arrays ordered oldest -> newest.
 */

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. Returns the latest value. */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** MACD (12, 26, 9). Returns latest macd, signal and histogram. */
export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
  if (closes.length < slow + signalPeriod) return { macd: null, signal: null, hist: null };
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const macdLine: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] != null && emaSlow[i] != null) {
      macdLine.push((emaFast[i] as number) - (emaSlow[i] as number));
      idx.push(i);
    }
  }
  if (macdLine.length < signalPeriod) return { macd: null, signal: null, hist: null };
  const sigSeries = emaSeries(macdLine, signalPeriod);
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSig = sigSeries[sigSeries.length - 1];
  return {
    macd: lastMacd,
    signal: lastSig,
    hist: lastSig != null ? lastMacd - lastSig : null,
  };
}

/** Percent return over approximately `days` trading days ago. */
export function momentum(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const past = closes[closes.length - 1 - days];
  const now = closes[closes.length - 1];
  if (!past) return null;
  return ((now - past) / past) * 100;
}

/** ATR% proxy computed from close-to-close true range (no OHLC in spark data). */
export function closeAtrPct(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    sum += Math.abs(closes[i] - closes[i - 1]);
  }
  const atr = sum / period;
  const last = closes[closes.length - 1];
  return last ? (atr / last) * 100 : null;
}

export interface ComputedIndicators {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  atr14Pct: number | null;
  mom1M: number | null;
  mom3M: number | null;
  mom6M: number | null;
  aboveSma20: boolean;
  aboveSma50: boolean;
  aboveSma200: boolean;
  goldenCross: boolean;
}

export function computeIndicators(closes: number[]): ComputedIndicators {
  const valid = closes.filter((c) => Number.isFinite(c));
  const s20 = sma(valid, 20);
  const s50 = sma(valid, 50);
  const s200 = sma(valid, 200);
  const e20 = emaSeries(valid, 20);
  const m = macd(valid);
  const price = valid[valid.length - 1] ?? null;
  return {
    sma20: s20,
    sma50: s50,
    sma200: s200,
    ema20: e20[e20.length - 1] ?? null,
    rsi14: rsi(valid),
    macd: m.macd,
    macdSignal: m.signal,
    macdHist: m.hist,
    atr14Pct: closeAtrPct(valid),
    mom1M: momentum(valid, 21),
    mom3M: momentum(valid, 63),
    mom6M: momentum(valid, 126),
    aboveSma20: s20 != null && price != null ? price > s20 : false,
    aboveSma50: s50 != null && price != null ? price > s50 : false,
    aboveSma200: s200 != null && price != null ? price > s200 : false,
    goldenCross: s20 != null && s50 != null ? s20 > s50 : false,
  };
}

// ---------------------------------------------------- extended indicators
// Weekly-timeframe indicators, Bollinger Bands and price-vs-MA distances —
// computed once per EOD sync and stored as columns so the condition builder
// can filter over them in pure SQL.

export interface ExtendedIndicators {
  wRsi14: number | null;
  wMacdHist: number | null;
  bbPctB: number | null;
  bbWidthPct: number | null;
  emaCross: boolean | null;
  distSma20Pct: number | null;
  distSma50Pct: number | null;
  distSma100Pct: number | null;
  distSma200Pct: number | null;
  distEma20Pct: number | null;
  distEma50Pct: number | null;
  distEma100Pct: number | null;
  distEma200Pct: number | null;
}

/**
 * Aggregate an ascending [unixTs, close] daily series to weekly closes
 * (last close per ISO week, Monday-anchored, UTC).
 */
export function weeklyCloses(series: [number, number][]): number[] {
  const byWeek = new Map<number, number>();
  for (const [ts, close] of series) {
    const d = new Date(ts * 1000);
    const day = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    const monday = Math.floor(ts / 86400 - day) * 86400;
    byWeek.set(monday, close); // later days overwrite — keeps the week's last close
  }
  return [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}

/** Bollinger Bands (period, 2σ population). Returns %B (0-100) and width (% of mid). */
export function bollinger(closes: number[], period = 20): { pctB: number | null; widthPct: number | null } {
  if (closes.length < period) return { pctB: null, widthPct: null };
  const win = closes.slice(-period);
  const mid = win.reduce((a, c) => a + c, 0) / period;
  const variance = win.reduce((a, c) => a + (c - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mid + 2 * sd;
  const lower = mid - 2 * sd;
  const price = closes[closes.length - 1];
  const span = upper - lower;
  return {
    pctB: span > 0 && price != null ? Math.max(0, Math.min(100, ((price - lower) / span) * 100)) : null,
    widthPct: mid > 0 ? (span / mid) * 100 : null,
  };
}

const distPct = (price: number | null, ma: number | null): number | null =>
  price != null && ma != null && ma > 0 ? (price / ma - 1) * 100 : null;

/** Extended indicator set — needs the timestamped series (weekly buckets) plus daily closes. */
export function computeExtendedIndicators(series: [number, number][]): ExtendedIndicators {
  const valid = series.filter(([, c]) => Number.isFinite(c));
  const closes = valid.map(([, c]) => c);
  const price = closes[closes.length - 1] ?? null;
  const weekly = weeklyCloses(valid);

  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s100 = sma(closes, 100);
  const s200 = sma(closes, 200);
  const lastOf = (arr: (number | null)[]) => arr[arr.length - 1] ?? null;
  const e20 = lastOf(emaSeries(closes, 20));
  const e50 = lastOf(emaSeries(closes, 50));
  const e100 = lastOf(emaSeries(closes, 100));
  const e200 = lastOf(emaSeries(closes, 200));
  const bb = bollinger(closes, 20);
  const wMacd = weekly.length >= 36 ? macd(weekly) : { hist: null };

  return {
    wRsi14: weekly.length >= 15 ? rsi(weekly) : null,
    wMacdHist: wMacd.hist,
    bbPctB: bb.pctB,
    bbWidthPct: bb.widthPct,
    emaCross: e20 != null && e50 != null ? e20 > e50 : null,
    distSma20Pct: distPct(price, s20),
    distSma50Pct: distPct(price, s50),
    distSma100Pct: distPct(price, s100),
    distSma200Pct: distPct(price, s200),
    distEma20Pct: distPct(price, e20),
    distEma50Pct: distPct(price, e50),
    distEma100Pct: distPct(price, e100),
    distEma200Pct: distPct(price, e200),
  };
}

/** Downsample a [ts, close] series to at most `maxPoints` evenly spaced points. */
export function downsample(series: [number, number][], maxPoints = 180): [number, number][] {
  if (series.length <= maxPoints) return series;
  const step = series.length / maxPoints;
  const out: [number, number][] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(series[Math.min(Math.floor(i * step), series.length - 1)]);
  }
  const last = series[series.length - 1];
  if (out[out.length - 1][0] !== last[0]) out.push(last);
  return out;
}

// ============================================================================
// OHLC-based indicators — TradingView-style technicals computed from full
// daily bars (DailyBar). All bar arrays are ordered oldest -> newest and use
// { open, high, low, close, volume } rows.

export interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** ATR(14) — Wilder's smoothing over true range. Returns the latest value. */
export function atr(bars: Bar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  let value = 0;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    trs.push(tr);
    if (trs.length === period) {
      value = trs.reduce((a, t) => a + t, 0) / period;
    } else if (trs.length > period) {
      value = (value * (period - 1) + tr) / period; // Wilder smoothing
    }
  }
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Stochastic Oscillator %K (smoothed) and %D — default (14, 3, 3). */
export function stochastic(bars: Bar[], kPeriod = 14, kSmooth = 3, dSmooth = 3): { k: number | null; d: number | null } {
  if (bars.length < kPeriod + kSmooth + dSmooth) return { k: null, d: null };
  const rawK: number[] = [];
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (bars[j].high > hh) hh = bars[j].high;
      if (bars[j].low < ll) ll = bars[j].low;
    }
    rawK.push(hh > ll ? ((bars[i].close - ll) / (hh - ll)) * 100 : 50);
  }
  const smooth = (arr: number[], p: number): number[] => {
    const out: number[] = [];
    for (let i = p - 1; i < arr.length; i++) {
      let s = 0;
      for (let j = i - p + 1; j <= i; j++) s += arr[j];
      out.push(s / p);
    }
    return out;
  };
  const kSeries = smooth(rawK, kSmooth);
  const dSeries = smooth(kSeries, dSmooth);
  return {
    k: kSeries.length ? kSeries[kSeries.length - 1] : null,
    d: dSeries.length ? dSeries[dSeries.length - 1] : null,
  };
}

/** ADX(14) with Wilder smoothing — trend strength 0-100. */
export function adx(bars: Bar[], period = 14): number | null {
  if (bars.length < period * 2 + 1) return null;
  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].high - bars[i - 1].high;
    const down = bars[i - 1].low - bars[i].low;
    plusDMs.push(up > down && up > 0 ? up : 0);
    minusDMs.push(down > up && down > 0 ? down : 0);
    trs.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
  }
  let tr = trs.slice(0, period).reduce((a, v) => a + v, 0);
  let pdm = plusDMs.slice(0, period).reduce((a, v) => a + v, 0);
  let mdm = minusDMs.slice(0, period).reduce((a, v) => a + v, 0);
  let dxs: number[] = [];
  for (let i = period; i < trs.length; i++) {
    tr = tr - tr / period + trs[i];
    pdm = pdm - pdm / period + plusDMs[i];
    mdm = mdm - mdm / period + minusDMs[i];
    const pdi = tr > 0 ? (pdm / tr) * 100 : 0;
    const mdi = tr > 0 ? (mdm / tr) * 100 : 0;
    dxs.push(pdi + mdi > 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0);
  }
  if (dxs.length < period) return null;
  let adxV = dxs.slice(0, period).reduce((a, v) => a + v, 0) / period;
  for (let i = period; i < dxs.length; i++) adxV = (adxV * (period - 1) + dxs[i]) / period;
  return Number.isFinite(adxV) ? adxV : null;
}

/** CCI(20) — Commodity Channel Index. */
export function cci(bars: Bar[], period = 20): number | null {
  if (bars.length < period) return null;
  const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
  const win = tp.slice(-period);
  const smaTp = win.reduce((a, v) => a + v, 0) / period;
  let meanDev = 0;
  for (const v of win) meanDev += Math.abs(v - smaTp);
  meanDev /= period;
  if (meanDev === 0) return 0;
  return (win[win.length - 1] - smaTp) / (0.015 * meanDev);
}

/** Williams %R(14) — 0 (at high) to -100 (at low). */
export function williamsR(bars: Bar[], period = 14): number | null {
  if (bars.length < period) return null;
  const win = bars.slice(-period);
  let hh = -Infinity;
  let ll = Infinity;
  for (const b of win) {
    if (b.high > hh) hh = b.high;
    if (b.low < ll) ll = b.low;
  }
  if (hh === ll) return -50;
  return ((hh - win[win.length - 1].close) / (hh - ll)) * -100;
}

/** Awesome Oscillator — SMA(median, 5) − SMA(median, 34). */
export function awesomeOscillator(bars: Bar[]): number | null {
  if (bars.length < 34) return null;
  const median = bars.map((b) => (b.high + b.low) / 2);
  const s5 = sma(median, 5);
  const s34 = sma(median, 34);
  return s5 != null && s34 != null ? s5 - s34 : null;
}

/** Ultimate Oscillator (7, 14, 28) — 0-100. */
export function ultimateOscillator(bars: Bar[]): number | null {
  if (bars.length < 29) return null;
  let bp7 = 0, tr7 = 0, bp14 = 0, tr14 = 0, bp28 = 0, tr28 = 0;
  for (let i = bars.length - 28; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    const trueLow = Math.min(bars[i].low, prevClose);
    const bp = bars[i].close - trueLow;
    const tr = Math.max(bars[i].high - trueLow, Math.abs(bars[i].close - prevClose));
    const age = bars.length - i;
    if (age <= 7) { bp7 += bp; tr7 += tr; }
    if (age <= 14) { bp14 += bp; tr14 += tr; }
    bp28 += bp; tr28 += tr;
  }
  if (tr7 === 0 || tr14 === 0 || tr28 === 0) return null;
  const avg7 = bp7 / tr7, avg14 = bp14 / tr14, avg28 = bp28 / tr28;
  return ((4 * avg7 + 2 * avg14 + avg28) / 7) * 100;
}

/** Supertrend (10, 3×ATR). Returns the band value and direction (1 up / -1 down). */
export function supertrend(bars: Bar[], period = 10, mult = 3): { value: number | null; dir: number | null } {
  if (bars.length < period + 2) return { value: null, dir: null };
  // Wilder ATR series
  const trs: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    trs.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
  }
  let a = trs.slice(1, period + 1).reduce((x, v) => x + v, 0) / period;
  const atrs: number[] = new Array(bars.length).fill(0);
  for (let i = period + 1; i < bars.length; i++) {
    a = (a * (period - 1) + trs[i]) / period;
    atrs[i] = a;
  }
  atrs[period] = trs.slice(1, period + 1).reduce((x, v) => x + v, 0) / period;

  let dir = 1;
  let finalUpper = Infinity;
  let finalLower = -Infinity;
  for (let i = period; i < bars.length; i++) {
    const mid = (bars[i].high + bars[i].low) / 2;
    const upper = mid + mult * atrs[i];
    const lower = mid - mult * atrs[i];
    finalUpper = bars[i - 1].close > finalUpper || upper < finalUpper ? Math.max(upper, finalUpper) : upper;
    finalLower = bars[i - 1].close < finalLower || lower > finalLower ? Math.min(lower, finalLower) : lower;
    if (dir === 1 && bars[i].close < finalLower) dir = -1;
    else if (dir === -1 && bars[i].close > finalUpper) dir = 1;
  }
  const last = bars[bars.length - 1];
  const mid = (last.high + last.low) / 2;
  return { value: dir === 1 ? finalLower : finalUpper, dir, ...(Number.isFinite(mid) ? {} : {}) };
}

/** Annualised volatility % — stdev of daily (or weekly) simple returns × √P. */
export function volatility(closes: number[], period: number, periodsPerYear: number): number | null {
  if (closes.length < period + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(closes[i] / closes[i - 1] - 1);
  }
  if (rets.length < period - 2) return null;
  const mean = rets.reduce((a, v) => a + v, 0) / rets.length;
  const variance = rets.reduce((a, v) => a + (v - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear) * 100;
}

/** Beta vs a same-length aligned index return series (1Y window). */
export function beta(symRets: number[], idxRets: number[]): number | null {
  const n = Math.min(symRets.length, idxRets.length);
  if (n < 60) return null;
  const s = symRets.slice(-n);
  const m = idxRets.slice(-n);
  let meanS = 0, meanM = 0;
  for (let i = 0; i < n; i++) { meanS += s[i]; meanM += m[i]; }
  meanS /= n; meanM /= n;
  let cov = 0, varM = 0;
  for (let i = 0; i < n; i++) {
    cov += (s[i] - meanS) * (m[i] - meanM);
    varM += (m[i] - meanM) ** 2;
  }
  return varM > 0 ? cov / varM : null;
}

/** % return over `days` sessions ago — thin wrapper for readability. */
export function perfOver(closes: number[], days: number): number | null {
  return momentum(closes, days);
}

/** TradingView-style composite rating.
 *  Oscillator votes: RSI(>=70 sell / <=30 buy), Stoch%K, Williams %R, CCI,
 *  Awesome Osc, Ultimate Osc, MACD hist vs prev.
 *  MA votes: price vs SMA 10/20/50/100/200 + EMA 10/20/50/100/200.
 *  Returns the group scores in −1..+1 and a 5-level label. */
export interface TechRatings {
  oscScore: number; // −1..+1
  maScore: number;
  total: number; // −100..+100
  rating: "Strong Sell" | "Sell" | "Neutral" | "Buy" | "Strong Buy";
  oscLabel: string;
  maLabel: string;
}

const vote = (buy: boolean | null, sell: boolean | null): number =>
  buy ? 1 : sell ? -1 : 0;

function labelOf(score: number): TechRatings["rating"] {
  if (score <= -0.5) return "Strong Sell";
  if (score <= -0.15) return "Sell";
  if (score < 0.15) return "Neutral";
  if (score < 0.5) return "Buy";
  return "Strong Buy";
}

export function computeTechRating(input: {
  price: number;
  rsi14: number | null;
  stochK: number | null;
  williamsR: number | null;
  cci20: number | null;
  ao: number | null;
  aoPrev: number | null;
  uo: number | null;
  macdHist: number | null;
  macdHistPrev: number | null;
  smas: (number | null)[];
  emas: (number | null)[];
}): TechRatings {
  const { price, rsi14, stochK, williamsR: wr, cci20, ao, aoPrev, uo, macdHist, macdHistPrev } = input;
  const oscVotes: number[] = [
    vote(rsi14 != null ? rsi14 <= 30 : null, rsi14 != null ? rsi14 >= 70 : null),
    vote(stochK != null ? stochK <= 20 : null, stochK != null ? stochK >= 80 : null),
    vote(wr != null ? wr <= -80 : null, wr != null ? wr >= -20 : null),
    vote(cci20 != null ? cci20 <= -100 : null, cci20 != null ? cci20 >= 100 : null),
    ao != null && aoPrev != null ? (ao > aoPrev ? 1 : ao < aoPrev ? -1 : 0) : 0,
    vote(uo != null ? uo <= 30 : null, uo != null ? uo >= 70 : null),
    macdHist != null && macdHistPrev != null ? (macdHist > 0 ? 1 : macdHist < 0 ? -1 : 0) : 0,
  ];
  const oscScore = oscVotes.reduce((a, v) => a + v, 0) / oscVotes.length;

  const maVotes: number[] = [];
  for (const ma of [...input.smas, ...input.emas]) {
    maVotes.push(ma != null ? (price > ma ? 1 : -1) : 0);
  }
  const maScore = maVotes.reduce((a, v) => a + v, 0) / maVotes.length;

  const total = Math.round(((oscScore + maScore) / 2) * 100);
  const rating = labelOf((oscScore + maScore) / 2);
  return { oscScore, maScore, total, rating, oscLabel: labelOf(oscScore), maLabel: labelOf(maScore) };
}
