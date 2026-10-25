/**
 * Background trickle pipelines: sector profiles, OHLCV bars and earnings dates.
 * Each runs a bounded, chunked loop in the background after a sync; safe to
 * call repeatedly (single-flight via globalThis guards).
 */

import { db, toPgSql, descNullsLast } from "@/lib/db";
import { fetchAssetProfile, fetchEarningsDate, fetchFinancials } from "@/lib/yahoo";
import { fetchFundamentalsFor, upsertFundamentals } from "@/lib/fundamentals";
import { STALE_DATA_MS } from "@/lib/sync";
import { resolveTaxonomy } from "@/lib/taxonomy";
import { syncSymbolBars, expectedLatestBarDate } from "@/lib/bar-sync";

interface TrickleGlobals {
  __tpSectorTrickle?: boolean;
  __tpBarsTrickle?: boolean;
  __tpEarningsTrickle?: boolean;
  __tpFinancialsTrickle?: boolean;
  __tpFundamentalsTrickle?: boolean;
}
const g = globalThis as unknown as TrickleGlobals;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bumpCounters(patch: Record<string, number>) {
  await db.syncState.upsert({
    where: { id: "main" },
    create: { id: "main", ...patch },
    update: patch,
  }).catch(() => {});
}

// ---------------------------------------------------------------- sectors

export function startSectorTrickle() {
  if (g.__tpSectorTrickle) return;
  g.__tpSectorTrickle = true;
  void (async () => {
    try {
      const pendingTotal = await db.stock.count({ where: { sectorSynced: null } });
      await bumpCounters({ sectorsTotal: pendingTotal, sectorsDone: 0 });
      const CHUNK = 6;
      let done = 0;
      for (;;) {
        const pending = await db.stock.findMany({
          where: { sectorSynced: null },
          select: { symbol: true },
          orderBy: descNullsLast("marketCap"),
          take: CHUNK,
        });
        if (pending.length === 0) break;
        for (const s of pending) {
          const profile = await fetchAssetProfile(s.symbol).catch(() => null);
          const sector = profile?.sector ?? "Unknown";
          const industry = profile?.industry ?? null;
          const tax = resolveTaxonomy(s.symbol, sector, industry);
          await db.stock.update({
            where: { symbol: s.symbol },
            data: {
              sector,
              industry,
              indGrp: tax.grp,
              subGrp: tax.sub,
              sectorSynced: new Date(),
            },
          }).catch(() => {});
          done++;
        }
        await bumpCounters({ sectorsDone: done });
        await sleep(400);
      }
    } catch (e) {
      console.error("[trickle] sectors:", e instanceof Error ? e.message : e);
    } finally {
      g.__tpSectorTrickle = false;
    }
  })();
}

// ---------------------------------------------------------------- bars

