import { supertrend, stochastic, adx, cci, williamsR, awesomeOscillator, ultimateOscillator, volatility, beta, atr, computeTechRating } from "../src/lib/indicators";

// Deterministic uptrend bars with noise-free structure
const mk = (n: number, drift: number) => Array.from({ length: n }, (_, i) => {
  const base = 100 * Math.exp(drift * i);
  return { open: base * 0.999, high: base * 1.01, low: base * 0.99, close: base * 1.001, volume: 1000 + i };
});
const up = mk(120, 0.002);
const down = mk(120, -0.002);
const flat = mk(120, 0.00002);

console.log("supertrend up dir (expect 1):", supertrend(up).dir);
console.log("supertrend down dir (expect -1):", supertrend(down).dir);
console.log("supertrend up value < price:", (supertrend(up).value ?? 0) < up[up.length-1].close);
console.log("stochK up (expect >50):", stochastic(up).k?.toFixed(1));
console.log("stochK down (expect <50):", stochastic(down).k?.toFixed(1));
console.log("adx up (expect >25):", adx(up)?.toFixed(1));
console.log("adx flat (expect <20):", adx(flat)?.toFixed(1));
console.log("cci up (expect >0):", cci(up)?.toFixed(1));
console.log("williamsR up (expect near 0):", williamsR(up)?.toFixed(1));
console.log("williamsR down (expect near -100):", williamsR(down)?.toFixed(1));
console.log("ao up (expect >0):", awesomeOscillator(up)?.toFixed(2));
console.log("ao down (expect <0):", awesomeOscillator(down)?.toFixed(2));
console.log("uo up (expect >50):", ultimateOscillator(up)?.toFixed(1));
console.log("volatility flat < vol up? ", (volatility(flat.map(b=>b.close),21,252) ?? 0) < (volatility(up.map(b=>b.close),21,252) ?? 0));
const mkt = up.map((b) => b.close / 100 - 1);
const stock = down.map((b) => b.close / 100 - 1);
console.log("beta(down stock, up mkt) negative:", (beta(stock, mkt) ?? 1) < 0);
console.log("atr positive:", (atr(up) ?? 0) > 0);
const tr = computeTechRating({ price: up[up.length-1].close, rsi14: 75, stochK: 85, williamsR: -5, cci20: 150, ao: 2, aoPrev: 1, uo: 80, macdHist: 1, macdHistPrev: 0.5, smas: [90,89,88,70,60], emas: [91,90,89,75,65] });
console.log("techRating overheated-up:", tr.rating, "(expect Strong Sell - overbought)");
const tr2 = computeTechRating({ price: down[down.length-1].close, rsi14: 25, stochK: 15, williamsR: -95, cci20: -150, ao: -2, aoPrev: -1, uo: 20, macdHist: -1, macdHistPrev: -0.5, smas: [110,111,112,130,140], emas: [109,110,111,125,135] });
console.log("techRating oversold-down:", tr2.rating, "(expect Strong Buy)");
