import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureHistory } from "@/lib/history";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol: raw } = await ctx.params;
    const symbol = decodeURIComponent(raw).toUpperCase();
    const url = new URL(req.url);
    const range = url.searchParams.get("range") || "1y";

    const hist = await ensureHistory(symbol);
    const bars = await db.dailyBar.findMany({
      where: { symbol },
      orderBy: { date: "asc" },
      select: { date: true, open: true, high: true, low: true, close: true, volume: true },
    });

    // Client-side range slice (bars stored full 2y)
    let sliced = bars;
    if (range.endsWith("d")) {
      const n = parseInt(range, 10);
      if (Number.isFinite(n) && n > 0) sliced = bars.slice(-n);
    } else if (range === "6m") sliced = bars.slice(-126);
    else if (range === "1y") sliced = bars.slice(-250);
    else if (range === "3m") sliced = bars.slice(-63);
    else if (range === "1m") sliced = bars.slice(-21);

    return NextResponse.json({ ready: hist.ready, bars: sliced });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "history failed" }, { status: 500 });
  }
}
