/**
 * Probe: call the app's actual fetchSpark for symbols missing closes,
 * replicating the exact code path used inside Next.
 */
import { fetchSpark } from "../src/lib/yahoo";
import { computeIndicators } from "../src/lib/indicators";

async function main() {
  const missing = ["DHOOTTRANS.NS", "MILKYMIST.NS", "ESDS.NS", "LALITHAA.NS", "HORIZONIND.NS"];
  console.log("probing", missing.length, "symbols...");
  try {
    const sparks = await fetchSpark(missing, "2y");
    console.log("returned sparks:", sparks.length, sparks.map((s) => s.symbol));
    for (const sp of sparks) {
      const series: [number, number][] = [];
      for (let j = 0; j < sp.timestamp.length; j++) {
        const c = sp.close[j];
        if (c != null && Number.isFinite(c)) series.push([sp.timestamp[j], c]);
      }
      const ind = computeIndicators(series.map((p) => p[1]));
      console.log(`  ${sp.symbol}: ts=${sp.timestamp.length} validCloses=${series.length} rsi=${ind.rsi14?.toFixed(1)}`);
    }
  } catch (e) {
    console.log("FETCHSPARK THREW:", e instanceof Error ? e.message : e);
  }
  process.exit(0);
}
main();
