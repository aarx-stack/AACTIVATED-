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

/** Team size over time as a glowing area line (Obsidian Glass "Team Growth"). */
export function GrowthChart({
  data,
}: {
  data: { month: string; team: number; earnings: number }[];
}) {
  const last = data[data.length - 1];
  return (
    <figure
      className="h-52 w-full"
      aria-label={`Team size over the last ${data.length} months, now ${last?.team ?? 0}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
          <defs>
            <linearGradient id="teamFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.7} />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="month"
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
            formatter={(value) => [value, "Team members"]}
          />
          <Area
            type="monotone"
            dataKey="team"
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            fill="url(#teamFill)"
            dot={{ r: 3.5, fill: "#ffffff", stroke: "var(--chart-1)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
