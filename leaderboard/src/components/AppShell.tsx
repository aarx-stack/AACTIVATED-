import type { ReactNode } from "react";
import { fmtLaTime } from "@shared/time";
import { store, type ViewMode } from "@/data/store";
import { useStoreVersion } from "@/data/useStore";
import { Banner, Button, Chip, cx } from "./ui";
import { IconShield, IconSync } from "./icons";

function StatusCluster() {
  useStoreVersion();
  const err = store.syncError;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {err ? (
        <Chip tone="warn">
          <span className="size-1.5 rounded-full bg-warn-400" />
          SYNC ISSUE
        </Chip>
      ) : (
        <Chip tone="cyan">
          <span className="pulse-dot size-1.5 rounded-full bg-glow-400" />
          DEMO FEED
        </Chip>
      )}
      <span className="num text-[12.5px] text-mist-500">
        {err ? "Last good data " : "Updated "}
        <span className="text-mist-300">{fmtLaTime(store.lastSyncMs)}</span>
      </span>
      <Button sm aria-label="Refresh now" onClick={() => store.refreshNow()} title="Refresh (demo polls every 60s)">
        <IconSync size={14} />
      </Button>
    </div>
  );
}

export function AppShell(props: { view: ViewMode; children: ReactNode }) {
  useStoreVersion();
  return (
    <div className="min-h-dvh">
      <div className="scene-bg" />

      {/* DEMO ribbon — always visible, unmistakable */}
      <div className="sticky top-0 z-40 border-b border-warn-500/25 bg-[#1c1406]/95 px-4 py-1.5 text-center backdrop-blur">
        <span className="text-[11.5px] font-semibold tracking-[0.14em] text-warn-400">
          DEMO — NOT LIVE · ALL NAMES &amp; FIGURES ARE FICTIONAL SAMPLE DATA
        </span>
      </div>

      <header className="mx-auto w-full max-w-7xl px-4 pt-7 sm:px-6 sm:pt-9">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div>
            <div className="wordmark flex items-center gap-2.5 text-[15px] text-mist-100 sm:text-base">
              AACTIVATED&nbsp;RX
              <span className="rounded-md border border-accent-500/40 bg-accent-500/12 px-1.5 py-0.5 text-[10px] tracking-[0.18em] text-accent-300">
                {props.view === "admin" ? "ADMIN" : "AFFILIATE"}
              </span>
            </div>
            <h1 className="font-display mt-2.5 text-[30px] font-bold leading-[1.05] tracking-tight text-mist-50 sm:text-[40px]">
              {props.view === "admin" ? "Program Control Center" : "Affiliate Leaderboard"}
            </h1>
            <p className="mt-2 mb-0 max-w-xl text-[14px] leading-relaxed text-mist-500">
              {props.view === "admin"
                ? "Verification, ledger and integration operations. Every correction requires a reason and lands in the audit log."
                : "Eligible sales only — verified payments, net of discounts and refunds, excluding tax and shipping. Reported in Pacific Time."}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2.5 sm:items-end">
            <StatusCluster />
            <span className="inline-flex items-center gap-1.5 text-[12px] text-mist-600">
              <IconShield size={13} />
              Production requires sign-in · demo preview is read-only sample data
            </span>
          </div>
        </div>

        {store.syncError ? (
          <div className="mt-5">
            <Banner
              tone="warn"
              action={
                <Button sm onClick={() => { store.refreshNow(); }}>
                  <IconSync size={13} /> Retry
                </Button>
              }
            >
              Live sync is failing — showing the last verified data from {fmtLaTime(store.lastSyncMs)}.
              {store.failedRetryAtMs ? ` Retry failed at ${fmtLaTime(store.failedRetryAtMs)}.` : ""}
            </Banner>
          </div>
        ) : null}
      </header>

      <main
        className={cx(
          "mx-auto w-full max-w-7xl px-4 pb-28 pt-8 sm:px-6 sm:pt-10",
          "flex flex-col gap-12 sm:gap-16",
        )}
      >
        {props.children}
      </main>

      <footer className="mx-auto w-full max-w-7xl border-t border-white/5 px-4 py-8 text-[12px] leading-relaxed text-mist-600 sm:px-6">
        AACTIVATED RX · Affiliate Leaderboard (demo build). Times shown in America/Los_Angeles.
        Qualification does not guarantee a payout; pool value and distribution rules are not shown
        because none are configured. Rankings use eligible sales only.
      </footer>
    </div>
  );
}
