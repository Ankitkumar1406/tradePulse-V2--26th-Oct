import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { FNO_UNIVERSE, NIFTY50_UNIVERSE } from "@/lib/fno-universe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TradingView-style screener feed — the FULL flat universe in one payload.
 *
 * One row per NSE listing, joining three tables:
 *   Stock               — snapshot quote + sector/industry (Yahoo screener)
 *   StockMetrics        — precomputed technicals for the latest EOD session
 *   StockFundamentals   — ratios, statements and analyst consensus (weekly)
 *
 * Everything the screener filters or renders is derived server-side so the
 * browser never waits on a live Yahoo call: relative volume, value traded,
 * net debt, FCF margin, EV margins, 3Y/5Y revenue CAGR (from the annual
 * slices), upside to target, market-cap class, F&O / Nifty 50 membership.
 * A null field means "no data" — the client shows "—" and excludes the stock
 * from any active filter on that field.
 */

const r = (x: number | null | undefined, dp = 3): number | null =>
  x == null || !Number.isFinite(x) ? null : Number((x as number).toFixed(dp));

const pctOf = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a != null && b != null && b !== 0 ? (a / b) * 100 : null;

function cagr(series: unknown, years: number): number | null {
  if (!Array.isArray(series) || series.length < years + 1) return null;
  const latest = series[0] as number;
  const oldest = series[years] as number;
  if (typeof latest !== "number" || typeof oldest !== "number" || latest <= 0 || oldest <= 0) return null;
  return (Math.pow(latest / oldest, 1 / years) - 1) * 100;
}

function mcapClass(mcapInr: number | null): string | null {
  if (mcapInr == null) return null;
  const cr = mcapInr / 1e7; // INR absolute → ₹ crore
  if (cr > 100_000) return "Mega Cap";
  if (cr > 20_000) return "Large Cap";
  if (cr > 5_000) return "Mid Cap";
  if (cr > 500) return "Small Cap";
  return "Micro Cap";
}

