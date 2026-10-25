/**
 * BSE mirror universe — real Yahoo quotes for the BSE listings of the same
 * companies already tracked on NSE.
 *
 * Yahoo's India screener only exposes the NSI (NSE) exchange facet, so the
 * BSE side of the market is built by mapping every NSE symbol to its
 * `${base}.BO` listing and batch-fetching REAL v7/quote snapshots for it.
 * Names Yahoo has no .BO listing for are skipped — nothing is invented.
 * Seeding is one-off and idempotent; after that the same batched quote
 * refresh runs at the tail of every universe phase so BSE prices track the
 * market. Closes/bars/metrics/fundamentals for .BO symbols then flow through
 * the existing per-symbol trickles (they are symbol-agnostic).
 */

import { db, descNullsLast } from "@/lib/db";
import { fetchQuotesBatch } from "@/lib/yahoo";

interface Globals {
  __tpBseRunning?: boolean;
}
const g = globalThis as unknown as Globals;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BATCH = 150; // v7/quote batch size (URL-length safe)

/** `.NS` → base ticker, e.g. RELIANCE.NS → RELIANCE. */
function baseOf(symbol: string): string {
  return symbol.replace(/\.NS$/, "");
}

interface QuoteRow {
  symbol: string;
  name: string;
  exchangeCode: string;
  price: number | null;
  prevClose: number | null;
  changePct: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  avgVol3M: number | null;
  marketCap: number | null;
  peTTM: number | null;
  epsTTM: number | null;
  bookValue: number | null;
  pbRatio: number | null;
  high52: number | null;
  low52: number | null;
  quoteTime: Date;
}

/** Map a v7/quote result to the Stock upsert shape (null-preserving). */
function quoteToRow(q: {
  symbol?: string;
  shortName?: string;
  longName?: string;
  exchange?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketChangePercent?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  averageDailyVolume3Month?: number;
  marketCap?: number;
  trailingPE?: number;
  epsTrailingTwelveMonths?: number;
  bookValue?: number;
  priceToBook?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  regularMarketTime?: number;
}): QuoteRow | null {
  if (!q.symbol || q.regularMarketPrice == null || !(q.regularMarketPrice > 0)) return null;
  return {
    symbol: q.symbol,
    name: q.longName || q.shortName || q.symbol,
    exchangeCode: q.exchange ?? "BSE",
    price: q.regularMarketPrice ?? null,
    prevClose: q.regularMarketPreviousClose ?? null,
    changePct: q.regularMarketChangePercent ?? null,
    open: q.regularMarketOpen ?? null,
    dayHigh: q.regularMarketDayHigh ?? null,
    dayLow: q.regularMarketDayLow ?? null,
    volume: q.regularMarketVolume ?? null,
    avgVol3M: q.averageDailyVolume3Month ?? null,
    marketCap: q.marketCap ?? null,
    peTTM: q.trailingPE ?? null,
    epsTTM: q.epsTrailingTwelveMonths ?? null,
    bookValue: q.bookValue ?? null,
    pbRatio: q.priceToBook ?? null,
    high52: q.fiftyTwoWeekHigh ?? null,
    low52: q.fiftyTwoWeekLow ?? null,
    quoteTime: q.regularMarketTime ? new Date(q.regularMarketTime * 1000) : new Date(),
  };
}

async function upsertQuoteRows(rows: QuoteRow[]) {
  if (rows.length === 0) return 0;
  await db.$transaction(
    rows.map((r) => {
      // marketCap null-preserving like the NSE upsert
      const data = {
        name: r.name,
        exchangeCode: r.exchangeCode,
        price: r.price,
        prevClose: r.prevClose,
        changePct: r.changePct,
        open: r.open,
        dayHigh: r.dayHigh,
        dayLow: r.dayLow,
        volume: r.volume,
        avgVol3M: r.avgVol3M,
        ...(r.marketCap != null ? { marketCap: r.marketCap } : {}),
        peTTM: r.peTTM,
        epsTTM: r.epsTTM,
        bookValue: r.bookValue,
        pbRatio: r.pbRatio,
        high52: r.high52,
        low52: r.low52,
        quoteTime: r.quoteTime,
      };
      return db.stock.upsert({
        where: { symbol: r.symbol },
        create: { symbol: r.symbol, ...data },
        update: data,
      });
    })
  );
  return rows.length;
}

/**
 * Seed the BSE mirror: one batched quote pass mapping every NSE listing to
 * its .BO counterpart. Runs once (skips when BSE rows already exist).
 * Copies fundamentals rows from the .NS sibling — the financials are the
 * same company's, so no extra Yahoo load.
 */
