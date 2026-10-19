/**
 * In-process scheduler:
 *  - daily EOD auto-update at 16:00 IST Mon–Fri (IST = UTC+5:30, no DST)
 *  - boot catch-up (server restarted after the 4 pm mark with stale data)
 *  - boot bars-wipe guard (quotes fresh but DailyBar mass-stale — e.g. the DB
 *    was restored from an older snapshot; without this the bars trickle would
 *    never fire and scanners/screener charts would lag until the next 4 pm run)
 *  - hourly autopay renewal pass
 *
 * Pure helpers are exported for unit tests; the live timer is idempotent and
 * stored on globalThis so hot reloads don't stack timers.
 */

import { db, toPgSql } from "@/lib/db";
import { startSync, isSyncRunning } from "@/lib/sync";
import { startBarsTrickle } from "@/lib/trickle";
import { expectedLatestBarDate } from "@/lib/bar-sync";
import { processDueRenewals } from "@/lib/payments";
import { runPostSyncPipeline, isPostPipelineRunning } from "@/lib/pipeline";
import { warmBreadthCache } from "@/lib/breadth-history";

const IST_OFFSET_MIN = 330; // UTC+5:30
const FIRE_UTC_H = 10; // 16:00 IST == 10:30 UTC
const FIRE_UTC_M = 30;

interface SchedulerGlobals {
  __tpDailyTimer?: ReturnType<typeof setTimeout>;
  __tpDailyTarget?: Date;
  __tpSchedulerLive?: boolean;
}
const g = globalThis as unknown as SchedulerGlobals;

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Next Mon–Fri 16:00 IST fire time (UTC instant), strictly after `now`. */
export function nextRunAt(now: Date = new Date()): Date {
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), FIRE_UTC_H, FIRE_UTC_M, 0, 0)
  );
  if (candidate.getTime() <= now.getTime() || isWeekend(candidate)) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
    candidate.setUTCHours(FIRE_UTC_H, FIRE_UTC_M, 0, 0);
  }
  while (isWeekend(candidate)) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

/** Most recent Mon–Fri 16:00 IST boundary at or before `now`. */
export function lastRunBoundary(now: Date = new Date()): Date {
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), FIRE_UTC_H, FIRE_UTC_M, 0, 0)
  );
  if (candidate.getTime() > now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() - 1);
  }
  while (isWeekend(candidate)) {
    candidate.setUTCDate(candidate.getUTCDate() - 1);
  }
  return candidate;
}

/**
 * Catch-up predicate: a daily update is owed when the last successful quote
 * snapshot predates the most recent 4 pm boundary AND no sync has started
 * after that boundary.
 */
export function shouldCatchUp(now: Date, lastQuoteTime: Date | null, startedAt: Date | null): boolean {
  const boundary = lastRunBoundary(now);
  if (!lastQuoteTime || lastQuoteTime.getTime() >= boundary.getTime()) return false;
  if (!startedAt) return false;
  return startedAt.getTime() < boundary.getTime();
}

/**
 * Bars-wipe guard: how many large-cap (≥ ₹1,000 Cr) priced names are behind
 * the universe's latest EOD date. Genuine no-trade stragglers are almost all
 * micro/SME caps, so a three-digit count among large caps means the bar store
 * itself is stale or was rolled back — not just illiquid names missing a day.
 */
export async function staleLargeCapCount(expected: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
    toPgSql(`SELECT COUNT(*) AS n
       FROM "Stock" s
       LEFT JOIN (SELECT symbol, MAX(date) AS maxDate FROM "DailyBar" GROUP BY symbol) b
         ON b.symbol = s.symbol
      WHERE s.price IS NOT NULL AND s."marketCap" >= 10000000000
        AND (b.maxDate IS NULL OR b.maxDate < ?)`),
    expected
  );
  return Number(rows[0]?.n ?? 0);
}

/** The armed auto-update time (ISO) or null when the scheduler is off. */
export function nextAutoUpdateIso(): string | null {
  return g.__tpSchedulerLive && g.__tpDailyTarget ? g.__tpDailyTarget.toISOString() : null;
}

