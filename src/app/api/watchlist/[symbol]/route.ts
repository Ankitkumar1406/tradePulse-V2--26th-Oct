import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol: raw } = await ctx.params;
    const symbol = decodeURIComponent(raw).toUpperCase();
    await db.watchlistItem.deleteMany({ where: { symbol } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "delete failed" }, { status: 500 });
  }
}
