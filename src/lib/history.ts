/**
 * On-demand OHLCV history fetch + cache in DailyBar table.
 * The chart API returns the full 2y window, so we replace the symbol's bars
 * atomically on each refresh. Freshness is tracked in memory per symbol.
 */
import { db } from "@/lib/db";
import { fetchChart } from "@/lib/yahoo";
import { isSessionFinal } from "@/lib/bar-sync";

const g = globalThis as unknown as {
  __histInFlight?: Set<string>;
  __histFetchedAt?: Map<string, number>;
  __histGate?: { active: number; queue: (() => void)[] };
};
const inFlight = (g.__histInFlight ??= new Set<string>());
const fetchedAt = (g.__histFetchedAt ??= new Map<string, number>());
const gate = (g.__histGate ??= { active: 0, queue: [] });

/** Global concurrency gate — chart grids fire many history fetches at once; keep Yahoo happy. */
async function withGate<T>(fn: () => Promise<T>): Promise<T> {
  const MAX = 4;
  if (gate.active >= MAX) await new Promise<void>((res) => gate.queue.push(res));
  gate.active++;
  try {
    return await fn();
  } finally {
    gate.active--;
    gate.queue.shift()?.();
  }
}

function istDate(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}

export async function ensureHistory(symbol: string, maxAgeMin = 30): Promise<{ ready: boolean; bars: number; fetched: boolean }> {
  const count = await db.dailyBar.count({ where: { symbol } });

  // Recent in-memory fetch -> trust the cache
  const lastFetch = fetchedAt.get(symbol);
  if (lastFetch && Date.now() - lastFetch < maxAgeMin * 60 * 1000) {
    return { ready: count > 0, bars: count, fetched: false };
  }

  // Another request is already fetching -> return what we have
  if (inFlight.has(symbol)) {
    return { ready: count > 0, bars: count, fetched: false };
  }

  inFlight.add(symbol);
  try {
    const chart = await withGate(() => fetchChart(symbol, "2y"));
    const q = chart.indicators.quote[0];
    const byDate = new Map<string, { symbol: string; date: string; open: number; high: number; low: number; close: number; volume: number }>();
    const today = istDate(new Date());
    for (let i = 0; i < chart.timestamp.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
      if (o == null || h == null || l == null || c == null) continue;
      const date = istDate(new Date(chart.timestamp[i] * 1000));
      // Same rule as the managed sync (bar-sync.ts): today's candle is intraday
      // partial until 15:45 IST — never store it, or chart views would poison
      // DailyBar with a half-day bar while the screener runs on the last
      // completed session. It re-enters via the 4 pm IST EOD fire.
      if (date === today && !isSessionFinal()) continue;
      if (o <= 0 || c <= 0) continue; // placeholder/zero-price rows + non-traded iNAV series
      byDate.set(date, { symbol, date, open: o, high: h, low: l, close: c, volume: v ?? 0 });
    }
    const rows = [...byDate.values()];
    if (rows.length > 0) {
      if (count === 0 || rows.length >= count) {
        // Fetched window is at least as complete as what's stored — replace atomically.
        await db.$transaction([
          db.dailyBar.deleteMany({ where: { symbol } }),
          db.dailyBar.createMany({ data: rows }),
        ]);
      } else {
        // Truncated/partial fetch (Yahoo rate-limit hiccups): merge recent bars
        // WITHOUT wiping the stored history — full history takes years to re-sync.
        // NOTE: Prisma createMany on SQLite has no skipDuplicates support —
        // emulate upsert by deleting just the covered dates first (chunked for
        // SQLite's bind-variable limit), then inserting, all in one transaction.
        const dates = rows.map((r) => r.date);
        await db.$transaction(async (tx) => {
          for (let i = 0; i < dates.length; i += 400) {
            await tx.dailyBar.deleteMany({ where: { symbol, date: { in: dates.slice(i, i + 400) } } });
          }
          await tx.dailyBar.createMany({ data: rows });
        });
      }
    }
    fetchedAt.set(symbol, Date.now());
    const newCount = await db.dailyBar.count({ where: { symbol } });
    return { ready: newCount > 0, bars: newCount, fetched: true };
  } catch (e) {
    const err = e as { constructor?: { name?: string }; message?: string };
    console.error(`[history] fetch failed for ${symbol}:`, err?.constructor?.name, err?.message?.slice(0, 200));
    return { ready: count > 0, bars: count, fetched: false };
  } finally {
    inFlight.delete(symbol);
  }
}
