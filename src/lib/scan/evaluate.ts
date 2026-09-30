/**
 * Scan builder — scan evaluator (vectorised across the universe).
 *
 * Compiles a Scan into a boolean mask over every stock, combining groups
 * (all = AND, any N = at least N true, none = NOT any). Everything runs
 * against the whitelisted registry — unknown ids can never reach here —
 * with hard caps on token count, node count and nesting depth. NaN values
 * (missing data / insufficient history) make a clause false and count the
 * stock as "skipped", reported back to the UI.
 */
import type { Clause, ComparatorId, Group, Scan } from "./expr-model";
import { byId } from "./registry";
import "./registry-items"; // registers the whitelist — must load before any byId check
import { getStore, type Store } from "./columns";
import { attrScalar, exprScalar, segFor } from "./attr-series";
import type { Expr, FundPeriod, Term } from "./expr-model";

export const MAX_EXPR_TOKENS = 80;
export const MAX_DEPTH = 8;
export const MAX_GROUP_NODES = 200;

export interface ScanRunResult {
  matched: string[];
  totalUniverse: number;
  fundAvailable: number | null;
  skipped: number;
  unevaluable: string[];
}

interface EvalStats {
  skipped: Uint8Array;
  unevaluable: Set<string>;
  fundFields: Set<string>;
}

// ---------------------------------------------------------------- validation

export function validateScan(scan: Scan): { ok: true } | { ok: false; error: string } {
  let nodes = 0;
  const visit = (g: Group, depth: number): string | null => {
    if (depth > MAX_DEPTH) return "Group nesting deeper than 8 levels";
    nodes++;
    if (nodes > MAX_GROUP_NODES) return "More than 200 groups/clauses";
    for (const c of g.children) {
      if (c.kind === "group") {
        const e = visit(c, depth + 1);
        if (e) return e;
      } else {
        nodes++;
        if (nodes > MAX_GROUP_NODES) return "More than 200 groups/clauses";
        for (const side of [c.left, c.right, c.right2 ?? []]) {
          if (side.length > MAX_EXPR_TOKENS) return "An expression is longer than 80 tokens";
        }
      }
    }
    return null;
  };
  const e = visit(scan.root, 1);
  return e ? { ok: false, error: e } : { ok: true };
}

// ---------------------------------------------------------------- clause evaluation

function evalTextSide(s: { store: Store; si: number }, expr: Expr): string {
  // text attr on the left / literal on the right — single term is the shape
  const t = expr[0];
  if (!t || t.t === "op") return "";
  if (t.t === "text") return t.value;
  if (t.t === "attr") {
    const v = attrScalar(s, t.name, t.period);
    return typeof v === "string" ? v : "";
  }
  return "";
}

function textAttrOf(expr: Expr): { name: string; period?: FundPeriod } | null {
  const t = expr[0];
  if (!t || t.t !== "attr") return null;
  const item = byId(t.name);
  if (!item || item.returns !== "text") return null;
  return { name: t.name, period: t.period };
}

function collectFundFields(expr: Expr, out: Set<string>) {
  for (const x of expr) {
    if (x.t === "op") continue;
    if (x.t === "attr") {
      const item = byId(x.name);
      if (item?.data === "yahoo-fundamentals") out.add(x.name);
    } else if (x.t === "fn") {
      for (const a of x.args) collectFundFields(a, out);
    } else if (x.t === "bracket") collectFundFields(x.inner, out);
  }
}

function hasTextComparison(clause: Clause): boolean {
  return textAttrOf(clause.left) != null;
}

