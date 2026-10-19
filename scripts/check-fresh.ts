import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const agg = await p.dailyBar.aggregate({ _max: { date: true }, _count: true });
  console.log("DailyBar max date:", agg._max.date, "| total bars:", agg._count);
  const recent = await p.dailyBar.groupBy({ by: ["date"], _count: true, orderBy: { date: "desc" }, take: 5 });
  console.log("Recent 5 bar dates:", recent.map(r => `${r.date}(${r._count})`).join("  "));
  const m = await p.stockMetrics.aggregate({ _max: { date: true }, _count: true });
  console.log("StockMetrics max:", m._max.date, "| rows:", m._count);
  const st = await p.stock.findFirst({ orderBy: { quoteTime: "desc" }, select: { symbol: true, quoteTime: true, price: true } });
  console.log("Newest quote:", JSON.stringify(st));
}
main().finally(() => p.$disconnect());
