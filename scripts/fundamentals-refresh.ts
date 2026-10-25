/**
 * Manual full-universe fundamentals refresh — stock_fundamentals from Yahoo.
 *
 *   bun scripts/fundamentals-refresh.ts            # full universe
 *   bun scripts/fundamentals-refresh.ts 200        # top-N by market cap only
 *
 * The fetch + unit-normalisation contract lives in src/lib/fundamentals.ts
 * (shared with the automatic post-sync fundamentals trickle — one source of
 * truth). This script exists for ops: first fill, forced re-refresh after a
 * schema change, or a catch-up run.
 */
import { PrismaClient } from "@prisma/client";
import { fetchFundamentalsFor, upsertFundamentals } from "../src/lib/fundamentals";

const db = new PrismaClient();

async function main() {
  const limitArg = Number(process.argv[2] ?? "") || null;
  const stocks = await db.stock.findMany({
    select: { symbol: true, marketCap: true },
    orderBy: { marketCap: { sort: "desc", nulls: "last" } },
    ...(limitArg ? { take: limitArg } : {}),
  });
  console.log(`[fundamentals] refreshing ${stocks.length} stocks into stock_fundamentals`);
  const CONCURRENCY = 5;
  let done = 0, got = 0;
  const t0 = Date.now();

  async function worker(queue: string[]) {
    for (;;) {
      const sym = queue.shift();
      if (!sym) return;
      const norm = await fetchFundamentalsFor(sym).catch(() => null);
      if (await upsertFundamentals(sym, norm)) got++;
      done++;
      if (done % 50 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(`  ${done}/${stocks.length} (data for ${got}) — ${rate.toFixed(1)}/s`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  const queue = stocks.map((s) => s.symbol);
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  console.log(`[fundamentals] done — ${got}/${stocks.length} stocks returned data in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
