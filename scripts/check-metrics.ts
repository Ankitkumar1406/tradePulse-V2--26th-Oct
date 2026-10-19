import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const g = await p.stockMetrics.groupBy({ by: ["date"], _count: true, orderBy: { date: "desc" }, take: 5 });
  console.log("StockMetrics by date:", g.map(r => `${r.date}(${r._count})`).join("  "));
}
main().finally(() => p.$disconnect());
