/**
 * Yahoo Finance client for the NSE universe.
 * Handles cookie + crumb auth, browser UA, retries and rate-limit etiquette.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const QUERY1 = "https://query1.finance.yahoo.com";
const QUERY2 = "https://query2.finance.yahoo.com";

interface CrumbState {
  cookie: string;
  crumb: string;
  fetchedAt: number;
}

const g = globalThis as unknown as { __yahooCrumb?: CrumbState };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureCrumb(force = false): Promise<CrumbState> {
  const cached = g.__yahooCrumb;
  if (!force && cached && Date.now() - cached.fetchedAt < 12 * 60 * 1000) {
    return cached;
  }
  const headers = { "User-Agent": UA, Accept: "*/*" };
  let cookie = "";
  try {
    const r = await fetch("https://fc.yahoo.com", {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    const setCookies = r.headers.getSetCookie?.() ?? [];
    cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
    if (!cookie) {
      const raw = r.headers.get("set-cookie");
      if (raw) cookie = raw.split(/,(?=[^;]+=)/).map((c) => c.split(";")[0]).join("; ");
    }
  } catch {
    /* cookie optional on some deployments */
  }
  const r2 = await fetch(`${QUERY2}/v1/test/getcrumb`, {
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(10000),
  });
  if (!r2.ok) throw new Error(`crumb fetch failed: ${r2.status}`);
  const crumb = (await r2.text()).trim();
  if (!crumb || crumb.length > 40) throw new Error("invalid crumb");
  const state: CrumbState = { cookie, crumb, fetchedAt: Date.now() };
  g.__yahooCrumb = state;
  return state;
}

interface FetchOpts {
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
  /** Return an error string for app-level failures delivered with HTTP 200. */
  validate?: (json: unknown) => string | null;
}

/** Authenticated JSON fetch with retry + crumb refresh on failure. */
export async function yahooFetch<T>(opts: FetchOpts): Promise<T> {
  const { url, method = "GET", body, query, validate, retries = 2, timeoutMs = 20000 } = opts;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const crumbState = await ensureCrumb(attempt > 0);
      const u = new URL(url);
      if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
      if (url.includes("query2") && url.includes("/v1/finance/screener") && !u.searchParams.has("crumb")) {
        u.searchParams.set("crumb", crumbState.crumb);
      }
      const headers: Record<string, string> = {
        "User-Agent": UA,
        Accept: "application/json",
        Referer: "https://finance.yahoo.com/",
      };
      if (crumbState.cookie) headers.Cookie = crumbState.cookie;
      if (!u.searchParams.has("crumb") && needsCrumb(url)) u.searchParams.set("crumb", crumbState.crumb);
      if (method === "POST") headers["Content-Type"] = "application/json";

      const res = await fetch(u.toString(), {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status === 401 || res.status === 403) {
        await ensureCrumb(true);
        lastErr = new Error(`auth ${res.status}`);
        continue;
      }
      if (res.status === 429) {
        // Rotate cookie+crumb: stale cookies often trigger throttles
        await ensureCrumb(true).catch(() => {});
        await sleep(1500 + attempt * 2500);
        lastErr = new Error("rate limited");
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
        if (res.status >= 500) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        throw lastErr;
      }
      const json = (await res.json()) as T;
      if (validate) {
        const appErr = validate(json);
        if (appErr) {
          lastErr = new Error(appErr);
          const lower = appErr.toLowerCase();
          if (lower.includes("cookie") || lower.includes("crumb") || lower.includes("token") || lower.includes("auth")) {
            await ensureCrumb(true).catch(() => {});
          }
          if (attempt < retries) {
            await sleep(500 * (attempt + 1));
            continue;
          }
          throw lastErr;
        }
      }
      return json;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries) await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("yahooFetch failed");
}

function needsCrumb(url: string): boolean {
  return url.includes("/v7/finance/spark") || url.includes("/v10/finance/quoteSummary");
}

// ---------- Types ----------

export interface ScreenerQuote {
  symbol: string;
  shortName?: string;
  longName?: string;
  exchange?: string;
  fullExchangeName?: string;
  marketCap?: number;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketChangePercent?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  averageDailyVolume3Month?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
  trailingPE?: number;
  epsTrailingTwelveMonths?: number;
  bookValue?: number;
  priceToBook?: number;
  trailingAnnualDividendYield?: number;
  regularMarketTime?: number;
}

export interface SparkPoint {
  symbol: string;
  timestamp: number[];
  close: (number | null)[];
}

export interface ChartResult {
  meta: { symbol: string; regularMarketPrice?: number };
  timestamp: number[];
  indicators: {
    quote: {
      open: (number | null)[];
      high: (number | null)[];
      low: (number | null)[];
      close: (number | null)[];
      volume: (number | null)[];
    }[];
  };
}

// ---------- API wrappers ----------

export const SCREENER_URL = `${QUERY2}/v1/finance/screener`;

export function screenerBody(offset: number, size = 250) {
  return {
    size,
    offset,
    sortField: "eodprice",
    sortType: "DESC",
    quoteType: "equity",
    query: { operator: "EQ", operands: ["exchange", "NSI"] },
    userId: "",
    userIdType: "guid",
  };
}

interface ScreenerResp {
  finance: { result: { total: number; quotes: ScreenerQuote[] }[] };
}

export async function fetchUniversePage(offset: number, size = 250): Promise<{ total: number; quotes: ScreenerQuote[] }> {
  const d = await yahooFetch<ScreenerResp>({
    url: SCREENER_URL,
    method: "POST",
    body: screenerBody(offset, size),
    timeoutMs: 25000,
  });
  const r = d.finance?.result?.[0];
  return { total: r?.total ?? 0, quotes: r?.quotes ?? [] };
}

export async function fetchSpark(symbols: string[], range = "2y"): Promise<SparkPoint[]> {
  const fetchOnce = async (syms: string[]): Promise<SparkPoint[]> => {
    const d = await yahooFetch<{
      spark: {
        result: { symbol: string; response: { timestamp: number[]; indicators: { quote: { close: (number | null)[] }[] } }[] }[] | null;
        error?: { description?: string; code?: string };
      } | null;
    }>({
      url: `${QUERY1}/v7/finance/spark`,
      query: { symbols: syms.join(","), range, interval: "1d" },
      timeoutMs: 30000,
      // Spark serves app-level errors with HTTP 200 -> surface them so the
      // retry loop can rotate the stale cookie/crumb and try again.
      validate: (raw) => {
        const s = raw as { spark?: { error?: { description?: string; code?: string } } | null };
        if (s?.spark?.error) {
          return `spark app error: ${s.spark.error.description ?? s.spark.error.code ?? "unknown"}`;
        }
        return null;
      },
    });
    const result = d.spark?.result ?? [];
    return result
      .filter((r) => r.response?.[0]?.timestamp)
      .map((r) => ({
        symbol: r.symbol,
        timestamp: r.response[0].timestamp,
        close: r.response[0].indicators.quote[0].close,
      }));
  };

  const first = await fetchOnce(symbols);
  // Spark sometimes silently drops individual symbols; retry missing ones once.
  const got = new Set(first.map((p) => p.symbol));
  const missing = symbols.filter((s) => !got.has(s));
  if (missing.length === 0) return first;
  try {
    await sleep(400);
    const second = await fetchOnce(missing);
    return [...first, ...second];
  } catch {
    return first;
  }
}

export async function fetchChart(symbol: string, range = "2y"): Promise<ChartResult> {
  const d = await yahooFetch<{ chart: { result: ChartResult[]; error: unknown } }>({
    url: `${QUERY2}/v8/finance/chart/${encodeURIComponent(symbol)}`,
    query: { range, interval: "1d", includePrePost: "false" },
    timeoutMs: 25000,
  });
  const r = d.chart?.result?.[0];
  if (!r || !r.timestamp) throw new Error(`no chart data for ${symbol}`);
  return r;
}

export interface AssetProfile {
  sector?: string;
  industry?: string;
  longBusinessSummary?: string;
}

export async function fetchAssetProfile(symbol: string): Promise<AssetProfile | null> {
  try {
    const d = await yahooFetch<{
      quoteSummary: { result: { assetProfile: AssetProfile }[] };
    }>({
      url: `${QUERY2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
      query: { modules: "assetProfile" },
      timeoutMs: 20000,
      retries: 1,
    });
    return d.quoteSummary?.result?.[0]?.assetProfile ?? null;
  } catch {
    return null;
  }
}

export interface CalendarEvents {
  earnings?: { earningsDate?: { startDate?: string; raw?: number; fmt?: string }[] };
}

/**
 * Next (estimated) earnings date. Yahoo ships two payload shapes for
 * `calendarEvents.earnings.earningsDate[0]`:
 *   - US markets: `{ startDate: "2026-10-16" }`
 *   - NSE & most others: `{ raw: 1792144800, fmt: "2026-10-16" }`
 * The old parser only read `startDate`, so every NSE name resolved to null
 * and the earnings-date column (plus the Earnings Gap Up / Positive Earnings
 * scans) stayed permanently empty.
 *
 * Returns `undefined` on transport failure so callers can leave a stored
 * value untouched, vs `null` for a successful "Yahoo has no date" response.
 */
export async function fetchEarningsDate(symbol: string): Promise<Date | null | undefined> {
  try {
    const d = await yahooFetch<{
      quoteSummary: { result: { calendarEvents?: CalendarEvents }[] };
    }>({
      url: `${QUERY2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
      query: { modules: "calendarEvents" },
      timeoutMs: 20000,
      retries: 1,
    });
    const ed = d.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate?.[0] as
      | { startDate?: string; raw?: number; fmt?: string }
      | undefined;
    // prefer the preformatted date string; fall back to the epoch `raw`
    const iso =
      typeof ed?.startDate === "string"
        ? ed.startDate
        : typeof ed?.fmt === "string"
          ? ed.fmt
          : typeof ed?.raw === "number"
            ? new Date(ed.raw * 1000).toISOString().slice(0, 10)
            : undefined;
    if (!iso) return null;
    const dt = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(dt.getTime()) ? null : dt;
  } catch {
    return undefined; // transport error — do NOT let callers wipe a good value
  }
}

// ---------------------------------------------------------------- financials

export interface QuarterlyFinancials {
  /** Latest quarter diluted EPS vs the year-ago quarter (decimal, 0.35 = +35%). */
  epsQuarterlyGrowth: number | null;
  /** Latest quarter totalRevenue vs the prior quarter (decimal). */
  revenueQoQGrowth: number | null;
  /** 3-year net-income CAGR from the annual income statement (decimal). */
  netIncome3YCagr: number | null;
}

interface IncomeStmt {
  totalRevenue?: { raw?: number } | null;
  netIncome?: { raw?: number } | null;
}

/**
 * Quarterly/annual financials for the EPS score and Trader Choice 7 — one
 * quoteSummary call with the three modules we need. Missing data resolves to
 * null per field (Yahoo omits whole statements for some listed names).
 */
export async function fetchFinancials(symbol: string): Promise<QuarterlyFinancials | null> {
  try {
    const d = await yahooFetch<{
      quoteSummary: {
        result: {
          defaultKeyStatistics?: { earningsQuarterlyGrowth?: unknown };
          incomeStatementHistory?: { incomeStatementHistory?: IncomeStmt[] };
          incomeStatementHistoryQuarterly?: { incomeStatementHistory?: IncomeStmt[] };
        }[];
      };
    }>({
      url: `${QUERY2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
      query: { modules: "defaultKeyStatistics,incomeStatementHistory,incomeStatementHistoryQuarterly" },
      timeoutMs: 20000,
      retries: 1,
    });
    const r = d.quoteSummary?.result?.[0];
    if (!r) return null;

    /** Yahoo quoteSummary returns numbers either as plain numbers or as
     *  { raw: number, fmt: string } — normalise both to a number. */
    const rawOf = (v: unknown): number | null => {
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (v && typeof v === "object" && typeof (v as { raw?: unknown }).raw === "number") {
        const n = (v as { raw: number }).raw;
        return Number.isFinite(n) ? n : null;
      }
      return null;
    };

    // EPS diluted growth YoY — Yahoo's own precomputed field, else derive it
    // from the quarterly net-income series (best-effort fallback).
    let epsQ: number | null = rawOf(r.defaultKeyStatistics?.earningsQuarterlyGrowth);
    const qStmts = r.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];
    if (epsQ == null && qStmts.length >= 2) {
      const ni0 = rawOf(qStmts[0]?.netIncome);
      const ni1 = rawOf(qStmts[1]?.netIncome);
      if (ni0 != null && ni1 != null && ni1 !== 0) epsQ = ni0 / Math.abs(ni1) - 1;
    }

    // Revenue QoQ — latest vs prior quarter (array is newest-first)
    let revQoQ: number | null = null;
    if (qStmts.length >= 2) {
      const r0 = rawOf(qStmts[0]?.totalRevenue);
      const r1 = rawOf(qStmts[1]?.totalRevenue);
      if (r0 != null && r1 != null && r1 !== 0) revQoQ = r0 / r1 - 1;
    }

    // 3-year net income CAGR — needs the annual statement with ≥4 years
    let cagr: number | null = null;
    const aStmts = r.incomeStatementHistory?.incomeStatementHistory ?? [];
    if (aStmts.length >= 4) {
      const latest = rawOf(aStmts[0]?.netIncome);
      const oldest = rawOf(aStmts[3]?.netIncome);
      if (latest != null && oldest != null && oldest > 0 && latest > 0) {
        cagr = Math.pow(latest / oldest, 1 / 3) - 1;
      }
    }

    return { epsQuarterlyGrowth: epsQ, revenueQoQGrowth: revQoQ, netIncome3YCagr: cagr };
  } catch {
    return null;
  }
}

export interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
}

const INDEX_DEFS: { symbol: string; name: string }[] = [
  { symbol: "^NSEI", name: "NIFTY 50" },
  { symbol: "^NSEBANK", name: "BANK NIFTY" },
  { symbol: "^BSESN", name: "SENSEX" },
  { symbol: "^CNXIT", name: "NIFTY IT" },
  // NIFTY MIDCAP 100 — the old ^CNXMIDCAP Yahoo symbol is dead (404); the
  // .NS-listed index feed is the live replacement.
  { symbol: "NIFTY_MIDCAP_100.NS", name: "NIFTY MIDCAP 100" },
  { symbol: "^INDIAVIX", name: "INDIA VIX" },
];

export async function fetchIndices(): Promise<IndexQuote[]> {
  const results = await Promise.all(
    INDEX_DEFS.map(async (def) => {
      try {
        const chart = await fetchChart(def.symbol, "5d");
        const closes = chart.indicators.quote[0].close.filter((c): c is number => c != null);
        const price = closes[closes.length - 1] ?? chart.meta.regularMarketPrice ?? 0;
        const prev = closes.length > 1 ? closes[closes.length - 2] : price;
        return {
          symbol: def.symbol,
          name: def.name,
          price,
          changePct: prev ? ((price - prev) / prev) * 100 : 0,
        };
      } catch {
        return { symbol: def.symbol, name: def.name, price: 0, changePct: 0 };
      }
    })
  );
  return results;
}
