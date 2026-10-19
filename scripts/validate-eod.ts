import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const T = "2026-10-19";
async function main() {
  // 1. Freshness
  const agg = await p.dailyBar.aggregate({ _max: { date: true }, _count: true });
  console.log("DailyBar max:", agg._max.date, "| total:", agg._count);
  const today = await p.dailyBar.count({ where: { date: T } });
  console.log("Bars for 2026-10-19:", today);
  // 2. OHLCV invariants on today's bars
  const rows = await p.dailyBar.findMany({ where: { date: T }, select: { symbol: true, open: true, high: true, low: true, close: true, volume: true } });
  let hiLo = 0, oor = 0, zero = 0, negVol = 0;
  for (const r of rows) {
    if (r.high < r.low) hiLo++;
    if (r.close > r.high || r.close < r.low || r.open > r.high || r.open < r.low) oor++;
    if (r.close <= 0 || r.open <= 0) zero++;
    if ((r.volume ?? 0) < 0) negVol++;
  }
  console.log(`Invariants: high<low=${hiLo} close/open out-of-range=${oor} nonpositive-price=${zero} neg-volume=${negVol}`);
  // 3. Metrics vs bars consistency (close match on today)
  let mism = 0, checked = 0;
  const ms = await p.stockMetrics.findMany({ where: { date: T }, select: { symbol: true, close: true }, take: 400 });
  for (const m of ms) {
    const b = await p.dailyBar.findFirst({ where: { symbol: m.symbol, date: T }, select: { close: true } });
    checked++;
    if (!b || Math.abs((b.close ?? 0) - (m.close ?? 0)) > 0.01) { mism++; if (mism <= 3) console.log("  MISMATCH", m.symbol, "bar:", b?.close, "metrics:", m.close); }
  }
  console.log(`Metrics-vs-bars close: checked=${checked} mismatches=${mism}`);
  // 4. Coverage
  const mc = await p.stockMetrics.count({ where: { date: T } });
  console.log("StockMetrics rows for today:", mc);
  // 5. Sample values vs Yahoo ground truth will be done via API for 2 names
  for (const s of ["RELIANCE.NS", "TCS.NS"]) {
    const b = await p.dailyBar.findFirst({ where: { symbol: s, date: T }, select: { open: true, high: true, low: true, close: true, volume: true } });
    console.log(`${s} today:`, JSON.stringify(b));
  }
}
main().finally(() => p.$disconnect());
