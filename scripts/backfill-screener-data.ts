/**
 * One-off backfill for the TradingView-style screener data layer:
 * force-recompute StockMetrics for the latest EOD session with the extended
 * technicals (stoch/adx/cci/wr/ao/uo/supertrend/beta/ratings…).
 *
 *   bun scripts/backfill-screener-data.ts [--no-metrics]
 */
import { PrismaClient } from "@prisma/client";
import { computeStockMetrics } from "../src/lib/metrics";

const db = new PrismaClient();

async function main() {
  if (!process.argv.includes("--no-metrics")) {
    console.log("[backfill] StockMetrics recompute (extended technicals)…");
    const t0 = Date.now();
    const out = await computeStockMetrics({ force: true });
    console.log(
      `[backfill] metrics: ok=${out.ok} date=${out.date} rows=${out.rows}` +
        (out.reason ? ` reason=${out.reason}` : "") +
        ` in ${((Date.now() - t0) / 1000).toFixed(0)}s`
    );
  }
  const counts = {
    nse: await db.stock.count(),
    metrics: await db.stockMetrics.count(),
  };
  console.log(`[backfill] done — universe: ${counts.nse} NSE stocks, metrics rows: ${counts.metrics}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
