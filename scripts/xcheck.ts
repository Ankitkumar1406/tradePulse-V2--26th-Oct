import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const s = await p.stock.findUnique({ where: { symbol: "TCS.NS" }, select: { closes: true } });
  const arr = JSON.parse(s!.closes as string) as [string, number][];
  console.log("closes last 3:", arr.slice(-3));
  const b = await p.dailyBar.findMany({ where: { symbol: "TCS.NS" }, orderBy: { date: "desc" }, take: 3, select: { date: true, close: true } });
  console.log("bars last 3:", b.map(x => `${x.date}:${x.close}`).join("  "));
}
main().finally(() => p.$disconnect());
