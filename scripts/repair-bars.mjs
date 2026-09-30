/**
 * Repair bars damaged by the pre-existing ensureHistory truncation bug:
 * find stocks flagged barsSynced whose DailyBar history collapsed (<5 rows),
 * report them; with --fix, re-fetch each one's full history via Yahoo.
 */
import { PrismaClient } from "@prisma/client";
import { fetchChart } from "../src/lib/yahoo.ts";

const db = new PrismaClient();
const FIX = process.argv.includes("--fix");

function istDate(d) {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const stocks = await db.stock.findMany({
    where: { barsSynced: { not: null } },
    select: { symbol: true },
  });
  const damaged = [];
  let checked = 0;
  for (const { symbol } of stocks) {
    const n = await db.dailyBar.count({ where: { symbol } });
    checked++;
    if (n < 5) damaged.push({ symbol, n });
  }
  console.log(`checked ${checked} symbols; damaged: ${damaged.length}`);
  const repairable = damaged.filter((d) => !/NSETEST/i.test(d.symbol));
  const testGone = damaged.length - repairable.length;
  console.log(`  (skipping ${testGone} NSE test securities)`);
  for (const d of repairable.slice(0, 60)) console.log(`  ${d.symbol}: ${d.n} bars`);

  if (FIX) {
    for (const { symbol } of repairable) {
      try {
        const chart = await fetchChart(symbol, "2y");
        const q = chart.indicators.quote[0];
        const byDate = new Map();
        for (let i = 0; i < chart.timestamp.length; i++) {
          const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
          if (o == null || h == null || l == null || c == null) continue;
          const date = istDate(new Date(chart.timestamp[i] * 1000));
          byDate.set(date, { symbol, date, open: o, high: h, low: l, close: c, volume: v ?? 0 });
        }
        const rows = [...byDate.values()];
        if (rows.length > 0) {
          await db.$transaction([
            db.dailyBar.deleteMany({ where: { symbol } }),
            db.dailyBar.createMany({ data: rows }),
          ]);
          console.log(`fixed ${symbol}: ${rows.length} bars`);
        } else {
          console.log(`skip ${symbol}: yahoo returned nothing`);
        }
        await new Promise((r) => setTimeout(r, 350));
      } catch (e) {
        console.log(`FAIL ${symbol}: ${String(e).slice(0, 120)}`);
      }
    }
  }
  await db.$disconnect();
}

main();
