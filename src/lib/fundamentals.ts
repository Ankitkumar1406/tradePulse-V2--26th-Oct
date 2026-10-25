/**
 * Deep fundamentals fetch — one quoteSummary call per symbol covering the
 * snapshot ratios (summaryDetail / defaultKeyStatistics / financialData),
 * analyst consensus and the annual income / balance-sheet / cashflow
 * statements. Shared by scripts/fundamentals-refresh.ts (manual full pass)
 * and the background fundamentals trickle — a single source of truth for the
 * StockFundamentals unit contract:
 *
 *   - dividendYield: Yahoo returns a fraction (0.012) or a percent (1.2) —
 *     values < 1 are treated as fractions and × 100.
 *   - debtToEquity: Yahoo reports e.g. 85.5 meaning 85.5% → stored as 0.855.
 *   - margins/ROE/ROA/payout: fractions → × 100 (percent).
 *   - money fields: absolute INR.
 *   - A null field stays null — "no data", never a zero.
 */

import { yahooFetch } from "@/lib/yahoo";
import { db } from "@/lib/db";

type Norm = Record<string, number | number[] | null>;

const pct = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v * 100 : null;
const ratio = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const abs = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Yahoo mixes fractions and percents — the classic ingestion trap. */
export function normaliseDividendYield(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v < 1 ? v * 100 : v;
}

/** Yahoo reports debt/equity as a percent (85.5 = 0.855 ratio). */
export function normaliseDebtToEquity(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v > 10 ? v / 100 : v;
}

