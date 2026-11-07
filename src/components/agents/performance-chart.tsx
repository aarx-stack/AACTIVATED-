"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Point {
  date: string;
  tasks: number;
  spend: number;
}

const weekday = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });

/** Tasks completed per day as a glowing area chart (Obsidian Glass "Weekly Performance"). */
export function PerformanceChart({ data }: { data: Point[] }) {
  const total = data.reduce((n, p) => n + p.tasks, 0);
  return (
    <figure
      className="h-48 w-full"
      aria-label={`${total} tasks completed over the last ${data.length} days`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
          <defs>
            <linearGradient id="perfFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.65} />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={weekday}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface-solid)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              color: "var(--foreground)",
              fontSize: 12,
            }}
            labelFormatter={(label) => weekday(String(label))}
            formatter={(value) => [value, "Tasks completed"]}
          />
          <Area
            type="monotone"
            dataKey="tasks"
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            fill="url(#perfFill)"
            dot={{ r: 3.5, fill: "#ffffff", stroke: "var(--chart-1)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