export function startBarsTrickle() {
  if (g.__tpBarsTrickle) return;
  g.__tpBarsTrickle = true;
  void (async () => {
    try {
      // Worker pool — the old sequential 6-chunk loop took 40+ minutes for
      // the full universe and could die mid-pass on a server recycle,
      // leaving charts days behind the quotes/closes data. Workers stay
      // gentle on the SQLite write lock (short gap between symbols) so
      // concurrent reads (login, screener, charts) are never starved.
      const CONCURRENCY = 4;
      let cursor = 0;
      let done = 0;

      // Data-driven staleness: a symbol needs bars when its newest stored
      // bar predates the universe's latest synced EOD date (or it has no
      // bars at all). This deliberately ignores barsSynced — the old
      // timestamp-only predicate let a failed fetch pass as "synced" and
      // hide stale charts for a whole day.
      const expected = await expectedLatestBarDate();
      let batch: { symbol: string }[];
      if (expected) {
        const rows = await db.$queryRawUnsafe<{ symbol: string }[]>(
          toPgSql(`SELECT s.symbol
            FROM "Stock" s
            LEFT JOIN (SELECT symbol, MAX(date) AS maxDate FROM "DailyBar" GROUP BY symbol) b
              ON b.symbol = s.symbol
           WHERE s.price IS NOT NULL AND (b.maxDate IS NULL OR b.maxDate < ?)
           ORDER BY s."marketCap" DESC NULLS LAST`),
          expected
        );
        batch = rows;
      } else {
        // universe never synced — fall back to the timestamp predicate
        const cutoff = new Date(Date.now() - STALE_DATA_MS);
        batch = await db.stock.findMany({
          where: { OR: [{ barsSynced: null }, { barsSynced: { lt: cutoff } }] },
          select: { symbol: true },
          orderBy: descNullsLast("marketCap"),
        });
      }

      await bumpCounters({ barsTotal: batch.length, barsDone: 0 });
      const attempted = new Set<string>();

      const pickNext = () => {
        while (cursor < batch.length) {
          const s = batch[cursor++];
          if (!attempted.has(s.symbol)) {
            attempted.add(s.symbol);
            return s;
          }
        }
        return null;
      };

      const worker = async () => {
        for (;;) {
          const s = pickNext();
          if (!s) return;
          let ok = false;
          // one retry per cycle — transient Yahoo failures are common
          for (let attempt = 0; attempt < 2 && !ok; attempt++) {
            if (attempt > 0) await sleep(1200);
            try {
              await syncSymbolBars(s.symbol);
              ok = true;
            } catch {
              // retry or leave for the next cycle — the data-driven
              // predicate re-picks anything still behind, and a failed
              // fetch must never look "synced" to the read path
            }
          }
          done++;
          if (done % 24 === 0) await bumpCounters({ barsDone: done });
          await sleep(150); // breathing room between write transactions
        }
      };

      if (batch.length > 0) {
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
      }
      await bumpCounters({ barsDone: done });
    } catch (e) {
      console.error("[trickle] bars:", e instanceof Error ? e.message : e);
    } finally {
      g.__tpBarsTrickle = false;
    }
  })();
}

// ---------------------------------------------------------------- earnings

export function startEarningsTrickle() {
  if (g.__tpEarningsTrickle) return;
  g.__tpEarningsTrickle = true;
  void (async () => {
    try {
      // estimates shift and results get announced — re-sync anything not
      // touched for 14 days, not just never-synced names
      const staleCutoff = new Date(Date.now() - 14 * 86400_000);
      const pendingWhere = { OR: [{ earningsSynced: null }, { earningsSynced: { lt: staleCutoff } }] };
      const pendingTotal = await db.stock.count({ where: pendingWhere });
      await bumpCounters({ earningsTotal: pendingTotal, earningsDone: 0 });
      const CHUNK = 6;
      let done = 0;
      for (;;) {
        const pending = await db.stock.findMany({
          where: pendingWhere,
          select: { symbol: true },
          orderBy: descNullsLast("marketCap"),
          take: CHUNK,
        });
        if (pending.length === 0) break;
        for (const s of pending) {
          // undefined = transport failure (leave any stored date untouched);
          // null = Yahoo has no date for the name (clear the stale estimate)
          const date = await fetchEarningsDate(s.symbol).catch(() => undefined);
          await db.stock.update({
            where: { symbol: s.symbol },
            data: {
              ...(date === undefined ? {} : { earningsDate: date }),
              earningsSynced: new Date(),
            },
          }).catch(() => {});
          done++;
        }
        await bumpCounters({ earningsDone: done });
        await sleep(400);
      }
    } catch (e) {
      console.error("[trickle] earnings:", e instanceof Error ? e.message : e);
    } finally {
      g.__tpEarningsTrickle = false;
    }
  })();
}

// ---------------------------------------------------------------- financials

