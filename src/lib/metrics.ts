/**
 * Precomputed stock metrics — pipeline Step 2.
 *
 * For every priced symbol, derive the full indicator set from the raw OHLCV
 * bars (DailyBar) ONCE per EOD session and write a flat row into StockMetrics
 * (symbol, date). This is deliberately a background job — never anything a
 * request handler waits on — so every read path (screener, scanners, breadth,
 * watchlists) becomes a trivial indexed lookup against precomputed columns:
 *
 *   WHERE rsi14 < 30 AND sma20 > sma50   — on an indexed flat table
 *
 * Set-based/batched by design: one bars query per ~400-symbol chunk, one bulk
 * insert per chunk, event-loop yields between chunks. Ratings (RS/EPS/A-D)
 * and the weekly indicators are carried over from Stock, where the ratings
 * recompute and the closes phase already produced them.
 */

import { db, descNullsLast } from "@/lib/db";
import {
  computeIndicators, computeExtendedIndicators, emaSeries, sma, weeklyCloses,
  atr, stochastic, adx, cci, williamsR, awesomeOscillator, ultimateOscillator,
  supertrend, volatility, beta as betaOf, computeTechRating, macd as macdOf, type Bar,
} from "@/lib/indicators";
import { weightedRs } from "@/lib/ratings";
import { expectedLatestBarDate } from "@/lib/bar-sync";
import { fetchChart } from "@/lib/yahoo";

interface MetricsGlobals {
  __tpMetricsRunning?: boolean;
}
const g = globalThis as unknown as MetricsGlobals;

const CHUNK = 400; // symbols per chunk (bars query + bulk insert)
const MIN_SESSION_ROWS = 800; // a "full" NSE session — below this the bars are still trickling

// --- Nifty index closes for beta ------------------------------------------
// One ^NSEI chart fetch per metrics run, cached per session date. Beta needs
// an aligned daily return series — null-safe: an index fetch failure only
// blanks beta1Y, never blocks the metrics run.
let indexCache: { date: string; byDate: Map<string, number> } | null = null;

async function indexClosesByDate(sessionDate: string): Promise<Map<string, number>> {
  if (indexCache && indexCache.date === sessionDate) return indexCache.byDate;
  try {
    const chart = await fetchChart("^NSEI", "2y");
    const q = chart.indicators?.quote?.[0];
    const ts = chart.timestamp ?? [];
    const closes = q?.close ?? [];
    const byDate = new Map<string, number>();
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c != null && Number.isFinite(c) && c > 0) {
        byDate.set(new Date(ts[i] * 1000).toISOString().slice(0, 10), c);
      }
    }
    indexCache = { date: sessionDate, byDate };
    return byDate;
  } catch {
    indexCache = { date: sessionDate, byDate: new Map() };
    return indexCache.byDate;
  }
}

const dailyReturns = (rows: { date: string; close: number }[]): Map<string, number> => {
  const rets = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i - 1].close > 0) rets.set(rows[i].date, rows[i].close / rows[i - 1].close - 1);
  }
  return rets;
};

const r6 = (x: number | null | undefined): number | null =>
  x == null || !Number.isFinite(x) ? null : Number(x.toFixed(6));
const b = (v: boolean | null | undefined): boolean | null => (v == null ? null : v);

/** MACD histogram one bar back — drives the MACD rating vote. */
function macdHistPrev(closes: number[]): number | null {
  if (closes.length < 36) return null;
  const m = macdOf(closes.slice(0, -1));
  return m.hist;
}

export interface MetricsOutcome {
  ok: boolean;
  date: string | null;
  rows: number;
  reason?: string;
}

/**
 * Compute + persist StockMetrics for `date` (default: the latest EOD session).
 * Skips when the session already has metrics (force to recompute) or when the
 * bars for that session haven't fully landed yet (the scheduler sweeper
 * retries in ~10 min).
 */
