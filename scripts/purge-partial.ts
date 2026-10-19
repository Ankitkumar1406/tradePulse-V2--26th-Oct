import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  // 1. Today's candle written by chart views BEFORE the 15:45 IST final rule —
  //    the 16:00 EOD fire re-adds it for the whole universe.
  const d1 = await p.dailyBar.deleteMany({ where: { date: "2026-10-19" } });
  console.log("Deleted premature 2026-10-19 bars:", d1.count);
  // 2. Stale metrics rows from the old frozen date (metricsDate is 2026-10-16).
  const d2 = await p.stockMetrics.deleteMany({ where: { date: { lt: "2026-10-16" } } });
  console.log("Deleted stale StockMetrics rows (<2026-10-16):", d2.count);
  const g = await p.stockMetrics.groupBy({ by: ["date"], _count: true, orderBy: { date: "desc" }, take: 3 });
  console.log("StockMetrics now:", g.map(r => `${r.date}(${r._count})`).join("  "));
}
main().finally(() => p.$disconnect());
