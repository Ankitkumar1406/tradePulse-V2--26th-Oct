import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const n = await p.dailyBar.count({ where: { date: "2026-10-19" } });
  const syms = await p.dailyBar.findMany({ where: { date: "2026-10-19" }, select: { symbol: true }, take: 12 });
  console.log("2026-10-19 bars in DB:", n);
  console.log("symbols:", syms.map(s => s.symbol).join(", "));
  // sanity of those bars: close vs prev close
  for (const s of syms.slice(0, 5)) {
    const prev = await p.dailyBar.findFirst({ where: { symbol: s.symbol, date: { lt: "2026-10-19" } }, orderBy: { date: "desc" } });
    const cur = await p.dailyBar.findFirst({ where: { symbol: s.symbol, date: "2026-10-19" } });
    console.log(`${s.symbol}: today close=${cur?.close} vol=${cur?.volume} | prev(${prev?.date}) close=${prev?.close}`);
  }
}
main().finally(() => p.$disconnect());
