import { useState } from "react";
import { store } from "@/data/store";
import { useStoreVersion } from "@/data/useStore";
import { notify } from "@/lib/toast";
import { fmtUsd } from "@shared/money";
import { Button, Segmented, cx } from "./ui";
import { IconBolt, IconChevronD, IconEye } from "./icons";

function Toggle(props: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span>
        <span className="block text-[13px] font-medium text-mist-200">{props.label}</span>
        {props.hint ? <span className="mt-0.5 block text-[11.5px] leading-snug text-mist-600">{props.hint}</span> : null}
      </span>
      <button
        role="switch"
        aria-checked={props.on}
        aria-label={props.label}
        onClick={() => props.onChange(!props.on)}
        className={cx(
          "relative mt-0.5 h-[22px] w-[40px] shrink-0 cursor-pointer rounded-full border transition-colors",
          props.on ? "border-accent-400/50 bg-accent-500/70" : "border-white/12 bg-ink-700",
        )}
      >
        <span
          className={cx(
            "absolute top-1/2 size-[16px] -translate-y-1/2 rounded-full bg-mist-100 transition-all",
            props.on ? "left-[20px]" : "left-[3px]",
          )}
        />
      </button>
    </label>
  );
}

/**
 * DEMO-ONLY panel. It swaps which fictional persona/view the preview renders —
 * nothing here exists in production builds, where identity and the admin role
 * come exclusively from the server-side session (see worker/lib/auth.ts).
 */
export function DemoControls() {
  useStoreVersion();
  // Open by default on desktop; collapsed on phones so it never buries content.
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.innerWidth >= 768);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(92vw,320px)]">
      {open ? (
        <div className="panel panel-strong overflow-hidden shadow-lift">
          <button
            onClick={() => setOpen(false)}
            className="flex w-full cursor-pointer items-center justify-between gap-2 border-0 border-b border-solid border-white/8 bg-warn-500/10 px-4 py-2.5 text-left"
          >
            <span className="inline-flex items-center gap-2 text-[12px] font-bold tracking-[0.12em] text-warn-400">
              <IconEye size={14} /> DEMO CONTROLS
            </span>
            <IconChevronD size={14} className="text-mist-500" />
          </button>
          <div className="space-y-4 p-4">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-mist-600">
                Preview as
              </div>
              <Segmented
                ariaLabel="Preview view"
                className="w-full [&>button]:flex-1"
                value={store.view}
                onChange={(v) => store.setView(v)}
                options={[
                  { value: "affiliate", label: "Affiliate" },
                  { value: "admin", label: "Admin" },
                ]}
              />
              <p className="mb-0 mt-1.5 text-[11px] leading-snug text-mist-600">
                Preview switch only — production access requires real sign-in; this control does not
                exist there.
              </p>
            </div>

            {store.view === "affiliate" ? (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-mist-600">
                  Demo persona
                </div>
                <select
                  aria-label="Demo persona"
                  value={store.viewerId}
                  onChange={(e) => store.setViewer(e.target.value)}
                  className="w-full cursor-pointer rounded-lg border border-white/10 bg-ink-900/80 px-2.5 py-2 text-[13px] text-mist-100 focus:border-accent-500/50 focus:outline-none"
                >
                  {store.personas().map((p) => (
                    <option key={p.affiliateId} value={p.affiliateId} className="bg-ink-850">
                      {p.name} — {p.tagline}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-3 border-t border-white/8 pt-3.5">
              <Toggle
                label="All 50 seats claimed"
                hint="Preview Capacity reached + a full recognition wall"
                on={store.seatsFull}
                onChange={(v) => store.setSeatsFull(v)}
              />
              <Toggle
                label="Simulate sync failure"
                hint="Preview the degraded-connection state"
                on={store.syncError}
                onChange={(v) => store.setSyncError(v)}
              />
            </div>

            <Button
              variant="soft"
              className="w-full"
              onClick={() => {
                const r = store.simulateSale();
                notify(`Demo sale: ${fmtUsd(r.amountCents)} for ${r.name}`);
              }}
            >
              <IconBolt size={14} /> Simulate a new sale
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="panel panel-strong ml-auto flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[12px] font-bold tracking-[0.12em] text-warn-400 shadow-lift"
        >
          <IconEye size={14} /> DEMO
        </button>
      )}
    </div>
  );
}