/** One clause → 0/1 mask value per stock (vectorised loop, scalar per stock). */
function evalClause(store: Store, clause: Clause, stats: EvalStats, mask: Uint8Array): void {
  const n = store.symbols.length;
  if (!clause.enabled) {
    // disabled clauses are invisible: leave mask untouched (neutral for AND/OR counting)
    return;
  }
  if (hasTextComparison(clause)) {
    const attr = textAttrOf(clause.left)!;
    const val = clause.right[0];
    const lit = val && val.t === "text" ? val.value : "";
    const cmp = clause.cmp;
    const s = { store, si: 0 };
    for (let si = 0; si < n; si++) {
      s.si = si;
      const left = evalTextSide(s, clause.left);
      let pass = false;
      switch (cmp) {
        case "textEq": pass = left === lit; break;
        case "textNeq": pass = left !== lit && left !== ""; break;
        case "contains": pass = left.toLowerCase().includes(lit.toLowerCase()); break;
        case "inList": pass = lit.split(",").map((x) => x.trim().toLowerCase()).includes(left.toLowerCase()); break;
        default: pass = false;
      }
      void attr;
      mask[si] = pass ? 1 : 0;
    }
    return;
  }

  const flags = clause.cmp === "isTrue" || clause.cmp === "isFalse";
  for (let si = 0; si < n; si++) {
    const s = { store, si };
    const l = exprScalar(s, clause.left, "daily", 0);
    if (Number.isNaN(l)) { stats.skipped[si] = 1; mask[si] = 0; continue; }
    let pass = false;
    if (flags) {
      pass = clause.cmp === "isTrue" ? l === 1 : l === 0;
    } else {
      const r = exprScalar(s, clause.right, "daily", 0);
      if (Number.isNaN(r)) { stats.skipped[si] = 1; mask[si] = 0; continue; }
      switch (clause.cmp) {
        case "gt": pass = l > r; break;
        case "gte": pass = l >= r; break;
        case "lt": pass = l < r; break;
        case "lte": pass = l <= r; break;
        case "eq": pass = Math.abs(l - r) <= 1e-9 * Math.max(1, Math.abs(l), Math.abs(r)); break;
        case "neq": pass = !(Math.abs(l - r) <= 1e-9 * Math.max(1, Math.abs(l), Math.abs(r))); break;
        case "crossAbove": {
          const l1 = exprScalar(s, clause.left, "daily", 1);
          const r1 = exprScalar(s, clause.right, "daily", 1);
          if (Number.isNaN(l1) || Number.isNaN(r1)) { stats.skipped[si] = 1; break; }
          pass = l1 <= r1 && l > r;
          break;
        }
        case "crossBelow": {
          const l1 = exprScalar(s, clause.left, "daily", 1);
          const r1 = exprScalar(s, clause.right, "daily", 1);
          if (Number.isNaN(l1) || Number.isNaN(r1)) { stats.skipped[si] = 1; break; }
          pass = l1 >= r1 && l < r;
          break;
        }
        case "between": {
          const r2 = exprScalar(s, clause.right2 ?? [], "daily", 0);
          if (Number.isNaN(r2)) { stats.skipped[si] = 1; break; }
          pass = l >= Math.min(r, r2) && l <= Math.max(r, r2);
          break;
        }
        case "withinPct": {
          const pct = clause.pct ?? 0;
          pass = Math.abs(l - r) <= (pct / 100) * Math.abs(r);
          break;
        }
        default: pass = false;
      }
    }
    mask[si] = pass ? 1 : 0;
  }
  collectFundFields(clause.left, stats.fundFields);
  collectFundFields(clause.right, stats.fundFields);
}

// ---------------------------------------------------------------- group combination

function evalGroup(store: Store, group: Group, stats: EvalStats): Uint8Array {
  const n = store.symbols.length;
  const children = group.children.filter((c) => c.enabled);
  const masks = children.map((c) => (c.kind === "group" ? evalGroup(store, c, stats) : (() => {
    const m = new Uint8Array(n);
    evalClause(store, c, stats, m);
    return m;
  })()));
  const out = new Uint8Array(n);
  if (group.mode === "all") {
    out.fill(1);
    for (const m of masks) for (let i = 0; i < n; i++) out[i] &&= m[i];
  } else if (group.mode === "any") {
    const need = Math.max(1, group.anyCount ?? 1);
    for (let i = 0; i < n; i++) {
      let c = 0;
      for (const m of masks) c += m[i];
      out[i] = c >= Math.min(need, masks.length) ? 1 : 0;
    }
  } else {
    // none of the children may fire
    for (let i = 0; i < n; i++) {
      let any = 0;
      for (const m of masks) any |= m[i];
      out[i] = any ? 0 : 1;
    }
    // a none-group with zero active children is neutral-true (already 1)
  }
  return out;
}

