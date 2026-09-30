"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

interface Suggestion {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
}

export function SearchBox({ onSelect }: { onSelect?: (symbol: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { data, isFetching } = useQuery<{ rows: Suggestion[] }>({
    queryKey: ["search", debounced],
    queryFn: async () => {
      const res = await fetch(`/api/stocks?q=${encodeURIComponent(debounced)}&pageSize=10&sort=marketCap`);
      if (!res.ok) throw new Error("search failed");
      return res.json();
    },
    enabled: debounced.length > 0,
  });

  const suggestions = data?.rows ?? [];

  return (
    <div ref={boxRef} className="relative w-full max-w-sm">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && suggestions[0]) {
            const sym = suggestions[0].symbol;
            setOpen(false);
            setQ("");
            if (onSelect) onSelect(sym);
            else router.push(`/?stock=${encodeURIComponent(sym)}`);
          }
        }}
        placeholder="Search 3,500+ NSE stocks…"
        className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/60"
        aria-label="Search stocks"
      />
      {open && debounced && (
        <div className="absolute z-50 mt-1 w-full max-h-80 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-xl">
          {isFetching && suggestions.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-500">Searching…</div>
          )}
          {!isFetching && suggestions.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-500">No matches</div>
          )}
          {suggestions.map((s) => (
            <button
              key={s.symbol}
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-800"
              onClick={() => {
                setOpen(false);
                setQ("");
                if (onSelect) onSelect(s.symbol);
                else router.push(`/?stock=${encodeURIComponent(s.symbol)}`);
              }}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-zinc-200">{s.symbol.replace(".NS", "")}</span>
                <span className="block truncate text-xs text-zinc-500">{s.name}</span>
              </span>
              {s.changePct != null && (
                <span className={`ml-2 shrink-0 font-mono text-xs ${s.changePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {s.changePct >= 0 ? "+" : ""}{s.changePct.toFixed(2)}%
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
