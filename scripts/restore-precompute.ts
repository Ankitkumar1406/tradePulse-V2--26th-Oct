/**
 * restore-precompute.ts — rebuild StockMetrics + ScanResult after a PG restore.
 * Idempotent: force-recomputes metrics for the latest bar date, then precomputes
 * all 39 scanners. Run: bun scripts/restore-precompute.ts
 */
/// <reference types="bun-types" />
import { db } from "../src/lib/db";
import { runPostSyncPipeline } from "../src/lib/pipeline";

const t0 = Date.now();
const out = await runPostSyncPipeline({ force: true });
console.log("[metrics]", JSON.stringify(out.metrics));
if (out.scans) {
  console.log("[scans]", `computed=${out.scans.computed} failed=${out.scans.failed} date=${out.scans.date}`);
} else {
  console.log("[scans] skipped (metrics not ok)");
}
const [stocks, bars, metrics, scans] = await Promise.all([
  db.stock.count(),
  db.dailyBar.count(),
  db.stockMetrics.count(),
  db.scanResult.count(),
]);
console.log(`[verify] stocks=${stocks} bars=${bars} metrics=${metrics} scanResults=${scans}`);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
