import { useId } from "react";

/** Glowing circular progress (Obsidian Glass "Today's Progress"). */
export function ProgressRing({
  value,
  size = 112,
  stroke = 10,
  label,
  sublabel = "Today's Progress",
}: {
  /** 0..1 */
  value: number;
  size?: number;
  stroke?: number;
  label: string;
  sublabel?: string;
}) {
  const id = useId();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${Math.round(pct * 100)}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <defs>
          <linearGradient id={`ring-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#14d2ff" />
            <stop offset="100%" stopColor="#1d7bff" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-muted)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#ring-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ filter: "drop-shadow(0 0 6px rgba(30, 190, 255, 0.7))" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xl font-bold tabular-nums">{Math.round(pct * 100)}%</span>
        <span className="text-[10px] leading-tight text-muted-foreground">{sublabel}</span>
      </div>
    </div>
  );
}
