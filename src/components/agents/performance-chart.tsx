"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsd } from "@/lib/utils";

interface Point {
  date: string;
  tasks: number;
  spend: number;
}

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function PerformanceChart({ data }: { data: Point[] }) {
  const tasks = data.reduce((n, p) => n + p.tasks, 0);
  const spend = data.reduce((n, p) => n + p.spend, 0);
  return (
    <figure
      className="h-56 w-full"
      aria-label={`Last 14 days: ${tasks} tasks completed, ${formatUsd(spend)} AI spend`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            yAxisId="tasks"
            allowDecimals={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <YAxis
            yAxisId="spend"
            orientation="right"
            tickFormatter={(v: number) => `$${v}`}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface-solid)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              color: "var(--foreground)",
              fontSize: 12,
            }}
            labelFormatter={(label) => shortDate(String(label))}
            formatter={(value, name) =>
              name === "spend" ? [formatUsd(Number(value)), "AI spend"] : [value, "Tasks done"]
            }
          />
          <Bar
            yAxisId="tasks"
            dataKey="tasks"
            fill="var(--chart-2)"
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
          />
          <Line
            yAxisId="spend"
            dataKey="spend"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={false}
            type="monotone"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}
