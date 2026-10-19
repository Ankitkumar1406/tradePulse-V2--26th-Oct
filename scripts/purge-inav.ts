import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const d = await p.dailyBar.deleteMany({ where: { symbol: "GRWN50INAV.NS", open: 0 } });
  console.log("Purged iNAV open=0 bars:", d.count);
  // re-run the invariant check on today
  const rows = await p.dailyBar.findMany({ where: { date: "2026-10-19" }, select: { symbol: true, open: true, high: true, low: true, close: true } });
  let bad = 0;
  for (const r of rows) if (r.high < r.low || r.close > r.high || r.close < r.low || r.open > r.high || r.open < r.low || r.open <= 0 || r.close <= 0) { bad++; console.log("STILL BAD:", r.symbol); }
  console.log(`Today's ${rows.length} bars — invariant violations: ${bad}`);
}
main().finally(() => p.$disconnect());