/** Numbers arrive either plain or wrapped as { raw, fmt }. */
function rawOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v && typeof v === "object" && typeof (v as { raw?: unknown }).raw === "number") {
    const n = (v as { raw: number }).raw;
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function normaliseFundamentals(
  raw: Record<string, unknown>,
  inc0: Record<string, unknown> | null,
  bal0: Record<string, unknown> | null,
  cf0: Record<string, unknown> | null,
  annuals: { eps: number[]; rev: number[]; ni: number[] }
): Norm {
  const out: Norm = {};
  out.mcap = abs(raw.marketCap);
  out.pe = abs(raw.trailingPE);
  out.pb = abs(raw.priceToBook);
  out.divYield = normaliseDividendYield(raw.dividendYield);
  out.epsTtm = abs(raw.trailingEps);
  out.bookValue = abs(raw.bookValue);
  out.roe = pct(raw.returnOnEquity);
  out.profitMargin = pct(raw.profitMargins);
  out.opMargin = pct(raw.operatingMargins);
  out.debtToEquity = normaliseDebtToEquity(raw.debtToEquity);
  out.currentRatio = ratio(raw.currentRatio);
  out.quickRatio = ratio(raw.quickRatio);
  out.ev = abs(raw.enterpriseValue);
  out.evEbitda = abs(raw.enterpriseToEbitda);
  out.evRevenue = abs(raw.enterpriseToRevenue);
  out.psTtm = abs(raw.priceToSalesTrailing12Months);
  out.dividendRate = abs(raw.dividendRate);
  out.payoutRatio = pct(raw.payoutRatio);
  out.roa = pct(raw.returnOnAssets);
  out.grossMargin = pct(raw.grossMargins);
  out.revenueTtm = abs(raw.totalRevenue);
  out.ebitda = abs(raw.ebitda);
  out.netIncome = abs(raw.netIncomeToCommon);
  // cashflow: annual statement first (real statement), snapshot as fallback
  out.ocf = abs(rawOf(cf0?.operatingCashFlow) ?? raw.operatingCashflow);
  out.fcf = abs(rawOf(cf0?.freeCashFlow) ?? raw.freeCashflow);
  out.totalDebt = abs(raw.totalDebt);
  out.totalCash = abs(raw.totalCash);
  out.sharesOut = abs(raw.sharesOutstanding);
  out.revenueGrowth = pct(raw.revenueGrowth);
  out.earningsGrowth = pct(raw.earningsGrowth);
  out.epsGrowthYoY = pct(raw.earningsQuarterlyGrowth);
  out.fwdEps = abs(raw.forwardEps);
  out.fwdPe = abs(raw.forwardPE);
  out.peg = abs(raw.trailingPegRatio ?? raw.pegRatio);
  // analyst consensus (financialData) — 1 = Strong Buy … 5 = Strong Sell
  out.analystRating = abs(raw.recommendationMean);
  out.analystCount = abs(raw.numberOfAnalystOpinions);
  out.targetPrice = abs(raw.targetMeanPrice);
  out.beta = abs(raw.beta);
  // holdings are P2 proxies — only filled when Yahoo actually returns them
  out.instHoldingPct = pct(raw.heldPercentInstitutions);
  out.insiderHoldingPct = pct(raw.heldPercentInsiders);
  // latest-FY statement figures (null when the statement is absent)
  out.totalAssets = rawOf(bal0?.totalAssets);
  out.totalLiabilities = rawOf(bal0?.totalLiabilitiesNetMinorityInterest);
  out.equity = rawOf(bal0?.stockholdersEquity);
  out.grossProfit = rawOf(inc0?.grossProfit);
  out.operatingIncome = rawOf(inc0?.operatingIncome);
  out.icf = rawOf(cf0?.investingCashFlow);
  // annual slices, newest-first, capped at 5 (schema comment: [fy0..fy4])
  out.annualEpss = annuals.eps.slice(0, 5);
  out.annualRevenues = annuals.rev.slice(0, 5);
  out.annualNetProfits = annuals.ni.slice(0, 5);
  return out;
}

interface QuoteSummaryResp {
  quoteSummary?: {
    result?: {
      summaryDetail?: Record<string, unknown>;
      defaultKeyStatistics?: Record<string, unknown>;
      financialData?: Record<string, unknown>;
      incomeStatementHistory?: { incomeStatementHistory?: Record<string, unknown>[] };
      cashflowStatementHistory?: { cashflowStatements?: Record<string, unknown>[] };
      balanceSheetHistory?: { balanceSheetStatements?: Record<string, unknown>[] };
    }[];
  };
}

/** Fetch + normalise the full fundamentals payload for one symbol. */
export async function fetchFundamentalsFor(symbol: string): Promise<Norm | null> {
  try {
    const d = await yahooFetch<QuoteSummaryResp>({
      url: `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
      query: {
        modules:
          "summaryDetail,defaultKeyStatistics,financialData,incomeStatementHistory,cashflowStatementHistory,balanceSheetHistory",
      },
      timeoutMs: 25000,
      retries: 1,
    });
    const r = d.quoteSummary?.result?.[0];
    if (!r) return null;
    // flatten { field: { raw: x } } wrappers into plain numbers
    const flat: Record<string, unknown> = {};
    for (const section of [r.summaryDetail, r.defaultKeyStatistics, r.financialData]) {
      for (const [k, v] of Object.entries(section ?? {})) {
        if (v && typeof v === "object" && "raw" in (v as Record<string, unknown>)) {
          flat[k] = (v as { raw?: unknown }).raw;
        }
      }
    }
    const incArr = r.incomeStatementHistory?.incomeStatementHistory ?? [];
    const inc0 = incArr[0] ?? null;
    const bal0 = (r.balanceSheetHistory?.balanceSheetStatements ?? [])[0] ?? null;
    const cf0 = (r.cashflowStatementHistory?.cashflowStatements ?? [])[0] ?? null;
    const annuals = {
      eps: incArr.map((s) => rawOf(s.trailingEps)).filter((v): v is number => v != null),
      rev: incArr.map((s) => rawOf(s.totalRevenue)).filter((v): v is number => v != null),
      ni: incArr.map((s) => rawOf(s.netIncome)).filter((v): v is number => v != null),
    };
    return normaliseFundamentals(flat, inc0, bal0, cf0, annuals);
  } catch {
    return null;
  }
}

/** Upsert the normalised payload, null-preserving (missing ≠ wipe). */
export async function upsertFundamentals(symbol: string, norm: Norm | null): Promise<boolean> {
  const fields = Object.entries(norm ?? {}).filter(([, v]) => {
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
  try {
    if (fields.length > 0) {
      await db.stockFundamentals.upsert({
        where: { symbol },
        create: { symbol, ...(Object.fromEntries(fields) as Record<string, never>) },
        update: { fetchedAt: new Date(), ...(Object.fromEntries(fields) as Record<string, never>) },
      });
      return true;
    }
    // keep the row (so "missing" tracking works) but refresh the timestamp
    await db.stockFundamentals.upsert({
      where: { symbol },
      create: { symbol },
      update: { fetchedAt: new Date() },
    });
    return false;
  } catch {
    return false;
  }
}
