/**
 * Per-symbol OHLCV bar freshness.
 *
 * The universe quotes + closes phases sync every evening and complete in
 * minutes, but the DailyBar chart store is filled by a slow background
 * trickle that can die mid-pass (server recycle) — leaving charts days
 * behind the rest of the app ("scanner says Sep 25, chart ends Sep 23").
 *
 * This module guarantees that any chart the user actually opens is synced
 * to the latest synced EOD date before it is served:
 *  - expectedLatestBarDate(): the calendar date (IST) of the newest quote
 *    snapshot across the universe — the same "data updated till" date the
 *    screener tables show.
 *  - syncSymbolBars(symbol): fetch 2y OHLCV from Yahoo and replace the
 *    symbol's stored bars + current-week candle (single source of truth
 *    for both the on-demand top-up and the background trickle).
 *  - ensureFreshBars(symbol): predicate + single-flight + soft deadline —
 *    fire the top-up only when the symbol is behind, never block the
 *    response for more than a few seconds, never break the chart on error.
 */

import { db } from "@/lib/db";
import { fetchChart } from "@/lib/yahoo";

/** How often a symbol's bars may be re-fetched from the read path. */
const TOPUP_COOLDOWN_MS = 2 * 3600 * 1000;
/** Soft deadline: serve possibly-stale bars rather than stall the request. */
const SOFT_DEADLINE_MS = 4500;
/** Cache TTL for the expected-latest-date lookup. */
const EXP_TTL_MS = 60 * 1000;

const IST_OFFSET_MIN = 330;
/** Yahoo stamps the session close at ~15:30 IST; anything earlier is intraday. */
const SESSION_QUOTE_MIN = 15 * 60 + 25;
/** NSE closes 15:30, the closing auction prints until ~15:40 — a bar for the
 *  current calendar day is only safe to store from 15:45 IST onwards. */
const SESSION_BAR_FINAL_MIN = 15 * 60 + 45;

/** Shift a UTC instant into IST (returned as a UTC-shifted Date — read its
 *  UTC getters as IST wall-clock fields). */
function istWall(now: Date): Date {
  return new Date(now.getTime() + IST_OFFSET_MIN * 60 * 1000);
}

/** True once today's (IST) session is closed and its bars are final —
 *  always true on weekends. Guards against storing intraday partial bars. */
export function isSessionFinal(now: Date = new Date()): boolean {
  const ist = istWall(now);
  const dow = ist.getUTCDay();
  if (dow === 0 || dow === 6) return true;
  return ist.getUTCHours() * 60 + ist.getUTCMinutes() >= SESSION_BAR_FINAL_MIN;
}

/** IST calendar date (YYYY-MM-DD) for `now`. */
export function istDateIso(now: Date = new Date()): string {
  return istWall(now).toISOString().slice(0, 10);
}

let holidayCache: { dates: Set<string>; at: number } | null = null;

async function nseHolidays(): Promise<Set<string>> {
  if (holidayCache && Date.now() - holidayCache.at < 10 * 60 * 1000) return holidayCache.dates;
  try {
    const rows = await db.marketEvent.findMany({ where: { category: "holiday" }, select: { date: true } });
    holidayCache = { dates: new Set(rows.map((r) => r.date)), at: Date.now() };
  } catch {
    holidayCache = { dates: new Set(), at: Date.now() };
  }
  return holidayCache.dates;
}

/** Step an IST calendar date back to the previous likely trading day —
 *  skips weekends and seeded NSE holidays (best effort; falls back to
 *  weekends-only when the calendar table is unavailable). */
export async function prevSessionDateIso(dateIso: string): Promise<string> {
  const holidays = await nseHolidays();
  const d = new Date(`${dateIso}T00:00:00Z`);
  for (let i = 0; i < 20; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) return iso;
  }
  return dateIso;
}

/** Most recent Mon–Fri 15:30 IST instant at or before `now` (UTC Date).
 *  "Has this table been refreshed since the last session closed?" cutoff —
 *  deliberately calendar-blind to holidays: a holiday's 15:30 cutoff simply
 *  over-covers, which is the safe direction for staleness checks. */