// ---------------------------------------------------------------- run

export interface ScanRunOpts {
  /** restrict the universe to these DB symbols (Nifty 50 / F&O …) */
  restrictSymbols?: Set<string> | null;
}

export async function runScan(scan: Scan, opts?: ScanRunOpts): Promise<ScanRunResult> {
  const store = await getStore();
  const n = store.symbols.length;
  const stats: EvalStats = { skipped: new Uint8Array(n), unevaluable: new Set(), fundFields: new Set() };
  const t0 = Date.now();

  // clause-level "unknown implementation" detection happens via a dry walk:
  // every registry id referenced must be computable — attrSeries returns null
  // for those, which we surface by pre-walking the tree.
  const walkTerms = (expr: Expr) => {
    for (const x of expr ?? []) {
      if (x.t === "op") continue;
      if (x.t === "attr") {
        if (!byId(x.name)) stats.unevaluable.add(x.name);
      } else if (x.t === "fn") {
        if (!byId(x.name)) stats.unevaluable.add(x.name);
        for (const a of x.args ?? []) walkTerms(a);
      } else if (x.t === "bracket") walkTerms(x.inner ?? []);
    }
  };
  const walkGroup = (g: Group) => {
    for (const c of g.children) {
      if (c.enabled) {
        if (c.kind === "group") walkGroup(c);
        else { walkTerms(c.left); walkTerms(c.right); walkTerms(c.right2 ?? []); }
      }
      if (c.kind === "group") walkGroup(c);
    }
  };
  walkGroup(scan.root);

  let mask = evalGroup(store, scan.root, stats);
  void t0;

  if (opts?.restrictSymbols) {
    for (let si = 0; si < n; si++) {
      if (!opts.restrictSymbols.has(store.symbols[si])) mask[si] = 0;
    }
  }

  const matched: string[] = [];
  for (let si = 0; si < n; si++) if (mask[si]) matched.push(store.symbols[si]);

  let fundAvailable: number | null = null;
  if (stats.fundFields.size > 0) {
    let count = 0;
    for (let si = 0; si < n; si++) {
      let ok = true;
      for (const f of stats.fundFields) {
        const arr = store.fund.get(f);
        if (!arr || Number.isNaN(arr[si])) { ok = false; break; }
      }
      if (ok) count++;
    }
    fundAvailable = count;
  }

  let skipped = 0;
  for (let si = 0; si < n; si++) if (stats.skipped[si] && !mask[si]) skipped++;

  // matched sorted by market cap desc by default (the API re-sorts per request)
  matched.sort((a, b) => {
    const ai = store.bySym.get(a)!, bi = store.bySym.get(b)!;
    const am = store.snap.marketCap[ai], bm = store.snap.marketCap[bi];
    const av = Number.isFinite(am) ? am : -1;
    const bv = Number.isFinite(bm) ? bm : -1;
    return bv - av;
  });

  return { matched, totalUniverse: n, fundAvailable, skipped, unevaluable: [...stats.unevaluable] };
}

// ---------------------------------------------------------------- debug

export interface DebugRow { symbol: string; left: number | string | null; right: number | string | null; pass: boolean; skipped: boolean }

