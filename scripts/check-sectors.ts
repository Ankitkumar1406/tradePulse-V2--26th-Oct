import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const sectors = await db.stock.groupBy({
  by: ["sector"],
  where: { sector: { not: null }, marketCap: { gte: 1e9 } },
  _count: { symbol: true },
  orderBy: { _count: { symbol: "desc" } },
});
console.log("SECTORS (liquid):", sectors.length);
for (const s of sectors) console.log(`  ${s.sector}: ${s._count.symbol}`);
const ind = await db.stock.groupBy({
  by: ["industry"],
  where: { industry: { not: null }, marketCap: { gte: 1e9 } },
  _count: { symbol: true },
});
console.log("INDUSTRIES (liquid):", ind.length);
// closes coverage
const withCloses = await db.stock.count({ where: { closes: { not: null }, marketCap: { gte: 1e9 }, sector: { not: null } } });
console.log("liquid w/ sector+closes:", withCloses);
const niftyBars = await db.dailyBar.count({ where: { symbol: "^NSEI" } }).catch(() => -1);
console.log("nifty bars in DailyBar:", niftyBars);
await db.$disconnect();
