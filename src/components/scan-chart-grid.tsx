"use client";

/**
 * Scanner chart view — replicates the BananaPatterns chart-card layout:
 *   header   : Company name                +big range-return %
 *   ticker   : SYMBOL · <scan name>        (gray)
 *   ohlc     : 2026-09-23  O 875.00  H 1005.00  L 866.25  C 986.70  (+16.10%)
 *   stats    : Vol 10.7M  RS 97
 *   chart    : candles + volume, price axis right (1,000.00), dates bottom,
 *              dashed pivot line with green "pivot ₹601.4" badge,
 *              shaded base zone, orange breakout flags
 *   footer   : 12-week base   pivot ₹601   RS 97
 */

import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, Star } from "lucide-react";
import type { Bar } from "@/components/candle-chart";
import { fmtPct, changeColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type MetricValue = number | string | null;
interface ScanRow {
  symbol: string; name: string; sector: string | null;
  price: number | null; changePct: number | null; marketCap: number | null; rsRank: number | null;
  m: Record<string, MetricValue>;
  barsCount?: number; // stored DailyBar count — rows with < MIN_CHART_BARS can't render candles
}
export interface ChartGridResult {
  name: string;
  columns: { key: string; label: string; fmt: string }[];
  rows: ScanRow[];
}

export type ChartRange = "3m" | "6m" | "1y";
const RANGE_BARS: Record<ChartRange, number> = { "3m": 63, "6m": 126, "1y": 250 };

// ---------------- pivot / base geometry ----------------

interface PivotInfo {
  pivot: number;
  baseLow: number;
  start: number; // first bar index of the base window
  end: number;   // last bar index (exclusive) of the base window
  weeks: number;
  flags: number[]; // bar indices where close crossed above pivot
}

function pivotInfo(bars: Bar[], range: ChartRange): PivotInfo | null {
  const n = bars.length;
  if (n < 30) return null;
  const window = { "3m": 40, "6m": 60, "1y": 120 }[range];
  const end = Math.max(10, n - 3);
  const start = Math.max(0, end - window);
  let pivot = -Infinity, baseLow = Infinity;
  for (let i = start; i < end; i++) {
    if (bars[i].high > pivot) pivot = bars[i].high;
    if (bars[i].low < baseLow) baseLow = bars[i].low;
  }
  if (!Number.isFinite(pivot) || !Number.isFinite(baseLow) || pivot <= baseLow) return null;
  const flags: number[] = [];
  for (let i = Math.max(1, start); i < n; i++) {
    if (bars[i - 1].close < pivot && bars[i].close >= pivot) flags.push(i);
  }
  return { pivot, baseLow, start, end, weeks: Math.max(1, Math.round((end - start) / 5)), flags: flags.slice(-4) };
}

// ---------------- formatting ----------------

const fmtAxis = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRupee = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return `₹${r.toLocaleString("en-US", { maximumFractionDigits: r >= 1000 ? 1 : 2 })}`;
};
const fmtVolM = (v: number) => {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${v}`;
};
const fmtTickDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
};

// ---------------- the chart ----------------

const PAD = { top: 12, right: 62, bottom: 20, left: 6 };

function BananaChart({ bars, height, piv }: { bars: Bar[]; height: number; piv: PivotInfo }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(300, Math.floor(entries[0]?.contentRect.width ?? 560))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const plotW = width - PAD.left - PAD.right;
    const volH = Math.round((height - PAD.top - PAD.bottom) * 0.16);
    const plotH = height - PAD.top - PAD.bottom - volH - 6;
    const volTop = PAD.top + plotH + 6;

    const loRaw = Math.min(piv.baseLow, Math.min(...bars.map((b) => b.low)));
    const hiRaw = Math.max(piv.pivot, Math.max(...bars.map((b) => b.high)));
    const span = hiRaw - loRaw || 1;
    const yLo = loRaw - span * 0.05;
    const yHi = hiRaw + span * 0.07;

    const stepX = plotW / bars.length;
    const candleW = Math.max(1.2, Math.min(7, stepX * 0.62));
    const x = (i: number) => PAD.left + i * stepX + stepX / 2;
    const y = (p: number) => PAD.top + ((yHi - p) / (yHi - yLo)) * plotH;
    const vy = (v: number) => volTop + volH - (v / Math.max(...bars.map((b) => b.volume), 1)) * volH;

    const steps = 4;
    const yTicks = Array.from({ length: steps + 1 }, (_, i) => {
      const p = yLo + ((yHi - yLo) * i) / steps;
      return { y: y(p), label: fmtAxis(p) };
    });

    const tickEvery = Math.max(1, Math.floor(bars.length / 6));
    const xTicks: { x: number; label: string }[] = [];
    for (let i = bars.length - 1; i >= 0; i -= tickEvery) {
      xTicks.push({ x: x(i), label: fmtTickDate(bars[i].date) });
    }

    return { plotW, plotH, volTop, volH, stepX, candleW, x, y, vy, yTicks, xTicks, yPivot: y(piv.pivot), yBase: y(piv.baseLow) };
  }, [bars, width, height, piv]);

  const hoverBar = hover != null ? bars[hover] : null;
  const prevClose = hover != null && hover > 0 ? bars[hover - 1].close : null;

  return (
    <div ref={containerRef} className="relative w-full select-none">
      <svg
        width={width}
        height={height}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = e.clientX - rect.left - PAD.left;
          setHover(Math.max(0, Math.min(bars.length - 1, Math.floor((px / geo.plotW) * bars.length))));
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${bars[0]?.date ?? ""} to ${bars[bars.length - 1]?.date ?? ""} chart`}
      >
        {/* base zone shading (base low -> pivot across the base window) */}
        <rect
          x={geo.x(piv.start) - geo.stepX / 2}
          y={geo.yPivot}
          width={Math.max(2, geo.x(piv.end - 1) - geo.x(piv.start))}
          height={Math.max(1, geo.yBase - geo.yPivot)}
          fill="#10b981"
          opacity="0.08"
        />

        {/* volume */}
        {bars.map((b, i) => (
          <rect
            key={`v${i}`}
            x={geo.x(i) - geo.candleW / 2}
            y={geo.vy(b.volume)}
            width={geo.candleW}
            height={Math.max(0.5, geo.volTop + geo.volH - geo.vy(b.volume))}
            fill={b.close >= b.open ? "#10b98140" : "#ef444440"}
          />
        ))}

        {/* candles */}
        {bars.map((b, i) => {
          const up = b.close >= b.open;
          const color = up ? "#10b981" : "#ef4444";
          const yO = geo.y(b.open), yC = geo.y(b.close);
          return (
            <g key={i}>
              <line x1={geo.x(i)} x2={geo.x(i)} y1={geo.y(b.high)} y2={geo.y(b.low)} stroke={color} strokeWidth="1" />
              <rect
                x={geo.x(i) - geo.candleW / 2}
                y={Math.min(yO, yC)}
                width={geo.candleW}
                height={Math.max(1, Math.abs(yC - yO))}
                fill={color}
              />
            </g>
          );
        })}

        {/* pivot dashed line + badge */}
        <line x1={PAD.left} x2={width - PAD.right} y1={geo.yPivot} y2={geo.yPivot} stroke="#10b981" strokeWidth="1" strokeDasharray="5,4" />
        <rect x={PAD.left + 2} y={geo.yPivot - 15} width={78} height={13} rx={2} fill="#059669" />
        <text x={PAD.left + 6} y={geo.yPivot - 5} fill="#ffffff" fontSize="9.5" fontFamily="ui-monospace, monospace">
          pivot {fmtRupee(piv.pivot)}
        </text>

        {/* breakout flags */}
        {piv.flags.map((i) => (
          <g key={`f${i}`} stroke="#f59e0b" fill="#f59e0b">
            <line x1={geo.x(i)} x2={geo.x(i)} y1={geo.y(bars[i].high) - 2} y2={geo.y(bars[i].high) - 11} strokeWidth="1" />
            <path d={`M${geo.x(i)},${geo.y(bars[i].high) - 11} l6,2.5 l-6,2.5 z`} stroke="none" />
          </g>
        ))}

        {/* price axis (right) */}
        {geo.yTicks.map((t, i) => (
          <text key={i} x={width - PAD.right + 6} y={t.y + 3.5} fill="#71717a" fontSize="10" fontFamily="ui-monospace, monospace">{t.label}</text>
        ))}

        {/* date axis (bottom) */}
        {geo.xTicks.map((t, i) => (
          <text key={i} x={t.x} y={height - 6} fill="#71717a" fontSize="10" textAnchor="middle" fontFamily="ui-monospace, monospace">{t.label}</text>
        ))}

        {/* crosshair */}
        {hover != null && (
          <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.top} y2={height - PAD.bottom} stroke="#52525b" strokeWidth="1" strokeDasharray="3,3" />
        )}
      </svg>

      {hoverBar && (
        <div
          className="absolute top-2 z-10 pointer-events-none rounded-md border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-[10px] leading-4 font-mono text-zinc-300 shadow-lg"
          style={{ left: Math.min(Math.max(4, (hover != null ? geo.x(hover) : 0) + 10), Math.max(4, width - 170)) }}
        >
          <span className="text-zinc-400">{hoverBar.date}</span>{" "}
          O {fmtAxis(hoverBar.open)} H {fmtAxis(hoverBar.high)} L {fmtAxis(hoverBar.low)}{" "}
          <span className={hoverBar.close >= (prevClose ?? hoverBar.open) ? "text-emerald-400" : "text-red-400"}>C {fmtAxis(hoverBar.close)}</span>{" "}
          V {fmtVolM(hoverBar.volume)}
        </div>
      )}
    </div>
  );
}