export function lastSessionCloseInstant(now: Date = new Date()): Date {
  const ist = istWall(now);
  const cand = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 15, 30, 0, 0) - IST_OFFSET_MIN * 60 * 1000
  );
  const out = cand.getTime() <= now.getTime() ? cand : new Date(cand.getTime() - 86400_000);
  const dow = istWall(out).getUTCDay();
  if (dow === 0) return new Date(out.getTime() - 2 * 86400_000);
  if (dow === 6) return new Date(out.getTime() - 1 * 86400_000);
  return out;
}

interface BarSyncGlobals {
  __tpBarSyncInFlight?: Map<string, Promise<void>>;
  __tpBarSyncFailures?: Map<string, number>;
}
const g = globalThis as unknown as BarSyncGlobals;
const inFlight: Map<string, Promise<void>> = (g.__tpBarSyncInFlight ??= new Map());
const lastFailure: Map<string, number> = (g.__tpBarSyncFailures ??= new Map());
/** After a failed fetch, wait this long before the read path retries. */
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

let expDateCache: { date: string; at: number } | null = null;

/**
 * Calendar date (YYYY-MM-DD, IST) of the newest COMPLETED EOD session the
 * universe has synced — i.e. the date "the data is updated till". Falls back
 * to null when the universe has never synced.
 *
 * Intraday guard: between 9:15 and 15:25 IST a manual refresh stamps
 * quoteTime with a live intraday instant. Treating that calendar day as the
 * latest EOD session would let metrics/scans freeze a partial-day snapshot
 * for it, so an intraday quote clamps back to the previous trading day.
 */
export async function expectedLatestBarDate(): Promise<string | null> {
  if (expDateCache && Date.now() - expDateCache.at < EXP_TTL_MS) return expDateCache.date;
  try {
    const agg = await db.stock.aggregate({ _max: { quoteTime: true } });
    const qt = agg._max.quoteTime;
    if (!qt) return null;
    // regularMarketTime is the UTC instant of the last NSE trade (~15:30 IST);
    // shift to IST before reading the calendar fields.
    const ist = istWall(qt);
    let date = ist.toISOString().slice(0, 10);
    const dow = ist.getUTCDay();
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const intradayQuote = dow !== 0 && dow !== 6 && mins < SESSION_QUOTE_MIN;
    if (intradayQuote || dow === 0 || dow === 6) {
      // weekend / holiday-safe step back to the previous trading day — a
      // Saturday/Sunday/holiday target would make every Friday bar look
      // stale → whole-universe re-fetch on every boot.
      date = await prevSessionDateIso(date);
    }
    // Zero-bars guard: an exchange holiday or special closure missing from
    // the seeded MarketEvent calendar leaves the candidate date with no
    // bars anywhere — the metrics pipeline then deadlocks forever on
    // "bars-incomplete" (2026-10-20 Dussehra incident). If the candidate
    // has zero bars while earlier sessions have thousands, trust the data
    // and step back to the previous trading day. A real session that is
    // mid-trickle always has SOME rows, so this only fires on genuinely
    // empty dates (and the metrics coverage gates still protect accuracy).
    const [candRows, maxBar] = await Promise.all([
      db.dailyBar.count({ where: { date } }),
      db.dailyBar.aggregate({ _max: { date: true } }),
    ]);
    if (candRows === 0 && maxBar._max.date && maxBar._max.date < date) {
      for (let i = 0; i < 3; i++) {
        date = await prevSessionDateIso(date);
        const rows = await db.dailyBar.count({ where: { date } });
        if (rows > 0) break;
      }
    }
    expDateCache = { date, at: Date.now() };
    return expDateCache.date;
  } catch {
    return null;
  }
}

