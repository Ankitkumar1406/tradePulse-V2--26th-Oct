import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const s = await p.stock.findUnique({ where: { symbol: "GRWN50INAV.NS" }, select: { name: true, sector: true } });
  console.log("stock:", JSON.stringify(s));
  const bars = await p.dailyBar.findMany({ where: { symbol: "GRWN50INAV.NS" }, orderBy: { date: "desc" }, take: 10, select: { date: true, open: true, close: true, volume: true } });
  console.log("last 10 bars:", bars.map(b => `${b.date}:O${b.open},C${b.close?.toFixed(2)},V${b.volume}`).join(" | "));
  const zeros = await p.dailyBar.count({ where: { symbol: "GRWN50INAV.NS", open: 0 } });
  const total = await p.dailyBar.count({ where: { symbol: "GRWN50INAV.NS" } });
  console.log(`open=0 bars: ${zeros}/${total}`);
  // how many OTHER symbols have open=0 anywhere in history?
  const bad = await p.dailyBar.groupBy({ by: ["symbol"], _count: true, where: { open: 0 } });
  console.log("symbols with any open=0 bar:", bad.length, "->", bad.slice(0, 8).map(b => `${b.symbol}(${b._count})`).join(", "));
}
main().finally(() => p.$disconnect());
