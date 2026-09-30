"use client";

import { useMemo } from "react";

/** Tiny SVG sparkline for close series. */
export function Sparkline({
  data,
  width = 120,
  height = 36,
  positive,
}: {
  data: [number, number][];
  width?: number;
  height?: number;
  positive?: boolean;
}) {
  const path = useMemo(() => {
    if (data.length < 2) return null;
    const values = data.map((p) => p[1]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pad = 2;
    const stepX = (width - pad * 2) / (data.length - 1);
    const pts = values.map((v, i) => {
      const x = pad + i * stepX;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { line: `M${pts.join(" L")}`, lastX: pts[pts.length - 1].split(",")[0], lastY: pts[pts.length - 1].split(",")[1] };
  }, [data, width, height]);

  if (!path) return <div style={{ width, height }} className="text-zinc-600 text-xs flex items-center">—</div>;
  const up = positive ?? true;
  const color = up ? "var(--color-emerald-400)" : "var(--color-red-400)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={path.line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={path.lastX} cy={path.lastY} r="2" fill={color} />
    </svg>
  );
}
