import { fmtUsd } from "@shared/money";
import { countdownTo, fmtLaDate, fmtLaDateTime } from "@shared/time";
import type { ChallengeVM } from "@/data/store";
import { store } from "@/data/store";
import { useNow, useStoreVersion } from "@/data/useStore";
import { Chip, ProgressBar, ProgressRing, SkeletonPanel, StateChip, cx } from "@/components/ui";
import {
  IconCalendar,
  IconCheck,
  IconClock,
  IconLock,
  IconSparkle,
  IconTrophy,
  IconUsers,
  IconWarning,
} from "@/components/icons";

function CountdownCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="panel-inset flex min-w-0 flex-col items-center px-2 py-3 sm:px-4 sm:py-4">
      <span className="num font-mono text-[30px] font-semibold leading-none text-mist-50 sm:text-[46px]">
        {String(value).padStart(2, "0")}
      </span>
      <span className="mt-1.5 text-[10px] font-semibold tracking-[0.2em] text-mist-600 sm:text-[11px]">
        {label}
      </span>
    </div>
  );
}

function Countdown({ endMs, nowMs, title, caption }: { endMs: number; nowMs: number; title: string; caption: string }) {
  const c = countdownTo(endMs, nowMs);
  return (
    <div>
      <div className="mb-3 flex items-center justify-center gap-2 text-[13px] font-semibold text-mist-400">
        <IconClock size={15} className="text-accent-300" />
        {title}
      </div>
      <div className="mx-auto grid max-w-md grid-cols-4 gap-2 sm:gap-3" role="timer" aria-label={`${title}: ${c.days} days, ${c.hours} hours, ${c.minutes} minutes, ${c.seconds} seconds`}>
        <CountdownCell value={c.days} label="DAYS" />
        <CountdownCell value={c.hours} label="HOURS" />
        <CountdownCell value={c.minutes} label="MIN" />
        <CountdownCell value={c.seconds} label="SEC" />
      </div>
      <p className="mb-0 mt-3 text-center text-[12.5px] text-mist-500">{caption}</p>
    </div>
  );
}

function HeroCard(props: {
  tone: "gold" | "muted" | "warn" | "err";
  icon: React.ReactNode;
  title: string;
  lines: (string | null)[];
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center rounded-2xl border px-6 py-8 text-center",
        props.tone === "gold" && "gold-card border-gold-400/35",
        props.tone === "muted" && "border-white/8 bg-white/[0.03]",
        props.tone === "warn" && "border-warn-500/30 bg-warn-500/[0.06]",
        props.tone === "err" && "border-neg-500/30 bg-neg-500/[0.06]",
      )}
    >
      <div
        className={cx(
          "mb-3",
          props.tone === "gold" ? "text-gold-400" : props.tone === "warn" ? "text-warn-400" : props.tone === "err" ? "text-neg-400" : "text-mist-500",
        )}
      >
        {props.icon}
      </div>
      <div className="font-display text-xl font-semibold text-mist-50 sm:text-2xl">{props.title}</div>
      {props.lines.filter(Boolean).map((l, i) => (
        <p key={i} className={cx("mb-0 max-w-xl text-[13.5px] leading-relaxed", i === 0 ? "mt-2 text-mist-300" : "mt-1.5 text-mist-500")}>
          {l}
        </p>
      ))}
    </div>
  );
}

