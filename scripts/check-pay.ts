import { db } from "../src/lib/db";
const u = await db.user.findUnique({ where: { email: "kavya.menon@gmail.com" }, select: { email: true, plan: true, planCycle: true, planExpiresAt: true, trialEndsAt: true } });
console.log("user:", JSON.stringify(u));
const p = await db.payment.findMany({ orderBy: { createdAt: "desc" }, take: 3 });
console.log("payments:", JSON.stringify(p.map(x => ({ orderId: x.orderId, provider: x.provider, cycle: x.cycle, amount: x.amount, status: x.status, paidAt: x.paidAt }))));
