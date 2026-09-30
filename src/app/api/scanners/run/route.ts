import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runScan, runMultipleScans, type ScanFilters } from "@/lib/scanners";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface RunBody {
  scanId?: string;
  scanIds?: string[];
  mode?: "any" | "all";
  sector?: string;
  mcapMinCr?: number;
  priceMin?: number;
  priceMax?: number;
  q?: string;
  limit?: number;
}

function filtersFrom(b: RunBody): ScanFilters {
  return {
    sector: b.sector || undefined,
    mcapMinCr: b.mcapMinCr != null && Number.isFinite(Number(b.mcapMinCr)) ? Number(b.mcapMinCr) : undefined,
    priceMin: b.priceMin != null && Number.isFinite(Number(b.priceMin)) ? Number(b.priceMin) : undefined,
    priceMax: b.priceMax != null && Number.isFinite(Number(b.priceMax)) ? Number(b.priceMax) : undefined,
    q: b.q || undefined,
    limit: b.limit != null ? Number(b.limit) : undefined,
  };
}

/**
 * Run one scan (scanId) or a multiple-scan matrix (scanIds + mode).
 * POST /api/scanners/run { scanId: "gap-up", mcapMinCr: 500 }
 * POST /api/scanners/run { scanIds: ["gap-up","vcp"], mode: "all" }
 */
export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as RunBody;
    const filters = filtersFrom(b);

    if (b.scanIds && Array.isArray(b.scanIds) && b.scanIds.length > 0) {
      const result = await runMultipleScans(b.scanIds.slice(0, 12), filters, b.mode === "all" ? "all" : "any");
      return NextResponse.json(result);
    }
    if (!b.scanId) {
      return NextResponse.json({ error: "scanId or scanIds required" }, { status: 400 });
    }
    const result = await runScan(b.scanId, filters);
    if (!result) return NextResponse.json({ error: "unknown scanId" }, { status: 404 });

    // Annotate rows with stored bar counts so the chart view can prioritize
    // symbols that actually have enough history (recently listed / SME names
    // often hold only 1-2 bars and cannot render candles).
    const symbols = result.rows.map((r) => r.symbol);
    const countMap = new Map<string, number>();
    if (symbols.length > 0) {
      const counts = await db.dailyBar.groupBy({
        by: ["symbol"],
        where: { symbol: { in: symbols } },
        _count: { _all: true },
      });
      for (const c of counts) countMap.set(c.symbol, c._count._all);
    }

    return NextResponse.json({
      ...result,
      rows: result.rows.map((r) => ({ ...r, barsCount: countMap.get(r.symbol) ?? 0 })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "scan failed" }, { status: 500 });
  }
}