export interface SymbolBarRow {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Yahoo chart JSON -> bar rows (drops null OHLC points).
 *
 * Partial-session guard: a chart fetched during market hours includes the
 * CURRENT day's half-formed candle (a ~2-hour price with a fraction of the
 * day's volume). Storing it would poison the EOD store — and because the
 * bar's date then equals the expected session, the trickle would never
 * re-fetch it. Drop the current day's row until the session is final.
 */
export function chartToRows(symbol: string, chart: Awaited<ReturnType<typeof fetchChart>>): SymbolBarRow[] {
  const ts = chart.timestamp;
  const q = chart.indicators.quote[0];
  const rows: SymbolBarRow[] = [];
  const todayIso = istDateIso();
  const sessionFinal = isSessionFinal();
  for (let i = 0; i < ts.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
    if (o == null || h == null || l == null || c == null) continue;
    if (c <= 0 || h <= 0 || l <= 0 || o <= 0) continue; // all-zero placeholders + non-traded iNAV series (valid close, open=0/vol=0)
    const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    if (date === todayIso && !sessionFinal) continue; // intraday partial candle
    rows.push({
      symbol,
      date,
      open: o, high: h, low: l, close: c,
      volume: v ?? 0,
    });
  }
  return rows;
}

/** Monday (UTC/ISO) anchor of the week containing the given YYYY-MM-DD date. */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

/** Current-week OHLC from freshly fetched bars (last week bucket, Mon-anchored). */
export function weeklyOhlc(rows: { date: string; open: number; high: number; low: number; close: number }[]) {
  if (rows.length === 0) return null;
  const monday = mondayOf(rows[rows.length - 1].date);
  const wk = rows.filter((r) => r.date >= monday);
  if (wk.length === 0) return null;
  return {
    wOpen: wk[0].open,
    wHigh: Math.max(...wk.map((r) => r.high)),
    wLow: Math.min(...wk.map((r) => r.low)),
    wClose: wk[wk.length - 1].close,
  };
}

/**
 * Fetch fresh bars for one symbol and merge them into the stored DailyBar
 * rows, then refresh the current-week candle. Returns the newest bar date
 * after the merge, or null when the fetch produced nothing.
 *
 * The merge is a covered-window replace: only dates within the fetched
 * range are deleted. A truncated upstream response (Yahoo occasionally
 * serves a 1-3 bar tail) can then never wipe the stored 2y history — it
 * just refreshes the days it actually returned.
 */
export async function syncSymbolBars(symbol: string, range = "2y"): Promise<string | null> {
  const chart = await fetchChart(symbol, range);
  const rows = chartToRows(symbol, chart);
  if (rows.length === 0) return null;
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  await db.$transaction([
    db.dailyBar.deleteMany({ where: { symbol, date: { gte: rows[0].date } } }),
    db.dailyBar.createMany({ data: rows }),
  ]);
  // keep the builder's Weekly-timeframe price columns fresh alongside bars
  const wk = weeklyOhlc(rows);
  await db.stock.update({
    where: { symbol },
    data: { barsSynced: new Date(), ...(wk ?? {}) },
  });
  return rows[rows.length - 1].date;
}

/**
 * On-demand freshness for chart reads: if the symbol's newest stored bar is
 * older than the universe's latest synced EOD date, top it up before the
 * chart is served. Best-effort by design — any failure leaves the stored
 * bars untouched so the chart still renders.
 */
export async function ensureFreshBars(symbol: string): Promise<void> {
  try {
    const [expected, stock, maxBar] = await Promise.all([
      expectedLatestBarDate(),
      db.stock.findUnique({ where: { symbol }, select: { barsSynced: true } }),
      db.dailyBar.aggregate({ where: { symbol }, _max: { date: true } }),
    ]);
    if (!expected || !stock) return;
    const last = maxBar._max.date;
    if (last && last >= expected) return; // already current
    // a recent attempt (this session or the trickle) — don't hammer Yahoo
    if (stock.barsSynced && Date.now() - stock.barsSynced.getTime() < TOPUP_COOLDOWN_MS) return;
    const failedAt = lastFailure.get(symbol);
    if (failedAt && Date.now() - failedAt < FAILURE_COOLDOWN_MS) return;

    const existing = inFlight.get(symbol);
    if (existing) {
      await Promise.race([existing, sleep(SOFT_DEADLINE_MS)]);
      return;
    }
    const p = (async () => {
      try {
        await syncSymbolBars(symbol);
        lastFailure.delete(symbol);
      } catch {
        lastFailure.set(symbol, Date.now());
      } finally {
        inFlight.delete(symbol);
      }
    })();
    inFlight.set(symbol, p);
    // soft deadline: chart response never waits on a slow upstream
    await Promise.race([p, sleep(SOFT_DEADLINE_MS)]);
  } catch {
    // freshness is an enhancement — the chart must always render
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
