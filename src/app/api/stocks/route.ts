import { NextResponse } from "next/server";
import { db, toPgSql, descNullsLast } from "@/lib/db";
import {
  CondSemantics,
  ProCompileError,
  ProRowWire,
  isV2Payload,
  proSymbolList,
  proComputedFor,
} from "@/lib/pro-sql";
import { FNO_UNIVERSE, NIFTY50_UNIVERSE, universeToDbSymbols } from "@/lib/fno-universe";
import { isV3Payload, runScanV3, type V3CondPayload } from "@/lib/scan/api";

export const dynamic = "force-dynamic";

/**
 * Screener / stock list. Filters over the universe with server-side paging.
 * Supports `cond` — the condition builder's payload. Two payload shapes:
 *
 *  1. Legacy bare JSON array (old builder — kept working):
 *      [{"f":"rsi14","op":"gt","v":60},
 *       {"kind":"expr","cmp":"gte","l":"close / min(66, low)","r":"1.30"}]
 *     A row with logic:"or" starts a new AND-group; groups OR-combine.
 *
 *  2. Versioned object from the rebuilt visual builder (Task 38):
 *      {"v":2,"rows":[{"kind":"expr","cmp":"gt","l":"close","r":"sma(close, 200)",
 *                      "logic":"and"}]}
 *     The logic chip joins a row to the previous one; AND chips split the
 *     chain into OR-groups and the groups AND-combine — A AND (B OR C),
 *     exactly as the builder's amber boxes read. Extra pro operators:
 *     crossAbove / crossBelow (previous-bar cross, per-series shift) and
 *     withinPct (|l−r|/|r|·100 ≤ pct).
 *
 * Pro rows compile to a single SQLite query whose CTEs compute the referenced
 * candle-series features (sma/min/max/lag over daily bars and weekly candles,
 * with candles-ago / weeks-ago shifts) via window functions — see pro-sql.ts.
 * Whenever a pro row is present the whole screen runs the pro path (field
 * rows compile to st.* comparisons in the same query); otherwise the fast
 * Prisma path is used. Up to 50 rows.
 */

const NUMERIC_FIELDS = [
  "price", "open", "dayHigh", "dayLow", "changePct", "volume", "avgVol3M", "marketCap",
  // current-week candle columns (screener builder Weekly timeframe)
  "wOpen", "wHigh", "wLow", "wClose",
  "peTTM", "pbRatio", "divYield",
  "rsi14", "wRsi14", "macdHist", "wMacdHist", "mom1M", "mom3M", "mom6M",
  "fromHighPct", "fromLowPct", "atr14Pct",
  "bbPctB", "bbWidthPct",
  "distSma20Pct", "distSma50Pct", "distSma100Pct", "distSma200Pct",
  "distEma20Pct", "distEma50Pct", "distEma100Pct", "distEma200Pct",
  "rsRating", "epsScore",
] as const;

const BOOLEAN_FIELDS = ["aboveSma20", "aboveSma50", "aboveSma200", "goldenCross", "volSpike", "emaCross"] as const;

const OPS = ["gt", "gte", "lt", "lte", "eq", "between"] as const;

export const MAX_COND_ROWS = 50;

interface CondRow {
  f?: unknown;
  op?: unknown;
  v?: unknown;
  v2?: unknown;
  logic?: unknown; // "and" (default) | "or" — how this row joins the previous one
}

function buildCondition(raw: CondRow): Record<string, unknown> | null {
  const f = typeof raw.f === "string" ? raw.f : "";
  const op = typeof raw.op === "string" ? raw.op : "";
  if (!(NUMERIC_FIELDS as readonly string[]).includes(f) && !(BOOLEAN_FIELDS as readonly string[]).includes(f)) return null;

  if ((BOOLEAN_FIELDS as readonly string[]).includes(f)) {
    if (op !== "eq") return null;
    return { [f]: { equals: raw.v === true || raw.v === "true" } };
  }

  const v = Number(raw.v);
  if (!Number.isFinite(v)) return null;
  switch (op) {
    case "gt": return { [f]: { gt: v } };
    case "gte": return { [f]: { gte: v } };
    case "lt": return { [f]: { lt: v } };
    case "lte": return { [f]: { lte: v } };
    case "between": {
      const v2 = Number(raw.v2);
      if (!Number.isFinite(v2)) return null;
      const lo = Math.min(v, v2), hi = Math.max(v, v2);
      return { [f]: { gte: lo, lte: hi } };
    }
    default: return null;
  }
}

