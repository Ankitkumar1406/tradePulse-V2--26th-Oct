"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ActivityIcon, BarChart3, History, RefreshCw, CircleCheck, Loader2, TriangleAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface SyncStatus {
  phase: string;
  status: string;
  universeDone: number;
  universeTotal: number;
  closesDone: number;
  closesTotal: number;
  barsDone: number;
  barsTotal: number;
  stockCount: number;
  lastQuoteTime: string | null;
  lastIngestAt: string | null;
  nextAutoUpdate: string | null;
}

function formatDataUpdated(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(d);
}

function fmtClock(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(d);
}

/** "just now" / "4 min ago" / "1h 12m ago" for the blocked-refresh toast. */
function fmtAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m ago`;
}

/** Header banner: data-updated stamp + sync progress + refresh action. */
export function SyncBanner({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: status } = useQuery<SyncStatus>({
    queryKey: ["syncStatus"],
    queryFn: async () => {
      const res = await fetch("/api/sync");
      if (!res.ok) throw new Error("sync status failed");
      return res.json();
    },
    refetchInterval: 15_000,
  });

  const running = status?.status === "running" && status.phase !== "idle";

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "refresh" }),
      });
      const json = (await res.json().catch(() => null)) as
        | (SyncStatus & { ok?: boolean; reason?: string | null; error?: string })
        | null;
      if (!res.ok || !json) {
        toast({
          title: "Refresh failed",
          description: json?.error ?? "Could not reach the update service. Try again in a minute.",
          variant: "destructive",
        });
        return;
      }
      if (json.ok) {
        // seed the poller with the returned status so the progress spinner
        // and stamp react immediately, then keep polling as the run advances
        const { ok: _ok, reason: _reason, error: _error, ...statusOnly } = json;
        qc.setQueryData(["syncStatus"], statusOnly);
        toast({
          title: "Data update started",
          description: "Quotes and indicators are refreshing — this usually takes a minute or two.",
        });
      } else if (json.reason === "recent") {
        const ago = fmtAgo(json.lastIngestAt ?? null);
        toast({
          title: "Data is already up to date",
          description: `Last update ${ago || "moments ago"} · auto-update runs at 4:00 pm IST${
            json.nextAutoUpdate ? ` (next: ${fmtClock(json.nextAutoUpdate)} IST)` : ""
          }.`,
        });
      } else if (json.reason === "already-running") {
        toast({ title: "An update is already running", description: "Watch the progress spinner in the header." });
      } else {
        toast({ title: "Update not started", description: `Reason: ${json.reason ?? "unknown"}.` });
      }
    } catch {
      toast({
        title: "Refresh failed",
        description: "Network error while starting the update. Try again in a minute.",
        variant: "destructive",
      });
    } finally {
      await qc.invalidateQueries({ queryKey: ["syncStatus"] });
      // keep the button in its spinning state while a sync is actually
      // running — the run itself lasts minutes, not the 1.2s of this handler
      setTimeout(() => setRefreshing(false), 1200);
    }
  };

  const stamp = formatDataUpdated(status?.lastQuoteTime ?? null);
  const autoAt = status?.nextAutoUpdate ? fmtClock(status.nextAutoUpdate) : null;
  const spinning = refreshing || running;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-w-0 items-center gap-2">
        {running ? (
          <span className="flex items-center gap-1.5 text-[11px] text-brand-text">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="hidden sm:inline">
              Syncing {status?.phase} · {status?.phase === "closes" ? `${status.closesDone}/${status.closesTotal}` : `${status.universeDone}/${status.universeTotal}`}
            </span>
            <span className="sm:hidden">sync…</span>
          </span>
        ) : stamp ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">
                <History className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <span className="truncate">
                  {status && status.stockCount > 0 && (
                    <span className="hidden text-zinc-400 lg:inline">{status.stockCount.toLocaleString("en-IN")} stocks · </span>
                  )}
                  Data updated {stamp} IST
                  {autoAt && <span className="hidden xl:inline"> · auto 4 pm IST</span>}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64 border-zinc-800 bg-zinc-900 text-xs text-zinc-300">
              Quotes are as of the last NSE session close, stamped in IST.
              {autoAt ? ` TradePulse auto-updates every trading day at 4:00 pm IST — next update around ${autoAt}.` : " TradePulse auto-updates every trading day at 4:00 pm IST."}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <TriangleAlert className="h-3.5 w-3.5 text-gold-text" /> Preparing data…
          </span>
        )}
        <button
          onClick={() => void onRefresh()}
          disabled={spinning}
          className={cn("rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-60", spinning && "text-brand-text")}
          aria-label="Refresh data"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", spinning && "animate-spin")} />
        </button>
      </div>
    </TooltipProvider>
  );
}
