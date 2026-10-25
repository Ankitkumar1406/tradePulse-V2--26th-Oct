"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bookmark, BookmarkPlus, ChevronDown, Layers, Radar, Star, Trash2, X,
} from "lucide-react";
import { AddToWatchlistButton } from "@/components/add-to-watchlist";
import { csvDate, exportCsv } from "@/components/screener-tables";
import { fmtPct, fmtPrice } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** How many table rows render before the "Show more" button (full result stays reachable). */
const TABLE_PAGE = 100;

/**
 * The quick filter is the full TradingView-style screener (public/screener.html)
 * — declarative filter pills, 10 column tabs, presets, saved screens, CSV and
 * watchlist — fed entirely from TradePulse's own database via
 * /api/screener/universe. Embedding it as an iframe keeps the single-file
 * deliverable self-contained while inheriting the app's auth context (same
 * origin). Legacy quick-filter saved screens (kind="filters") map onto the
 * screener's URL-hash state so old bookmarks keep working.
 */
const LEGACY_SORT_MAP: Record<string, string> = {
  marketCap: "mcap", price: "price", changePct: "chgPct", volume: "vol",
  rsi14: "rsi14", mom1M: "perf1M", mom3M: "perf3M", mom6M: "perf6M",
  fromHighPct: "fromHi", fromLowPct: "fromLo",
};

function screenerHash(def: { q?: unknown; sector?: unknown; sort?: unknown; dir?: unknown }): string {
  const f: [string, unknown][] = [];
  if (typeof def.q === "string" && def.q.trim()) f.push(["q", def.q.trim()]);
  if (typeof def.sector === "string" && def.sector && def.sector !== "all") f.push(["sector", [def.sector]]);
  const legacySort = typeof def.sort === "string" ? LEGACY_SORT_MAP[def.sort] : undefined;
  const st = {
    f,
    sort: { key: legacySort ?? "mcap", dir: def.dir === "asc" ? "asc" : "desc" },
    tab: "Overview",
    market: "NSE",
  };
  return "#s=" + btoa(unescape(encodeURIComponent(JSON.stringify(st))));
}

// ================================================================ types

interface ScanGroup {
  category: string;
  description: string;
  scans: { id: string; name: string; description: string; basic: boolean }[];
}

interface SavedScreen {
  id: string; name: string; kind: "conditions" | "multi" | "filters"; definition: string; createdAt: string;
}

interface MultiResponse {
  min: number; requested: number; total: number; scanned: number;
  scanSummaries: { id: string; name: string; total: number }[];
  rows: {
    symbol: string; name: string; price: number | null; changePct: number | null;
    marketCap: number | null; sector: string | null; rs: number | null;
    matches: number; scans: string[];
  }[];
}

// ================================================================ pro gate

function ScreenerUpgradePanel({ onUpgrade }: { onUpgrade?: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15">
        <Radar className="h-6 w-6 text-brand-text" />
      </span>
      <h2 className="mt-4 text-lg font-bold tracking-tight text-zinc-50">The Screener is part of TradePulse Pro</h2>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-zinc-500">
        Screen all 3,551 NSE stocks with pro-grade quick filters, run several scans together for
        confluence, save your screens and export the results.
      </p>
      <ul className="mx-auto mt-5 max-w-sm space-y-1.5 text-left text-xs text-zinc-400">
        {[
          "Full-universe filters — search, sector, sort & paginate",
          "Multi-scan confluence — run scans together, see which stocks fire in several",
          "Saved screens — update in place or save as new, re-run in one click",
          "CSV export for every result table",
        ].map((t) => (
          <li key={t} className="flex items-start gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
            {t}
          </li>
        ))}
      </ul>
      <Button onClick={onUpgrade} className="mt-6 bg-brand text-white hover:bg-brand-hover">
        Upgrade to Pro
      </Button>
    </div>
  );
}

// ================================================================ main