function arm(next?: Date) {
  const target = next ?? nextRunAt();
  const delay = Math.max(1000, target.getTime() - Date.now());
  g.__tpDailyTarget = target;
  g.__tpDailyTimer = setTimeout(() => {
    void (async () => {
      try {
        console.log(`[scheduler] firing daily EOD sync at ${new Date().toISOString()}`);
        // force:true — this IS the EOD run of record. Without it, any manual
        // refresh inside the previous 4 hours would trip the SYNC_MIN_INTERVAL
        // gate and silently cancel the day's only universe+closes update.
        const res = await startSync("daily", { force: true });
        if (!res.started && res.reason === "already-running") {
          // a long-running manual sync held the single-flight — retry once
          // instead of losing the trading day's EOD update entirely.
          console.log("[scheduler] daily fire blocked by a running sync — retrying in 15 min");
          setTimeout(() => {
            void startSync("daily", { force: true }).catch(() => {});
          }, 15 * 60 * 1000);
        }
        await processDueRenewals().catch(() => {});
      } catch (e) {
        console.error("[scheduler] daily fire failed:", e instanceof Error ? e.message : e);
      } finally {
        arm(); // always re-arm for the next trading day
      }
    })();
  }, delay);
  console.log(`[scheduler] next EOD auto-update at ${target.toISOString()} (4:00 pm IST, Mon-Fri)`);
}

/** Start the scheduler exactly once per server process. */
export function startDailySyncScheduler() {
  if (g.__tpSchedulerLive) return;
  g.__tpSchedulerLive = true;

  arm();

  // Warm the market-breadth history cache in the background so the breadth
  // page renders its charts on the very first visit instead of computing a
  // ~1.3M-row window scan on demand (seconds of blank charts after boot).
  void warmBreadthCache();

  // Hourly autopay renewal pass
  setInterval(() => {
    void processDueRenewals().catch(() => {});
  }, 3600 * 1000);

  // 10-minute precompute sweeper — the safety net that keeps stock_metrics /
  // scan_results in lock-step with the latest EOD session even when the bars
  // trickle finished after the sync (or a server recycle interrupted the
  // chain). Cheap: two tiny reads + a gate check, every 10 min.
  setInterval(() => {
    void (async () => {
      try {
        if (isSyncRunning() || isPostPipelineRunning()) return;
        const state = await db.syncState
          .findUnique({ where: { id: "main" }, select: { metricsDate: true } })
          .catch(() => null);
        const expected = await expectedLatestBarDate();
        if (!expected || state?.metricsDate === expected) return;
        const stale = await staleLargeCapCount(expected);
        if (stale > 250) return; // bars still catching up — trickle first
        console.log("[scheduler] metrics behind EOD session — running precompute pipeline");
        await runPostSyncPipeline();
      } catch (e) {
        console.error("[scheduler] pipeline sweep failed:", e instanceof Error ? e.message : e);
      }
    })();
  }, 10 * 60 * 1000);

  // Boot: renewal pass + catch-up check after a short warm-up
  setTimeout(() => {
    void processDueRenewals().catch(() => {});
    void (async () => {
      try {
        const stockCount = await db.stock.count();
        if (stockCount === 0) return; // GET /api/sync owns the initial full sync
        const [agg, state] = await Promise.all([
          db.stock.aggregate({ _max: { quoteTime: true } }),
          db.syncState.findUnique({ where: { id: "main" } }),
        ]);
        // Key the catch-up on the last SUCCESSFUL ingest (lastIngestAt), not
        // the last attempt (startedAt): a sync that started after the 4 pm
        // boundary but failed — or skipped its universe phase — must not
        // block a retry on the next boot.
        const lastIngest = state?.lastIngestAt ?? state?.startedAt ?? null;
        if (shouldCatchUp(new Date(), agg._max.quoteTime, lastIngest)) {
          console.log("[scheduler] catch-up daily update owed — firing now");
          await startSync("daily");
        } else {
          console.log("[scheduler] data already covers the last 4:00 pm IST mark — no catch-up needed");
        }

        // Bars-wipe guard: the quote catch-up predicate above can pass while
        // DailyBar is empty/mass-stale (quotes and bars are separate tables).
        // Without this, charts, scanners and pro screener conditions would
        // stay broken until the next 4 pm IST sync. The trickle is gentle
        // (4 workers, WAL) and single-flight, so firing it here is safe even
        // if a sync just started it.
        const expected = await expectedLatestBarDate();
        if (expected) {
          const staleLarge = await staleLargeCapCount(expected);
          if (staleLarge > 250) {
            console.log(
              `[scheduler] ${staleLarge} large-cap symbols behind ${expected} — starting bars trickle catch-up`
            );
            startBarsTrickle();
          } else {
            console.log(`[scheduler] bars fresh (stale large-caps: ${staleLarge})`);
            // Bars are current — if the precomputed metrics lag the session
            // (e.g. a restore or an interrupted pipeline), build them now.
            void runPostSyncPipeline().catch(() => {});
          }
        }
      } catch (e) {
        console.error("[scheduler] catch-up check failed:", e instanceof Error ? e.message : e);
      }
    })();
  }, 20_000);
}
