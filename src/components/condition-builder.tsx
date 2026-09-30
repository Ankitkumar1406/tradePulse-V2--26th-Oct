"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  Info,
  Plus,
  RotateCcw,
  Sigma,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExprEditor } from "@/components/expr-editor";
import { expandUnitSuffixes, isScalarOnly, parseNumWithUnits, parseProExpr, type SeriesField } from "@/lib/pro-expr";
import {
  Pager,
  ResultsTable,
  SORTS,
  type StocksResponse,
  csvDate,
  exportCsv,
} from "@/components/screener-tables";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * The condition builder (Task 55) — reads as a sentence of clickable pills:
 *
 *   [Latest ▾] [Close ▾] [is greater than ▾] [SMA(Close) 200 ▾]
 *
 *   · one row type; both sides are terms — a number (3cr unit shortcuts
 *     welcome), a catalog field, or a free-form expression
 *   · timeframe + bars-ago merged into ONE pill (Latest / 2 candles ago /
 *     Weekly / 3 weeks ago …); window params open a small token editor
 *   · plain-word operators; a single right-side value pill with
 *     Number / Indicator / Expression tabs
 *   · strict grid, hover row actions (duplicate / delete), light "and"
 *     separators, amber OR-groups (A AND (B OR C) reads exactly as boxed)
 *   · pattern rows — one wire row for "N consecutive higher weekly highs"
 *   · Universe & filters bar so baseline filters never take scan slots
 *   · live match counter, bidirectional text view, computed-value columns
 *
 * Rows serialize to the v2 wire format ({v:2, rows}) compiled by pro-sql.ts,
 * which evaluates the same AND-of-OR-groups semantics the boxes show.
 */

// ================================================================ terms & rows

export type CondOp =
  | "gt" | "gte" | "lt" | "lte" | "eq" | "between"
  | "crossAbove" | "crossBelow" | "withinPct";

export type Term =
  | { mode: "num"; v: string }
  | { mode: "field"; f: string; tf: "d" | "w"; off: number; p: number }
  | { mode: "expr"; src: string };

/** Cross-bar pattern row — one wire row instead of N stacked lag comparisons. */
export interface RowPattern {
  pattern: "higherHighs" | "lowerLows";
  tf: "d" | "w";
  n: number;
}

export interface V2Row {
  id: number;
  logic: "and" | "or"; // connector to the PREVIOUS row (row 0 ignores it)
  op: CondOp;
  left: Term;
  right: Term;
  right2: Term | null; // between only
  pct: string; // withinPct — percent width, kept as input string
  pat?: RowPattern; // when present the row renders + compiles as a pattern
}

export const MAX_BUILDER_ROWS = 50;
export const MAX_PATTERN_N = 20;

let rowSeq = 1;
const nextRowId = () => rowSeq++;

// ================================================================ field catalog

interface SeriesSpec { id: string; kind: "series"; f: SeriesField; label: string; hint?: string }
interface WindowSpec { id: string; kind: "window"; fn: "sma" | "min" | "max"; ser: SeriesField; p: number; label: string; hint?: string }
interface ScalarSpec { id: string; kind: "scalar"; f: string; label: string; scale?: number; hint?: string }
type FieldSpec = SeriesSpec | WindowSpec | ScalarSpec;

/** Field catalog — ids are stable (saved screens store them). */
const FIELD_CATALOG: FieldSpec[] = [
  // Price & volume
  { id: "open", kind: "series", f: "open", label: "Open", hint: "e.g. 500" },
  { id: "high", kind: "series", f: "high", label: "High", hint: "e.g. 500" },
  { id: "low", kind: "series", f: "low", label: "Low", hint: "e.g. 500" },
  { id: "close", kind: "series", f: "close", label: "Close (price)", hint: "e.g. 500" },
  { id: "volume", kind: "series", f: "volume", label: "Volume (shares)", hint: "e.g. 1000000 or 10l" },
  // Moving averages & ranges
  { id: "smaClose", kind: "window", fn: "sma", ser: "close", p: 50, label: "SMA (close, N)", hint: "e.g. 200" },
  { id: "smaVolume", kind: "window", fn: "sma", ser: "volume", p: 20, label: "SMA (volume, N)", hint: "e.g. 1000000" },
  { id: "maxHigh", kind: "window", fn: "max", ser: "high", p: 20, label: "Highest high (N bars)", hint: "e.g. 500" },
  { id: "minLow", kind: "window", fn: "min", ser: "low", p: 66, label: "Lowest low (N bars)", hint: "e.g. 400" },
  // Momentum & oscillators
  { id: "rsi14", kind: "scalar", f: "rsi14", label: "RSI (14) · daily", hint: "e.g. 30" },
  { id: "wRsi14", kind: "scalar", f: "wRsi14", label: "RSI (14) · weekly", hint: "e.g. 50" },
  { id: "macdHist", kind: "scalar", f: "macdHist", label: "MACD histogram · daily", hint: "e.g. 0" },
  { id: "wMacdHist", kind: "scalar", f: "wMacdHist", label: "MACD histogram · weekly", hint: "e.g. 0" },
  { id: "mom1M", kind: "scalar", f: "mom1M", label: "1M return %", hint: "e.g. 5" },
  { id: "mom3M", kind: "scalar", f: "mom3M", label: "3M return %", hint: "e.g. 10" },
  { id: "mom6M", kind: "scalar", f: "mom6M", label: "6M return %", hint: "e.g. 20" },
  { id: "atr14Pct", kind: "scalar", f: "atr14Pct", label: "ATR % (volatility)", hint: "e.g. 3" },
  { id: "bbPctB", kind: "scalar", f: "bbPctB", label: "Bollinger %B", hint: "e.g. 80" },
  { id: "bbWidthPct", kind: "scalar", f: "bbWidthPct", label: "Bollinger width %", hint: "e.g. 5" },
  // Snapshot & fundamentals
  { id: "marketCap", kind: "scalar", f: "marketCap", scale: 1e7, label: "Market cap (₹ Cr)", hint: "e.g. 5000 or 5000cr" },
  { id: "peTTM", kind: "scalar", f: "peTTM", label: "P/E (TTM)", hint: "e.g. 25" },
  { id: "pbRatio", kind: "scalar", f: "pbRatio", label: "P/B ratio", hint: "e.g. 3" },
  { id: "divYield", kind: "scalar", f: "divYield", label: "Dividend yield %", hint: "e.g. 1" },
  { id: "avgVol3M", kind: "scalar", f: "avgVol3M", label: "Avg volume (3M shares)", hint: "e.g. 500000" },
  { id: "changePct", kind: "scalar", f: "changePct", label: "Day change %", hint: "e.g. 2" },
  { id: "fromHighPct", kind: "scalar", f: "fromHighPct", label: "% below 52W high", hint: "e.g. 10" },
  { id: "fromLowPct", kind: "scalar", f: "fromLowPct", label: "% above 52W low", hint: "e.g. 30" },
  { id: "distSma20Pct", kind: "scalar", f: "distSma20Pct", label: "Price vs SMA 20 %", hint: "e.g. 3" },
  { id: "distSma50Pct", kind: "scalar", f: "distSma50Pct", label: "Price vs SMA 50 %", hint: "e.g. 5" },
  { id: "distSma100Pct", kind: "scalar", f: "distSma100Pct", label: "Price vs SMA 100 %", hint: "e.g. 8" },
  { id: "distSma200Pct", kind: "scalar", f: "distSma200Pct", label: "Price vs SMA 200 %", hint: "e.g. 12" },
  { id: "distEma20Pct", kind: "scalar", f: "distEma20Pct", label: "Price vs EMA 20 %", hint: "e.g. 3" },
  { id: "distEma50Pct", kind: "scalar", f: "distEma50Pct", label: "Price vs EMA 50 %", hint: "e.g. 5" },
  { id: "distEma100Pct", kind: "scalar", f: "distEma100Pct", label: "Price vs EMA 100 %", hint: "e.g. 8" },
  { id: "distEma200Pct", kind: "scalar", f: "distEma200Pct", label: "Price vs EMA 200 %", hint: "e.g. 12" },
  { id: "rsRating", kind: "scalar", f: "rsRating", label: "RS Rating (1–99)", hint: "e.g. 70" },
  { id: "epsScore", kind: "scalar", f: "epsScore", label: "EPS Score (1–99)", hint: "e.g. 70" },
];

const FIELD_MAP: Record<string, FieldSpec> = Object.fromEntries(
  FIELD_CATALOG.map((s) => [s.id, s])
);

const GROUPS: { name: string; ids: string[] }[] = [
  { name: "Price & volume", ids: ["open", "high", "low", "close", "volume"] },
  { name: "Moving averages & ranges", ids: ["smaClose", "smaVolume", "maxHigh", "minLow"] },
  {
    name: "Momentum & oscillators",
    ids: ["rsi14", "wRsi14", "macdHist", "wMacdHist", "mom1M", "mom3M", "mom6M", "atr14Pct", "bbPctB", "bbWidthPct"],
  },
  {
    name: "Snapshot & fundamentals",
    ids: [
      "marketCap", "peTTM", "pbRatio", "divYield", "avgVol3M", "changePct", "fromHighPct", "fromLowPct",
      "distSma20Pct", "distSma50Pct", "distSma100Pct", "distSma200Pct",
      "distEma20Pct", "distEma50Pct", "distEma100Pct", "distEma200Pct",
      "rsRating", "epsScore",
    ],
  },
];

const specHasTimeframe = (spec: FieldSpec | undefined): boolean =>
  !!spec && (spec.kind === "series" || spec.kind === "window");

// ================================================================ serialization

/** Series reference with timeframe + bars-ago prefix, e.g. "2 weeks ago high". */
function seriesRef(f: SeriesField, tf: "d" | "w", off: number): string {
  if (tf === "w") {
    return off > 0 ? `${off} week${off > 1 ? "s" : ""} ago ${f}` : `weekly ${f}`;
  }
  return off > 0 ? `${off} candle${off > 1 ? "s" : ""} ago ${f}` : f;
}

/** Term → pro-expression source string (compiled server-side by pro-sql). */
export function termToExpr(t: Term): string {
  if (t.mode === "num") return expandUnitSuffixes(t.v.trim()) || t.v.trim();
  if (t.mode === "expr") return t.src.trim();
  const spec = FIELD_MAP[t.f];
  if (!spec) return "";
  if (spec.kind === "series") return seriesRef(spec.f, t.tf, t.off);
  if (spec.kind === "window") {
    const ser = seriesRef(spec.ser, t.tf, t.off);
    return spec.fn === "sma" ? `sma(${ser}, ${t.p})` : `${spec.fn}(${t.p}, ${ser})`;
  }
  // snapshot scalar — display-scale fields divide down (market cap ₹ → ₹ Cr)
  return spec.scale ? `${spec.f} / ${spec.scale}` : spec.f;
}