export async function computeStockMetrics(opts?: { date?: string; force?: boolean }): Promise<MetricsOutcome> {
  if (g.__tpMetricsRunning) return { ok: false, date: null, rows: 0, reason: "already-running" };
  g.__tpMetricsRunning = true;
  try {
    const date = opts?.date ?? (await expectedLatestBarDate());
    if (!date) return { ok: false, date: null, rows: 0, reason: "no-eod-date" };

    if (!opts?.force) {
      const existing = await db.stockMetrics.count({ where: { date } });
      if (existing > 0) return { ok: false, date, rows: existing, reason: "already-computed" };
    }

    // Bars for this session must have fully landed before metrics are built —
    // otherwise the row would freeze a partial-universe snapshot for the day.
    const sessionRows = await db.dailyBar.count({ where: { date } });
    if (sessionRows < MIN_SESSION_ROWS) {
      return { ok: false, date, rows: 0, reason: `bars-incomplete (${sessionRows}/${MIN_SESSION_ROWS})` };
    }

    // Partial-session guard (two more signals on top of the raw row count):
    //
    // 1. Coverage — the day's rows must cover ≥90% of the symbols that traded
    //    in the surrounding 10-day window. The raw count alone cannot tell
    //    2,800 complete EOD rows from 2,767 rows written mid-session while
    //    hundreds of names were still missing.
    // 2. No bars trickle in flight — the trickle walks the universe by market
    //    cap, so large-cap gates pass while micro-caps are still landing.
    //    Freezing metrics mid-trickle would lock a partial universe in for
    //    the day ("already-computed" blocks any re-run).
    const trickleRunning = Boolean(
      (globalThis as unknown as { __tpBarsTrickle?: boolean }).__tpBarsTrickle
    );
    if (trickleRunning && !opts?.force) {
      return { ok: false, date, rows: 0, reason: "bars-trickle-running" };
    }
    const winStart = new Date(Date.parse(`${date}T00:00:00Z`) - 10 * 86400_000).toISOString().slice(0, 10);
    const activeSymbols = await db.dailyBar.groupBy({
      by: ["symbol"],
      where: { date: { gte: winStart, lte: date } },
    });
    const minCoverage = Math.floor(activeSymbols.length * 0.9);
    if (sessionRows < minCoverage) {
      return {
        ok: false,
        date,
        rows: 0,
        reason: `bars-coverage (${sessionRows}/${activeSymbols.length} active symbols, need ${minCoverage})`,
      };
    }

    // ~380 calendar days ≈ 253 trading sessions — covers the deepest lookback
    // (252-session momentum / 52-week window) with margin.
    const cutoff = new Date(Date.parse(`${date}T00:00:00Z`) - 380 * 86400_000).toISOString().slice(0, 10);

    const stocks = await db.stock.findMany({
      where: { price: { not: null } },
      select: {
        symbol: true,
        rsRating: true,
        epsScore: true,
        adRating: true,
        wRsi14: true,
        wMacdHist: true,
        volSpike: true,
        mom3Y: true,
        mom5Y: true,
        fromAthPct: true,
      },
      orderBy: descNullsLast("marketCap"),
    });

    const idxByDate = await indexClosesByDate(date);

    // Rebuild the whole session atomically: wipe any partial run, then insert.
    await db.stockMetrics.deleteMany({ where: { date } });

    let total = 0;
    for (let i = 0; i < stocks.length; i += CHUNK) {
      const chunk = stocks.slice(i, i + CHUNK);
      const symbols = chunk.map((s) => s.symbol);
      const bars = await db.dailyBar.findMany({
        where: { symbol: { in: symbols }, date: { gte: cutoff, lte: date } },
        orderBy: [{ symbol: "asc" }, { date: "asc" }],
        select: { symbol: true, date: true, open: true, high: true, low: true, close: true, volume: true },
      });
      if (bars.length === 0) continue;

      const bySymbol = new Map<string, typeof bars>();
      for (const r of bars) {
        const list = bySymbol.get(r.symbol);
        if (list) list.push(r);
        else bySymbol.set(r.symbol, [r]);
      }

      const rows: Record<string, unknown>[] = [];
      for (const s of chunk) {
        const list = bySymbol.get(s.symbol);
        if (!list || list.length === 0) continue;
        const n = list.length;
        const closes = list.map((r) => r.close);
        const close = closes[n - 1];
        if (!Number.isFinite(close) || close <= 0) continue;

        const ind = computeIndicators(closes);
        const series: [number, number][] = list.map((r) => [Date.parse(`${r.date}T00:00:00Z`) / 1000, r.close]);
        const ext = computeExtendedIndicators(series);
        const bars: Bar[] = list.map((r) => ({
          open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
        }));
        const e10s = emaSeries(closes, 10);
        const e50s = emaSeries(closes, 50);
        const e100s = emaSeries(closes, 100);
        const e200s = emaSeries(closes, 200);
        const ema10 = e10s[n - 1] ?? null;
        const ema50 = e50s[n - 1] ?? null;
        const ema100 = e100s[n - 1] ?? null;
        const ema200 = e200s[n - 1] ?? null;
        const sma100 = sma(closes, 100);
        const sma10 = sma(closes, 10);

        // 52-week window (up to 252 sessions)
        const w = list.slice(-252);
        let high52 = -Infinity;
        let low52 = Infinity;
        for (const r of w) {
          if (r.high > high52) high52 = r.high;
          if (r.low < low52) low52 = r.low;
        }
        const fromHighPct = high52 > 0 ? Math.max(0, ((high52 - close) / high52) * 100) : null;
        const fromLowPct = low52 > 0 ? Math.max(0, ((close - low52) / low52) * 100) : null;

        // momentum over ~252 sessions (12M)
        const mom12M =
          n > 252 && closes[n - 1 - 252] > 0 ? ((close / closes[n - 1 - 252]) - 1) * 100 : null;

        // volume health (10 / 20 / 30 / 50 / 90-session averages)
        const avgVol = (p: number): number | null => {
          const win = list.slice(-p);
          const avg = win.reduce((a, r) => a + (r.volume || 0), 0) / Math.max(1, win.length);
          return avg > 0 ? avg : null;
        };
        const avgVol10 = avgVol(10);
        const last20 = list.slice(-20);
        const avgVol20 = last20.reduce((a, r) => a + (r.volume || 0), 0) / Math.max(1, last20.length) || null;
        const avgVol30 = avgVol(30);
        const last50 = list.slice(-50);
        const avgVol50 = last50.reduce((a, r) => a + (r.volume || 0), 0) / Math.max(1, last50.length) || null;
        const avgVol90 = avgVol(90);
        const todayVol = list[n - 1].volume || 0;
        const volVsAvg20 = avgVol20 ? todayVol / avgVol20 : null;
        const turnover20Cr = avgVol20 ? (close * avgVol20) / 10_000_000 : null;
        const valueTradedCr = todayVol > 0 ? (close * todayVol) / 10_000_000 : null;

        // gap % — session open vs the prior close (needs the previous bar)
        const gapPct =
          n >= 2 && list[n - 2].close > 0 && list[n - 1].open > 0
            ? ((list[n - 1].open - list[n - 2].close) / list[n - 2].close) * 100
            : null;

        // performance windows
        const perf1W = n > 5 && closes[n - 1 - 5] > 0 ? ((close / closes[n - 1 - 5]) - 1) * 100 : null;
        const momentum10 = n > 10 && closes[n - 1 - 10] > 0 ? ((close / closes[n - 1 - 10]) - 1) * 100 : null;
        let perfYTD: number | null = null;
        for (let i = n - 1; i >= 0; i--) {
          if (list[i].date < `${date.slice(0, 4)}-01-01`) {
            if (list[i].close > 0) perfYTD = ((close / list[i].close) - 1) * 100;
            break;
          }
        }

        // volatility + beta (vs ^NSEI, aligned by session date)
        const volatM = volatility(closes, 21, 252);
        const weekly = weeklyCloses(series);
        const volatW = weekly.length >= 9 ? volatility(weekly, 8, 52) : null;
        let beta1Y: number | null = null;
        if (idxByDate.size > 0) {
          const symAligned: number[] = [];
          const idxRets: number[] = [];
          for (let i = 1; i < n; i++) {
            const ir = idxByDate.get(list[i].date);
            if (ir != null && list[i - 1].close > 0) {
              symAligned.push(list[i].close / list[i - 1].close - 1);
              idxRets.push(ir);
            }
          }
          beta1Y = betaOf(symAligned, idxRets);
        }

        // 20-session range tightness (VCP proxy)
        let h20 = -Infinity;
        let l20 = Infinity;
        for (const r of list.slice(-20)) {
          if (r.high > h20) h20 = r.high;
          if (r.low < l20) l20 = r.low;
        }
        const rangeTight20 = close > 0 && Number.isFinite(h20) ? ((h20 - l20) / close) * 100 : null;

        // OHLC-based oscillator suite
        const atr14 = atr(bars, 14);
        const stoch = stochastic(bars);
        const adx14 = adx(bars, 14);
        const cci20 = cci(bars, 20);
        const wr = williamsR(bars, 14);
        const ao = awesomeOscillator(bars);
        const aoPrev = bars.length >= 35 ? awesomeOscillator(bars.slice(0, -1)) : null;
        const uo = ultimateOscillator(bars);
        const st = supertrend(bars, 10, 3);

        // raw 13-week up/down volume ratio (the A/D rating's underlying)
        const ad = list.slice(-65);
        let upVol = 0;
        let downVol = 0;
        for (const r of ad) {
          if (r.close > r.open) upVol += r.volume;
          else if (r.close < r.open) downVol += r.volume;
        }
        const adRatio = upVol + downVol > 0 ? upVol / Math.max(1, downVol) : null;

        // TradingView-style composite rating (oscillators + moving averages)
        const tech = computeTechRating({
          price: close,
          rsi14: ind.rsi14,
          stochK: stoch.k,
          williamsR: wr,
          cci20,
          ao,
          aoPrev,
          uo,
          macdHist: ind.macdHist,
          macdHistPrev: macdHistPrev(closes),
          smas: [sma10, ind.sma20, ind.sma50, sma100, ind.sma200],
          emas: [ema10, ind.ema20, ema50, ema100, ema200],
        });

        // raw weighted 12M momentum (what rsRating ranks)
        const rsMomentum = weightedRs(
          closes[n - 1] ?? null,
          closes[n - 1 - 63] ?? null,
          closes[n - 1 - 126] ?? null,
          closes[n - 1 - 189] ?? null,
          closes[n - 1 - 252] ?? null
        );

        rows.push({
          symbol: s.symbol,
          date,
          close: r6(close),
          volume: r6(todayVol),
          avgVol20: r6(avgVol20),
          avgVol50: r6(avgVol50),
          volVsAvg20: r6(volVsAvg20),
          turnover20Cr: r6(turnover20Cr),
          sma20: r6(ind.sma20),
          sma50: r6(ind.sma50),
          sma100: r6(sma100),
          sma200: r6(ind.sma200),
          ema20: r6(ind.ema20),
          ema50: r6(ema50),
          ema200: r6(ema200),
          rsi14: r6(ind.rsi14),
          wRsi14: r6(s.wRsi14),
          macd: r6(ind.macd),
          macdSignal: r6(ind.macdSignal),
          macdHist: r6(ind.macdHist),
          wMacdHist: r6(s.wMacdHist),
          atr14Pct: r6(ind.atr14Pct),
          bbPctB: r6(ext.bbPctB),
          bbWidthPct: r6(ext.bbWidthPct),
          mom1M: r6(ind.mom1M),
          mom3M: r6(ind.mom3M),
          mom6M: r6(ind.mom6M),
          mom12M: r6(mom12M),
          high52: r6(high52),
          low52: r6(low52),
          fromHighPct: r6(fromHighPct),
          fromLowPct: r6(fromLowPct),
          aboveSma20: b(ind.aboveSma20),
          aboveSma50: b(ind.aboveSma50),
          aboveSma200: b(ind.aboveSma200),
          goldenCross: b(ind.goldenCross),
          emaCross: b(ext.emaCross),
          volSpike: b(s.volSpike),
          rsRating: s.rsRating ?? null,
          rsMomentum: r6(rsMomentum),
          epsScore: s.epsScore ?? null,
          adRating: s.adRating ?? null,
          adRatio: r6(adRatio),
          // --- extended technicals (TradingView-style) ---
          sma10: r6(sma10),
          ema10: r6(ema10),
          ema100: r6(ema100),
          momentum10: r6(momentum10),
          stochK: r6(stoch.k),
          stochD: r6(stoch.d),
          adx14: r6(adx14),
          cci20: r6(cci20),
          williamsR: r6(wr),
          ao: r6(ao),
          uo: r6(uo),
          stVal: r6(st.value),
          stDir: st.dir ?? null,
          atr14: r6(atr14),
          gapPct: r6(gapPct),
          avgVol10: r6(avgVol10),
          avgVol30: r6(avgVol30),
          avgVol90: r6(avgVol90),
          valueTradedCr: r6(valueTradedCr),
          perf1W: r6(perf1W),
          perfYTD: r6(perfYTD),
          perf3Y: r6(s.mom3Y),
          perf5Y: r6(s.mom5Y),
          volatM: r6(volatM),
          volatW: r6(volatW),
          beta1Y: r6(beta1Y),
          rangeTight20: r6(rangeTight20),
          fromAthPct: r6(s.fromAthPct),
          techScore: tech.total,
          techRating: tech.rating,
          oscRating: tech.oscLabel,
          maRating: tech.maLabel,
        });
      }

      // ~73 cols × 400 rows ≈ 29k params — under Prisma's 32,767 ceiling.
      for (let k = 0; k < rows.length; k += 400) {
        await db.stockMetrics.createMany({ data: rows.slice(k, k + 400) as never, skipDuplicates: true });
      }
      total += rows.length;
      // let queued API renders run between chunks
      await new Promise((r) => setImmediate(r));
    }

    await db.syncState.updateMany({
      where: { id: "main" },
      data: { metricsDate: date, metricsSyncedAt: new Date() },
    }).catch(() => {});

    console.log(`[metrics] stock_metrics computed for ${date}: ${total} rows`);
    return { ok: true, date, rows: total };
  } finally {
    g.__tpMetricsRunning = false;
  }
}

/** Latest session covered by StockMetrics (or null when none). */
export async function latestMetricsDate(): Promise<string | null> {
  const rows = await db.$queryRaw<{ date: string }[]>`SELECT MAX(date) AS date FROM "StockMetrics"`;
  return rows[0]?.date ?? null;
}
