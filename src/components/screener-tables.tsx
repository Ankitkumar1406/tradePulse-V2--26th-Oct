"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Radar, Star } from "lucide-react";
import { AddToWatchlistButton } from "@/components/add-to-watchlist";
import { changeColor, fmtMcap, fmtNum, fmtPct, fmtPrice, fmtVol } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Shared result-table / CSV / formatting layer for the Screener tab — used
 *  by Quick filters (screener-tab) and the sentence-style scan builder
 *  (scan-builder) so both render identical result grids. */

export interface StockRow {
  symbol: string; name: string; price: number | null; changePct: number | null;
  volume: number | null; marketCap: number | null; sector: string | null;
  rsi14: number | null; mom1M: number | null; mom3M: number | null; mom6M: number | null;
  peTTM: number | null; fromHighPct: number | null;
  volAvg20: number | null; relVol: number | null; // volume vs prior-20-session average (API-computed)
  computed?: (number | null)[]; // evaluated condition expressions ("show values")
}

export interface StocksResponse {
  total: number; page: number; perPage: number; condCount: number;
  stocks: StockRow[];
  sectors: (string | null)[];
}

export const SORTS = [
  { id: "marketCap", label: "Market cap" },
  { id: "changePct", label: "Day change" },
  { id: "rsi14", label: "RSI (14)" },
  { id: "mom1M", label: "1M return" },
  { id: "mom3M", label: "3M return" },
  { id: "mom6M", label: "6M return" },
  { id: "peTTM", label: "P/E" },
  { id: "fromHighPct", label: "From 52W high" },
];

export function exportCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const csvDate = () => new Date().toISOString().slice(0, 10);

/** Relative-volume chip colour — ≥2× is spike territory (mirrors the Volume-spike scanner flag). */
export function relVolTone(rv: number): string {
  if (rv >= 2) return "text-emerald-400";
  if (rv >= 1.5) return "text-zinc-200";
  return "text-zinc-500";
}

export function rsiTone(rsi: number | null): string {
  if (rsi == null) return "text-zinc-500";
  if (rsi > 60) return "text-emerald-400";
  if (rsi < 40) return "text-red-400";
  return "text-zinc-300";
}

/** Compact value formatter for the computed-value cells. */
function fmtVal(v: number | null): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
  if (a >= 1000) return v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return Number(v.toFixed(2)).toString();
}

export function ResultsTable({
  rows, isLoading, onSelectStock, showValues,
}: {
  rows?: StockRow[];
  isLoading: boolean;
  onSelectStock: (s: string) => void;
  showValues?: boolean;
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 bg-zinc-800/70" />)}
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Radar className="h-6 w-6 text-zinc-700" />
            <p className="text-xs text-zinc-500">No stocks match — loosen the filters or wait for the next sync.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={cn("w-full text-sm", showValues ? "min-w-[960px]" : "min-w-[860px] ")}>
              <thead>
                <tr className="border-b border-zinc-800/70 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="w-9 px-2 py-2.5 text-center font-medium">
                    <Star className="mx-auto h-3 w-3 text-zinc-600" />
                    <span className="sr-only">Watchlist</span>
                  </th>
                  <th className="px-4 py-2.5 font-medium">Stock</th>
                  <th className="px-3 py-2.5 text-right font-medium">Price</th>
                  <th className="px-3 py-2.5 text-right font-medium">Chg %</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="Traded volume · multiple of its own 20-day average">Volume</th>
                  <th className="px-3 py-2.5 text-right font-medium">RSI</th>
                  <th className="px-3 py-2.5 text-right font-medium">1M</th>
                  <th className="px-3 py-2.5 text-right font-medium">3M</th>
                  <th className="px-3 py-2.5 text-right font-medium">6M</th>
                  <th className="px-3 py-2.5 text-right font-medium">P/E</th>
                  <th className="px-3 py-2.5 text-right font-medium">From high</th>
                  <th className="px-4 py-2.5 text-right font-medium">Mkt cap</th>
                  {showValues && (
                    <th className="px-3 py-2.5 text-right font-medium" title="Each condition's evaluated left / right values for this stock — verify the math">
                      Values
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
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
                      <div className="max-w-52 truncate text-[10px] text-zinc-600">{r.name}{r.sector && r.sector !== "Unknown" ? ` · ${r.sector}` : ""}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-200">{fmtPrice(r.price)}</td>
                    <td className={cn("px-3 py-2.5 text-right font-mono text-xs", changeColor(r.changePct))}>{fmtPct(r.changePct)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="font-mono text-xs text-zinc-400">{fmtVol(r.volume)}</div>
                      {r.relVol != null && (
                        <div
                          className={cn("font-mono text-[10px]", relVolTone(r.relVol))}
                          title="Today's traded volume vs its 20-day average — 2× or more is spike territory"
                        >
                          {r.relVol >= 10 ? "10×+" : `${r.relVol.toFixed(1)}×`} avg
                        </div>
                      )}
                    </td>
                    <td className={cn("px-3 py-2.5 text-right font-mono text-xs", rsiTone(r.rsi14))}>{fmtNum(r.rsi14, 1)}</td>
                    <td className={cn("px-3 py-2.5 text-right font-mono text-xs", changeColor(r.mom1M))}>{fmtPct(r.mom1M, 1)}</td>
                    <td className={cn("px-3 py-2.5 text-right font-mono text-xs", changeColor(r.mom3M))}>{fmtPct(r.mom3M, 1)}</td>
                    <td className={cn("px-3 py-2.5 text-right font-mono text-xs", changeColor(r.mom6M))}>{fmtPct(r.mom6M, 1)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-400">{fmtNum(r.peTTM, 1)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-400">{fmtNum(r.fromHighPct, 1)}%</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-400">{fmtMcap(r.marketCap)}</td>
                    {showValues && (
                      <td className="max-w-40 px-3 py-2.5 text-right font-mono text-[10px] leading-4 text-zinc-400" title="Condition values: left / right per condition">
                        {r.computed && r.computed.length > 0
                          ? (() => {
                              const pairs: string[] = [];
                              for (let i = 0; i + 1 < r.computed.length; i += 2) {
                                pairs.push(`${fmtVal(r.computed[i])} / ${fmtVal(r.computed[i + 1])}`);
                              }
                              if (r.computed.length % 2 === 1) pairs.push(fmtVal(r.computed[r.computed.length - 1]));
                              return pairs.join(" · ");
                            })()
                          : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between px-1">
      <span className="text-[11px] text-zinc-600">Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} className="h-7 border-zinc-700 bg-transparent px-2.5 text-xs text-zinc-300">
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="h-7 border-zinc-700 bg-transparent px-2.5 text-xs text-zinc-300">
          Next <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