export function ScreenerTab({
  onSelectStock,
  isPro,
  onUpgrade,
  initialSector,
}: {
  onSelectStock: (s: string) => void;
  isPro: boolean;
  onUpgrade?: () => void;
  /** Pre-fills the sector filter (e.g. "Run scan on this sector" from market views). */
  initialSector?: string;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"filters" | "multi">("filters");

  // ------------------------------------------------------------ screener iframe
  const appDark = () =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [screenerSrc, setScreenerSrc] = useState(() => {
    const base = "/screener.html";
    const hash = initialSector ? screenerHash({ sector: initialSector }) : "";
    const theme = appDark() ? "?theme=dark" : "";
    return `${base}${theme}${hash}`;
  });
  const [screenerKey, setScreenerKey] = useState(0);

  // The embedded screener asks the host to open a stock's chart with a
  // postMessage ("Open chart" in the row drawer) — route it into the app's
  // own stock-detail chart view instead of any external chart site.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; symbol?: unknown } | null;
      if (!d || d.type !== "tradepulse:openStock") return;
      // Screener universe symbols are bare ("RELIANCE"); the stock-detail API
      // and the rest of the app use the Yahoo suffix form ("RELIANCE.NS").
      const raw = typeof d.symbol === "string" ? d.symbol.trim().toUpperCase() : "";
      if (!raw) return;
      onSelectStock(raw.includes(".") ? raw : `${raw}.NS`);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onSelectStock]);

  // ------------------------------------------------------------ saved screens
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedSearch, setSavedSearch] = useState("");
  const savedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!savedOpen) return;
    const onDoc = (e: MouseEvent) => { if (savedRef.current && !savedRef.current.contains(e.target as Node)) setSavedOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSavedOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [savedOpen]);

  const { data: saved } = useQuery<SavedScreen[]>({
    queryKey: ["screens"],
    queryFn: async () => {
      const res = await fetch("/api/screens");
      if (!res.ok) throw new Error("screens failed");
      const data = await res.json();
      return data.screens as SavedScreen[];
    },
    enabled: isPro,
  });

  const filteredSaved = useMemo(() => {
    const q = savedSearch.trim().toLowerCase();
    return (saved ?? []).filter((s) => !q || s.name.toLowerCase().includes(q));
  }, [saved, savedSearch]);

  // ------------------------------------------------------------ multi mode
  const [catalog, setCatalog] = useState<ScanGroup[] | null>(null);
  const [sel, setSel] = useState<string[]>(["trader-choice-6", "momentum-scanner", "w52-high"]);
  const [minMatch, setMinMatch] = useState(2);
  const [multi, setMulti] = useState<MultiResponse | null>(null);
  const [multiLoading, setMultiLoading] = useState(false);
  const [multiError, setMultiError] = useState<string | null>(null);

  useEffect(() => {
    if (catalog) return;
    let alive = true;
    fetch("/api/scanners")
      .then((res) => res.json())
      .then((data) => { if (alive) setCatalog(data.groups as ScanGroup[]); })
      .catch(() => { /* catalog stays null */ });
    return () => { alive = false; };
  }, [catalog]);

  const runMulti = async (ids: string[] = sel, min: number = minMatch) => {
    if (ids.length < 2) {
      toast({ title: "Pick at least 2 scans to combine" });
      return;
    }
    setMultiLoading(true);
    setMultiError(null);
    try {
      const res = await fetch("/api/scanners/multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, min }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.upgrade && onUpgrade) onUpgrade();
        throw new Error(data?.error ?? "Multi-scan failed");
      }
      setMulti(data as MultiResponse);
    } catch (e) {
      setMulti(null);
      setMultiError(e instanceof Error ? e.message : "Multi-scan failed");
    } finally {
      setMultiLoading(false);
    }
  };

  const toggleScan = (id: string) => {
    const next = sel.includes(id)
      ? sel.filter((x) => x !== id)
      : sel.length >= 8 ? sel : [...sel, id];
    if (next !== sel) {
      setSel(next);
      setMinMatch((m) => Math.min(m, Math.max(2, next.length)));
    }
  };

  // ------------------------------------------------------------ save / load
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  const saveScreen = async () => {
    const name = saveName.trim();
    if (!name) {
      toast({ title: "Give the view a name first" });
      return;
    }
    // Multi snapshots the scan set. The full screener saves its own screens
    // (localStorage, inside the embedded tool) — this covers multi-scan sets.
    const kind = "multi";
    const definition = { ids: sel, min: minMatch };
    setSaving(true);
    try {
      const res = await fetch("/api/screens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind, definition }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Save failed");
      await qc.invalidateQueries({ queryKey: ["screens"] });
      toast({ title: "Screen saved", description: `“${name}” is in your Saved screens.` });
      setSaveName("");
      setSaveOpen(false);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteScreen = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/screens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await qc.invalidateQueries({ queryKey: ["screens"] });
      toast({ title: "Deleted", description: `“${name}” removed.` });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const loadScreen = (s: SavedScreen) => {
    try {
      const def = JSON.parse(s.definition) as {
        v?: number;
        scan?: unknown;
        rows?: unknown[];
        ids?: string[];
        min?: number;
        q?: unknown; sector?: unknown; sort?: unknown; dir?: unknown;
      };
      if (s.kind === "conditions") {
        // Condition builder is parked for launch — saved condition screens open
        // once it ships. Nothing else to do here.
        toast({ title: "Condition builder is launching soon", description: `“${s.name}” will open here once the builder ships.` });
        setSavedOpen(false);
        return;
      } else if (s.kind === "multi" && Array.isArray(def.ids)) {
        setSel(def.ids.slice(0, 8));
        setMinMatch(Math.max(2, def.min ?? 2));
        setMode("multi");
        void runMulti(def.ids.slice(0, 8), Math.max(2, def.min ?? 2));
      } else if (s.kind === "filters") {
        // Quick-filter view — open the full screener with the saved search /
        // sector / sort mapped into its URL-hash state.
        setScreenerSrc(`/screener.html${appDark() ? "?theme=dark" : ""}${screenerHash(def)}`);
        setScreenerKey((k) => k + 1);
        setMode("filters");
      }
      setSavedOpen(false);
    } catch {
      toast({ title: "Could not load that screen", variant: "destructive" });
    }
  };

  // ------------------------------------------------------------ render helpers

  /** Name-and-save editor for multi views. */
  const saveEditor = (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        value={saveName}
        onChange={(e) => setSaveName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void saveScreen()}
        placeholder="View name…"
        aria-label="View name"
        className="h-8 w-40 border-zinc-700 bg-zinc-900 text-xs text-zinc-100"
      />
      <Button size="sm" disabled={saving} onClick={() => void saveScreen()} className="h-8 bg-brand px-2.5 text-xs text-white hover:bg-brand-hover">
        Save
      </Button>
      <button onClick={() => setSaveOpen(false)} aria-label="Cancel save" className="rounded p-1 text-zinc-500 hover:text-zinc-300">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  if (!isPro) return <ScreenerUpgradePanel onUpgrade={onUpgrade} />;

  const headerCount =
    mode === "filters" ? "Full-universe screener"
    : (multi ? `${multi.total.toLocaleString("en-IN")} confluence matches` : "Multi-scan confluence");

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Screener · NSE universe · EOD 4 pm IST</div>
          <h2 className="text-lg font-bold tracking-tight text-zinc-100">{headerCount}</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* saved screens dropdown — search + list (Component 5) */}
          <div ref={savedRef} className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSavedOpen((v) => !v)}
              className="h-8 gap-1.5 border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              <Bookmark className="h-3.5 w-3.5 text-emerald-400" /> Saved
              <ChevronDown className={cn("h-3.5 w-3.5 text-zinc-500 transition-transform", savedOpen && "rotate-180")} />
            </Button>
            {savedOpen && (
              <div className="absolute right-0 top-9 z-30 w-72 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
                <div className="border-b border-zinc-800 p-2">
                  <Input
                    value={savedSearch}
                    onChange={(e) => setSavedSearch(e.target.value)}
                    placeholder="Search saved screens…"
                    aria-label="Search saved screens"
                    className="h-7 border-zinc-700 bg-zinc-950 text-xs text-zinc-100"
                  />
                </div>
                {filteredSaved.length === 0 ? (
                  <p className="px-3 py-4 text-center text-[11px] text-zinc-500">
                    {(saved ?? []).length === 0
                      ? "No saved views yet — set up quick filters or scans, then save."
                      : `Nothing matches “${savedSearch}”.`}
                  </p>
                ) : (
                  filteredSaved.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 border-b border-zinc-800/60 px-3 py-2 last:border-0 hover:bg-zinc-800/50">
                      <button onClick={() => loadScreen(s)} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-xs font-medium text-zinc-100">{s.name}</span>
                        <span className="block text-[10px] text-zinc-500">
                          {s.kind === "multi" ? "Multi-scan set" : s.kind === "filters" ? "Quick-filter view" : "Condition screen (launching soon)"}
                        </span>
                      </button>
                      <button
                        onClick={() => void deleteScreen(s.id, s.name)}
                        aria-label={`Delete ${s.name}`}
                        className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-loss"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          {/* export — multi only (the full screener exports from its own toolbar) */}
          {mode === "multi" && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-200 hover:bg-zinc-800"
            onClick={() => {
              if (multi) {
                exportCsv(
                  `tradepulse-multiscan-${csvDate()}.csv`,
                  ["Symbol", "Name", "Price", "Change %", "Matches", "Scans", "RS", "Market cap Cr"],
                  multi.rows.map((r) => [
                    r.symbol.replace(".NS", ""), r.name, r.price, r.changePct, `${r.matches}/${multi.requested}`,
                    r.scans.join(" | "), r.rs, r.marketCap != null ? Math.round(r.marketCap / 1e7) : null,
                  ])
                );
                toast({ title: "CSV exported" });
              } else {
                toast({ title: "Nothing to export yet" });
              }
            }}
          >
            Export CSV
          </Button>
          )}
          {/* save current view — multi anchors here; the full screener saves its own screens */}
          {mode === "multi" && (
            saveOpen ? (
              saveEditor
            ) : (
              <Button
                size="sm"
                onClick={() => setSaveOpen(true)}
                title="Save this view under a name to re-run it any day"
                className="h-8 gap-1.5 bg-brand px-3 text-xs font-medium text-white hover:bg-brand-hover"
              >
                <BookmarkPlus className="h-3.5 w-3.5" /> Save view
              </Button>
            )
          )}
        </div>
      </div>

      {/* mode switcher */}
      <div className="flex w-fit items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/70 p-1">
        {([
          { id: "filters", label: "Screener", icon: Radar },
          { id: "multi", label: "Multi-scan", icon: Layers },
        ] as const).map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              mode === m.id ? "bg-brand/15 text-brand-text" : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <m.icon className="h-3.5 w-3.5" />
            {m.label}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------ filters mode —
          the full TradingView-style screener (single-file tool fed from the
          TradePulse database). Embedded so it keeps its own state, theme and
          localStorage screens; hash links map saved quick-filter views in. */}
      {mode === "filters" && (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-inner">
          <iframe
            key={screenerKey}
            src={screenerSrc}
            title="TradePulse stock screener"
            className="h-[calc(100vh-215px)] min-h-[620px] w-full border-0 bg-transparent"
          />
        </div>
      )}

      {/* ------------------------------------------------ multi-scan mode */}
      {mode === "multi" && (
        <>
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardContent className="space-y-3 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-zinc-500">
                  Run up to 8 scans together — a stock is listed when it fires in at least the minimum number of them.
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    Min matches
                    <select
                      value={minMatch}
                      onChange={(e) => setMinMatch(Number(e.target.value))}
                      className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
                      aria-label="Minimum matches"
                    >
                      {Array.from({ length: Math.max(1, sel.length) }, (_, i) => i + 2 <= Math.max(2, sel.length) ? i + 2 : null)
                        .filter((v): v is number => v != null && v <= Math.max(2, sel.length))
                        .map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <Button
                    size="sm"
                    onClick={() => void runMulti()}
                    disabled={multiLoading}
                    className="h-8 gap-1.5 bg-brand px-3 text-xs text-white hover:bg-brand-hover"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    {multiLoading ? "Running…" : `Run ${sel.length} scans`}
                  </Button>
                </div>
              </div>

              {catalog === null ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 bg-zinc-800/70" />)}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {catalog.map((g) => (
                    <div key={g.category}>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{g.category}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {g.scans.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => toggleScan(s.id)}
                            title={s.description}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                              sel.includes(s.id)
                                ? "border-brand/50 bg-brand/15 text-brand-text"
                                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                            )}
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {multiError && <p className="text-xs text-loss">{multiError}</p>}

              {multi && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-800/70 pt-2 text-[11px] text-zinc-500">
                  <span className="font-medium text-zinc-400">Per-scan hits:</span>
                  {multi.scanSummaries.map((s) => (
                    <span key={s.id}>{s.name} <b className="text-zinc-300">{s.total}</b></span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {multiLoading ? (
            <Card className="border-zinc-800 bg-zinc-900/60">
              <CardContent className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 bg-zinc-800/70" />)}
              </CardContent>
            </Card>
          ) : multi ? (
            multi.rows.length === 0 ? (
              <Card className="border-zinc-800 bg-zinc-900/60">
                <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                  <Layers className="h-6 w-6 text-zinc-700" />
                  <p className="text-xs text-zinc-500">
                    No stock fired in {multi.min}+ of the {multi.requested} scans — lower the minimum or swap scans.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <MultiTable rows={multi.rows} requested={multi.requested} onSelectStock={onSelectStock} />
              </>
            )
          ) : (
            <Card className="border-zinc-800 bg-zinc-900/60">
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <Radar className="h-6 w-6 text-zinc-700" />
                <p className="text-xs text-zinc-500">Pick at least two scans above and run the confluence.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ================================================================ multi table

function MultiTable({
  rows, requested, onSelectStock,
}: {
  rows: MultiResponse["rows"];
  requested: number;
  onSelectStock: (s: string) => void;
}) {
  // confluence returns every matching stock now — render in pages
  const [visible, setVisible] = useState(TABLE_PAGE);
  const shown = rows.slice(0, visible);
  const remaining = rows.length - shown.length;
  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-zinc-800/70 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="w-9 px-2 py-2.5 text-center font-medium">
                  <Star className="mx-auto h-3 w-3 text-zinc-600" />
                  <span className="sr-only">Watchlist</span>
                </th>
                <th className="px-4 py-2.5 font-medium">Stock</th>
                <th className="px-3 py-2.5 text-right font-medium">Price</th>
                <th className="px-3 py-2.5 text-right font-medium">Chg %</th>
                <th className="px-3 py-2.5 text-center font-medium">Matches</th>
                <th className="px-3 py-2.5 font-medium">Fired in</th>
                <th className="px-3 py-2.5 text-right font-medium">RS</th>
                <th className="px-4 py-2.5 text-right font-medium">Mkt cap</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.symbol}
                  onClick={() => onSelectStock(r.symbol)}
                  className="cursor-pointer border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30"
                >
                  <td className="px-2 py-2.5 text-center">
                    <AddToWatchlistButton symbol={r.symbol} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-xs font-semibold text-zinc-100">{r.symbol.replace(".NS", "")}</div>
                    <div className="max-w-52 truncate text-[10px] text-zinc-600">{r.name}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-200">{fmtPrice(r.price)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-200">{fmtPct(r.changePct)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={cn(
                        "inline-block rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold",
                        r.matches >= requested ? "bg-brand text-white" : r.matches >= requested - 1 ? "bg-brand/20 text-brand-text" : "bg-zinc-800 text-zinc-300"
                      )}
                    >
                      {r.matches}/{requested}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex max-w-72 flex-wrap gap-1">
                      {r.scans.slice(0, 3).map((s) => (
                        <span key={s} className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-300">{s}</span>
                      ))}
                      {r.scans.length > 3 && (
                        <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-500">+{r.scans.length - 3} more</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-300">{r.rs != null ? r.rs : "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-400">{r.marketCap != null ? `${Math.round(r.marketCap / 1e7).toLocaleString("en-IN")} Cr` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {remaining > 0 && (
          <div className="flex flex-col items-center gap-1 border-t border-zinc-800/70 py-3">
            <button
              onClick={() => setVisible((v) => v + TABLE_PAGE)}
              className="rounded-md border border-zinc-800 px-4 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
            >
              Show more matches <span className="font-normal text-zinc-500">(+{Math.min(TABLE_PAGE, remaining)})</span>
            </button>
            <span className="text-[10px] text-zinc-600">Showing {shown.length} of {rows.length} confluence matches</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
