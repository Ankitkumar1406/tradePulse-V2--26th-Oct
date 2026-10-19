import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const rows = await p.dailyBar.findMany({ where: { date: "2026-10-19" }, select: { symbol: true, open: true, high: true, low: true, close: true, volume: true } });
  for (const r of rows) {
    const oor = r.close > r.high || r.close < r.low || r.open > r.high || r.open < r.low;
    const bad = r.close <= 0 || r.open <= 0;
    if (oor || bad) console.log("ANOMALY:", JSON.stringify(r), oor ? "[range]" : "", bad ? "[nonpositive]" : "");
  }
  // also check prior history of the anomalous symbol for context
}
main().finally(() => p.$disconnect());