export async function GET() {
  try {
    const latest = await db.$queryRaw<{ date: string }[]>`SELECT MAX(date) AS date FROM "StockMetrics"`;
    const mdate = latest[0]?.date ?? null;

    const [stocks, metrics, funds] = await Promise.all([
      db.stock.findMany({
        where: { price: { not: null } },
        orderBy: [{ marketCap: { sort: "desc", nulls: "last" } }],
      }),
      mdate
        ? db.stockMetrics.findMany({ where: { date: mdate } })
        : Promise.resolve([] as import("@prisma/client").StockMetrics[]),
      db.stockFundamentals.findMany(),
    ]);

    const mBySym = new Map(metrics.map((m) => [m.symbol, m]));
    const fBySym = new Map(funds.map((f) => [f.symbol, f]));

    const rows = stocks.map((s) => {
      const m = mBySym.get(s.symbol);
      const f = fBySym.get(s.symbol);
      const root = s.symbol.replace(/\.NS$/, "");
      const mcap = s.marketCap ?? f?.mcap ?? null;
      const revenue = f?.revenueTtm ?? null;
      const ebitda = f?.ebitda ?? null;
      const ocf = f?.ocf ?? null;
      const fcf = f?.fcf ?? null;
      const totalDebt = f?.totalDebt ?? null;
      const totalCash = f?.totalCash ?? null;
      const price = s.price ?? null;
      const prevClose = s.prevClose ?? null;
      const target = f?.targetPrice ?? null;
      const annualRevs = f?.annualRevenues;
      const annualEpss = f?.annualEpss;

      return {
        // ---- descriptive ----
        sym: root,
        name: s.name,
        exch: "NSE",
        // "Unknown" buckets come from the taxonomy backfill — surface them as
        // no-data ("—") so the multi-select popups don't offer a 900-row
        // Unknown bucket as if it were a real sector.
        sector: s.sector && s.sector !== "Unknown" ? s.sector : null,
        industry: s.indGrp && s.indGrp !== "Unknown" ? s.indGrp : (s.industry && s.industry !== "Unknown" ? s.industry : null),
        subInd: s.subGrp && s.subGrp !== "Unknown" ? s.subGrp : null,
        mcapCls: mcapClass(mcap),
        n50: NIFTY50_UNIVERSE.has(root) || undefined,
        fno: FNO_UNIVERSE.has(root) || undefined,
        country: "India",
        curr: "INR",
        // ---- price & volume ----
        price: r(price, 2),
        prev: r(prevClose, 2),
        chg: r(price != null && prevClose != null ? price - prevClose : null, 2),
        chgPct: r(s.changePct, 2),
        open: r(s.open, 2),
        high: r(s.dayHigh, 2),
        low: r(s.dayLow, 2),
        vol: s.volume ?? null,
        relVol: m?.volVsAvg20 != null ? r(m.volVsAvg20, 2) : null,
        avgVol10: m?.avgVol10 ?? null,
        avgVol20: m?.avgVol20 ?? null,
        avgVol30: m?.avgVol30 ?? null,
        avgVol50: m?.avgVol50 ?? null,
        avgVol90: m?.avgVol90 ?? null,
        avgVol3M: s.avgVol3M ?? null,
        valCr: m?.valueTradedCr != null ? r(m.valueTradedCr, 2) : (s.volume != null && price ? r((price * s.volume) / 1e7, 2) : null),
        gapPct: m?.gapPct != null ? r(m.gapPct, 2) : null,
        hi52: m?.high52 ?? s.high52 ?? null,
        lo52: m?.low52 ?? s.low52 ?? null,
        fromHi: m?.fromHighPct ?? (s.fromHighPct != null ? r(s.fromHighPct, 2) : null),
        fromLo: m?.fromLowPct ?? (s.fromLowPct != null ? r(s.fromLowPct, 2) : null),
        fromAth: m?.fromAthPct ?? (s.fromAthPct != null ? r(s.fromAthPct, 2) : null),
        // ---- market data ----
        mcap: mcap != null ? r(mcap, 0) : null,
        ev: f?.ev ?? null,
        sharesOut: f?.sharesOut ?? null,
        // ---- valuation ----
        pe: s.peTTM ?? f?.pe ?? null,
        fwdPe: f?.fwdPe ?? null,
        peg: f?.peg ?? null,
        pb: s.pbRatio ?? f?.pb ?? null,
        ps: f?.psTtm ?? null,
        evEbitda: f?.evEbitda ?? null,
        evRev: f?.evRevenue ?? null,
        pCf: ocf && ocf > 0 && mcap ? r(mcap / ocf, 2) : null,
        pFcf: fcf && fcf > 0 && mcap ? r(mcap / fcf, 2) : null,
        // ---- dividends ----
        divYld: s.divYield ?? f?.divYield ?? null,
        dps: f?.dividendRate ?? null,
        payout: f?.payoutRatio ?? null,
        // ---- profitability ----
        grossM: f?.grossMargin ?? null,
        opM: f?.opMargin ?? null,
        netM: f?.profitMargin ?? null,
        roe: f?.roe ?? null,
        roa: f?.roa ?? null,
        ebitdaM: pctOf(ebitda, revenue) != null ? r(pctOf(ebitda, revenue), 2) : null,
        // ---- growth ----
        revQoQ: s.revenueQoQGrowth != null ? r(s.revenueQoQGrowth * 100, 2) : null,
        revYoY: f?.revenueGrowth ?? null,
        revCagr3: cagr(annualRevs, 3) != null ? r(cagr(annualRevs, 3), 2) : null,
        revCagr5: cagr(annualRevs, 5) != null ? r(cagr(annualRevs, 5), 2) : null,
        epsQoQ: s.epsQuarterlyGrowth != null ? r(s.epsQuarterlyGrowth * 100, 2) : (f?.epsGrowthQoQ ?? null),
        epsYoY: f?.epsGrowthYoY ?? null,
        epsCagr3: cagr(annualEpss, 3) != null ? r(cagr(annualEpss, 3), 2) : (f?.epsCagr3Y ?? null),
        profitYoY: f?.earningsGrowth ?? null,
        // ---- financial health ----
        de: f?.debtToEquity ?? null,
        currentR: f?.currentRatio ?? null,
        quickR: f?.quickRatio ?? null,
        netDebt: totalDebt != null && totalCash != null ? r(totalDebt - totalCash, 0) : (totalDebt ?? null),
        totalDebt: totalDebt != null ? r(totalDebt, 0) : null,
        cash: totalCash != null ? r(totalCash, 0) : null,
        // ---- income statement ----
        revenue: revenue != null ? r(revenue, 0) : null,
        grossProfit: f?.grossProfit != null ? r(f.grossProfit, 0) : (revenue != null && f?.grossMargin != null ? r((revenue * f.grossMargin) / 100, 0) : null),
        opIncome: f?.operatingIncome ?? (revenue != null && f?.opMargin != null ? r((revenue * f.opMargin) / 100, 0) : null),
        ebitda: ebitda != null ? r(ebitda, 0) : null,
        netIncome: f?.netIncome != null ? r(f.netIncome, 0) : null,
        eps: s.epsTTM ?? f?.epsTtm ?? null,
        // ---- balance sheet ----
        assets: f?.totalAssets != null ? r(f.totalAssets, 0) : null,
        liabilities: f?.totalLiabilities != null ? r(f.totalLiabilities, 0) : null,
        equity: f?.equity != null ? r(f.equity, 0) : null,
        bvps: s.bookValue ?? f?.bookValue ?? null,
        // ---- cash flow ----
        ocf: ocf != null ? r(ocf, 0) : null,
        icf: f?.icf != null ? r(f.icf, 0) : null,
        fcf: fcf != null ? r(fcf, 0) : null,
        fcfM: pctOf(fcf, revenue) != null ? r(pctOf(fcf, revenue), 2) : null,
        // ---- performance ----
        perf1D: r(s.changePct, 2),
        perf1W: m?.perf1W != null ? r(m.perf1W, 2) : null,
        perf1M: m?.mom1M ?? null,
        perf3M: m?.mom3M ?? null,
        perf6M: m?.mom6M ?? null,
        perfYTD: m?.perfYTD != null ? r(m.perfYTD, 2) : null,
        perf1Y: m?.mom12M ?? null,
        perf3Y: m?.perf3Y ?? null,
        perf5Y: m?.perf5Y ?? null,
        volatM: m?.volatM != null ? r(m.volatM, 2) : null,
        volatW: m?.volatW != null ? r(m.volatW, 2) : null,
        beta: m?.beta1Y != null ? r(m.beta1Y, 2) : (f?.beta ?? null),
        atr14: m?.atr14 != null ? r(m.atr14, 2) : null,
        atrPct: m?.atr14Pct != null ? r(m.atr14Pct, 2) : null,
        // ---- technicals ----
        rsi14: m?.rsi14 != null ? r(m.rsi14, 1) : null,
        wRsi: m?.wRsi14 != null ? r(m.wRsi14, 1) : null,
        stochK: m?.stochK != null ? r(m.stochK, 1) : null,
        stochD: m?.stochD != null ? r(m.stochD, 1) : null,
        adx: m?.adx14 != null ? r(m.adx14, 1) : null,
        cci20: m?.cci20 != null ? r(m.cci20, 1) : null,
        mom10: m?.momentum10 != null ? r(m.momentum10, 2) : null,
        willR: m?.williamsR != null ? r(m.williamsR, 1) : null,
        ao: m?.ao != null ? r(m.ao, 2) : null,
        uo: m?.uo != null ? r(m.uo, 1) : null,
        macd: m?.macd != null ? r(m.macd, 3) : null,
        macdSig: m?.macdSignal != null ? r(m.macdSignal, 3) : null,
        macdHist: m?.macdHist != null ? r(m.macdHist, 3) : null,
        bbB: m?.bbPctB != null ? r(m.bbPctB, 1) : null,
        bbW: m?.bbWidthPct != null ? r(m.bbWidthPct, 2) : null,
        sma10: m?.sma10 != null ? r(m.sma10, 2) : null,
        sma20: m?.sma20 != null ? r(m.sma20, 2) : null,
        sma50: m?.sma50 != null ? r(m.sma50, 2) : (s.sma50Yahoo ?? null),
        sma100: m?.sma100 != null ? r(m.sma100, 2) : null,
        sma200: m?.sma200 != null ? r(m.sma200, 2) : (s.sma200Yahoo ?? null),
        ema10: m?.ema10 != null ? r(m.ema10, 2) : null,
        ema20: m?.ema20 != null ? r(m.ema20, 2) : null,
        ema50: m?.ema50 != null ? r(m.ema50, 2) : null,
        ema100: m?.ema100 != null ? r(m.ema100, 2) : null,
        ema200: m?.ema200 != null ? r(m.ema200, 2) : null,
        dist20: s.distSma20Pct != null ? r(s.distSma20Pct, 2) : null,
        dist50: s.distSma50Pct != null ? r(s.distSma50Pct, 2) : null,
        dist200: s.distSma200Pct != null ? r(s.distSma200Pct, 2) : null,
        above20: m?.aboveSma20 ?? null,
        above50: m?.aboveSma50 ?? null,
        above200: m?.aboveSma200 ?? null,
        golden: m?.goldenCross ?? null,
        emaX: m?.emaCross ?? null,
        stDir: m?.stDir ?? null,
        stVal: m?.stVal != null ? r(m.stVal, 2) : null,
        tight20: m?.rangeTight20 != null ? r(m.rangeTight20, 2) : null,
        tech: m?.techRating ?? null,
        techScore: m?.techScore ?? null,
        osc: m?.oscRating ?? null,
        maR: m?.maRating ?? null,
        // ---- analyst ----
        analyst: f?.analystRating ?? null, // 1 = Strong Buy … 5 = Strong Sell
        target: target != null ? r(target, 2) : null,
        upside: target != null && price != null && price > 0 ? r(((target - price) / price) * 100, 2) : null,
        nAnalysts: f?.analystCount ?? null,
        // ---- earnings ----
        earnDate: s.earningsDate ? s.earningsDate.toISOString().slice(0, 10) : null,
      };
    });

    return NextResponse.json(
      {
        asOf: mdate,
        updated: stocks.reduce<Date | null>((acc, s) => {
          const t = s.quoteTime;
          return t && (!acc || t > acc) ? t : acc;
        }, null)?.toISOString() ?? null,
        count: rows.length,
        universe: rows,
      },
      { headers: { "Cache-Control": "public, max-age=60" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "universe failed" },
      { status: 500 }
    );
  }
}
