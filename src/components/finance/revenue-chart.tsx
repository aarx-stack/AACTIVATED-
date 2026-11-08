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
import { formatUsd } from "@/lib/utils";

interface Point {
  date: string;
  revenue: number;
  expense: number;
}

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Running revenue and expense totals across the selected period. */
export function RevenueChart({ data }: { data: Point[] }) {
  const last = data[data.length - 1];
  return (
    <figure
      className="h-64 w-full"
      aria-label={`Running totals over ${data.length} days: revenue ${formatUsd(last?.revenue ?? 0)}, expense ${formatUsd(last?.expense ?? 0)}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="expFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            tickFormatter={(v: number) => formatUsd(v, { compact: true })}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            contentStyle={{
              background: "var(--surface-solid)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              color: "var(--foreground)",
              fontSize: 12,
            }}
            labelFormatter={(label) => shortDate(String(label))}
            formatter={(value, name) => [
              formatUsd(Number(value)),
              name === "revenue" ? "Revenue to date" : "Expense to date",
            ]}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--chart-2)"
            strokeWidth={2.5}
            fill="url(#revFill)"
          />
          <Area
            type="monotone"
            dataKey="expense"
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            fill="url(#expFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
