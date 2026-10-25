import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const tot = await db.stockFundamentals.count();
  const agg = await db.stockFundamentals.aggregate({
    _count: { roe: true, evEbitda: true, revenueTtm: true, ocf: true, fcf: true, totalDebt: true, sharesOut: true, currentRatio: true, grossMargin: true, dividendRate: true, epsGrowthQoQ: true, fwdPe: true, quickRatio: true, netIncome: true, ebitda: true },
  });
  console.log("fundamentals total:", tot);
  console.log("filled:", JSON.stringify(agg._count));
  const m = await db.stockMetrics.aggregate({ _count: { rsi14: true, sma200: true, mom12M: true } });
  const latest = await db.$queryRaw<{ date: string; n: bigint }[]>`SELECT date, count(*) n FROM "StockMetrics" GROUP BY date ORDER BY date DESC LIMIT 3`;
  console.log("metrics:", JSON.stringify(m._count), latest.map(r=>`${r.date}:${r.n}`).join(", "));
  const st = await db.stock.count({ where: { price: { gt: 0 } } });
  console.log("stocks priced:", st);
  const exch = await db.stock.groupBy({ by: ["exchangeCode"], _count: true });
  console.log("exchanges:", exch.map(r=>`${r.exchangeCode}:${r._count}`).join(", "));
}
main().finally(() => db.$disconnect());