/** Left/right values of one clause for a handful of symbols (debug panel). */
export async function debugClause(clause: Clause, symbols: string[]): Promise<DebugRow[]> {
  const store = await getStore();
  const out: DebugRow[] = [];
  for (const sym of symbols) {
    const si = store.bySym.get(sym);
    if (si == null) continue;
    const s = { store, si };
    const textCmp = hasTextComparison(clause);
    if (textCmp) {
      const left = evalTextSide(s, clause.left);
      const rv = clause.right[0];
      const right = rv && rv.t === "text" ? rv.value : "";
      out.push({ symbol: sym, left, right, pass: clauseLeftPass(clause, left, right), skipped: false });
      continue;
    }
    const l = exprScalar(s, clause.left, "daily", 0);
    const r = exprScalar(s, clause.right, "daily", 0);
    const skipped = Number.isNaN(l) || Number.isNaN(r);
    out.push({
      symbol: sym,
      left: Number.isNaN(l) ? null : round6(l),
      right: Number.isNaN(r) ? null : round6(r),
      pass: !skipped && clauseNumPass(clause, l, r),
      skipped,
    });
  }
  return out;
}

function round6(v: number): number { return Math.round(v * 1e6) / 1e6; }

function clauseLeftPass(clause: Clause, left: string, right: string): boolean {
  switch (clause.cmp) {
    case "textEq": return left === right;
    case "textNeq": return left !== right;
    case "contains": return left.toLowerCase().includes(right.toLowerCase());
    case "inList": return right.split(",").map((x) => x.trim().toLowerCase()).includes(left.toLowerCase());
    default: return false;
  }
}

function clauseNumPass(clause: Clause, l: number, r: number): boolean {
  switch (clause.cmp) {
    case "gt": return l > r;
    case "gte": return l >= r;
    case "lt": return l < r;
    case "lte": return l <= r;
    case "eq": return Math.abs(l - r) <= 1e-9 * Math.max(1, Math.abs(l), Math.abs(r));
    case "neq": return !(Math.abs(l - r) <= 1e-9 * Math.max(1, Math.abs(l), Math.abs(r)));
    case "between": {
      const r2v = clause.right2?.length ? r : r;
      return l >= Math.min(r, r2v) && l <= Math.max(r, r2v);
    }
    case "withinPct": return Math.abs(l - r) <= ((clause.pct ?? 0) / 100) * Math.abs(r);
    default: return false;
  }
}

// between upper bound evaluated properly for debug
export async function debugClauseFull(clause: Clause, symbols: string[]): Promise<DebugRow[]> {
  const store = await getStore();
  const out: DebugRow[] = [];
  for (const sym of symbols) {
    const si = store.bySym.get(sym);
    if (si == null) continue;
    const s = { store, si };
    const l = exprScalar(s, clause.left, "daily", 0);
    const r = exprScalar(s, clause.right, "daily", 0);
    const r2 = clause.right2?.length ? exprScalar(s, clause.right2, "daily", 0) : NaN;
    const skipped = Number.isNaN(l) || (clause.cmp !== "isTrue" && clause.cmp !== "isFalse" && Number.isNaN(r));
    out.push({ symbol: sym, left: Number.isNaN(l) ? null : round6(l), right: Number.isNaN(r) ? null : round6(r), pass: !skipped && evalCmp(clause.cmp, l, r, r2, clause.pct ?? 0), skipped });
  }
  return out;
}

function evalCmp(cmp: ComparatorId, l: number, r: number, r2: number, pct: number): boolean {
  switch (cmp) {
    case "gt": return l > r;
    case "gte": return l >= r;
    case "lt": return l < r;
    case "lte": return l <= r;
    case "eq": return Math.abs(l - r) <= 1e-9 * Math.max(1, Math.abs(l), Math.abs(r));
    case "neq": return !(Math.abs(l - r) <= 1e-9 * Math.max(1, Math.abs(l), Math.abs(r)));
    case "isTrue": return l === 1;
    case "isFalse": return l === 0;
    case "between": return Number.isFinite(r2) ? l >= Math.min(r, r2) && l <= Math.max(r, r2) : false;
    case "withinPct": return Math.abs(l - r) <= (pct / 100) * Math.abs(r);
    default: return false;
  }
}

/** Segments export for value columns (debug table). */
export { segFor };
export type { Expr, Term };
