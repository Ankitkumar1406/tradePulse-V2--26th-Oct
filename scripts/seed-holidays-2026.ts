/**
 * Seed the official NSE 2026 Equity/Derivatives trading-holiday calendar into
 * MarketEvent (category="holiday"). This table drives:
 *   - prevSessionDateIso() → expectedLatestBarDate() → the metrics/scans
 *     pipeline's EOD target date, and the bars-trickle staleness predicate.
 *
 * Missing entries DEADLOCK the pipeline on a no-bars date: on 2026-10-20
 * (Dussehra) an empty calendar made expectedLatestBarDate() return the
 * holiday itself → zero DailyBar rows → "bars-incomplete" forever →
 * StockMetrics/ScanResults empty, screener frozen at stale data.
 *
 * Sources (cross-validated):
 *   - NSE/BSE official trading-holiday list 2026 (nseindia.com / bseindia.com)
 *   - Yahoo ^NSEI actual session gaps for Jan–Oct 2026 — every derived gap
 *     matches this list exactly (Jan 26, Mar 3, Mar 26, Mar 31, Apr 3,
 *     Apr 14, May 1, May 28, Jun 26, Sep 14, Oct 2, Oct 20).
 *
 * NOTE: re-run each December when NSE publishes the next year's list — the
 * 2027 calendar is NOT seeded here (do not guess movable festivals).
 * Idempotent: upsert on the stable `key`.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

interface Holiday {
  date: string;
  title: string;
}

// Official NSE 2026 equity segment list — all weekdays (weekend festivals
// like Maha Shivaratri Sun 15 Feb, Eid-ul-Fitr Sat 21 Mar, Independence Day
// Sat 15 Aug, Diwali Laxmi Pujan Sun 08 Nov need no entry: weekends are
// already skipped by the calendar math).
const NSE_2026_HOLIDAYS: Holiday[] = [
  { date: "2026-01-15", title: "Municipal Corporation Election (Maharashtra)" },
  { date: "2026-01-26", title: "Republic Day" },
  { date: "2026-03-03", title: "Holi" },
  { date: "2026-03-26", title: "Shri Ram Navami" },
  { date: "2026-03-31", title: "Shri Mahavir Jayanti" },
  { date: "2026-04-03", title: "Good Friday" },
  { date: "2026-04-14", title: "Dr. Baba Saheb Ambedkar Jayanti" },
  { date: "2026-05-01", title: "Maharashtra Day" },
  { date: "2026-05-28", title: "Bakri Id" },
  { date: "2026-06-26", title: "Muharram" },
  { date: "2026-09-14", title: "Ganesh Chaturthi" },
  { date: "2026-10-02", title: "Mahatma Gandhi Jayanti" },
  { date: "2026-10-20", title: "Dussehra" },
  { date: "2026-11-10", title: "Diwali Balipratipada" },
  { date: "2026-11-24", title: "Prakash Gurpurb Sri Guru Nanak Dev Jayanti" },
  { date: "2026-12-25", title: "Christmas" },
];

async function main() {
  let created = 0;
  let updated = 0;
  for (const h of NSE_2026_HOLIDAYS) {
    const key = `nse-holiday-${h.date}`;
    const existing = await db.marketEvent.findUnique({ where: { key } });
    if (existing) {
      if (existing.category !== "holiday" || existing.date !== h.date) {
        await db.marketEvent.update({
          where: { key },
          data: { date: h.date, title: h.title, category: "holiday", impact: "high", source: "NSE", tentative: false },
        });
        updated++;
      }
    } else {
      await db.marketEvent.create({
        data: {
          key,
          date: h.date,
          title: h.title,
          category: "holiday",
          impact: "high",
          source: "NSE",
          tentative: false,
          description: `${h.title} — NSE equity & equity-derivatives segment closed.`,
        },
      });
      created++;
    }
  }
  const total = await db.marketEvent.count({ where: { category: "holiday" } });
  console.log(`[seed] NSE 2026 holidays: ${created} created, ${updated} updated, ${total} holiday rows total`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
