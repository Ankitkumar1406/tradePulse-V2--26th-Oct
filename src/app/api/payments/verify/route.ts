import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { markPaidAndActivate } from "@/lib/payments";
import { CASHFREE_ENABLED, fetchCashfreeOrderStatus } from "@/lib/cashfree";

// POST /api/payments/verify — confirm a Cashfree order's status after the
// checkout modal closes (server-side polling verification; webhooks are
// handled separately in /api/payments/webhook).
// Body: { orderId }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!CASHFREE_ENABLED) {
    return NextResponse.json({ error: "Cashfree is not configured" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderId?: string };
  const orderId = String(body.orderId ?? "");
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const payment = await db.payment.findUnique({ where: { orderId } });
  if (!payment || payment.userId !== session.user.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (payment.provider !== "cashfree") {
    return NextResponse.json({ error: "Not a Cashfree order" }, { status: 400 });
  }
  if (payment.status === "PAID") {
    return NextResponse.json({ status: "PAID", plan: "pro" });
  }

  let orderStatus = "UNKNOWN";
  try {
    orderStatus = await fetchCashfreeOrderStatus(orderId);
  } catch {
    return NextResponse.json({ status: "PENDING" });
  }

  if (orderStatus === "PAID") {
    await markPaidAndActivate(payment.id);
    return NextResponse.json({ status: "PAID", plan: "pro" });
  }
  if (orderStatus === "EXPIRED" || orderStatus === "CANCELLED") {
    await db.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return NextResponse.json({ status: "FAILED" });
  }
  return NextResponse.json({ status: "PENDING" });
}
