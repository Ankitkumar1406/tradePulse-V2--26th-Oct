import { runClosesPhase } from "../src/lib/sync";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
runClosesPhase({ staleCutoff: new Date() })
  .then(async () => {
    const withAth = await db.stock.count({ where: { fromAthPct: { not: null } } });
    const with3y = await db.stock.count({ where: { mom3Y: { not: null } } });
    console.log(`[closes6y] done — fromAthPct filled: ${withAth}, mom3Y filled: ${with3y}`);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