function Hero({ ch, nowMs }: { ch: ChallengeVM; nowMs: number }) {
  const { status, window: win, config } = ch;
  const m = status.membership;

  switch (status.state) {
    case "qualified":
      return (
        <HeroCard
          tone="gold"
          icon={<IconTrophy size={30} />}
          title="Qualified — Founders Pool Member"
          lines={[
            `Seat ${m!.seatNo} of ${config.seatCap} · qualified ${fmtLaDate(Date.parse(m!.qualifiedAt))} via ${m!.path === "direct" ? "direct sales" : m!.path === "team" ? "team sales" : "Founders Pack"}.`,
            `Membership active through ${fmtLaDate(Date.parse(m!.membershipExpiresAt))} (one year from verification).`,
            "Qualification secures membership only — it does not guarantee a payout amount.",
          ]}
        />
      );
    case "membership_expired":
      return (
        <HeroCard
          tone="muted"
          icon={<IconClock size={28} />}
          title="Membership expired"
          lines={[
            `Your Founders Pool membership ended ${fmtLaDate(Date.parse(m!.membershipExpiresAt))} (qualified ${fmtLaDate(Date.parse(m!.qualifiedAt))}, seat ${m!.seatNo}).`,
            "Qualification windows do not restart automatically.",
          ]}
        />
      );
    case "pending_verification":
      return (
        <HeroCard
          tone="warn"
          icon={<IconClock size={28} />}
          title="Pending verification"
          lines={[
            `Your ${status.pending!.path === "founders_pack" ? "Founders Pack purchase" : "qualification"} was submitted ${fmtLaDateTime(Date.parse(status.pending!.submittedAt))} and is awaiting payment verification.`,
            "A conversion is not proof of payment — your seat is confirmed the moment payment verification completes (verification can finish after your window closes).",
          ]}
        />
      );
    case "capacity_reached":
      return (
        <HeroCard
          tone="err"
          icon={<IconUsers size={28} />}
          title="All 50 seats claimed"
          lines={[
            "The Founders Pool reached its 50 verified members before you qualified.",
            "Your sales still count toward the monthly and all-time leaderboards.",
          ]}
        />
      );
    case "window_ended":
      return (
        <HeroCard
          tone="muted"
          icon={<IconLock size={28} />}
          title="Your window has ended"
          lines={[
            win ? `Your 30-day window closed ${fmtLaDateTime(win.endMs)}.` : null,
            "Qualification windows do not restart automatically. Your sales still count toward the leaderboards.",
          ]}
        />
      );
    case "not_started":
    case "in_progress": {
      if (!win) {
        return (
          <HeroCard
            tone="muted"
            icon={<IconCalendar size={28} />}
            title="Launch date pending"
            lines={[
              "The challenge launch date hasn’t been configured yet.",
              "Enrolled before launch → your 30-day window starts at launch. Enrolled on or after launch → 30 days from your enrollment.",
            ]}
          />
        );
      }
      if (nowMs < win.startMs) {
        return (
          <Countdown
            endMs={win.startMs}
            nowMs={nowMs}
            title="Your window opens in"
            caption={`Window: ${fmtLaDate(win.startMs)} – ${fmtLaDate(win.endMs)} · opens ${fmtLaDateTime(win.startMs)}`}
          />
        );
      }
      return (
        <Countdown
          endMs={win.endMs}
          nowMs={nowMs}
          title="Your window closes in"
          caption={`Window: ${fmtLaDate(win.startMs)} – ${fmtLaDate(win.endMs)} · closes ${fmtLaDateTime(win.endMs)} · sales at the closing second don’t count`}
        />
      );
    }
  }
}

function FoundersPackCard({ ch }: { ch: ChallengeVM }) {
  const fp = ch.progress.foundersPack;
  const price = fmtUsd(ch.config.foundersPackMinCents);
  let body: React.ReactNode;
  if (fp.verified) {
    body = (
      <div className="flex items-center gap-2 text-[13.5px] font-medium text-pos-400">
        <IconCheck size={16} /> Verified qualifying purchase
      </div>
    );
  } else if (fp.awaitingPayment) {
    body = (
      <div className="flex items-center gap-2 text-[13.5px] font-medium text-warn-400">
        <IconClock size={16} /> Purchase found — payment verification pending
      </div>
    );
  } else {
    body = (
      <div className="flex items-center gap-2 text-[13.5px] text-mist-500">
        <IconSparkle size={16} /> No qualifying purchase yet
      </div>
    );
  }
  return (
    <div className="panel flex flex-col gap-2 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-mist-300">Founders Pack</span>
        <span className="num text-[12.5px] text-mist-500">{price} purchase</span>
      </div>
      {body}
      <span className="text-[12px] leading-relaxed text-mist-600">
        A verified {price} Founders Pack inside your window qualifies on its own. It counts once as a
        normal eligible sale — never as extra volume.
      </span>
    </div>
  );
}

