/**
 * Post-restore state check: holiday table coverage, expected EOD date,
 * closes staleness, and pipeline gate values.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // 1. Holiday table around October 2026
  const events = await db.$queryRawUnsafe<{ date: string; name: string | null }[]>(
    `SELECT date, name FROM "MarketEvent" WHERE category='holiday' AND date >= '2026-09-01' ORDER BY date`
  );
  console.log("Holidays (>= Sep 2026):", JSON.stringify(events));

  // 2. What expectedLatestBarDate would compute: max quoteTime
  const agg = (await db.$queryRawUnsafe<{ qt: string | null }[]>(
    `SELECT MAX("quoteTime") AS qt FROM "Stock"`
  )) as { qt: string | null }[];
  console.log("max quoteTime:", agg[0]?.qt);

  // 3. closes staleness vs last session close (Oct 19 15:30 IST = 10:00 UTC)
  const stale = (await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM "Stock" WHERE "closesSynced" IS NULL OR "closesSynced" < '2026-10-19 15:30:00+05:30'`
  )) as { n: bigint }[];
  const total = (await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM "Stock" WHERE price IS NOT NULL`
  )) as { n: bigint }[];
  console.log(`closes stale: ${stale[0]?.n} / priced ${total[0]?.n}`);

  // 4. Oct-20 bar rows (should be 0 — holiday) and Oct-19 count
  const oct20 = (await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM "DailyBar" WHERE date='2026-10-20'`
  )) as { n: bigint }[];
  const oct19 = (await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM "DailyBar" WHERE date='2026-10-19'`
  )) as { n: bigint }[];
  console.log(`DailyBar Oct-20: ${oct20[0]?.n}  Oct-19: ${oct19[0]?.n}`);

  // 5. bars per symbol sanity: how many symbols have NO Oct-19 bar
  const missing = (await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM "Stock" s WHERE s.price IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "DailyBar" b WHERE b.symbol = s.symbol AND b.date = '2026-10-19')`
  )) as { n: bigint }[];
  console.log(`priced stocks missing Oct-19 bar: ${missing[0]?.n}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
