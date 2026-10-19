/**
 * One-time data recovery after the sync.ts inverted-universe-skip fix.
 *
 * The bug froze Stock quotes at the 2026-09-25 close (universe phase skipped
 * whenever data was >2h old) which cascaded into the banner stamp,
 * metricsDate and scansDate. This morning's bars trickle also stored today's
 * partial intraday candles for ~2.8k symbols.
 *
 * Steps:
 *   1. delete today's partial intraday bars (only while the session is open)
 *   2. force a full refresh sync (universe quotes are 23 days stale)
 *   3. force a closes pass (session-aware cutoff sees this morning's spark
 *      run as "fresh" — with the new spark partial-guard the recompute is
 *      EOD-clean through the last completed session)
 *   4. wait for the bars trickle to end, then run the precompute pipeline
 *      (metrics + scans) for the clamped EOD session
 *
 *   DATABASE_URL=... bun scripts/recover-sync.ts
 */
import { db } from "../src/lib/db";
import { startSync, getSyncStatus, runClosesPhase } from "../src/lib/sync";
import { runPostSyncPipeline } from "../src/lib/pipeline";
import { isSessionFinal, istDateIso, expectedLatestBarDate } from "../src/lib/bar-sync";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

  // ---- 1. drop today's partial intraday bars ------------------------------
  const todayIso = istDateIso();
  if (!isSessionFinal()) {
    const del = await db.dailyBar.deleteMany({ where: { date: todayIso } });
    console.log(`[recover] deleted ${del.count} partial intraday bars for ${todayIso}`);
  } else {
    console.log(`[recover] session final — keeping ${todayIso} bars (they are complete EOD rows)`);
  }

  // ---- 2. force refresh sync (universe + gated phases) ---------------------
  console.log("[recover] starting forced refresh sync...");
  const startedAt = new Date();
  const start = await startSync("refresh", { force: true });
  if (!start.started) throw new Error(`sync did not start: ${start.reason}`);

  for (let i = 0; i < 120; i++) {
    await sleep(10_000);
    const s = await getSyncStatus();
    if (s.status === "error") throw new Error(`sync failed: ${s.lastError}`);
    const ingested = s.lastIngestAt ? Date.parse(s.lastIngestAt) > startedAt.getTime() : false;
    if (s.status === "done" && ingested) {
      console.log(`[recover] sync done in ${elapsed()} (universe ${s.universeDone}/${s.universeTotal}, closes ${s.closesDone}/${s.closesTotal})`);
      break;
    }
    if (i % 3 === 0) console.log(`[recover] ... ${s.phase}/${s.status} closes ${s.closesDone}/${s.closesTotal} bars ${s.barsDone}/${s.barsTotal} (${elapsed()})`);
  }

  // ---- 3. forced closes pass (EOD-clean indicators) ------------------------
  console.log("[recover] forcing closes pass (all stocks, session-guarded spark)...");
  await runClosesPhase({ staleCutoff: new Date() });
  console.log(`[recover] closes pass done in ${elapsed()}`);

  // ---- 4. wait for bars trickle, then precompute metrics + scans -----------
  const expected = await expectedLatestBarDate();
  console.log(`[recover] expected EOD session: ${expected}`);
  for (let i = 0; i < 30; i++) {
    const out = await runPostSyncPipeline();
    if (out.metrics.ok) {
      console.log(`[recover] pipeline ok: metrics ${out.metrics.date} (${out.metrics.rows} rows), scans for ${out.scans?.date ?? "?"} (${out.scans?.computed ?? 0}/${out.scans?.computed ?? 0} cached)`);
      break;
    }
    console.log(`[recover] pipeline deferred: ${out.metrics.reason} (${elapsed()}) — retrying in 60s`);
    await sleep(60_000);
  }

  // ---- final state ---------------------------------------------------------
  const s = await getSyncStatus();
  console.log("[recover] FINAL:", JSON.stringify({
    lastQuoteTime: s.lastQuoteTime,
    metricsDate: s.metricsDate,
    scansDate: s.scansDate,
    stockCount: s.stockCount,
  }, null, 2));
  await db.$disconnect();
}

main().catch((e) => {
  console.error("[recover] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