export async function seedBseMirror(): Promise<{ seeded: number; skipped: boolean }> {
  const existing = await db.stock.count({ where: { exchangeCode: "BSE" } });
  if (existing > 0) return { seeded: 0, skipped: true };

  const nse = await db.stock.findMany({
    where: { symbol: { endsWith: ".NS" } },
    select: { symbol: true, name: true },
    orderBy: descNullsLast("marketCap"),
  });
  console.log(`[bse] seeding mirror universe for ${nse.length} NSE listings…`);

  let seeded = 0;
  for (let i = 0; i < nse.length; i += BATCH) {
    const batch = nse.slice(i, i + BATCH);
    const boSymbols = batch.map((s) => `${baseOf(s.symbol)}.BO`);
    try {
      const quotes = await fetchQuotesBatch(boSymbols);
      const rows = quotes
        .map(quoteToRow)
        .filter((r): r is QuoteRow => r != null && r.symbol.endsWith(".BO"));
      seeded += await upsertQuoteRows(rows);
    } catch (e) {
      console.error(`[bse] seed batch ${i} failed:`, e instanceof Error ? e.message : e);
    }
    await sleep(400);
  }

  // Mirror fundamentals from the .NS sibling (same company financials).
  await db.$executeRaw`
    INSERT INTO "StockFundamentals" (
      "symbol", "fetchedAt", mcap, pe, pb, "divYield", "epsTtm", "bookValue",
      roe, "profitMargin", "opMargin", "debtToEquity", "currentRatio", "quickRatio",
      ev, "evEbitda", "evRevenue", "psTtm", "dividendRate", "payoutRatio", roa,
      "grossMargin", "revenueTtm", ebitda, "netIncome", fcf, ocf, "totalDebt",
      "totalCash", "sharesOut", "revenueGrowth", "earningsGrowth", "epsGrowthYoY",
      "fwdEps", "fwdPe", peg, "instHoldingPct", "insiderHoldingPct", beta,
      "analystRating", "analystCount", "targetPrice", "totalAssets",
      "totalLiabilities", equity, "grossProfit", "operatingIncome", icf,
      "annualEpss", "annualRevenues", "annualNetProfits"
    )
    SELECT replace(f."symbol", '.NS', '.BO'), f."fetchedAt", f.mcap, f.pe, f.pb,
      f."divYield", f."epsTtm", f."bookValue", f.roe, f."profitMargin", f."opMargin",
      f."debtToEquity", f."currentRatio", f."quickRatio", f.ev, f."evEbitda",
      f."evRevenue", f."psTtm", f."dividendRate", f."payoutRatio", f.roa,
      f."grossMargin", f."revenueTtm", f.ebitda, f."netIncome", f.fcf, f.ocf,
      f."totalDebt", f."totalCash", f."sharesOut", f."revenueGrowth",
      f."earningsGrowth", f."epsGrowthYoY", f."fwdEps", f."fwdPe", f.peg,
      f."instHoldingPct", f."insiderHoldingPct", f.beta, f."analystRating",
      f."analystCount", f."targetPrice", f."totalAssets", f."totalLiabilities",
      f.equity, f."grossProfit", f."operatingIncome", f.icf,
      f."annualEpss", f."annualRevenues", f."annualNetProfits"
    FROM "StockFundamentals" f
    JOIN "Stock" s ON s.symbol = replace(f."symbol", '.NS', '.BO')
    WHERE f."symbol" LIKE '%.NS'
    ON CONFLICT ("symbol") DO NOTHING
  `.catch(() => {});

  console.log(`[bse] seeded ${seeded} BSE listings`);
  return { seeded, skipped: false };
}

/**
 * Refresh quotes for every existing BSE row (batched, single-flight).
 * Called at the tail of the universe phase; also seeds on first run.
 */
export async function refreshBseQuotes(): Promise<number> {
  if (g.__tpBseRunning) return 0;
  g.__tpBseRunning = true;
  try {
    const seed = await seedBseMirror();
    if (seed.skipped) {
      const bse = await db.stock.findMany({
        where: { exchangeCode: "BSE" },
        select: { symbol: true },
        orderBy: descNullsLast("marketCap"),
      });
      let done = 0;
      for (let i = 0; i < bse.length; i += BATCH) {
        const batch = bse.slice(i, i + BATCH);
        try {
          const quotes = await fetchQuotesBatch(batch.map((s) => s.symbol));
          const rows = quotes
            .map(quoteToRow)
            .filter((r): r is QuoteRow => r != null && r.symbol.endsWith(".BO"));
          done += await upsertQuoteRows(rows);
        } catch (e) {
          console.error(`[bse] refresh batch ${i} failed:`, e instanceof Error ? e.message : e);
        }
        await sleep(300);
      }
      return done;
    }
    return seed.seeded;
  } finally {
    g.__tpBseRunning = false;
  }
}