/** Short label for the picker trigger. */
function termShortLabel(t: Term): string {
  if (t.mode === "num") return t.v.trim() || "number";
  if (t.mode === "expr") return t.src.trim() ? "ƒx expression" : "ƒx custom…";
  const spec = FIELD_MAP[t.f];
  if (!spec) return "pick a field";
  if (spec.kind === "series") return spec.label;
  if (spec.kind === "window") {
    const ser = spec.ser.charAt(0).toUpperCase() + spec.ser.slice(1);
    return spec.fn === "sma" ? `SMA(${ser}, ${t.p})` : `${spec.fn === "min" ? "Lowest" : "Highest"} ${ser.toLowerCase()}, ${t.p}`;
  }
  return spec.label;
}

// ================================================================ validation

export interface RowErrors {
  left?: string;
  right?: string;
  right2?: string;
  pct?: string;
  pat?: string;
  general?: string;
}

function clampInt(raw: string, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function termError(t: Term): string | undefined {
  if (t.mode === "num") {
    if (!t.v.trim()) return "Enter a number";
    if (parseNumWithUnits(t.v) == null) return "Not a valid number (unit suffixes like 3cr / 50l ok)";
    return undefined;
  }
  if (t.mode === "expr") {
    if (!t.src.trim()) return "Enter an expression";
    const parsed = parseProExpr(t.src);
    if (!parsed.ok) return parsed.error;
    return undefined;
  }
  const spec = FIELD_MAP[t.f];
  if (!spec) return "Pick a field";
  if (spec.kind === "window" && (!Number.isInteger(t.p) || t.p < 1 || t.p > 500)) {
    return "Window length must be 1–500 bars";
  }
  if (spec.kind !== "scalar" && (!Number.isInteger(t.off) || t.off < 0 || t.off > 600)) {
    return "Offset must be 0–600 bars back";
  }
  return undefined;
}

function termHasSeries(t: Term): boolean {
  if (t.mode === "field") {
    const spec = FIELD_MAP[t.f];
    return !!spec && spec.kind !== "scalar";
  }
  if (t.mode === "expr") {
    const parsed = parseProExpr(t.src);
    return parsed.ok && !isScalarOnly(parsed.node);
  }
  return false;
}

/** Per-side validation for a row — an empty object means the row is runnable. */
export function rowErrors(r: V2Row): RowErrors {
  const errs: RowErrors = {};
  if (r.pat) {
    if (!Number.isInteger(r.pat.n) || r.pat.n < 1 || r.pat.n > MAX_PATTERN_N) {
      errs.pat = `Streak length must be 1–${MAX_PATTERN_N}`;
    }
    return errs;
  }
  const l = termError(r.left);
  if (l) errs.left = l;
  const rt = termError(r.right);
  if (rt) errs.right = rt;
  if (r.op === "between") {
    const e = termError(r.right2 ?? { mode: "num", v: "" });
    if (e) errs.right2 = e;
  }
  if (r.op === "withinPct") {
    const p = Number(r.pct);
    if (!r.pct.trim() || !Number.isFinite(p) || p <= 0 || p > 10000) {
      errs.pct = "Percent width 0–10000";
    }
  }
  if ((r.op === "crossAbove" || r.op === "crossBelow") && !termHasSeries(r.left) && !termHasSeries(r.right)) {
    errs.general = "Crosses needs candle fields (price, volume, SMA…) — snapshot values have no previous bar";
  }
  return errs;
}

const firstErrorText = (errs: RowErrors): string | null =>
  (Object.values(errs).find(Boolean) as string | undefined) ?? null;

// ================================================================ wire + formula

export function rowToWire(r: V2Row): Record<string, unknown> {
  if (r.pat) {
    return {
      kind: "pattern",
      pattern: r.pat.pattern,
      tf: r.pat.tf,
      n: r.pat.n,
      logic: r.logic,
    };
  }
  const w: Record<string, unknown> = {
    kind: "expr",
    cmp: r.op,
    l: termToExpr(r.left),
    r: termToExpr(r.right),
    logic: r.logic,
  };
  if (r.op === "between" && r.right2) w.r2 = termToExpr(r.right2);
  if (r.op === "withinPct") {
    const p = Number(r.pct);
    if (Number.isFinite(p)) w.pct = p;
  }
  return w;
}

export const rowsToWire = (rows: V2Row[]) => rows.map(rowToWire);

/** The v2 payload string sent as the `cond` URL parameter / saved definition companion. */
export const wirePayload = (rows: V2Row[]) => JSON.stringify({ v: 2, rows: rowsToWire(rows) });

/** Human expression text for one row, e.g. "close > sma(close, 200)". */
export function rowExprText(r: V2Row): string {
  if (r.pat) {
    const what = r.pat.pattern === "higherHighs" ? "higher highs" : "lower lows";
    const tf = r.pat.tf === "w" ? "Weekly" : "Daily";
    return `${tf} ${r.pat.n} consecutive ${what}`;
  }
  const l = termToExpr(r.left) || "…";
  const rr = termToExpr(r.right) || "…";
  switch (r.op) {
    case "between":
      return `${l} between ${rr} and ${r.right2 ? termToExpr(r.right2) || "…" : "…"}`;
    case "crossAbove":
      return `${l} crosses above ${rr}`;
    case "crossBelow":
      return `${l} crosses below ${rr}`;
    case "withinPct":
      return `${l} within ${r.pct.trim() || "?"}% of ${rr}`;
    case "gt": return `${l} > ${rr}`;
    case "gte": return `${l} ≥ ${rr}`;
    case "lt": return `${l} < ${rr}`;
    case "lte": return `${l} ≤ ${rr}`;
    case "eq": return `${l} = ${rr}`;
  }
}

/** Split rows into AND-separated segments (each an OR-group) — "1 AND (2 OR 3)". */
export function formulaText(rows: V2Row[]): string {
  const segs: number[][] = [];
  rows.forEach((r, i) => {
    if (i === 0 || r.logic === "and") segs.push([i]);
    else segs[segs.length - 1].push(i);
  });
  return segs
    .map((s) => (s.length === 1 ? `${s[0] + 1}` : `(${s.map((i) => i + 1).join(" OR ")})`))
    .join(" AND ");
}

// ================================================================ operators (plain words)

export const OP_META: Record<CondOp, { label: string; short: string }> = {
  gt: { label: "is greater than", short: ">" },
  gte: { label: "is at least", short: "≥" },
  lt: { label: "is less than", short: "<" },
  lte: { label: "is at most", short: "≤" },
  eq: { label: "equals", short: "=" },
  between: { label: "is between", short: "between" },
  crossAbove: { label: "crosses above", short: "crosses ↑" },
  crossBelow: { label: "crosses below", short: "crosses ↓" },
  withinPct: { label: "is within % of", short: "within %" },
};

const OP_GROUPS: { label: string; ops: CondOp[] }[] = [
  { label: "Compare", ops: ["gt", "gte", "lt", "lte", "eq", "between"] },
  { label: "Pattern", ops: ["crossAbove", "crossBelow", "withinPct"] },
];

// ================================================================ recently used fields

const RECENT_KEY = "tp.builder.recentFields";

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === "string" && !!FIELD_MAP[x]).slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  try {
    const next = [id, ...readRecents().filter((x) => x !== id)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — recents are a nicety, not a requirement */
  }
}

// ================================================================ pill primitives

/** Dismiss-on-outside-click + Escape for the custom pill popovers. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/** The pill look every clickable token shares. */
const pillCls =
  "flex h-8 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 transition-colors hover:border-zinc-600";

type FieldPick = { type: "field"; id: string } | { type: "expr" };

/** The searchable, categorised list — shared by the field pill and the
 *  value pill's Indicator tab. Recents pinned first. */
function FieldList({
  onPick,
  allowExpr,
  search,
  setSearch,
}: {
  onPick: (pick: FieldPick) => void;
  allowExpr: boolean;
  search: string;
  setSearch: (v: string) => void;
}) {
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => {
    setRecents(readRecents());
  }, []);

  const q = search.trim().toLowerCase();
  const matches = (label: string) => label.toLowerCase().includes(q);

  const item = (spec: FieldSpec) => (
    <button
      key={spec.id}
      type="button"
      onClick={() => {
        pushRecent(spec.id);
        onPick({ type: "field", id: spec.id });
      }}
      className="block w-full truncate px-3 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-zinc-800"
    >
      {spec.label}
    </button>
  );

  const section = (title: string, children: React.ReactNode) => (
    <div key={title}>
      <div className="sticky top-0 bg-zinc-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
        {title}
      </div>
      {children}
    </div>
  );

  let found = 0;
  GROUPS.forEach((g) => g.ids.forEach((id) => { if (FIELD_MAP[id] && matches(FIELD_MAP[id].label)) found++; }));

  return (
    <>
      <div className="border-b border-zinc-800 p-2">
        <Input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search indicators… (try “rsi”)"
          aria-label="Search indicators"
          className="h-7 border-zinc-700 bg-zinc-950 text-xs text-zinc-100"
        />
      </div>
      <div className="max-h-72 overflow-y-auto py-1">
        {!q && recents.length > 0 &&
          section("Recent", recents.map((id) => FIELD_MAP[id]).filter(Boolean).map(item))}
        {GROUPS.map((g) => {
          const specs = g.ids.map((id) => FIELD_MAP[id]).filter((s): s is FieldSpec => !!s && matches(s.label));
          if (specs.length === 0) return null;
          return section(g.name, specs.map(item));
        })}
        {allowExpr && matches("custom expression") &&
          section("Advanced", (
            <button
              type="button"
              onClick={() => onPick({ type: "expr" })}
              className="block w-full px-3 py-1.5 text-left text-xs text-brand-text transition-colors hover:bg-zinc-800"
            >
              ƒx Custom expression…
            </button>
          ))}
        {found === 0 && !matches("custom expression") && (
          <p className="px-3 py-3 text-center text-[11px] text-zinc-500">No fields match “{search}”.</p>
        )}
      </div>
    </>
  );
}

/** Field pill — opens the indicator picker; window fields open a small
 *  token editor for the N parameter instead (SMA(Close, 200) ▾). */