const STOCK_SELECT = {
  symbol: true, name: true, price: true, changePct: true, volume: true, marketCap: true,
  sector: true, rsi14: true, mom1M: true, mom3M: true, mom6M: true, peTTM: true,
  fromHighPct: true, fromLowPct: true, aboveSma50: true, aboveSma200: true,
} as const;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const sector = url.searchParams.get("sector") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const perPage = Math.min(100, Math.max(10, Number(url.searchParams.get("perPage") ?? "25") || 25));
  const sortKey = url.searchParams.get("sort") ?? "marketCap";
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";

  const allowedSorts = [
    "marketCap", "changePct", "rsi14", "price", "mom1M", "mom3M", "mom6M", "volume",
    "peTTM", "fromHighPct", "fromLowPct", "pbRatio", "divYield", "atr14Pct",
  ] as const;
  const sort = (allowedSorts as readonly string[]).includes(sortKey) ? sortKey : "marketCap";

  const baseWhere: { AND: Record<string, unknown>[] } = {
    AND: [{ price: { not: null } }],
  };
  if (q) {
    const or: Record<string, unknown>[] = [
      { symbol: { contains: q.toUpperCase() } },
      { name: { contains: q } },
    ];
    // SQLite Prisma `contains` is case-sensitive — provide a capitalized fallback too
    or.push({ name: { contains: q.charAt(0).toUpperCase() + q.slice(1) } });
    baseWhere.AND.push({ OR: or });
  }
  if (sector && sector !== "all") baseWhere.AND.push({ sector });

  // Condition builder — up to 50 rows. Legacy arrays keep old semantics;
  // {v:2, rows, base?} from the rebuilt builder uses AND-of-OR-groups semantics.
  // `base` rows are Universe-bar baseline filters — they AND-combine and never
  // consume condition slots. `universe` narrows membership (Nifty 50/500, F&O).
  let condCount = 0;
  const condRaw = url.searchParams.get("cond");
  let condRows: ProRowWire[] = [];
  let baseRows: ProRowWire[] = [];
  let hasPro = false;
  let semantics: CondSemantics = "legacy";
  if (condRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(condRaw);
    } catch {
      return NextResponse.json({ error: "Invalid cond JSON" }, { status: 400 });
    }
    if (Array.isArray(parsed)) {
      condRows = parsed.slice(0, MAX_COND_ROWS) as ProRowWire[];
      hasPro = condRows.some(
        (r) => r != null && typeof r === "object" && ((r as { kind?: unknown }).kind === "expr" || (r as { kind?: unknown }).kind === "pattern")
      );
    } else if (isV3Payload(parsed)) {
      // v3 — sentence-style scan builder (registry-whitelisted vectorised evaluator).
      // Errors here are evaluation problems, NOT JSON problems — surface the real
      // message instead of letting the outer catch mask it as "Invalid cond JSON".
      try {
        return await runScanV3(parsed, url, sort, dir, page, perPage);
      } catch (e) {
        console.error("[/api/stocks] v3 scan failed:", e);
        return NextResponse.json(
          { error: `Scan failed: ${e instanceof Error ? e.message : "unknown error"}` },
          { status: 500 },
        );
      }
    } else if (isV2Payload(parsed)) {
      condRows = (parsed.rows as ProRowWire[]).slice(0, MAX_COND_ROWS);
      const rawBase = (parsed as { base?: unknown }).base;
      baseRows = Array.isArray(rawBase) ? (rawBase as ProRowWire[]).slice(0, 10) : [];
      semantics = "v2";
      hasPro = condRows.length > 0 || baseRows.length > 0;
    }
  }

  // Universe bar — membership narrowing + baseline filters. Any of these
  // active routes the screen through the pro path (one SQL for everything).
  const universe = url.searchParams.get("universe") ?? "all";
  const minPrice = Number(url.searchParams.get("minPrice") ?? "") || null;
  const minMcapCr = Number(url.searchParams.get("minMcapCr") ?? "") || null;
  const minTurnoverCr = Number(url.searchParams.get("minTurnoverCr") ?? "") || null;
  const extras: { sql: string; params: unknown[]; cheap?: boolean }[] = [];
  let restrictCandidates: string[] | null = null;
  if (universe === "n50") {
    restrictCandidates = universeToDbSymbols(NIFTY50_UNIVERSE);
  } else if (universe === "fno") {
    restrictCandidates = universeToDbSymbols(FNO_UNIVERSE);
  } else if (universe === "n500") {
    // Self-maintaining Nifty 500 approximation: the 500 largest by market cap.
    extras.push({
      sql: `st."marketCap" >= (SELECT st2."marketCap" FROM "Stock" st2 WHERE st2."marketCap" IS NOT NULL ORDER BY st2."marketCap" DESC OFFSET 499 LIMIT 1)`,
      params: [],
    });
  }
  if (minPrice != null && minPrice > 0) extras.push({ sql: `st."price" >= ?`, params: [minPrice], cheap: true });
  if (minMcapCr != null && minMcapCr > 0) extras.push({ sql: `st."marketCap" >= ?`, params: [minMcapCr * 1e7], cheap: true });
  if (minTurnoverCr != null && minTurnoverCr > 0) extras.push({ sql: `st."price" * st."volume" >= ?`, params: [minTurnoverCr * 1e7], cheap: true });
  if (extras.length > 0 || restrictCandidates != null) hasPro = true;

  try {
    let total: number;
    let stocks: Record<string, unknown>[];

    if (hasPro) {
      // ---- pro path: compile everything into one SQL query (cached briefly)
      const proOpts = { sector, sort, dir: dir as "asc" | "desc", extra: extras, restrictCandidates };
      const symbols = await proSymbolList(db, condRows, proOpts, semantics, baseRows);
      total = symbols.length;
      condCount = condRows.length + baseRows.length;
      const pageSymbols = symbols.slice((page - 1) * perPage, page * perPage);
      const rows = pageSymbols.length
        ? await db.stock.findMany({ where: { symbol: { in: pageSymbols } }, select: STOCK_SELECT })
        : [];
      const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
      stocks = pageSymbols
        .map((s) => bySymbol.get(s))
        .filter((r): r is (typeof rows)[number] => Boolean(r)) as unknown as Record<string, unknown>[];

      // "Show computed value" — evaluate the applied conditions' expressions
      // for the visible page so users can verify the math. Capped at 6 columns.
      const colsRaw = url.searchParams.get("cols");
      if (colsRaw && pageSymbols.length > 0) {
        try {
          const parsedCols: unknown = JSON.parse(colsRaw);
          const colExprs = (Array.isArray(parsedCols) ? parsedCols : [])
            .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
            .slice(0, 6);
          if (colExprs.length > 0) {
            const computed = await proComputedFor(db, condRows, proOpts, pageSymbols, colExprs, baseRows);
            for (const s of stocks) {
              (s as { computed?: (number | null)[] }).computed = computed.get(s.symbol as string) ?? undefined;
            }
          }
        } catch {
          // computed values are a nicety — a bad column expression must not
          // fail the screen itself
        }
      }
    } else {
      // ---- fast path: snapshot columns only, compiled to a Prisma where
      const where = { ...baseWhere, AND: [...baseWhere.AND] };
      const groups: Record<string, unknown>[][] = [];
      for (const raw of condRows) {
        const cond = buildCondition(raw as CondRow);
        if (!cond) continue;
        const isOr = (raw as CondRow).logic === "or" && groups.length > 0;
        if (isOr) groups.push([cond]);
        else {
          if (groups.length === 0) groups.push([]);
          groups[groups.length - 1].push(cond);
        }
        condCount++;
      }
      if (groups.length === 1) where.AND.push(...groups[0]);
      else if (groups.length > 1) {
        where.AND.push({ OR: groups.map((g) => (g.length === 1 ? g[0] : { AND: g })) });
      }
      const [count, rows] = await Promise.all([
        db.stock.count({ where }),
        db.stock.findMany({
          where,
          // nulls-last on the DESC leg: PostgreSQL would otherwise surface the
          // ~1,000 no-market-cap rows (SME/ETF) on page 1 of every default view
          orderBy: [
            dir === "desc"
              ? ({ [sort]: { sort: "desc", nulls: "last" } } as Record<string, never>)
              : ({ [sort]: dir } as Record<string, never>),
            descNullsLast("marketCap"),
          ],
          skip: (page - 1) * perPage,
          take: perPage,
          select: STOCK_SELECT,
        }),
      ]);
      total = count;
      stocks = rows as unknown as Record<string, unknown>[];
    }

    // Relative-volume context for the visible page: each row's traded volume
    // against its own prior-20-session average (latest stored session excluded,
    // so neither an intraday snapshot nor the just-synced EOD bar pollutes the
    // base). One indexed window query over the page's symbols keeps it cheap.
    const pageSymbols = stocks.map((s) => s.symbol) as string[];
    const volAvg = new Map<string, number>();
    if (pageSymbols.length > 0) {
      const rows: { symbol: string; avgVol: unknown }[] = await db.$queryRawUnsafe(
        toPgSql(`SELECT symbol, AVG(volume) AS avgVol
           FROM (SELECT symbol, volume,
                        ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
                   FROM "DailyBar" WHERE symbol IN (${pageSymbols.map(() => "?").join(",")}))
          WHERE rn BETWEEN 2 AND 21
          GROUP BY symbol`),
        ...pageSymbols
      );
      for (const r of rows) {
        const avg = Number(r.avgVol);
        if (Number.isFinite(avg) && avg > 0) volAvg.set(r.symbol, avg);
      }
    }
    const enriched = stocks.map((s) => {
      const volAvg20 = volAvg.get(s.symbol as string) ?? null;
      const volume = s.volume as number | null;
      const relVol = volAvg20 != null && volume != null && volume > 0 ? volume / volAvg20 : null;
      return { ...s, volAvg20, relVol };
    });

    const sectors = await db.stock.groupBy({
      by: ["sector"],
      where: { sector: { notIn: ["Unknown"] } },
      _count: { symbol: true },
      orderBy: { sector: "asc" },
    });

    return NextResponse.json({
      total,
      page,
      perPage,
      condCount,
      stocks: enriched,
      sectors: sectors.map((s) => s.sector).filter(Boolean),
    });
  } catch (e) {
    if (e instanceof ProCompileError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[/api/stocks] pro query failed:", e);
    return NextResponse.json({ error: "Screen failed — check the conditions" }, { status: 500 });
  }
}