export function Challenge() {
  useStoreVersion();
  const nowMs = useNow(1000);
  if (store.loading) return <SkeletonPanel lines={6} />;

  const ch = store.challenge(store.viewerId);
  const seatsLeft = Math.max(0, ch.seatCap - ch.seatsClaimed);
  const pct = ch.seatsClaimed / ch.seatCap;
  const direct = ch.progress.directCents;
  const team = ch.progress.teamCents;
  const showCountdownHero = !["qualified", "membership_expired"].includes(ch.status.state);

  return (
    <div className="panel panel-strong overflow-hidden">
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <StateChip state={ch.status.state} />
            <span className="text-[12.5px] text-mist-500">
              Enrolled {fmtLaDate(ch.enrolledAtMs)}
              {ch.window ? ` · window ${fmtLaDate(ch.window.startMs)} – ${fmtLaDate(ch.window.endMs)}` : ""}
            </span>
          </div>

          <Hero ch={ch} nowMs={nowMs} />

          {showCountdownHero ? null : (
            <p className="m-0 text-center text-[12.5px] text-mist-600">
              Window {ch.window ? `${fmtLaDate(ch.window.startMs)} – ${fmtLaDate(ch.window.endMs)}` : "—"} ·
              qualified members keep their seat for one year from verification.
            </p>
          )}

          {/* three alternative paths */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="panel flex flex-col justify-between gap-3 p-4">
              <ProgressBar
                label="Direct sales"
                value={Math.min(direct, ch.config.directTargetCents)}
                max={ch.config.directTargetCents}
                done={direct >= ch.config.directTargetCents}
                sublabel={
                  direct >= ch.config.directTargetCents
                    ? "Target reached ✓"
                    : `${fmtUsd(Math.max(0, ch.config.directTargetCents - direct))} to go · eligible sales in your window`
                }
              />
            </div>
            <div className="panel flex flex-col justify-between gap-3 p-4">
              {team === null ? (
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-semibold text-mist-300">Team sales</span>
                    <span className="num text-[13px] text-mist-500">{fmtUsd(ch.config.teamTargetCents)} target</span>
                  </div>
                  <div className="flex items-center gap-2 text-[13.5px] font-medium text-mist-500">
                    <IconUsers size={16} /> Team data not connected
                  </div>
                  <span className="mt-1.5 block text-[12px] leading-relaxed text-mist-600">
                    Verified team relationships and a confirmed rollup policy are required before
                    team volume can count.
                  </span>
                </div>
              ) : (
                <ProgressBar
                  label="Team sales"
                  value={Math.min(team, ch.config.teamTargetCents)}
                  max={ch.config.teamTargetCents}
                  done={team >= ch.config.teamTargetCents}
                  sublabel={
                    team >= ch.config.teamTargetCents
                      ? "Target reached ✓"
                      : `${fmtUsd(Math.max(0, ch.config.teamTargetCents - team))} to go · you + verified team, in your window`
                  }
                />
              )}
            </div>
            <FoundersPackCard ch={ch} />
          </div>

          <p className="m-0 text-[12px] leading-relaxed text-mist-600">
            Any <span className="font-semibold text-mist-400">one verified path</span> qualifies you — first{" "}
            {ch.seatCap} verified qualifiers only. Enrolled before launch → 30 days from launch; on or
            after → 30 days from enrollment. Only eligible transactions inside your window count, and
            monthly rankings are unaffected by your window. Qualification does not guarantee a payout.
          </p>

          {ch.config.launchIsDemoSample && ch.config.launchAt ? (
            <p className="m-0 text-[12px] text-warn-400/90">
              <IconWarning size={12} className="mr-1 inline align-[-1.5px]" />
              Sample launch date for this demo: {fmtLaDate(Date.parse(ch.config.launchAt))}. Production
              shows “Launch date pending” until you configure the real date.
            </p>
          ) : null}
        </div>

        {/* seats */}
        <div className="flex flex-row items-center justify-center gap-5 border-t border-white/5 pt-5 lg:flex-col lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
          <ProgressRing pct={pct} size={118} tone={seatsLeft === 0 ? "warn" : "accent"}>
            <div className="text-center">
              <div className="num font-display text-[22px] font-semibold leading-none text-mist-50">
                {ch.seatsClaimed}
                <span className="text-[14px] text-mist-500">/{ch.seatCap}</span>
              </div>
              <div className="mt-1 text-[10px] font-semibold tracking-[0.14em] text-mist-600">MEMBERS</div>
            </div>
          </ProgressRing>
          <div className="max-w-[180px] text-center lg:text-center">
            {seatsLeft > 0 ? (
              <>
                <div className="font-display text-lg font-semibold text-mist-50">
                  <span className="num">{seatsLeft}</span> seats left
                </div>
                <div className="mt-1 text-[12px] leading-relaxed text-mist-600">
                  Verified members claim seats in verification order.
                </div>
              </>
            ) : (
              <Chip tone="warn">Pool full — {ch.seatCap} verified members</Chip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