// ---------------- card ----------------

function ScanChartCard({ row, result, range, onSelectStock }: {
  row: ScanRow; result: ChartGridResult; range: ChartRange; onSelectStock: (s: string) => void;
}) {
  const qc = useQueryClient();
  const { data: hist, isLoading } = useQuery<{ ready: boolean; bars: Bar[] }>({
    queryKey: ["history", row.symbol, range],
    queryFn: async () => {
      const res = await fetch(`/api/stock/${encodeURIComponent(row.symbol)}/history?range=${range}`);
      if (!res.ok) throw new Error("history failed");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const addWatch = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: row.symbol }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Added to watchlist" });
      qc.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  const bars = hist?.bars ?? [];
  const piv = useMemo(() => (bars.length >= 30 ? pivotInfo(bars, range) : null), [bars, range]);

  // header + ohlc figures come from the latest bar (matches the reference card)
  const last = bars.length ? bars[bars.length - 1] : null;
  const prev = bars.length > 1 ? bars[bars.length - 2].close : null;
  const rangeRet = bars.length > 5 ? ((last!.close / bars[0].close - 1) * 100) : null;

  const metricBits = result.columns
    .map((c) => (row.m[c.key] != null ? `${c.label} ${row.m[c.key]}` : null))
    .filter(Boolean)
    .slice(0, 1);

  return (
    <div
      onClick={() => onSelectStock(row.symbol)}
      className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 transition-colors hover:border-zinc-600"
    >
      {/* header: name + big range return */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-100">{row.name}</div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            <span className="font-mono uppercase">{row.symbol.replace(".NS", "")}</span>
            <span> · {result.name}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            title="Add to watchlist"
            onClick={(e) => { e.stopPropagation(); addWatch.mutate(); }}
            className="text-zinc-600 hover:text-amber-400"
          >
            <Star className="h-3.5 w-3.5" />
          </button>
          <span className={cn("text-lg font-bold leading-6", changeColor(rangeRet))}>
            {rangeRet != null ? `${rangeRet >= 0 ? "+" : ""}${rangeRet.toFixed(1)}%` : "—"}
          </span>
        </div>
      </div>

      {/* ohlc line */}
      <div className="mt-1.5 font-mono text-[11px] text-zinc-300">
        {last ? (
          <>
            <span className="text-zinc-500">{last.date}</span>
            {"  "}O {fmtAxis(last.open)}
            {" "}H {fmtAxis(last.high)}
            {" "}L {fmtAxis(last.low)}
            {" "}<span className="font-semibold">C {fmtAxis(last.close)}</span>
            {"  "}
            <span className={changeColor(row.changePct)}>({row.changePct != null && row.changePct >= 0 ? "+" : ""}{(row.changePct ?? 0).toFixed(2)}%)</span>
          </>
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </div>

      {/* vol + rs */}
      <div className="mt-0.5 font-mono text-[11px] text-zinc-400">
        {last ? <>Vol {fmtVolM(last.volume)}</> : "Vol —"}
        {row.rsRank != null ? <>{"  "}RS <span className="text-zinc-200">{row.rsRank}</span></> : null}
        {metricBits.length > 0 && <span className="text-zinc-500">  ·  {metricBits[0]}</span>}
      </div>

      {/* chart */}
      <div className="mt-2">
        {isLoading ? (
          <div className="flex h-[240px] items-center justify-center text-xs text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading history…
          </div>
        ) : bars.length >= 2 ? (
          piv ? <BananaChart bars={bars} height={240} piv={piv} />
            : <div className="flex h-[240px] items-center justify-center text-xs text-zinc-600">Flat profile — no pivot to mark</div>
        ) : (
          <div className="flex h-[240px] items-center justify-center text-xs text-zinc-600">No price history yet</div>
        )}
      </div>

      {/* footer: base · pivot · rs */}
      {piv && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 font-mono text-[11px] text-zinc-500">
          <span>{piv.weeks}-week base</span>
          <span>pivot {fmtRupee(piv.pivot)}</span>
          {row.rsRank != null && <span>RS {row.rsRank}</span>}
          <span className="text-zinc-600">{fmtPct(row.changePct)} today</span>
        </div>
      )}
    </div>
  );
}

// ---------------- grid ----------------

const MIN_CHART_BARS = 60; // enough history for a meaningful chart

export function ScanChartGrid({ result, range, onSelectStock }: {
  result: ChartGridResult; range: ChartRange; onSelectStock: (s: string) => void;
}) {
  const [visible, setVisible] = useState(12);
  // rows with enough stored history render as full chart cards, in scan order;
  // the rest (recently listed / SME names with 1-2 bars) collapse into a strip
  const chartable = useMemo(
    () => result.rows.filter((r) => (r.barsCount ?? Number.POSITIVE_INFINITY) >= MIN_CHART_BARS),
    [result.rows]
  );
  const noHistory = useMemo(
    () => result.rows.filter((r) => (r.barsCount ?? Number.POSITIVE_INFINITY) < MIN_CHART_BARS),
    [result.rows]
  );
  const rows = chartable.slice(0, visible);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((r) => (
          <ScanChartCard key={r.symbol} row={r} result={result} range={range} onSelectStock={onSelectStock} />
        ))}
      </div>
      {chartable.length > visible && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-zinc-700 bg-zinc-900 text-xs"
            onClick={() => setVisible((v) => v + 12)}
          >
            Show more charts · {chartable.length - visible} remaining
          </Button>
        </div>
      )}
      {rows.length === 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 py-10 text-center text-xs text-zinc-500">
          No charts yet — switch back to the list or run another scan.
        </div>
      )}
      {noHistory.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-600">
            Not enough history to chart · {noHistory.length}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {noHistory.map((r) => (
              <button
                key={r.symbol}
                onClick={() => onSelectStock(r.symbol)}
                className="rounded border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                title={`${r.name} — listed recently or thinly traded`}
              >
                {r.symbol.replace(".NS", "")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
