import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

interface FilterBody {
  q?: string;
  sector?: string;
  priceMin?: number;
  priceMax?: number;
  changePctMin?: number;
  changePctMax?: number;
  mcapMin?: number; // INR
  mcapMax?: number;
  volumeMin?: number;
  peMin?: number;
  peMax?: number;
  rsiMin?: number;
  rsiMax?: number;
  aboveSma20?: boolean;
  aboveSma50?: boolean;
  aboveSma200?: boolean;
  goldenCross?: boolean;
  volSpike?: boolean;
  fromHighMax?: number; // % below 52w high (<= X)
  fromLowMin?: number; // % above 52w low (>= X)
  mom1MMin?: number;
  mom3MMin?: number;
  mom6MMin?: number;
  mom1MMax?: number;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const SORTABLE = new Set([
  "symbol", "name", "price", "changePct", "volume", "avgVol3M", "marketCap",
  "peTTM", "rsi14", "mom1M", "mom3M", "mom6M", "fromHighPct", "fromLowPct",
]);

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return undefined;
  return Number(v);
}

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as FilterBody;
    const where: Record<string, unknown> = {};
    const and: Record<string, unknown>[] = [];

    if (b.q?.trim()) {
      const t = b.q.trim();
      and.push({
        OR: [{ symbol: { contains: t.toUpperCase() } }, { name: { contains: t } }],
      });
    }
    if (b.sector) and.push({ sector: b.sector });

    const priceMin = num(b.priceMin), priceMax = num(b.priceMax);
    if (priceMin != null || priceMax != null) {
      const c: Record<string, number> = {};
      if (priceMin != null) c.gte = priceMin;
      if (priceMax != null) c.lte = priceMax;
      and.push({ price: c });
    }
    const chMin = num(b.changePctMin), chMax = num(b.changePctMax);
    if (chMin != null || chMax != null) {
      const c: Record<string, number> = {};
      if (chMin != null) c.gte = chMin;
      if (chMax != null) c.lte = chMax;
      and.push({ changePct: c });
    }
    const mcMin = num(b.mcapMin), mcMax = num(b.mcapMax);
    if (mcMin != null || mcMax != null) {
      const c: Record<string, number> = {};
      if (mcMin != null) c.gte = mcMin;
      if (mcMax != null) c.lte = mcMax;
      and.push({ marketCap: c });
    }
    const vMin = num(b.volumeMin);
    if (vMin != null) and.push({ volume: { gte: vMin } });

    const peMin = num(b.peMin), peMax = num(b.peMax);
    if (peMin != null || peMax != null) {
      const c: Record<string, number> = {};
      if (peMin != null) c.gte = peMin;
      if (peMax != null) c.lte = peMax;
      and.push({ peTTM: c });
    }
    const rsiMin = num(b.rsiMin), rsiMax = num(b.rsiMax);
    if (rsiMin != null || rsiMax != null) {
      const c: Record<string, number> = {};
      if (rsiMin != null) c.gte = rsiMin;
      if (rsiMax != null) c.lte = rsiMax;
      and.push({ rsi14: c });
    }

    if (b.aboveSma20) and.push({ aboveSma20: true });
    if (b.aboveSma50) and.push({ aboveSma50: true });
    if (b.aboveSma200) and.push({ aboveSma200: true });
    if (b.goldenCross) and.push({ goldenCross: true });
    if (b.volSpike) and.push({ volSpike: true });

    const fhMax = num(b.fromHighMax);
    if (fhMax != null) and.push({ fromHighPct: { lte: fhMax } });
    const flMin = num(b.fromLowMin);
    if (flMin != null) and.push({ fromLowPct: { gte: flMin } });

    const m1Min = num(b.mom1MMin); if (m1Min != null) and.push({ mom1M: { gte: m1Min } });
    const m1Max = num(b.mom1MMax); if (m1Max != null) and.push({ mom1M: { lte: m1Max } });
    const m3Min = num(b.mom3MMin); if (m3Min != null) and.push({ mom3M: { gte: m3Min } });
    const m6Min = num(b.mom6MMin); if (m6Min != null) and.push({ mom6M: { gte: m6Min } });

    if (and.length > 0) where.AND = and;

    const page = Math.max(1, b.page ?? 1);
    const pageSize = Math.min(200, Math.max(10, b.pageSize ?? 50));
    const field = b.sort && SORTABLE.has(b.sort) ? b.sort : "marketCap";
    const dir = b.dir === "asc" ? "asc" : "desc";

    const [total, rows] = await Promise.all([
      db.stock.count({ where }),
      db.stock.findMany({
        where,
        orderBy: [{ [field]: dir }, { symbol: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const sectors = await db.stock.findMany({
      where: { sector: { not: null } },
      select: { sector: true },
      distinct: ["sector"],
      orderBy: { sector: "asc" },
    });

    return NextResponse.json({
      total,
      page,
      pageSize,
      rows,
      sectors: sectors.map((s) => s.sector).filter(Boolean),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "screener failed" }, { status: 500 });
  }
}
