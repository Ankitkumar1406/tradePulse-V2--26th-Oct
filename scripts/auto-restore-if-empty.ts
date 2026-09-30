/**
 * auto-restore-if-empty.ts — cold-start data self-heal.
 *
 * Runs in the background from .zscripts/dev.sh after the dev server is healthy.
 * When the PostgreSQL universe is missing (fresh pgdata after a platform cold
 * start — the tarball snapshot excludes it), rebuild everything from the
 * SQLite backup that IS snapshotted:
 *
 *   1. gunzip backups/custom-*.db.gz -> db/custom.db (if absent)
 *   2. scripts/migrate-sqlite-to-pg.ts   (bars + stocks, ~1 min)
 *   3. scripts/restore-precompute.ts     (metrics + 39 scans, ~3 min)
 *   4. scripts/fundamentals-refresh.ts   (Yahoo, ~2.5 min)
 *   5. scripts/compute-ratings.ts        (RS/EPS/A-D, ~30 s)
 *
 * No-op (and safe to run any number of times) when the universe is present.
 * A /tmp lock prevents double-runs. Log: /tmp/auto-restore.log
 */
/// <reference types="bun-types" />
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const LOCK = "/tmp/tp-auto-restore.lock";
const MIN_STOCKS = 100;

const log = (m: string) => console.log(`[auto-restore ${new Date().toISOString()}] ${m}`);

async function alreadyRunning(): Promise<boolean> {
  try {
    const pid = Number(await Bun.file(LOCK).text());
    if (Number.isFinite(pid) && pid > 0) {
      process.kill(pid, 0); // throws if not alive
      return true;
    }
  } catch {
    /* stale or missing lock */
  }
  return false;
}

const db = new PrismaClient();
try {
  if (await alreadyRunning()) {
    log("another run holds the lock — exiting");
    process.exit(0);
  }
  writeFileSync(LOCK, String(process.pid));

  const stocks = await db.stock.count();
  if (stocks >= MIN_STOCKS) {
    log(`universe present (${stocks} stocks) — nothing to do`);
    process.exit(0);
  }
  log(`universe missing (${stocks} stocks) — starting full restore`);

  const step = (cmd: string) => {
    log(`STEP: ${cmd}`);
    execSync(cmd, { cwd: "/home/z/my-project", stdio: "inherit", timeout: 15 * 60_000 });
  };

  // 1. SQLite backup present? (prefer newest gz in backups/)
  if (!existsSync("/home/z/my-project/db/custom.db")) {
    const gz = readdirSync("/home/z/my-project/backups")
      .filter((f) => f.startsWith("custom-") && f.endsWith(".db.gz"))
      .map((f) => `/home/z/my-project/backups/${f}`)
      .sort()
      .pop();
    if (!gz) throw new Error("no SQLite backup found in backups/ — cannot self-heal");
    log(`restoring SQLite from ${gz} (${(statSync(gz).size / 1e6).toFixed(1)} MB)`);
    execSync("mkdir -p /home/z/my-project/db", { stdio: "inherit" });
    execSync(`gunzip -kc "${gz}" > /home/z/my-project/db/custom.db`, { stdio: "inherit" });
  }

  // 2-5. data + derived artifacts
  step("bun run scripts/migrate-sqlite-to-pg.ts");
  step("bun run scripts/restore-precompute.ts");
  step("bun run scripts/fundamentals-refresh.ts");
  step("bun run scripts/compute-ratings.ts");

  const after = await db.stock.count();
  log(`restore complete — ${after} stocks back in the universe`);
} catch (e) {
  console.error("[auto-restore] FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  try {
    execSync(`rm -f ${LOCK}`);
  } catch {
    /* ignore */
  }
  await db.$disconnect();
}
