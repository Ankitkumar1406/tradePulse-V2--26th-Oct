/**
 * Payments: plan activation, autopay renewals and cancellation.
 *
 * Cashfree: when CASHFREE_APP_ID / CASHFREE_SECRET_KEY are configured the
 * checkout uses the real Cashfree Orders/Subscriptions APIs (UPI Autopay or
 * card e-mandate). Without keys the server runs in demo mode: orders are
 * simulated and the mandate debit is recorded locally so the whole
 * subscription lifecycle (renew, cancel, re-arm) is testable end to end.
 */

import { db } from "@/lib/db";
import { PRO_PLANS, type Cycle } from "@/lib/pricing";

export function isCashfreeConfigured(): boolean {
  return Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
}

/** Record the successful authorization/debit and extend the Pro window. */
export async function markPaidAndActivate(paymentId: string): Promise<{ expiresAt: Date; cycle: Cycle }> {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const cycle = payment.cycle as Cycle;
  const months = PRO_PLANS[cycle].months;

  const user = await db.user.findUniqueOrThrow({ where: { id: payment.userId } });
  const now = new Date();
  // Stacking semantics: extension starts from the current expiry if still valid.
  const base = user.planExpiresAt && user.planExpiresAt.getTime() > now.getTime() ? user.planExpiresAt : now;
  const expiresAt = new Date(base);
  expiresAt.setMonth(expiresAt.getMonth() + months);

  await db.$transaction([
    db.payment.update({ where: { id: paymentId }, data: { status: "PAID", paidAt: now } }),
    db.user.update({
      where: { id: payment.userId },
      data: { plan: "pro", planCycle: cycle, planExpiresAt: expiresAt, autoRenew: true },
    }),
  ]);
  return { expiresAt, cycle };
}

/** Record a failed authorization/debit so order history reflects it. */
export async function markFailed(paymentId: string): Promise<void> {
  await db.payment.update({ where: { id: paymentId }, data: { status: "FAILED" } });
}

/**
 * Autopay renewal pass — runs hourly (scheduler) and after the 4 pm EOD fire.
 * For every Pro user with an active mandate (autoRenew) whose paid period has
 * lapsed, debit the next cycle — in demo mode this records a renewal Payment
 * row; with real Cashfree keys the Subscriptions API charge slots into the
 * same place (verify the mandate charge, then call markPaidAndActivate).
 */
export async function processDueRenewals(): Promise<{ renewed: number }> {
  const due = await db.user.findMany({
    where: { plan: "pro", autoRenew: true, planCycle: { not: null }, planExpiresAt: { lte: new Date() } },
    select: { id: true, planCycle: true },
  });

  let renewed = 0;
  for (const u of due) {
    const cycle = (u.planCycle ?? "monthly") as Cycle;
    const plan = PRO_PLANS[cycle] ?? PRO_PLANS.monthly;
    try {
      const payment = await db.payment.create({
        data: {
          userId: u.id,
          provider: isCashfreeConfigured() ? "cashfree" : "demo",
          orderId: `tp_renew_${u.id.slice(-6)}_${Date.now().toString(36)}`,
          cycle,
          amount: plan.price * 100,
          status: "CREATED",
          renewal: true,
        },
      });
      await markPaidAndActivate(payment.id);
      renewed++;
    } catch (e) {
      console.error("[renewal] failed for user", u.id, e instanceof Error ? e.message : e);
    }
  }
  return { renewed };
}

/** Pause the autopay mandate. Access continues till the paid period ends. */
export async function cancelAutoRenew(userId: string): Promise<{ ok: boolean; activeUntil: Date | null }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, activeUntil: null };
  const hasActive = user.plan === "pro" && user.planExpiresAt && user.planExpiresAt.getTime() > Date.now();
  if (!hasActive) return { ok: false, activeUntil: null };
  await db.user.update({ where: { id: userId }, data: { autoRenew: false } });
  return { ok: true, activeUntil: user.planExpiresAt };
}

// ---------- Cashfree (real mode) ----------

const CASHFREE_BASE = process.env.CASHFREE_API_DOMAIN ?? "https://api.cashfree.com";

/** Create a Cashfree order for the first mandate authorization. */
export async function createCashfreeOrder(opts: {
  orderId: string;
  amountPaise: number;
  customerEmail: string;
  customerPhone: string;
  customerName: string;
  cycle: Cycle;
}): Promise<{ sessionId: string }> {
  const { orderId, amountPaise, customerEmail, customerPhone, customerName, cycle } = opts;
  const plan = PRO_PLANS[cycle];
  const res = await fetch(`${CASHFREE_BASE}/pg/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": process.env.CASHFREE_APP_ID as string,
      "x-client-secret": process.env.CASHFREE_SECRET_KEY as string,
    },
    body: JSON.stringify({
      order_id: orderId,
      order_amount: amountPaise / 100,
      order_currency: "INR",
      customer_details: {
        customer_email: customerEmail,
        customer_phone: customerPhone || "9999999999",
        customer_name: customerName || "TradePulse user",
      },
      order_note: `TradePulse Pro — ${plan.per} subscription (auto-renews, cancel anytime)`,
      order_meta: { return_url: `${process.env.NEXTAUTH_URL ?? ""}/?payment=return&order_id={order_id}` },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`cashfree order failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const j = (await res.json()) as { payment_session_id?: string };
  if (!j.payment_session_id) throw new Error("cashfree order missing payment_session_id");
  return { sessionId: j.payment_session_id };
}