/**
 * Quarterly financials (EPS growth YoY, revenue QoQ, 3Y NI CAGR) — one
 * quoteSummary call per stock, fetched for the whole universe on first run
 * and refreshed once they go stale. Powers the EPS score, the EPS Chg % (YoY)
 * screener column and Trader Choice 7's fundamental filters.
 */
export function startFinancialsTrickle() {
  if (g.__tpFinancialsTrickle) return;
  g.__tpFinancialsTrickle = true;
  void (async () => {
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000); // financials move quarterly
      const pendingTotal = await db.stock.count({
        where: { OR: [{ financialsSynced: null }, { financialsSynced: { lt: cutoff } }] },
      });
      await bumpCounters({ financialsTotal: pendingTotal, financialsDone: 0 });
      const CHUNK = 4;
      let done = 0;
      for (;;) {
        const pending = await db.stock.findMany({
          where: { OR: [{ financialsSynced: null }, { financialsSynced: { lt: cutoff } }] },
          select: { symbol: true },
          orderBy: descNullsLast("marketCap"),
          take: CHUNK,
        });
        if (pending.length === 0) break;
        for (const s of pending) {
          const f = await fetchFinancials(s.symbol).catch(() => null);
          // null-preserving: a missing statement must not wipe a good value
          await db.stock
            .update({
              where: { symbol: s.symbol },
              data: {
                ...(f?.epsQuarterlyGrowth != null ? { epsQuarterlyGrowth: f.epsQuarterlyGrowth } : {}),
                ...(f?.revenueQoQGrowth != null ? { revenueQoQGrowth: f.revenueQoQGrowth } : {}),
                ...(f?.netIncome3YCagr != null ? { netIncome3YCagr: f.netIncome3YCagr } : {}),
                financialsSynced: new Date(),
              },
            })
            .catch(() => {});
          done++;
        }
        await bumpCounters({ financialsDone: done });
        await sleep(300);
      }
    } catch (e) {
      console.error("[trickle] financials:", e instanceof Error ? e.message : e);
    } finally {
      g.__tpFinancialsTrickle = false;
    }
  })();
}


// ---------------------------------------------------------------- fundamentals

/**
 * Deep fundamentals (StockFundamentals) — snapshot ratios, annual income /
 * balance-sheet / cashflow statements and analyst consensus, one quoteSummary
 * call per symbol. Walks the universe biggest-mcap-first whenever rows go
 * stale (>3 days) or are missing entirely, so every EOD leaves the
 * fundamental layer a little fresher and the whole universe converges every
 * few days (statements move quarterly — a polite trickle beats a nightly
 * 3,600-call hammer that would trip Yahoo rate limits).
 */
export function startFundamentalsTrickle() {
  if (g.__tpFundamentalsTrickle) return;
  g.__tpFundamentalsTrickle = true;
  void (async () => {
    try {
      for (;;) {
        const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000);
        const pendingSymbols = await db.$queryRaw<{ symbol: string }[]>`
          SELECT s.symbol FROM "Stock" s
          LEFT JOIN "StockFundamentals" f ON f.symbol = s.symbol
          WHERE s.price IS NOT NULL AND (f.symbol IS NULL OR f."fetchedAt" < ${cutoff})
          ORDER BY s."marketCap" DESC NULLS LAST
          LIMIT 400
        `;
        await bumpCounters({ fundamentalsTotal: pendingSymbols.length, fundamentalsDone: 0 });
        if (pendingSymbols.length === 0) break;
        let done = 0;
        for (const { symbol } of pendingSymbols) {
          const norm = await fetchFundamentalsFor(symbol).catch(() => null);
          await upsertFundamentals(symbol, norm);
          done++;
          if (done % 25 === 0) await bumpCounters({ fundamentalsDone: done });
          await sleep(250);
        }
        await bumpCounters({ fundamentalsDone: done });
      }
    } catch (e) {
      console.error("[trickle] fundamentals:", e instanceof Error ? e.message : e);
    } finally {
      g.__tpFundamentalsTrickle = false;
    }
  })();
}
