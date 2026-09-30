import { db } from "../src/lib/db";
const users = await db.user.findMany({
  where: { email: { contains: "kavya" } },
  select: { email: true, onboarded: true, plan: true, trialEndsAt: true, planExpiresAt: true, createdAt: true },
});
console.log(JSON.stringify(users, null, 2));
const payments = await db.payment.findMany();
console.log("payments:", payments.length);
