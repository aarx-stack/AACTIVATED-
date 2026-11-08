"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsd } from "@/lib/utils";

/** AI model spend per department for the selected period. */
export function DeptSpendChart({
  data,
}: {
  data: { department: string; short: string; usd: number }[];
}) {
  const total = data.reduce((n, d) => n + d.usd, 0);
  return (
    <figure
      className="h-64 w-full"
      aria-label={`AI spend by department, ${formatUsd(total)} in total. ${data
        .map((d) => `${d.department} ${formatUsd(d.usd)}`)
        .join(", ")}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 22, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="deptBar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={1} />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.7} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="short"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tickFormatter={(v: number) => `$${v}`}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-hover)" }}
            contentStyle={{
              background: "var(--surface-solid)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              color: "var(--foreground)",
              fontSize: 12,
            }}
            labelFormatter={(_, payload) =>
              (payload?.[0]?.payload as { department?: string } | undefined)?.department ?? ""
            }
            formatter={(value) => [formatUsd(Number(value)), "AI spend"]}
          />
          <Bar dataKey="usd" fill="url(#deptBar)" radius={[6, 6, 0, 0]} maxBarSize={44}>
            <LabelList
              dataKey="usd"
              position="top"
              formatter={(v: unknown) => `$${Math.round(Number(v))}`}
              style={{ fill: "var(--foreground)", fontSize: 11, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
