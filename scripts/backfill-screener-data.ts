/**
 * One-off backfill for the TradingView-style screener data layer:
 *   1. Seed the BSE mirror universe (real .BO quotes via v7/quote).
 *   2. Force-recompute StockMetrics for the latest EOD session with the new
 *      extended technicals (stoch/adx/cci/wr/ao/uo/supertrend/beta/ratings…).
 *
 *   bun scripts/backfill-screener-data.ts [--no-bse] [--no-metrics]
 */
import { PrismaClient } from "@prisma/client";
import { seedBseMirror, refreshBseQuotes } from "../src/lib/bse";
import { computeStockMetrics } from "../src/lib/metrics";

const db = new PrismaClient();

async function main() {
  const skipBse = process.argv.includes("--no-bse");
  const skipMetrics = process.argv.includes("--no-metrics");

  if (!skipBse) {
    console.log("[backfill] 1/2 — BSE mirror universe…");
    const seed = await seedBseMirror();
    if (seed.skipped) {
      const refreshed = await refreshBseQuotes();
      console.log(`[backfill] BSE rows refreshed: ${refreshed}`);
    } else {
      console.log(`[backfill] BSE rows seeded: ${seed.seeded}`);
    }
  }

  if (!skipMetrics) {
    console.log("[backfill] 2/2 — StockMetrics recompute (extended technicals)…");
    const t0 = Date.now();
    const out = await computeStockMetrics({ force: true });
    console.log(
      `[backfill] metrics: ok=${out.ok} date=${out.date} rows=${out.rows}` +
        (out.reason ? ` reason=${out.reason}` : "") +
        ` in ${((Date.now() - t0) / 1000).toFixed(0)}s`
    );
  }

  const counts = {
    bse: await db.stock.count({ where: { exchangeCode: "BSE" } }),
    nse: await db.stock.count({ where: { exchangeCode: { not: "BSE" } } }),
    metrics: await db.stockMetrics.count(),
  };
  console.log(`[backfill] done — universe: ${counts.nse} NSE + ${counts.bse} BSE, metrics rows: ${counts.metrics}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
