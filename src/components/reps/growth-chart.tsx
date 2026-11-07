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

export function GrowthChart({
  data,
}: {
  data: { month: string; team: number; earnings: number }[];
}) {
  const last = data[data.length - 1];
  return (
    <figure
      className="h-56 w-full"
      aria-label={`Last 6 months. Team now ${last?.team ?? 0}. Earnings this month ${formatUsd(last?.earnings ?? 0)}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="earnings"
            tickFormatter={(v: number) => `$${v}`}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <YAxis
            yAxisId="team"
            orientation="right"
            allowDecimals={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface-solid)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              color: "var(--foreground)",
              fontSize: 12,
            }}
            formatter={(value, name) =>
              name === "earnings" ? [formatUsd(Number(value)), "Earnings"] : [value, "Team size"]
            }
          />
          <Bar
            yAxisId="earnings"
            dataKey="earnings"
            fill="var(--chart-2)"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
          <Line
            yAxisId="team"
            dataKey="team"
            stroke="var(--chart-1)"
            strokeWidth={2}
            type="monotone"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}
