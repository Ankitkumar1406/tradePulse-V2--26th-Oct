import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { markFailed, markPaidAndActivate } from "@/lib/payments";
import { CASHFREE_ENABLED, verifyWebhookSignature } from "@/lib/cashfree";

// POST /api/payments/webhook — Cashfree server-to-server notifications.
// Configure in the Cashfree dashboard -> Webhooks with:
//   https://<your-domain>/api/payments/webhook
// Signature headers are verified with the SDK's PGVerifyWebhookSignature.
export async function POST(req: NextRequest) {
  if (!CASHFREE_ENABLED) {
    return NextResponse.json({ error: "Cashfree is not configured" }, { status: 400 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature") ?? "";
  const timestamp = req.headers.get("x-webhook-timestamp") ?? "";

  try {
    // Throws when the signature does not match (anti-tamper check).
    verifyWebhookSignature(signature, rawBody, timestamp);
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let payload: { type?: string; data?: { order?: { order_id?: string; order_status?: string } } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = payload.data?.order?.order_id;
  const orderStatus = payload.data?.order?.order_status;
  if (!orderId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const payment = await db.payment.findUnique({ where: { orderId } });
  if (!payment || payment.provider !== "cashfree") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (orderStatus === "PAID" && payment.status !== "PAID") {
    await markPaidAndActivate(payment.id);
  } else if ((orderStatus === "EXPIRED" || orderStatus === "CANCELLED") && payment.status === "CREATED") {
    await markFailed(payment.id);
  }

  return NextResponse.json({ ok: true });
}
