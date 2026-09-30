import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const total = await db.stock.count({ where: { marketCap: { gte: 1e9 } } });
const withInd = await db.stock.count({ where: { marketCap: { gte: 1e9 }, industry: { not: null } } });
console.log(`liquid: ${total}, with industry: ${withInd}`);
const g = await db.stock.groupBy({
  by: ["industry"],
  where: { industry: { not: null }, marketCap: { gte: 1e9 }, closes: { not: null } },
  _count: { symbol: true },
  orderBy: { _count: { symbol: "desc" } },
});
const sizes = g.map((x) => x._count.symbol);
console.log("industry groups:", g.length, "| groups >=5 members:", sizes.filter((n) => n >= 5).length, "| >=8:", sizes.filter((n) => n >= 8).length);
console.log("top:", g.slice(0, 10).map((x) => `${x.industry}:${x._count.symbol}`).join(", "));
// sample closes length check
const s = await db.stock.findFirst({ where: { symbol: "RELIANCE.NS" }, select: { closes: true } });
const arr = s?.closes ? JSON.parse(s.closes) : [];
console.log("RELIANCE closes points:", arr.length, "first:", arr[0], "last:", arr[arr.length - 1]);
await db.$disconnect();
