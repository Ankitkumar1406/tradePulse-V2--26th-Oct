/** Debug RS-high scan with real data. */
import { db } from "../src/lib/db";
import { getNiftyCloses, alignIndex } from "../src/lib/bars";

function isoDay(utcDay: number): string {
  return new Date(utcDay * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  const nifty = await getNiftyCloses();
  const rows = await db.stock.findMany({
    where: { symbol: { in: ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS"] } },
    select: { symbol: true, closes: true, fromHighPct: true, sma200: true, price: true },
  });
  for (const r of rows) {
    if (!r.closes) { console.log(r.symbol, "no closes"); continue; }
    const arr = JSON.parse(r.closes) as [number, number][];
    const d = arr.map((p) => Math.floor(p[0] / 86_400_000));
    console.log(`\n${r.symbol}: ${arr.length} pts, fromHigh=${r.fromHighPct?.toFixed(1)}% price>${r.sma200 ? "yes" : "no"}`);
    console.log("  last close ts:", new Date(arr[arr.length - 1][0] * 1000).toISOString(), "close:", arr[arr.length - 1][1]);
    console.log("  isoDay:", isoDay(d[d.length - 1]));
    const ni = alignIndex(nifty, isoDay(d[d.length - 1]));
    console.log("  aligned nifty idx:", ni, ni >= 0 ? `niftyDate=${nifty.d[ni]} niftyClose=${nifty.c[ni]}` : "MISSED");
    if (ni >= 0) {
      let rsMax = 0, rsLast = 0, valid = 0;
      for (let i = d.length - 1, steps = 0; i >= 0 && steps < 250; i--, steps++) {
        const n2 = alignIndex(nifty, isoDay(d[i]));
        if (n2 < 0) continue;
        valid++;
        const rs = arr[i][1] / nifty.c[n2];
        if (valid === 1) rsLast = rs;
        if (rs > rsMax) rsMax = rs;
      }
      console.log(`  valid=${valid} rsLast=${rsLast.toFixed(4)} rsMax=${rsMax.toFixed(4)} ratio=${(rsLast / rsMax).toFixed(4)}`);
    }
  }
  await db.$disconnect();
}
main();