function FieldPill({
  term,
  onPick,
  onParam,
  ariaLabel,
  error,
}: {
  term: Term;
  onPick: (pick: FieldPick) => void;
  onParam?: (p: number) => void;
  ariaLabel: string;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  const spec = term.mode === "field" ? FIELD_MAP[term.f] : undefined;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setSearch("");
        }}
        aria-label={ariaLabel}
        aria-expanded={open}
        className={cn(pillCls, "max-w-52", open && "border-brand/60", error && "border-loss/70")}
      >
        <span className="min-w-0 truncate">{termShortLabel(term)}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>
      {open && spec?.kind === "window" && (
        <div className="absolute left-0 top-9 z-40 w-56 rounded-lg border border-zinc-700 bg-zinc-900 p-2.5 shadow-xl">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Window length (N)</p>
          <Input
            autoFocus
            type="number"
            min={1}
            max={500}
            value={term.mode === "field" ? term.p : 1}
            onChange={(e) => onParam?.(clampInt(e.target.value, 1, 500))}
            aria-label="Window length"
            className="h-7 border-zinc-700 bg-zinc-950 text-center font-mono text-xs text-zinc-100"
          />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setSearch("");
              // reopen as the full picker: signal via a second click path
              onPick({ type: "expr" });
            }}
            className="mt-2 text-[10px] text-zinc-500 underline-offset-2 hover:text-brand-text hover:underline"
          >
            Use a custom expression instead…
          </button>
        </div>
      )}
      {open && (!spec || spec.kind !== "window") && (
        <div className="absolute left-0 top-9 z-40 w-64 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          <FieldList
            search={search}
            setSearch={setSearch}
            allowExpr
            onPick={(pick) => {
              onPick(pick);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ================================================================ timeframe pill (merged tf + offset)

const D_OFFS = [0, 1, 2, 3, 5, 10, 20] as const;
const W_OFFS = [0, 1, 2, 3, 4, 8, 12] as const;

export function tfPillLabel(tf: "d" | "w", off: number): string {
  if (off === 0) return tf === "d" ? "Latest" : "Weekly";
  return tf === "d" ? `${off} candle${off > 1 ? "s" : ""} ago` : `${off} week${off > 1 ? "s" : ""} ago`;
}

/** One pill for timeframe + bars-ago — replaces the D/W toggle + "N ago" input. */
function TfPill({ tf, off, onChange }: { tf: "d" | "w"; off: number; onChange: (tf: "d" | "w", off: number) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));

  const opt = (t: "d" | "w", o: number) => (
    <button
      key={`${t}${o}`}
      type="button"
      onClick={() => {
        onChange(t, o);
        setOpen(false);
      }}
      className={cn(
        "block w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-zinc-800",
        tf === t && off === o ? "font-semibold text-brand-text" : "text-zinc-200"
      )}
    >
      {tfPillLabel(t, o)}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Timeframe and offset"
        aria-expanded={open}
        className={cn(pillCls, "w-[7.2rem] justify-between", open && "border-brand/60")}
      >
        <span className="min-w-0 truncate">{tfPillLabel(tf, off)}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-40 w-48 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          <div className="max-h-64 overflow-y-auto py-1">
            <div className="sticky top-0 bg-zinc-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Daily</div>
            {D_OFFS.map((o) => opt("d", o))}
            <div className="sticky top-0 bg-zinc-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Weekly</div>
            {W_OFFS.map((o) => opt("w", o))}
          </div>
          <div className="flex items-center gap-1 border-t border-zinc-800 p-2">
            <Input
              type="number"
              min={0}
              max={600}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="N"
              aria-label="Custom bars back"
              className="h-7 w-14 border-zinc-700 bg-zinc-950 px-1.5 text-center font-mono text-xs text-zinc-100"
            />
            <span className="text-[10px] text-zinc-500">bars back</span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 border-zinc-700 bg-zinc-950 px-2 text-[11px] text-zinc-300"
              onClick={() => {
                const n = clampInt(custom, 0, 600);
                onChange(n > 12 ? "d" : tf, n);
                setCustom("");
                setOpen(false);
              }}
            >
              Set
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ================================================================ operator picker (plain words)

function OpPick({ op, onChange }: { op: CondOp; onChange: (op: CondOp) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Operator"
        aria-expanded={open}
        className={cn(pillCls, "min-w-[8.6rem] justify-between font-medium", open && "border-brand/60")}
      >
        <span className="min-w-0 truncate">{OP_META[op].label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-40 w-52 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          <div className="py-1">
            {OP_GROUPS.map((g) => (
              <div key={g.label}>
                <div className="sticky top-0 bg-zinc-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{g.label}</div>
                {g.ops.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => {
                      onChange(o);
                      setOpen(false);
                    }}
                    className={cn(
                      "block w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-zinc-800",
                      op === o ? "font-semibold text-brand-text" : "text-zinc-200"
                    )}
                  >
                    {OP_META[o].label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ================================================================ value pill (right side: Number / Indicator / Expression)

/** Ready-made math snippets (Phase 5) — most users never write a formula. */
const EXPR_SNIPPETS: { label: string; src: string; title: string }[] = [
  { label: "% change (N days)", src: "pct_change(close, 5)", title: "% move vs N candles back" },
  { label: "Range % today", src: "(high - low) / close * 100", title: "Today's traded range as % of price" },
  { label: "Turnover (₹ Cr)", src: "close * volume / 1e7", title: "Traded value in ₹ crore" },
  { label: "N × average volume", src: "volume / sma(volume, 20)", title: "Today's volume as a multiple of its 20-day average" },
  { label: "% below 52W high", src: "(highest(high, 250) - close) / highest(high, 250) * 100", title: "Distance from the 52-week high, in %" },
  { label: "Weekly % change", src: "weekly pct_change(close, 1)", title: "This week's move vs last week's close" },
];

function SnippetMenu({ onInsert }: { onInsert: (src: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-1.5 text-[10px] text-zinc-400 transition-colors hover:border-brand/40 hover:text-brand-text"
        aria-label="Insert a ready-made expression"
        aria-expanded={open}
      >
        <Sigma className="h-3 w-3" /> patterns
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-50 w-60 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          <div className="py-1">
            {EXPR_SNIPPETS.map((s) => (
              <button
                key={s.label}
                type="button"
                title={s.title}
                onClick={() => {
                  onInsert(s.src);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-zinc-800"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The single right-side pill — Number / Indicator / Expression in one popover. */
function ValuePill({
  term,
  onChange,
  error,
  placeholder,
  rowId,
  side,
  allowNum,
}: {
  term: Term;
  onChange: (t: Term) => void;
  error?: string;
  placeholder: string;
  rowId: number;
  side: "l" | "r" | "r2";
  allowNum: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"num" | "ind" | "expr">(term.mode === "num" ? "num" : term.mode === "field" ? "ind" : "expr");
  const [search, setSearch] = useState("");
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  const exprOk = term.mode !== "expr" || !parseProExpr(term.src).ok;

  const pickField = (id: string) => {
    const nextSpec = FIELD_MAP[id];
    if (!nextSpec) return;
    const tfAble = specHasTimeframe(nextSpec);
    const prevTf = term.mode === "field" ? term.tf : "d";
    const prevOff = term.mode === "field" ? term.off : 0;
    onChange({
      mode: "field",
      f: nextSpec.id,
      tf: tfAble ? prevTf : "d",
      off: tfAble ? prevOff : 0,
      p: nextSpec.kind === "window" ? nextSpec.p : 1,
    });
  };

  const tabBtn = (t: "num" | "ind" | "expr", label: string) => (
    <button
      key={t}
      type="button"
      onClick={() => setTab(t)}
      className={cn(
        "flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors",
        tab === t ? "border-b-2 border-brand text-brand-text" : "text-zinc-500 hover:text-zinc-300"
      )}
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={side === "l" ? "Left operand" : "Right operand"}
        aria-expanded={open}
        className={cn(pillCls, "w-full max-w-72 justify-between", open && "border-brand/60", error && "border-loss/70")}
      >
        <span className="min-w-0 truncate">
          {term.mode === "num"
            ? <span className="font-mono">{term.v.trim() || <span className="text-zinc-500">number…</span>}</span>
            : termShortLabel(term)}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-40 w-72 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          <div className="flex border-b border-zinc-800">
            {allowNum && tabBtn("num", "Number")}
            {tabBtn("ind", "Indicator")}
            {tabBtn("expr", "ƒx Expression")}
          </div>

          {tab === "num" && (
            <div className="p-2.5">
              <Input
                autoFocus
                type="text"
                inputMode="decimal"
                value={term.mode === "num" ? term.v : ""}
                onChange={(e) => onChange({ mode: "num", v: e.target.value })}
                placeholder={placeholder}
                aria-label="Number value"
                className="h-8 border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-100"
              />
              <p className="mt-1.5 text-[10px] leading-4 text-zinc-500">
                Unit shortcuts work: <span className="font-mono text-zinc-400">3cr</span> = 3 crore, <span className="font-mono text-zinc-400">50l</span> = 50 lakh, <span className="font-mono text-zinc-400">1.5k</span> = 1500.
              </p>
            </div>
          )}

          {tab === "ind" && (
            <FieldList
              search={search}
              setSearch={setSearch}
              allowExpr={false}
              onPick={(pick) => {
                if (pick.type === "field") {
                  pickField(pick.id);
                  setOpen(false);
                }
              }}
            />
          )}

          {tab === "expr" && (
            <div className="space-y-2 p-2.5">
              <div className="flex items-center gap-1.5">
                <SnippetMenu onInsert={(src) => onChange({ mode: "expr", src })} />
                <span className="text-[10px] text-zinc-500">insert a ready-made formula, then edit N</span>
              </div>
              <ExprEditor
                value={term.mode === "expr" ? term.src : ""}
                onChange={(v) => onChange({ mode: "expr", src: v })}
                placeholder="e.g. close / min(66, low) · pct_change(close, 5)"
                ariaLabel="Custom expression"
                inputKey={`${rowId}:${side}`}
                registerInput={() => {}}
                onFocusKey={() => {}}
              />
              {term.mode === "expr" && term.src.trim() && !exprOk && (() => {
                const p = parseProExpr(term.src);
                return <p className="text-[10px] leading-tight text-loss">{p.ok ? "" : p.error}</p>;
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ================================================================ term assembly (the left sentence)

/**
 * One operand rendered as pills: [Latest ▾][Close ▾][N token ▾] — the
 * timeframe+offset pill appears for candle fields; window fields get their
 * N token; scalars (RSI, market cap…) render the field pill alone.
 */
function TermPills({
  rowId,
  side,
  term,
  onChange,
  error,
  allowNum,
  numPlaceholder,
}: {
  rowId: number;
  side: "l" | "r" | "r2";
  term: Term;
  onChange: (t: Term) => void;
  error?: string;
  allowNum: boolean;
  numPlaceholder: string;
}) {
  const spec = term.mode === "field" ? FIELD_MAP[term.f] : undefined;
  const defaultField: Term = { mode: "field", f: "close", tf: "d", off: 0, p: 50 };

  if (term.mode === "expr") {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <ExprEditor
          value={term.src}
          onChange={(v) => onChange({ mode: "expr", src: v })}
          placeholder="expression — e.g. close / min(66, low)"
          ariaLabel={side === "l" ? "Left expression" : "Right expression"}
          inputKey={`${rowId}:${side}`}
          registerInput={() => {}}
          onFocusKey={() => {}}
        />
        <button
          type="button"
          onClick={() => onChange(defaultField)}
          title="Pick a field instead"
          aria-label="Switch to field picker"
          className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <ListTreeIcon />
        </button>
        {error && <p className="basis-full text-[10px] leading-tight text-loss">{error}</p>}
      </div>
    );
  }

  if (term.mode === "num") {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className={cn("inline-flex h-8 min-w-20 items-center rounded-md border border-dashed border-zinc-700 bg-zinc-950/60 px-2 font-mono text-xs", term.v.trim() ? "text-zinc-100" : "text-zinc-600")}>
          {term.v.trim() || <span className="not-italic">{numPlaceholder}</span>}
        </span>
        {error && <p className="basis-full text-[10px] leading-tight text-loss">{error}</p>}
      </div>
    );
  }

  // field term
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {specHasTimeframe(spec) && (
        <TfPill tf={term.tf} off={term.off} onChange={(tf, off) => onChange({ ...term, tf, off })} />
      )}
      <FieldPill
        term={term}
        error={error}
        ariaLabel={side === "l" ? "Left operand field" : "Right operand field"}
        onParam={(p) => onChange({ ...term, p })}
        onPick={(pick) => {
          if (pick.type === "expr") {
            onChange({ mode: "expr", src: "" });
            return;
          }
          const nextSpec = FIELD_MAP[pick.id];
          if (!nextSpec) return;
          const tfAble = specHasTimeframe(nextSpec);
          onChange({
            mode: "field",
            f: nextSpec.id,
            tf: tfAble ? term.tf : "d",
            off: tfAble ? term.off : 0,
            p: nextSpec.kind === "window" ? nextSpec.p : 1,
          });
        }}
      />
      {error && <p className="basis-full text-[10px] leading-tight text-loss">{error}</p>}
    </div>
  );
}

/** lucide ListTree is imported once at the top — tiny wrapper for readability. */
function ListTreeIcon() {
  return <Info className="h-3.5 w-3.5" />;
}

// ================================================================ logic chip + row card

/** Light "and" separator / coloured OR chip — click toggles the connector. */
function LogicChip({ value, onToggle }: { value: "and" | "or"; onToggle: () => void }) {
  return (
    <div className="flex justify-center py-0.5">
      <button
        type="button"
        onClick={onToggle}
        title={
          value === "and"
            ? "AND — both conditions must match. Click to switch to OR."
            : "OR — either condition matches (amber group). Click to switch back to AND."
        }
        aria-label={`Connector ${value.toUpperCase()} — click to toggle`}
        className={cn(
          "rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide transition-colors",
          value === "or"
            ? "border border-gold/50 bg-gold/10 text-gold-text hover:bg-gold/20"
            : "text-zinc-600 hover:text-zinc-300"
        )}
      >
        {value === "or" ? "OR" : "and"}
      </button>
    </div>
  );
}

function RowCard({
  row,
  index,
  errors,
  dragOver,
  onPatch,
  onRemove,
  onDuplicate,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  row: V2Row;
  index: number;
  errors: RowErrors;
  dragOver: boolean;
  onPatch: (patch: Partial<V2Row>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const leftSpec = row.left.mode === "field" ? FIELD_MAP[row.left.f] : undefined;
  const numPlaceholder = leftSpec?.hint ?? "e.g. 100";
  const firstErr = firstErrorText(errors);
  const isCross = row.op === "crossAbove" || row.op === "crossBelow";

  const changeOp = (op: CondOp) => {
    if (op === "between" && !row.right2) onPatch({ op, right2: { mode: "num", v: "" } });
    else if (op === "withinPct" && !row.pct.trim()) onPatch({ op, pct: "2" });
    else onPatch({ op });
  };

  // ---- pattern rows: one pill + N stepper instead of N stacked rows
  if (row.pat) {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        className={cn(
          "group relative flex items-center gap-x-1.5 gap-y-2 rounded-lg border border-transparent px-0.5 py-1 transition-colors",
          dragOver && "border-brand/50 bg-brand/5"
        )}
      >
        <span className="w-4 shrink-0 select-none text-center font-mono text-[10px] text-zinc-600">{index + 1}</span>
        <GripVertical className="hidden h-4 w-4 shrink-0 cursor-grab text-zinc-700 group-hover:text-zinc-500 sm:block" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className={cn(pillCls, "justify-between border-gold/40 bg-gold/[0.06] text-gold-text")} title="Cross-bar pattern — replaces a stack of lag comparisons">
            <span className="min-w-0 truncate">
              {row.pat.tf === "w" ? "Weekly" : "Daily"} · {row.pat.pattern === "higherHighs" ? "N consecutive higher highs" : "N consecutive lower lows"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </span>
          <Input
            type="number"
            min={1}
            max={MAX_PATTERN_N}
            value={row.pat.n}
            onChange={(e) => onPatch({ pat: { ...row.pat!, n: clampInt(e.target.value, 1, MAX_PATTERN_N) } })}
            aria-label="Streak length"
            title={`1–${MAX_PATTERN_N} bars`}
            className={cn("h-8 w-14 border-zinc-700 bg-zinc-900 text-center font-mono text-xs text-zinc-100", errors.pat && "border-loss/70")}
          />
          {row.pat.tf === "d" && (
            <button
              type="button"
              onClick={() => onPatch({ pat: { ...row.pat!, tf: "w" } })}
              className="text-[10px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
              title="Use weekly candles instead"
            >
              weekly?
            </button>
          )}
        </div>
        <RowActions onDuplicate={onDuplicate} onRemove={onRemove} />
        {firstErr && <p className="basis-full pl-6 text-[10px] leading-tight text-loss">{firstErr}</p>}
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative flex flex-wrap items-center gap-x-1.5 gap-y-2 rounded-lg border border-transparent px-0.5 py-1 transition-colors",
        dragOver && "border-brand/50 bg-brand/5"
      )}
    >
      <span className="w-4 shrink-0 select-none text-center font-mono text-[10px] text-zinc-600" title={`Condition ${index + 1}`}>
        {index + 1}
      </span>
      <GripVertical
        className="hidden h-4 w-4 shrink-0 cursor-grab text-zinc-700 transition-colors group-hover:text-zinc-500 active:cursor-grabbing sm:block"
        aria-hidden
      />

      <div className="flex min-w-0 basis-full flex-wrap items-center gap-1.5 sm:basis-auto sm:pr-1">
        <TermPills
          rowId={row.id}
          side="l"
          term={row.left}
          onChange={(t) => onPatch({ left: t })}
          error={errors.left}
          allowNum={false}
          numPlaceholder={numPlaceholder}
        />
      </div>

      <div className="flex min-w-0 basis-full flex-wrap items-center gap-1.5 sm:basis-auto">
        <OpPick op={row.op} onChange={changeOp} />
        {row.op === "withinPct" && (
          <Input
            type="number"
            value={row.pct}
            onChange={(e) => onPatch({ pct: e.target.value })}
            placeholder="%"
            aria-label="Percent width"
            title="How close the two sides must be, in percent"
            className={cn(
              "h-8 w-16 border-zinc-700 bg-zinc-900 text-center font-mono text-xs text-zinc-100",
              errors.pct && "border-loss/70"
            )}
          />
        )}
        {isCross && (
          <span title="True only on the bar where the cross happens — automatically compares with the previous candle">
            <Info className="h-3.5 w-3.5 text-zinc-600" />
          </span>
        )}
        <ValuePill
          rowId={row.id}
          side="r"
          term={row.right}
          onChange={(t) => onPatch({ right: t })}
          error={errors.right}
          allowNum
          placeholder={numPlaceholder}
        />
        {row.op === "between" && (
          <>
            <span className="text-[10px] text-zinc-600">and</span>
            <ValuePill
              rowId={row.id}
              side="r2"
              term={row.right2 ?? { mode: "num", v: "" }}
              onChange={(t) => onPatch({ right2: t })}
              error={errors.right2}
              allowNum
              placeholder={numPlaceholder}
            />
          </>
        )}
      </div>

      <RowActions onDuplicate={onDuplicate} onRemove={onRemove} />

      {firstErr && <p className="basis-full pl-6 text-[10px] leading-tight text-loss">{firstErr}</p>}
    </div>
  );
}

/** Hover row actions — duplicate + delete (always visible on touch). */
function RowActions({ onDuplicate, onRemove }: { onDuplicate: () => void; onRemove: () => void }) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 sm:ml-0">
      <button
        type="button"
        onClick={onDuplicate}
        aria-label="Duplicate condition"
        title="Duplicate this condition"
        className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove condition"
        title="Remove this condition"
        className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-loss"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ================================================================ presets

const fT = (f: string, o?: { tf?: "d" | "w"; off?: number; p?: number }): Term => ({
  mode: "field",
  f,
  tf: o?.tf ?? "d",
  off: o?.off ?? 0,
  p: o?.p ?? (FIELD_MAP[f]?.kind === "window" ? (FIELD_MAP[f] as WindowSpec).p : 1),
});
const nT = (v: string): Term => ({ mode: "num", v });
const xT = (src: string): Term => ({ mode: "expr", src });
const mk = (
  logic: "and" | "or",
  op: CondOp,
  left: Term,
  right: Term,
  extra?: { right2?: Term; pct?: string }
): Omit<V2Row, "id"> => ({
  logic,
  op,
  left,
  right,
  right2: extra?.right2 ?? null,
  pct: extra?.pct ?? "",
});
const mkPat = (logic: "and" | "or", pattern: RowPattern["pattern"], tf: "d" | "w", n: number): Omit<V2Row, "id"> => ({
  logic,
  op: "gte", // unused by pattern rows but kept for wire shape
  left: { mode: "field", f: "close", tf: "d", off: 0, p: 1 },
  right: nT(""),
  right2: null,
  pct: "",
  pat: { pattern, tf, n },
});

/** Built-in presets — loaded into the builder, fully editable afterwards. */
export const PRESETS: { name: string; rows: Omit<V2Row, "id">[] }[] = [
  {
    name: "Momentum leaders",
    rows: [
      mk("and", "gt", fT("rsi14"), nT("60")),
      mk("and", "gt", fT("mom6M"), nT("20")),
      mk("and", "gt", fT("close"), fT("smaClose", { p: 200 })),
      mk("and", "lte", fT("fromHighPct"), nT("15")),
    ],
  },
  {
    name: "Oversold bounce watch",
    rows: [
      mk("and", "lt", fT("rsi14"), nT("40")),
      mk("and", "lt", fT("mom1M"), nT("-5")),
      mk("and", "gt", fT("close"), nT("50")),
    ],
  },
  {
    name: "Volume accumulation",
    rows: [
      mk("and", "gt", fT("volume"), xT("2 * sma(volume, 20)")),
      mk("and", "gt", fT("changePct"), nT("1")),
      mk("and", "between", fT("marketCap"), nT("5000"), { right2: nT("200000") }),
    ],
  },
  {
    name: "Near 52-week high",
    rows: [
      mk("and", "lte", fT("fromHighPct"), nT("5")),
      mk("and", "gt", fT("close"), fT("smaClose", { p: 50 })),
      mk("and", "gt", fT("close"), fT("smaClose", { p: 200 })),
    ],
  },
  {
    name: "Chartink · 66-day breakout (weekly calm)",
    rows: [
      mk("and", "gte", xT("close / min(66, low)"), nT("1.30")),
      mk("and", "gt", fT("marketCap"), nT("0")),
      mk("and", "gte", fT("close"), nT("1")),
      mk("and", "gt", xT("close * sma(volume, 20)"), nT("30000000")),
      mk("and", "gt", fT("close"), fT("smaClose", { p: 200 })),
      mk("and", "lte", xT("abs(1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100))"), nT("6")),
      mk("and", "lte", xT("abs(2 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))"), nT("6")),
      mk("and", "lte", xT("abs(3 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))"), nT("6")),
      // one pattern row instead of five stacked weekly-high comparisons
      mkPat("and", "higherHighs", "w", 4),
      mk("and", "lt", fT("close", { tf: "w", off: 1 }), fT("high", { tf: "w", off: 2 })),
    ],
  },
  {
    name: "Weekly higher-highs streak",
    rows: [
      mkPat("and", "higherHighs", "w", 4),
      mk("and", "gt", fT("close", { tf: "w" }), fT("smaClose", { tf: "w", p: 10 })),
      mk("and", "gte", fT("marketCap"), nT("1000")),
    ],
  },
  {
    name: "Trend + tight weekly swings",
    rows: [
      mk("and", "gt", fT("close"), fT("smaClose", { p: 50 })),
      mk("and", "gt", fT("smaClose", { p: 50 }), fT("smaClose", { p: 200 })),
      mk("and", "lte", xT("abs(1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100))"), nT("4")),
      mk("and", "gte", xT("close * sma(volume, 20)"), nT("10000000")),
      mk("and", "gte", fT("marketCap"), nT("1000")),
    ],
  },
  {
    name: "Cross back above SMA 50",
    rows: [
      mk("and", "crossAbove", fT("close"), fT("smaClose", { p: 50 })),
      mk("and", "gte", fT("marketCap"), nT("1000")),
    ],
  },
  {
    name: "Riding the 52W high (within 2%)",
    rows: [
      mk("and", "withinPct", fT("close"), fT("maxHigh", { p: 252 }), { pct: "2" }),
      mk("and", "gte", fT("avgVol3M"), nT("200000")),
    ],
  },
];

/** Empty-state quick starts. */
const SHORTCUTS: { key: string; label: string; rows: Omit<V2Row, "id">[] }[] = [
  {
    key: "vol",
    label: "Volume Breakout",
    rows: [mk("and", "gt", fT("volume"), xT("2 * sma(volume, 20)"))],
  },
  {
    key: "oversold",
    label: "Oversold Bounce",
    rows: [
      mk("and", "lt", fT("rsi14"), nT("40")),
      mk("and", "gt", fT("close"), nT("50")),
    ],
  },
  {
    key: "w52",
    label: "52W High Breakout",
    rows: [
      mk("and", "lte", fT("fromHighPct"), nT("5")),
      mk("and", "gt", fT("close"), fT("smaClose", { p: 50 })),
    ],
  },
  {
    key: "streak",
    label: "4 Weekly Higher Highs",
    rows: [mkPat("and", "higherHighs", "w", 4)],
  },
];

// ================================================================ saved-screen converters

const termOf = (x: unknown, fallback: Term): Term => {
  if (x && typeof x === "object") {
    const t = x as Record<string, unknown>;
    if (t.mode === "num") return { mode: "num", v: typeof t.v === "string" ? t.v : String(t.v ?? "") };
    if (t.mode === "field" && typeof t.f === "string" && FIELD_MAP[t.f]) {
      return {
        mode: "field",
        f: t.f,
        tf: t.tf === "w" ? "w" : "d",
        off: clampInt(String(t.off ?? 0), 0, 600),
        p: clampInt(String(t.p ?? 1), 1, 500),
      };
    }
    if (t.mode === "expr" && typeof t.src === "string") return { mode: "expr", src: t.src };
  }
  return fallback;
};

const patOf = (x: unknown): RowPattern | undefined => {
  if (!x || typeof x !== "object") return undefined;
  const t = x as Record<string, unknown>;
  if (t.pattern !== "higherHighs" && t.pattern !== "lowerLows") return undefined;
  return {
    pattern: t.pattern,
    tf: t.tf === "w" ? "w" : "d",
    n: clampInt(String(t.n ?? 1), 1, MAX_PATTERN_N),
  };
};

/** Revive a v2 saved definition (UI-shaped rows) into editor rows. */
export function v2DefToRows(rawRows: unknown[]): V2Row[] {
  return rawRows.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const pat = patOf(r.pat);
    const op = OP_LIST.includes(r.op as CondOp) ? (r.op as CondOp) : "gt";
    return {
      id: nextRowId(),
      logic: r.logic === "or" ? "or" : "and",
      op,
      left: termOf(r.left, { mode: "field", f: "close", tf: "d", off: 0, p: 50 }),
      right: termOf(r.right, { mode: "num", v: "" }),
      right2: op === "between" && !pat ? termOf(r.right2, { mode: "num", v: "" }) : null,
      pct: typeof r.pct === "string" ? r.pct : r.pct != null ? String(r.pct) : "",
      pat,
    };
  });
}

const OP_LIST: CondOp[] = [
  "gt", "gte", "lt", "lte", "eq", "between", "crossAbove", "crossBelow", "withinPct",
];

/**
 * Convert a legacy (pre-rebuild) saved definition — flat wire rows — into
 * editor rows. Boolean signal flags become equivalent pro comparisons
 * (aboveSma200 → close > sma(close, 200) …). Legacy OR chips map onto OR
 * chips one-to-one; the caller surfaces a note because legacy OR semantics
 * ("or" started a new AND-branch) differ from the v2 box model.
 */
export function legacyDefToRows(rawRows: unknown[]): { rows: V2Row[]; orUsed: boolean } {
  let orUsed = false;
  const WEEKLY_KEY: Record<string, [string, "w"]> = {
    wClose: ["close", "w"], wOpen: ["open", "w"], wHigh: ["high", "w"], wLow: ["low", "w"],
  };
  const ALIAS: Record<string, string> = { price: "close", dayHigh: "high", dayLow: "low" };
  const numStr = (x: unknown, scale = 1) => {
    const n = Number(x);
    return Number.isFinite(n) ? String(n / scale) : "";
  };

  const rows = rawRows.map((raw): V2Row => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const logic: "and" | "or" = r.logic === "or" ? "or" : "and";
    if (logic === "or") orUsed = true;

    if (r.kind === "expr") {
      const cmpRaw = typeof r.cmp === "string" ? r.cmp : "gte";
      const op: CondOp = (["gt", "gte", "lt", "lte", "eq"] as const).includes(cmpRaw as "gt")
        ? (cmpRaw as CondOp)
        : cmpRaw === "between"
          ? "between"
          : "gte";
      return {
        id: nextRowId(),
        logic,
        op,
        left: { mode: "expr", src: typeof r.l === "string" ? r.l : "" },
        right: { mode: "expr", src: typeof r.r === "string" ? r.r : "" },
        right2: op === "between" ? { mode: "expr", src: typeof r.r2 === "string" ? r.r2 : "" } : null,
        pct: "",
      };
    }

    const f = typeof r.f === "string" ? r.f : "price";
    const opRaw = typeof r.op === "string" ? r.op : "gt";
    const boolVal = r.v === true || r.v === "true";
    const cmpOp: CondOp = (["gt", "gte", "lt", "lte"] as const).includes(opRaw as "gt")
      ? (opRaw as CondOp)
      : "gt";

    // Signal flags → equivalent pro comparisons.
    if (f === "aboveSma20" || f === "aboveSma50" || f === "aboveSma200") {
      const p = f === "aboveSma20" ? 20 : f === "aboveSma50" ? 50 : 200;
      return { id: nextRowId(), logic, op: boolVal ? "gt" : "lt", left: fT("close"), right: fT("smaClose", { p }), right2: null, pct: "" };
    }
    if (f === "volSpike") {
      return { id: nextRowId(), logic, op: boolVal ? "gt" : "lte", left: fT("volume"), right: xT("2 * sma(volume, 20)"), right2: null, pct: "" };
    }
    if (f === "goldenCross") {
      return { id: nextRowId(), logic, op: boolVal ? "gt" : "lt", left: fT("smaClose", { p: 20 }), right: fT("smaClose", { p: 50 }), right2: null, pct: "" };
    }
    if (f === "emaCross") {
      return { id: nextRowId(), logic, op: boolVal ? "gt" : "lt", left: fT("distEma20Pct"), right: fT("distEma50Pct"), right2: null, pct: "" };
    }

    const weekly = WEEKLY_KEY[f];
    const fid = weekly ? weekly[0] : (ALIAS[f] ?? (FIELD_MAP[f] ? f : "close"));
    const tf: "d" | "w" = weekly ? weekly[1] : "d";
    const scale = f === "marketCap" ? 1e7 : 1;
    const op: CondOp = opRaw === "between" ? "between" : cmpOp;
    return {
      id: nextRowId(),
      logic,
      op,
      left: fT(fid, { tf }),
      right: { mode: "num", v: numStr(r.v, scale) },
      right2: op === "between" ? { mode: "num", v: numStr(r.v2, scale) } : null,
      pct: "",
    };
  });

  return { rows, orUsed };
}

// ================================================================ bidirectional text view

const TEXT_OPS: { re: RegExp; build: (l: string, r: string, r2?: string) => Omit<V2Row, "id"> }[] = [
  { re: /\s+crosses\s+above\s+/i, build: (l, r) => mk("and", "crossAbove", xT(l), xT(r)) },
  { re: /\s+crosses\s+below\s+/i, build: (l, r) => mk("and", "crossBelow", xT(l), xT(r)) },
  { re: /\s+is\s+between\s+/i, build: (l, r) => mk("and", "between", xT(l), xT(r)) },
  { re: /\s+is\s+greater\s+or\s+equal(,\s*to|\s+to)?\s+/i, build: (l, r) => mk("and", "gte", xT(l), xT(r)) },
  { re: /\s+is\s+less\s+or\s+equal(\s+to)?\s+/i, build: (l, r) => mk("and", "lte", xT(l), xT(r)) },
  { re: /\s+is\s+greater\s+than\s+/i, build: (l, r) => mk("and", "gt", xT(l), xT(r)) },
  { re: /\s+is\s+less\s+than\s+/i, build: (l, r) => mk("and", "lt", xT(l), xT(r)) },
  { re: /\s+equals\s+/i, build: (l, r) => mk("and", "eq", xT(l), xT(r)) },
  { re: /\s+>=\s+|\s+≥\s+/i, build: (l, r) => mk("and", "gte", xT(l), xT(r)) },
  { re: /\s+<=\s+|\s+≤\s+/i, build: (l, r) => mk("and", "lte", xT(l), xT(r)) },
  { re: /\s+>\s+/i, build: (l, r) => mk("and", "gt", xT(l), xT(r)) },
  { re: /\s+<\s+/i, build: (l, r) => mk("and", "lt", xT(l), xT(r)) },
  { re: /\s+=\s+/i, build: (l, r) => mk("and", "eq", xT(l), xT(r)) },
];

/** Wrap bare numbers on either side into number terms for nicer pills. */
const smartTerm = (src: string): Term => {
  const s = src.trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return { mode: "num", v: s };
  return { mode: "expr", src: s };
};

/**
 * Parse the text view back into rows: one condition per line, optional
 * leading "and"/"or", plain-word or symbol operators. Returns per-line
 * errors so the UI can flag exactly which line failed.
 */
export function textToRows(src: string): { rows?: V2Row[]; errors: Map<number, string> } {
  const errors = new Map<number, string>();
  const out: V2Row[] = [];
  const lines = src.split("\n");
  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    let logic: "and" | "or" = "and";
    let rest = line;
    const lead = /^(and|or)\s+/i.exec(line);
    if (lead) {
      logic = lead[1].toLowerCase() as "and" | "or";
      rest = line.slice(lead[0].length);
    }
    // "is between A and B" — split the remainder on its top-level " and "
    const betweenM = /^(.*?)\s+is\s+between\s+(.+)$/i.exec(rest);
    if (betweenM) {
      const tail = betweenM[2];
      const andIdx = tail.toLowerCase().lastIndexOf(" and ");
      if (andIdx === -1) {
        errors.set(i, "“is between” needs two values: X is between A and B");
        return;
      }
      const lo = tail.slice(0, andIdx);
      const hi = tail.slice(andIdx + 5);
      for (const side of [betweenM[1], lo, hi]) {
        if (!side.trim()) { errors.set(i, "Empty side in “is between”"); return; }
        const p = parseProExpr(side.trim());
        if (!p.ok) { errors.set(i, p.error); return; }
      }
      out.push({
        id: nextRowId(),
        logic,
        op: "between",
        left: smartTerm(betweenM[1]),
        right: smartTerm(lo),
        right2: smartTerm(hi),
        pct: "",
      });
      return;
    }
    // "within X% of"
    const withinM = /^(.*?)\s+is\s+within\s+([\d.]+)%\s+of\s+(.+)$/i.exec(rest);
    if (withinM) {
      const p = parseProExpr(withinM[1]);
      const q = parseProExpr(withinM[3]);
      if (!p.ok) { errors.set(i, p.error); return; }
      if (!q.ok) { errors.set(i, q.error); return; }
      out.push({ id: nextRowId(), logic, op: "withinPct", left: smartTerm(withinM[1]), right: smartTerm(withinM[3]), right2: null, pct: withinM[2] });
      return;
    }
    for (const t of TEXT_OPS) {
      const re = new RegExp(t.re.source, "i");
      const raw = re.exec(rest);
      if (!raw || raw.index === undefined) continue;
      const l = rest.slice(0, raw.index).trim();
      const r = rest.slice(raw.index + raw[0].length).trim();
      if (!l || !r) { errors.set(i, "Both sides are required"); return; }
      const pl = parseProExpr(l);
      const pr = parseProExpr(r);
      if (!pl.ok) { errors.set(i, pl.error); return; }
      if (!pr.ok) { errors.set(i, pr.error); return; }
      const built = t.build(l, r);
      out.push({ ...built, id: nextRowId(), logic, left: smartTerm(l), right: smartTerm(r) });
      return;
    }
    errors.set(i, "No operator found — try “close is greater than sma(close, 200)”");
  });
  return { rows: errors.size === 0 ? out : undefined, errors };
}

/** Rows → text (the text view's starting content). */
export function rowsToText(rows: V2Row[]): string {
  return rows
    .map((r, i) => {
      const lead = i === 0 ? "" : r.logic === "or" ? "or " : "and ";
      return `${lead}${rowExprText(r)}`;
    })
    .join("\n");
}

// ================================================================ universe & filters bar

export interface UniverseState {
  universe: "all" | "n50" | "n500" | "fno";
  minPrice: string;
  minMcapCr: string;
  minTurnoverCr: string;
}

const DEFAULT_UNIVERSE: UniverseState = { universe: "all", minPrice: "", minMcapCr: "", minTurnoverCr: "" };

const UNIVERSE_LABEL = (u: UniverseState): string => {
  const bits: string[] = [];
  if (u.universe === "n50") bits.push("Nifty 50");
  else if (u.universe === "n500") bits.push("Nifty 500");
  else if (u.universe === "fno") bits.push("F&O");
  if (u.minPrice.trim()) bits.push(`₹${u.minPrice}+`);
  if (u.minMcapCr.trim()) bits.push(`₹${u.minMcapCr}cr+`);
  if (u.minTurnoverCr.trim()) bits.push(`t/o ₹${u.minTurnoverCr}cr+`);
  return bits.length ? bits.join(" · ") : "All NSE";
};

/** The "Universe & filters" bar — baseline filters never take scan slots. */
function UniverseBar({
  state,
  onChange,
}: {
  state: UniverseState;
  onChange: (u: UniverseState) => void;
}) {
  const num = (key: keyof UniverseState, placeholder: string, label: string, title: string) => (
    <label className="flex items-center gap-1 text-[10px] text-zinc-500" title={title}>
      {label}
      <Input
        type="number"
        min={0}
        value={state[key] as string}
        onChange={(e) => onChange({ ...state, [key]: e.target.value })}
        placeholder={placeholder}
        aria-label={label}
        className="h-7 w-20 border-zinc-800 bg-zinc-950 px-1.5 text-center font-mono text-xs text-zinc-100"
      />
    </label>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Universe &amp; filters</span>
      <select
        value={state.universe}
        onChange={(e) => onChange({ ...state, universe: e.target.value as UniverseState["universe"] })}
        className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-1.5 text-xs text-zinc-200"
        aria-label="Universe"
        title="Which stocks are even considered — baseline filters don't use condition slots"
      >
        <option value="all">All NSE</option>
        <option value="n50">Nifty 50</option>
        <option value="n500">Nifty 500 (top 500 by mcap)</option>
        <option value="fno">F&amp;O eligible</option>
      </select>
      {num("minPrice", "50", "Min price ₹", "Close at or above this price — filters out penny stocks")}
      {num("minMcapCr", "1000", "Min mcap ₹Cr", "Market cap at or above this many ₹ crore")}
      {num("minTurnoverCr", "1", "Min turnover ₹Cr", "Close × volume at or above this many ₹ crore — liquidity floor")}
    </div>
  );
}

// ================================================================ main component

export interface BuilderStateInfo {
  name: string | null;
  dirty: boolean;
  wireJson: string;
}

export interface BuilderInitial {
  rows: V2Row[];
  name: string | null;
  screenId: string | null;
  baselineWire: string;
  legacyOrNote?: boolean;
  uni?: UniverseState;
}

const blankRow = (): V2Row => ({
  id: nextRowId(),
  logic: "and",
  op: "gt",
  left: { mode: "field", f: "close", tf: "d", off: 0, p: 50 },
  right: { mode: "num", v: "" },
  right2: null,
  pct: "",
});

// ================================================================ main component

/** Pattern-insert menu — one click replaces a hand-built row stack. */
const PATTERN_TEMPLATES: { key: string; label: string; rows: Omit<V2Row, "id">[] }[] = [
  { key: "hh", label: "N consecutive higher weekly highs", rows: [mkPat("and", "higherHighs", "w", 4)] },
  { key: "ll", label: "N consecutive lower daily lows", rows: [mkPat("and", "lowerLows", "d", 3)] },
  { key: "52w", label: "Within 2% of 52-week high", rows: [mk("and", "withinPct", fT("close"), fT("maxHigh", { p: 252 }), { pct: "2" })] },
  { key: "volx", label: "Volume ≥ 2× its 20-day average", rows: [mk("and", "gt", fT("volume"), xT("2 * sma(volume, 20)"))] },
  { key: "chg5", label: "5-day % change", rows: [mk("and", "gt", xT("pct_change(close, 5)"), nT("0"))] },
  { key: "range", label: "Today's range %", rows: [mk("and", "gt", xT("(high - low) / close * 100"), nT("3"))] },
];

export function ConditionBuilder({
  sectors,
  onSelectStock,
  initial,
  onStateChange,
  onSaveNew,
  onUpdate,
}: {
  sectors: (string | null)[];
  onSelectStock: (s: string) => void;
  initial?: BuilderInitial | null;
  onStateChange?: (s: BuilderStateInfo) => void;
  onSaveNew?: (name: string, definition: unknown) => Promise<string | null>;
  onUpdate?: (id: string, name: string, definition: unknown) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<V2Row[]>(() => initial?.rows ?? []);
  const [applied, setApplied] = useState<V2Row[] | null>(() => initial?.rows ?? null);
  const [universe, setUniverse] = useState<UniverseState>(() => initial?.uni ?? DEFAULT_UNIVERSE);
  const [appliedUni, setAppliedUni] = useState<UniverseState>(() => initial?.uni ?? DEFAULT_UNIVERSE);
  const [editingName, setEditingName] = useState<string | null>(initial?.name ?? null);
  const [editingId, setEditingId] = useState<string | null>(initial?.screenId ?? null);
  const baselineRef = useRef<string>(initial?.baselineWire ?? "");
  const [sourceName, setSourceName] = useState<string | null>(initial?.name ?? null);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [textErrors, setTextErrors] = useState<Map<number, string>>(new Map());
  const [collapsed, setCollapsed] = useState(false);
  const [showValues, setShowValues] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [sector, setSector] = useState("all");
  const [bSort, setBSort] = useState("marketCap");
  const [bDir, setBDir] = useState<"asc" | "desc">("desc");
  const [bPage, setBPage] = useState(1);
  const [previewWire, setPreviewWire] = useState<string | null>(null);
  const dragId = useRef<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  /** Push the current editing state up (called from mutation handlers only). */
  const report = (next: V2Row[], over?: { name?: string | null; baseline?: string }) => {
    if (!onStateChange) return;
    const name = over?.name !== undefined ? over.name : editingName;
    const base = over?.baseline !== undefined ? over.baseline : baselineRef.current;
    const wireJson = wirePayload(next);
    onStateChange({ name, dirty: base !== wireJson, wireJson });
  };

  const commit = (next: V2Row[]) => {
    setRows(next);
    report(next);
  };

  const addRow = () => {
    if (rows.length >= MAX_BUILDER_ROWS) return;
    commit([...rows, blankRow()]);
  };

  const duplicateRow = (id: number) => {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0 || rows.length >= MAX_BUILDER_ROWS) return;
    const copy: V2Row = { ...rows[idx], id: nextRowId() };
    const next = [...rows.slice(0, idx + 1), copy, ...rows.slice(idx + 1)];
    commit(next);
  };

  const patchRow = (id: number, patch: Partial<V2Row>) =>
    commit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRow = (id: number) => {
    const next = rows.filter((r) => r.id !== id);
    commit(next);
    if (next.length === 0) setApplied(null);
  };

  const setLogic = (id: number, logic: "and" | "or") => patchRow(id, { logic });

  const moveRow = (fromId: number, toId: number) => {
    const from = rows.findIndex((r) => r.id === fromId);
    const to = rows.findIndex((r) => r.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  const loadRowSet = (preset: Omit<V2Row, "id">[], note?: string, presetName?: string) => {
    const loaded = preset.map((r) => ({ ...r, id: nextRowId() }));
    commit(loaded);
    baselineRef.current = wirePayload(loaded);
    if (presetName) setSourceName(presetName);
    setApplied(null);
    setCollapsed(false);
    setBPage(1);
    if (note) toast({ title: note });
  };

  // ------------------------------------------------------------ validation
  const errMap = useMemo(() => new Map(rows.map((r) => [r.id, rowErrors(r)])), [rows]);
  const firstBadRow = rows.findIndex((r) => Object.keys(errMap.get(r.id) ?? {}).length > 0);
  const complete = rows.length > 0 && firstBadRow === -1;
  const applyTooltip = !complete
    ? rows.length === 0
      ? "Add at least one condition first"
      : `Row ${firstBadRow + 1}: ${firstErrorText(errMap.get(rows[firstBadRow].id) ?? {}) ?? "is incomplete"}`
    : "Run the screen";

  // ------------------------------------------------------------ live counter (debounced)
  const liveWireJson = useMemo(() => wirePayload(rows), [rows]);
  const appliedWireJson = useMemo(() => (applied ? wirePayload(applied) : null), [applied]);
  const uniKey = JSON.stringify(universe);
  const appliedUniKey = JSON.stringify(appliedUni);
  const applyDirty = applied != null && (liveWireJson !== appliedWireJson || uniKey !== appliedUniKey);
  const sourceDirty = sourceName != null && liveWireJson !== baselineRef.current;

  useEffect(() => {
    const t = setTimeout(() => setPreviewWire(complete ? liveWireJson : null), 450);
    return () => clearTimeout(t);
  }, [liveWireJson, complete]);

  /** Universe-bar params appended to every screen query. */
  const withUni = (params: URLSearchParams) => {
    if (universe.universe !== "all") params.set("universe", universe.universe);
    if (universe.minPrice.trim()) params.set("minPrice", universe.minPrice);
    if (universe.minMcapCr.trim()) params.set("minMcapCr", universe.minMcapCr);
    if (universe.minTurnoverCr.trim()) params.set("minTurnoverCr", universe.minTurnoverCr);
  };

  const { data: cData, isFetching: cFetching, error: cError } = useQuery<StocksResponse>({
    queryKey: ["condPreview", previewWire, sector, bSort, bDir, uniKey],
    queryFn: async () => {
      const params = new URLSearchParams({ cond: previewWire ?? "[]", sector, sort: bSort, dir: bDir, page: "1", perPage: "10" });
      withUni(params);
      const res = await fetch(`/api/stocks?${params}`);
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d?.error ?? "Preview failed");
      }
      return res.json();
    },
    placeholderData: keepPreviousData,
    enabled: previewWire !== null,
  });

  // ------------------------------------------------------------ applied results
  // Computed-value columns: left/right of the first expr rows, capped at 6.
  const colExprs = useMemo(() => {
    if (!applied || !showValues) return [];
    const out: string[] = [];
    for (const r of applied) {
      if (r.pat) continue;
      out.push(termToExpr(r.left));
      if (out.length >= 6) break;
      out.push(termToExpr(r.right));
      if (out.length >= 6) break;
    }
    return out;
  }, [applied, showValues]);

  const { data: bData, isLoading: bLoading, error: bError } = useQuery<StocksResponse>({
    queryKey: ["screenerBuilder", appliedWireJson, appliedUniKey, sector, bSort, bDir, bPage, colExprs.join("|")],
    queryFn: async () => {
      const params = new URLSearchParams({
        cond: appliedWireJson ?? "[]", sector, sort: bSort, dir: bDir, page: String(bPage), perPage: "25",
      });
      withUni(params);
      if (colExprs.length > 0) params.set("cols", JSON.stringify(colExprs));
      const res = await fetch(`/api/stocks?${params}`);
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d?.error ?? "Screen failed — check the conditions");
      }
      return res.json();
    },
    placeholderData: keepPreviousData,
    enabled: appliedWireJson !== null,
  });

  const applyConditions = () => {
    if (!complete) return;
    setApplied(rows);
    setAppliedUni(universe);
    setBPage(1);
    setCollapsed(true);
  };

  const resetConditions = () => {
    if (rows.length >= 3 && !resetConfirm) {
      setResetConfirm(true);
      window.setTimeout(() => setResetConfirm(false), 3500);
      return;
    }
    setResetConfirm(false);
    commit([]);
    setApplied(null);
    setBPage(1);
    setSourceName(null);
    baselineRef.current = "";
  };

  // ------------------------------------------------------------ save / update
  const definition = useMemo(
    () => ({
      v: 2,
      rows: rows.map((r) => {
        const copy = { ...r } as Record<string, unknown>;
        delete copy.id;
        return copy;
      }),
      uni: universe,
    }),
    [rows, universe]
  );

  const saveAsNew = async () => {
    const name = nameDraft.trim();
    if (!name || !onSaveNew || saving) return;
    setSaving(true);
    try {
      const id = await onSaveNew(name, definition);
      if (id) {
        setEditingId(id);
        setEditingName(name);
        setSourceName(name);
        baselineRef.current = liveWireJson;
        report(rows, { name, baseline: liveWireJson });
        setNameOpen(false);
        setNameDraft("");
      }
    } finally {
      setSaving(false);
    }
  };

  const updateExisting = async () => {
    if (!editingId || !onUpdate || saving) return;
    setSaving(true);
    try {
      const ok = await onUpdate(editingId, editingName ?? "", definition);
      if (ok) {
        baselineRef.current = liveWireJson;
        report(rows, { baseline: liveWireJson });
      }
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------ text view apply
  const applyText = () => {
    const res = textToRows(textDraft);
    if (!res.rows) {
      setTextErrors(res.errors);
      return;
    }
    setTextErrors(new Map());
    commit(res.rows);
    setApplied(null);
    setTextOpen(false);
    setCollapsed(false);
    toast({ title: `Applied ${res.rows.length} conditions from text` });
  };

  const openText = () => {
    setTextDraft(rowsToText(rows));
    setTextErrors(new Map());
    setTextOpen(true);
    setFormulaOpen(false);
  };

  // ------------------------------------------------------------ segments (OR groups)
  const segs = useMemo(() => {
    const out: number[][] = [];
    rows.forEach((r, i) => {
      if (i === 0 || r.logic === "and") out.push([i]);
      else out[out.length - 1].push(i);
    });
    return out;
  }, [rows]);

  const copyFormula = () => {
    const text =
      rows.map((r, i) => `${i + 1}. ${rowExprText(r)}`).join("\n") + `\n\n${formulaText(rows)}`;
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast({ title: "Formula copied" }))
      .catch(() => toast({ title: "Could not copy", variant: "destructive" }));
  };

  const nameEditor = (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void saveAsNew()}
        placeholder="Screen name…"
        aria-label="Screen name"
        className="h-8 w-40 border-zinc-700 bg-zinc-900 text-xs text-zinc-100"
      />
      <Button
        size="sm"
        disabled={saving || !nameDraft.trim()}
        onClick={() => void saveAsNew()}
        className="h-8 bg-brand px-2.5 text-xs text-white hover:bg-brand-hover"
      >
        Save
      </Button>
      <button
        type="button"
        onClick={() => setNameOpen(false)}
        aria-label="Cancel save"
        className="rounded p-1 text-zinc-500 hover:text-zinc-300"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const totalPages = (total: number, perPage: number) => Math.max(1, Math.ceil(total / perPage));

  const rowArea = rows.length > 0 && (
    <div className="space-y-1">
      {segs.map((seg, si) => {
        const multi = seg.length > 1;
        const body = seg.map((rowIdx, j) => (
          <div key={rows[rowIdx].id}>
            {multi && j > 0 && <LogicChip value="or" onToggle={() => setLogic(rows[rowIdx].id, "and")} />}
            <RowCard
              row={rows[rowIdx]}
              index={rowIdx}
              errors={errMap.get(rows[rowIdx].id) ?? {}}
              dragOver={dragOverId === rows[rowIdx].id}
              onPatch={(patch) => patchRow(rows[rowIdx].id, patch)}
              onRemove={() => removeRow(rows[rowIdx].id)}
              onDuplicate={() => duplicateRow(rows[rowIdx].id)}
              onDragStart={(e) => {
                dragId.current = rows[rowIdx].id;
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOverId !== rows[rowIdx].id) setDragOverId(rows[rowIdx].id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId.current != null) moveRow(dragId.current, rows[rowIdx].id);
                dragId.current = null;
                setDragOverId(null);
              }}
              onDragEnd={() => setDragOverId(null)}
            />
          </div>
        ));
        return (
          <div key={rows[seg[0]].id}>
            {si > 0 && <LogicChip value="and" onToggle={() => setLogic(rows[seg[0]].id, "or")} />}
            {multi ? (
              <div
                className="rounded-r-lg border-l-2 border-gold/50 bg-gold/[0.04] py-1.5 pl-2 pr-1"
                title="OR group — matches when any row inside matches"
              >
                {body}
              </div>
            ) : (
              body
            )}
          </div>
        );
      })}
      {rows.length >= MAX_BUILDER_ROWS && (
        <p className="pt-1 text-[10px] text-gold-text">Row limit reached ({MAX_BUILDER_ROWS} conditions).</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="space-y-3 p-3">
          {/* sticky toolbar — Run / counter / Save always in reach */}
          <div className="sticky top-0 z-20 -mx-3 -mt-1 rounded-t-lg border-b border-zinc-800/60 bg-zinc-950/95 px-3 py-2 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={addRow}
                disabled={rows.length >= MAX_BUILDER_ROWS}
                className="h-8 border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                <Plus className="h-3.5 w-3.5" /> Add condition
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-200 hover:bg-zinc-800"
                  >
                    Insert pattern <ChevronDown className="ml-1 h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="border-zinc-700 bg-zinc-900 text-zinc-200">
                  {PATTERN_TEMPLATES.map((t) => (
                    <DropdownMenuItem key={t.key} onClick={() => loadRowSet(t.rows, `Pattern added — ${t.label}`)}>
                      {t.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <select
                value=""
                onChange={(e) => {
                  const p = PRESETS.find((x) => x.name === e.target.value);
                  if (p) loadRowSet(p.rows, `Preset loaded — “${p.name}”`, p.name);
                }}
                className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-300"
                aria-label="Load a preset screen"
              >
                <option value="">Load preset…</option>
                {PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
              {rows.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setFormulaOpen((v) => !v);
                      setTextOpen(false);
                    }}
                    title="Show the formula the builder represents (read-only, copy-friendly)"
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                      formulaOpen
                        ? "border-brand/50 bg-brand/10 text-brand-text"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                    )}
                  >
                    <span className="font-mono">{"{ }"}</span> Formula
                  </button>
                  <button
                    type="button"
                    onClick={() => (textOpen ? setTextOpen(false) : openText())}
                    title="Edit the conditions as text — applied back to the builder"
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                      textOpen
                        ? "border-brand/50 bg-brand/10 text-brand-text"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                    )}
                  >
                    ⇄ Text
                  </button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={resetConditions}
                className={cn(
                  "h-8 px-2.5 text-xs",
                  resetConfirm ? "bg-loss/10 text-loss hover:text-loss" : "text-zinc-500 hover:text-zinc-300"
                )}
                title={resetConfirm ? "Click again to clear all conditions" : "Clear all conditions"}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {resetConfirm ? "Clear everything?" : "Reset"}
              </Button>

              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {/* editing: [source] • unsaved chip */}
                {sourceName && (
                  <span
                    className="hidden items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] lg:inline-flex"
                    title={sourceDirty ? "Edits not saved to this screen yet" : "All edits saved"}
                  >
                    <span className="text-zinc-500">editing:</span>
                    <span className="font-medium text-zinc-300">{sourceName}</span>
                    <span className={sourceDirty ? "text-gold-text" : "text-emerald-400"}>
                      • {sourceDirty ? "unsaved" : "saved"}
                    </span>
                  </span>
                )}

                {/* live match counter */}
                <span className="text-[11px]" aria-live="polite">
                  {!complete ? (
                    <span className="italic text-zinc-600">
                      {rows.length === 0 ? "Add a condition to preview" : "Complete all fields to preview"}
                    </span>
                  ) : cFetching ? (
                    <span className="animate-pulse text-zinc-400">checking…</span>
                  ) : cError ? (
                    <span className="text-gold-text">
                      Preview failed — {cError instanceof Error ? cError.message : "check conditions"}
                    </span>
                  ) : cData ? (
                    cData.total === 0 ? (
                      <span className="text-gold-text">0 stocks match — check your condition values</span>
                    ) : (
                      <span className="text-zinc-300">
                        <b className="font-semibold text-brand-text">~{cData.total.toLocaleString("en-IN")}</b> stocks match
                      </span>
                    )
                  ) : (
                    <span className="text-zinc-600">…</span>
                  )}
                </span>

                {editingId ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() => void updateExisting()}
                      disabled={saving || !complete}
                      title="Save these conditions over the loaded screen"
                      className="h-8 bg-brand px-3 text-xs text-white hover:bg-brand-hover"
                    >
                      {saving ? "Saving…" : "Update"}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-zinc-700 bg-zinc-900 px-1.5 text-zinc-300 hover:bg-zinc-800"
                          aria-label="More save options"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="border-zinc-700 bg-zinc-900 text-zinc-200">
                        <DropdownMenuItem
                          onClick={() => {
                            setNameDraft(editingName ? `${editingName} copy` : "");
                            setNameOpen(true);
                          }}
                        >
                          Save as new…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                ) : nameOpen ? (
                  nameEditor
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setNameOpen(true)}
                    disabled={!complete}
                    title={complete ? "Save these conditions under a name" : applyTooltip}
                    className="h-8 gap-1.5 bg-brand px-3 text-xs font-medium text-white hover:bg-brand-hover"
                  >
                    Save screen
                  </Button>
                )}

                <span title={applyTooltip}>
                  <Button
                    size="sm"
                    onClick={applyConditions}
                    disabled={!complete}
                    className="relative h-8 bg-brand px-3 text-xs text-white hover:bg-brand-hover"
                  >
                    Run
                    {applyDirty && (
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-gold" title="Edits not applied yet" />
                    )}
                  </Button>
                </span>
              </div>
            </div>
            {!complete && rows.length > 0 && (
              <p className="mt-1 truncate text-right text-[10px] text-loss" title={applyTooltip}>
                Run is disabled — {applyTooltip}
              </p>
            )}
          </div>

          {initial?.legacyOrNote && (
            <p className="rounded-md border border-gold/30 bg-gold/[0.06] px-3 py-1.5 text-[11px] leading-relaxed text-gold-text">
              Loaded an older-format screen — OR chips now read as boxed OR-groups (A AND (B OR C)).
              Double-check the amber boxes before re-running.
            </p>
          )}

          <UniverseBar
            state={universe}
            onChange={(u) => {
              setUniverse(u);
              setBPage(1);
            }}
          />

          {/* conditions + OR groups, or the empty state, or the collapsed summary */}
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-zinc-800 py-10 text-center">
              <SlidersHorizontal className="h-6 w-6 text-zinc-700" />
              <div>
                <p className="text-xs font-medium text-zinc-300">Build your screen condition by condition</p>
                <p className="mt-1 max-w-md text-[11px] leading-relaxed text-zinc-500">
                  Every row reads as a sentence of pills — [Latest] [Close] [is greater than] [SMA(Close, 200)].
                  Chain with and / OR, insert a pattern for streaks, and the live counter previews matches as you type.
                  Baseline filters live in the Universe bar, so they never use condition slots.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => loadRowSet([mk("and", "lt", fT("rsi14"), nT("30"))])}
                  className="h-7 border-zinc-700 bg-zinc-900 text-[11px] text-zinc-200 hover:bg-zinc-800"
                >
                  Try an example — RSI(14) &lt; 30
                </Button>
                <span className="text-[10px] text-zinc-600">or start from a popular scan:</span>
                {SHORTCUTS.map((s) => (
                  <Button
                    key={s.key}
                    size="sm"
                    variant="ghost"
                    onClick={() => loadRowSet(s.rows, `Starter loaded — ${s.label}`)}
                    className="h-7 border border-zinc-800 px-2 text-[11px] text-zinc-400 hover:text-zinc-200"
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : collapsed && applied ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2.5 text-left transition-colors hover:border-brand/40"
              title="Expand the condition builder"
            >
              <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
              <span className="text-xs text-zinc-300">
                <b className="font-semibold text-brand-text">{rows.length}</b> condition{rows.length === 1 ? "" : "s"}
                {appliedUni.universe !== "all" || appliedUni.minPrice || appliedUni.minMcapCr || appliedUni.minTurnoverCr
                  ? ` · universe: ${UNIVERSE_LABEL(appliedUni)}`
                  : ""}
              </span>
              <span className="ml-auto text-[11px] text-zinc-500">click to edit · results below</span>
            </button>
          ) : (
            rowArea
          )}

          {/* text view — bidirectional */}
          {rows.length > 0 && textOpen && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Text — one condition per line; lead lines 2+ with “and” / “or”
              </p>
              <textarea
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                spellCheck={false}
                rows={Math.min(14, Math.max(4, textDraft.split("\n").length + 1))}
                aria-label="Conditions as text"
                className="w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 p-2.5 font-mono text-xs leading-6 text-zinc-100 outline-none focus:border-brand/60"
                placeholder={"close is greater than sma(close, 200)\nand rsi14 is greater than 60"}
              />
              {[...textErrors.entries()].map(([line, msg]) => (
                <p key={line} className="text-[10px] leading-tight text-loss">
                  Line {line + 1}: {msg}
                </p>
              ))}
              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={applyText}
                  className="h-7 bg-brand px-2.5 text-[11px] text-white hover:bg-brand-hover"
                >
                  Apply to builder
                </Button>
                <span className="text-[10px] text-zinc-600">
                  Supports plain-word and symbol operators, {`pct_change(close, 5)`}, unit suffixes (3cr).
                </span>
              </div>
            </div>
          )}

          {/* formula view — read-only mirror */}
          {rows.length > 0 && formulaOpen && !textOpen && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Formula</span>
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">{formulaText(rows)}</code>
                <button
                  type="button"
                  onClick={copyFormula}
                  className="flex items-center gap-1 rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-brand/40 hover:text-brand-text"
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
              </div>
              <div className="mt-2 space-y-1">
                {rows.map((r, i) => (
                  <div key={r.id} className="flex gap-2 text-[11px] leading-relaxed">
                    <span className="w-5 shrink-0 text-right font-mono text-zinc-600">{i + 1}</span>
                    <code className="min-w-0 break-all font-mono text-zinc-400">{rowExprText(r)}</code>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-zinc-600">
                Numbers reference the condition rows. Edit in the builder, or open ⇄ Text to type conditions instead.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* sector / sort / export row */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sector}
          onChange={(e) => {
            setSector(e.target.value);
            setBPage(1);
          }}
          className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300"
          aria-label="Sector filter"
        >
          <option value="all">All sectors</option>
          {sectors.filter(Boolean).map((s) => (
            <option key={s as string} value={s as string}>{s as string}</option>
          ))}
        </select>
        <select
          value={bSort}
          onChange={(e) => {
            setBSort(e.target.value);
            setBPage(1);
          }}
          className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300"
          aria-label="Sort results by"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>Sort: {s.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setBDir((d) => (d === "desc" ? "asc" : "desc"))}
          className="rounded-full px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-200"
        >
          {bDir === "desc" ? "↓ Descending" : "↑ Ascending"}
        </button>
        {applied && applied.some((r) => !r.pat) && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400" title="Evaluate each condition's expressions for the visible stocks so you can verify the math">
            <input
              type="checkbox"
              checked={showValues}
              onChange={(e) => setShowValues(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--brand,#10b981)]"
            />
            Show computed values
          </label>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-8 border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-200 hover:bg-zinc-800"
          onClick={() => {
            if (!bData || bData.stocks.length === 0) {
              toast({ title: "Nothing to export yet" });
              return;
            }
            exportCsv(
              `tradepulse-screen-${csvDate()}.csv`,
              ["Symbol", "Name", "Price", "Change %", "Volume", "Vol vs 20D avg", "RSI", "1M %", "3M %", "6M %", "P/E", "From 52W high %", "Market cap Cr", "Sector"],
              bData.stocks.map((r) => [
                r.symbol.replace(".NS", ""), r.name, r.price, r.changePct, r.volume,
                r.relVol != null ? Number(r.relVol.toFixed(2)) : null, r.rsi14,
                r.mom1M, r.mom3M, r.mom6M, r.peTTM, r.fromHighPct,
                r.marketCap != null ? Math.round(r.marketCap / 1e7) : null, r.sector,
              ])
            );
            toast({ title: "CSV exported" });
          }}
        >
          Export CSV
        </Button>
      </div>

      {/* results */}
      {applied ? (
        <>
          {bError && (
            <p className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss">
              {bError instanceof Error ? bError.message : "Screen failed — check the conditions."}
            </p>
          )}
          <ResultsTable rows={bData?.stocks} isLoading={bLoading} onSelectStock={onSelectStock} showValues={showValues && colExprs.length > 0} />
          {bData && bData.total > bData.perPage && (
            <Pager page={bPage} totalPages={totalPages(bData.total, bData.perPage)} onPage={setBPage} />
          )}
        </>
      ) : (
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <SlidersHorizontal className="h-6 w-6 text-zinc-700" />
            <p className="text-xs text-zinc-500">Set your conditions and hit Run to screen the universe.</p>
            {rows.length > 0 && complete && (
              <p className="text-[11px] text-zinc-600">
                The live counter above already previews the match count — Run pins it to the results table.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
