import { fmtInt, fmtUsd } from "@shared/money";
import { store } from "@/data/store";
import { useCountUp, useStoreVersion } from "@/data/useStore";
import { Chip, MovementCell, SkeletonPanel, Sparkline, cx } from "@/components/ui";
import { IconLock, IconUsers } from "@/components/icons";
import type { ReactNode } from "react";

function Tile(props: { label: string; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className={cx("panel hover-lift flex flex-col justify-between gap-3 p-5", props.className)}>
      <div className="text-[12.5px] font-semibold text-mist-500">{props.label}</div>
      <div>{props.children}</div>
      {props.footer ? <div className="text-[12px] text-mist-600">{props.footer}</div> : null}
    </div>
  );
}

function Money({ cents }: { cents: number }) {
  const v = useCountUp(cents);
  return <span className="num">{fmtUsd(v)}</span>;
}

export function Performance() {
  useStoreVersion();
  if (store.loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonPanel key={i} lines={2} />
        ))}
      </div>
    );
  }

  const perf = store.performance(store.viewerId);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="My rank" footer="Personal sales · this month">
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-4xl font-semibold text-mist-50">
              {perf.rank ? <span className="num">#{perf.rank}</span> : "—"}
            </span>
            <MovementCell movement={perf.rankMovement} />
          </div>
        </Tile>

        <Tile label="Personal sales" footer="Eligible revenue · this month">
          <div className="flex items-end justify-between gap-3">
            <span className="text-3xl font-semibold text-mist-50">
              <Money cents={perf.personalMonthCents} />
            </span>
            <Sparkline points={perf.spark} width={104} height={30} />
          </div>
        </Tile>

        <Tile
          label="Team sales"
          footer={
            perf.teamMonthCents === null
              ? "Relationships must be verified before totals appear"
              : `${fmtInt(perf.teamOrders ?? 0)} team orders · this month`
          }
        >
          {perf.teamMonthCents === null ? (
            <div className="flex items-center gap-2 text-[15px] font-medium text-mist-500">
              <IconUsers size={17} />
              Team data not connected
            </div>
          ) : (
            <span className="text-3xl font-semibold text-mist-50">
              <Money cents={perf.teamMonthCents} />
            </span>
          )}
        </Tile>

        <Tile label="Eligible orders" footer="Verified-paid orders · this month">
          <span className="num text-3xl font-semibold text-mist-50">{fmtInt(perf.personalOrders)}</span>
        </Tile>
      </div>

      {/* Commission tier — only ever rendered from a configured plan. */}
      {perf.compPlan && perf.tier ? (
        <div className="panel p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[12.5px] font-semibold text-mist-500">Commission tier</span>
            <Chip tone="warn">{perf.compPlan.label}</Chip>
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div className="font-display text-2xl font-semibold text-mist-50">
              {perf.tier.current}
              {perf.tier.next ? (
                <span className="ml-2 text-[13px] font-medium text-mist-500">
                  next: {perf.tier.next}
                </span>
              ) : (
                <span className="ml-2 text-[13px] font-medium text-mist-500">top tier</span>
              )}
            </div>
            {perf.tier.toNextCents !== null ? (
              <span className="num text-[13px] text-mist-400">
                {fmtUsd(perf.tier.toNextCents)} to {perf.tier.next}
              </span>
            ) : null}
          </div>
          {perf.tier.next ? (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-accent-500/12">
                <div
                  className="bar-fill h-full rounded-full bg-gradient-to-r from-accent-600 to-accent-400"
                  style={{ width: `${(perf.tier.pct * 100).toFixed(1)}%` }}
                />
              </div>
            </div>
          ) : null}
          <p className="mb-0 mt-3 text-[12px] leading-relaxed text-mist-600">{perf.compPlan.rateNote}</p>
        </div>
      ) : (
        <div className="panel-inset flex items-start gap-3 px-5 py-4">
          <IconLock size={17} className="mt-0.5 shrink-0 text-mist-600" />
          <p className="m-0 text-[13px] leading-relaxed text-mist-500">
            <span className="font-semibold text-mist-300">No verified compensation plan configured.</span>{" "}
            Your current tier and next-tier progress will appear here once a plan is verified.
            Commission rates and tier thresholds are never estimated.
          </p>
        </div>
      )}
    </div>
  );
}
