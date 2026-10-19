import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { markFailed, markPaidAndActivate } from "@/lib/payments";
import { CASHFREE_ENABLED } from "@/lib/cashfree";

// POST /api/payments/demo-confirm — sandbox-only completion for demo
// checkouts (active when CASHFREE_APP_ID/SECRET are not configured).
// Mirrors what the Cashfree webhook + verify flow do in production.
// Body: { orderId, outcome: "success" | "failure" }
export async function POST(req: NextRequest) {
  if (CASHFREE_ENABLED) {
    return NextResponse.json(
      { error: "Demo checkout is disabled when Cashfree credentials are configured" },
      { status: 403 }
    );
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderId?: string; outcome?: string };
  const orderId = String(body.orderId ?? "");
  const outcome = body.outcome === "failure" ? "failure" : "success";
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const payment = await db.payment.findUnique({ where: { orderId } });
  if (!payment || payment.userId !== session.user.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (payment.provider !== "demo") {
    return NextResponse.json({ error: "Not a demo order" }, { status: 400 });
  }
  if (payment.status === "PAID") {
    return NextResponse.json({ status: "PAID", plan: "pro" });
  }

  if (outcome === "failure") {
    await markFailed(payment.id);
    return NextResponse.json({ status: "FAILED" });
  }

  const { expiresAt } = await markPaidAndActivate(payment.id);
  return NextResponse.json({ status: "PAID", plan: "pro", expiresAt: expiresAt.toISOString() });
}
