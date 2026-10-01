"use client";

import { useState } from "react";

export interface WeekPoint {
  week: string;
  value: number;
}

const BAR = "#3578FF"; // validated against the dark chart surface (contrast >= 3:1)

function weekLabel(week: string) {
  const d = new Date(`${week}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

/** Single-series weekly bar chart (one of a set of small multiples). Hover/focus a bar for its value. */
export function WeekBars({ title, points, unit }: { title: string; points: WeekPoint[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 400;
  const height = 170;
  const padL = 30;
  const padB = 22;
  const padT = 10;
  const max = Math.max(1, ...points.map((p) => p.value));
  const plotW = width - padL - 4;
  const plotH = height - padB - padT;
  const slot = points.length ? plotW / points.length : plotW;
  const barW = Math.max(3, Math.min(28, slot - 2));
  const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const total = points.reduce((s, p) => s + p.value, 0);

  return (
    <figure className="glass p-4">
      <figcaption className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-xs text-muted">
          {total} {unit} in range
        </span>
      </figcaption>
      {points.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No data in this range.</p>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`${title} per week`}>
            {ticks.map((t) => {
              const y = padT + plotH - (t / max) * plotH;
              return (
                <g key={t}>
                  <line x1={padL} x2={width - 4} y1={y} y2={y} stroke="rgba(148,163,184,0.14)" strokeWidth={1} />
                  <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={12} fill="#8c9ab3">
                    {t}
                  </text>
                </g>
              );
            })}
            {points.map((p, i) => {
              const h = (p.value / max) * plotH;
              const x = padL + i * slot + (slot - barW) / 2;
              const y = padT + plotH - h;
              const r = Math.min(4, barW / 2, h);
              return (
                <g key={p.week}>
                  {/* Hit target: the full column, larger than the mark. */}
                  <rect
                    x={padL + i * slot}
                    y={padT}
                    width={slot}
                    height={plotH}
                    fill={hover === i ? "rgba(53,231,255,0.06)" : "transparent"}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    aria-label={`Week of ${weekLabel(p.week)}: ${p.value} ${unit}`}
                  />
                  {p.value > 0 && (
                    <path
                      pointerEvents="none"
                      fill={BAR}
                      d={`M${x},${padT + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${padT + plotH} Z`}
                    />
                  )}
                  {i % labelEvery === 0 && (
                    <text x={padL + i * slot + slot / 2} y={height - 6} textAnchor="middle" fontSize={12} fill="#8c9ab3">
                      {weekLabel(p.week)}
                    </text>
                  )}
                </g>
              );
            })}
            <line x1={padL} x2={width - 4} y1={padT + plotH} y2={padT + plotH} stroke="rgba(148,163,184,0.35)" strokeWidth={1} />
          </svg>
          {hover !== null && points[hover] && (
            <div
              className="pointer-events-none absolute top-0 rounded-lg border border-white/15 bg-[#0d1628] px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: `${((padL + hover * slot + slot / 2) / width) * 100}%`, transform: "translateX(-50%)" }}
              role="status"
            >
              <div className="text-muted">Week of {weekLabel(points[hover].week)}</div>
              <div className="font-semibold text-ink">
                {points[hover].value} {unit}
              </div>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
