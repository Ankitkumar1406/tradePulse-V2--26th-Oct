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
import { computeIndicators, computeExtendedIndicators, emaSeries, sma } from "@/lib/indicators";
import { weightedRs } from "@/lib/ratings";
import { expectedLatestBarDate } from "@/lib/bar-sync";

interface MetricsGlobals {
  __tpMetricsRunning?: boolean;
}
const g = globalThis as unknown as MetricsGlobals;

const CHUNK = 400; // symbols per chunk (bars query + bulk insert)
const MIN_SESSION_ROWS = 800; // a "full" NSE session — below this the bars are still trickling

const r6 = (x: number | null | undefined): number | null =>
  x == null || !Number.isFinite(x) ? null : Number(x.toFixed(6));
const b = (v: boolean | null | undefined): boolean | null => (v == null ? null : v);

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
      },
      orderBy: descNullsLast("marketCap"),
    });

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
        const e50s = emaSeries(closes, 50);
        const e200s = emaSeries(closes, 200);
        const ema50 = e50s[n - 1] ?? null;
        const ema200 = e200s[n - 1] ?? null;
        const sma100 = sma(closes, 100);

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

        // volume health
        const last20 = list.slice(-20);
        const avgVol20 = last20.reduce((a, r) => a + (r.volume || 0), 0) / Math.max(1, last20.length) || null;
        const last50 = list.slice(-50);
        const avgVol50 = last50.reduce((a, r) => a + (r.volume || 0), 0) / Math.max(1, last50.length) || null;
        const todayVol = list[n - 1].volume || 0;
        const volVsAvg20 = avgVol20 ? todayVol / avgVol20 : null;
        const turnover20Cr = avgVol20 ? (close * avgVol20) / 10_000_000 : null;

        // raw 13-week up/down volume ratio (the A/D rating's underlying)
        const ad = list.slice(-65);
        let upVol = 0;
        let downVol = 0;
        for (const r of ad) {
          if (r.close > r.open) upVol += r.volume;
          else if (r.close < r.open) downVol += r.volume;
        }
        const adRatio = upVol + downVol > 0 ? upVol / Math.max(1, downVol) : null;

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
        });
      }

      // ~45 cols × 400 rows ≈ 18k params — under Prisma's 32,767 ceiling.
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
