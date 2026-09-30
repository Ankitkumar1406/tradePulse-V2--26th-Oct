// Cashfree Payment Gateway server client — wraps the official Node SDK
// (github.com/cashfree/cashfree-pg-sdk-nodejs, npm: cashfree-pg).
//
// Credentials (merchant dashboard -> API keys):
//   CASHFREE_APP_ID      x-client-id
//   CASHFREE_SECRET_KEY  x-client-secret
//   CASHFREE_ENV         "sandbox" (default) | "production"
//
// When credentials are absent the payments API falls back to a clearly
// labelled demo checkout so the full upgrade flow stays testable.

import { Cashfree, CFEnvironment } from "cashfree-pg";

export const CASHFREE_ENABLED = !!(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);

export function cashfreeMode(): "sandbox" | "production" {
  return process.env.CASHFREE_ENV === "production" ? "production" : "sandbox";
}

let cached: Cashfree | null = null;

function client(): Cashfree {
  if (!CASHFREE_ENABLED) throw new Error("Cashfree credentials are not configured");
  if (!cached) {
    const env = cashfreeMode() === "production" ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;
    cached = new Cashfree(env, process.env.CASHFREE_APP_ID!, process.env.CASHFREE_SECRET_KEY!);
  }
  return cached;
}

export interface CreateOrderInput {
  orderId: string;
  amountInPaise: number;
  customerId: string;
  customerPhone: string; // 10-digit Indian mobile (no +91)
  customerEmail: string;
  returnUrl: string; // absolute URL with {order_id} placeholder
}

export interface CashfreeOrder {
  orderId: string;
  paymentSessionId: string;
  orderStatus: string;
}

/** Create a Cashfree PG order and return its checkout session id. */
export async function createCashfreeOrder(input: CreateOrderInput): Promise<CashfreeOrder> {
  const res = await client().PGCreateOrder({
    order_id: input.orderId,
    order_amount: input.amountInPaise / 100,
    order_currency: "INR",
    customer_details: {
      customer_id: input.customerId,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone,
    },
    order_meta: {
      return_url: input.returnUrl,
    },
    order_note: "TradePulse Pro subscription",
  });

  const data = res.data as {
    order_id?: string;
    payment_session_id?: string;
    order_status?: string;
  };
  if (!data?.payment_session_id) {
    throw new Error("Cashfree did not return a payment session id");
  }
  return {
    orderId: data.order_id ?? input.orderId,
    paymentSessionId: data.payment_session_id,
    orderStatus: data.order_status ?? "ACTIVE",
  };
}

/** Fetch the latest order status (PAID | ACTIVE | EXPIRED ...). */
export async function fetchCashfreeOrderStatus(orderId: string): Promise<string> {
  const res = await client().PGFetchOrder(orderId);
  const data = res.data as { order_status?: string };
  return data?.order_status ?? "UNKNOWN";
}

/** Verify a webhook's signature header (throws when invalid). */
export function verifyWebhookSignature(signature: string, rawBody: string, timestamp: string): void {
  client().PGVerifyWebhookSignature(signature, rawBody, timestamp);
}

/** Extract a readable message from an axios-shaped SDK error. */
export function cashfreeErrorMessage(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? "Cashfree request failed";
}
