import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PeriodType, Scope } from "@shared/types";
import { fmtInt, fmtUsd } from "@shared/money";
import { fmtLaDate, fmtLaDateTime } from "@shared/time";
import type { BoardRow } from "@/data/store";
import {
  fetchBoard,
  fetchRecognition,
  fetchSummary,
  type PublicBoard,
  type PublicRecognitionRow,
  type PublicSummary,
} from "@/data/liveApi";
import { useReveal } from "@/data/useStore";
import {
  Avatar,
  Banner,
  Button,
  Chip,
  EmptyState,
  MovementCell,
  Paginator,
  ProgressBar,
  ProgressRing,
  Section,
  Segmented,
  SkeletonPanel,
  SkeletonRow,
  TextInput,
  cx,
} from "@/components/ui";
import { IconLock, IconSearch, IconShield, IconTrophy, IconUsers } from "@/components/icons";
import { Podium } from "@/views/affiliate/Podium";

const POLL_MS = 60_000;
const PAGE_SIZE = 10;
const PERIOD_LABEL: Record<PeriodType, string> = {
  monthly: "This month",
  weekly: "This week",
  alltime: "All-time",
};

/* ————————————————————— header ————————————————————— */

function LiveStatus({ summary, error }: { summary: PublicSummary | null; error: boolean }) {
  const degraded = error || summary?.health === "degraded";
  const last = summary?.lastSuccessfulSyncAt ? fmtLaDateTime(Date.parse(summary.lastSuccessfulSyncAt)) : "—";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {degraded ? (
        <Chip tone="warn">
          <span className="size-1.5 rounded-full bg-warn-400" /> SYNC DEGRADED
        </Chip>
      ) : (
        <Chip tone="cyan">
          <span className="pulse-dot size-1.5 rounded-full bg-glow-400" /> LIVE
        </Chip>
      )}
      <span className="num text-[12.5px] text-mist-500">
        {degraded ? "Last good sync " : "Last synced "}
        <span className="text-mist-300">{last}</span>
      </span>
    </div>
  );
}

/* ————————————————————— pool card ————————————————————— */

function PoolCard({ summary }: { summary: PublicSummary }) {
  const { config, seatsClaimed } = summary;
  const seatsLeft = Math.max(0, config.seatCap - seatsClaimed);
  const launchPending = config.launchAt === null;
  return (
    <div className="panel panel-strong grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_auto]">
      <div className="min-w-0 space-y-5">
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-6 py-6 text-center">
          {launchPending ? (
            <>
              <div className="font-display text-xl font-semibold text-mist-50 sm:text-2xl">
                Launch date pending
              </div>
              <p className="mx-auto mt-2 mb-0 max-w-xl text-[13.5px] leading-relaxed text-mist-400">
                The 30-day Founders Bonus Pool opens when the launch date is set. Enrolled before
                launch → your window starts at launch; on or after → 30 days from enrollment.
              </p>
            </>
          ) : (
            <div className="font-display text-xl font-semibold text-mist-50">
              Challenge live · window {config.windowDays} days
            </div>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="panel p-4">
            <ProgressBar label="Direct sales" value={0} max={config.directTargetCents} sublabel="Target to qualify" />
          </div>
          <div className="panel p-4">
            <ProgressBar label="Team sales" value={0} max={config.teamTargetCents} sublabel="Verified team, in window" />
          </div>
          <div className="panel flex flex-col justify-center gap-1 p-4">
            <span className="text-[13px] font-semibold text-mist-300">Founders Pack</span>
            <span className="num text-[13px] text-mist-400">{fmtUsd(config.foundersPackMinCents)} verified purchase</span>
            <span className="text-[12px] leading-relaxed text-mist-600">
              Any one verified path qualifies — first {config.seatCap} only.
            </span>
          </div>
        </div>
        <p className="m-0 text-[12px] leading-relaxed text-mist-600">
          Sign in to see your own window, progress and performance. Qualification secures membership
          only — it does not guarantee a payout, and no pool value or distribution rules are shown
          because none are configured.
        </p>
      </div>
      <div className="flex flex-row items-center justify-center gap-5 border-t border-white/5 pt-5 lg:flex-col lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
        <ProgressRing pct={seatsClaimed / config.seatCap} size={118} tone={seatsLeft === 0 ? "warn" : "accent"}>
          <div className="text-center">
            <div className="num font-display text-[22px] font-semibold leading-none text-mist-50">
              {seatsClaimed}
              <span className="text-[14px] text-mist-500">/{config.seatCap}</span>
            </div>
            <div className="mt-1 text-[10px] font-semibold tracking-[0.14em] text-mist-600">MEMBERS</div>
          </div>
        </ProgressRing>
        <div className="max-w-[180px] text-center">
          {seatsLeft > 0 ? (
            <div className="font-display text-lg font-semibold text-mist-50">
              <span className="num">{seatsLeft}</span> seats left
            </div>
          ) : (
            <Chip tone="warn">Pool full</Chip>
          )}
        </div>
      </div>
    </div>
  );
}

/* ————————————————————— rankings ————————————————————— */

function LiveRankings({
  board,
  loading,
  scope,
  period,
  onScope,
  onPeriod,
}: {
  board: PublicBoard | null;
  loading: boolean;
  scope: Scope;
  period: PeriodType;
  onScope: (s: Scope) => void;
  onPeriod: (p: PeriodType) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search, scope, period]);

  const rows = board?.rows ?? [];
  const needle = search.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => r.displayName.toLowerCase().includes(needle)) : rows;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const p = Math.min(page, pageCount);
  const shown = filtered.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-4 py-3.5 sm:px-5">
        <Segmented
          ariaLabel="Leaderboard scope"
          value={scope}
          onChange={onScope}
          options={[
            { value: "personal", label: "Personal Sales" },
            { value: "team", label: "Team Sales" },
          ]}
        />
        <Segmented
          ariaLabel="Ranking period"
          value={period}
          onChange={onPeriod}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "weekly", label: "Weekly" },
            { value: "alltime", label: "All-time" },
          ]}
        />
        <TextInput
          className="ml-auto w-full sm:w-60"
          value={search}
          onChange={setSearch}
          placeholder="Search affiliates…"
          icon={<IconSearch size={15} />}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-white/5">
              <th className="w-14 px-4 py-3 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mist-600 sm:px-5">Rank</th>
              <th className="px-3 py-3 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mist-600">Affiliate</th>
              <th className="px-3 py-3 text-right text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mist-600">Eligible sales</th>
              <th className="hidden px-3 py-3 text-right text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mist-600 md:table-cell">Orders</th>
              <th className="w-20 whitespace-nowrap px-4 py-3 text-right text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mist-600 sm:px-5">Δ Rank</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/[0.04]">
                    <td className="px-4 py-3.5 sm:px-5"><SkeletonRow w="20px" /></td>
                    <td className="px-3 py-3.5"><SkeletonRow w="160px" /></td>
                    <td className="px-3 py-3.5"><SkeletonRow w="70px" /></td>
                    <td className="hidden px-3 py-3.5 md:table-cell"><SkeletonRow w="36px" /></td>
                    <td className="px-4 py-3.5 sm:px-5"><SkeletonRow w="24px" /></td>
                  </tr>
                ))
              : shown.map((r) => (
                  <tr key={r.affiliateId} className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.025]">
                    <td className="px-4 py-3 sm:px-5">
                      <span className={cx("num text-[14.5px] font-semibold", r.rank === 1 ? "text-gold-300" : r.rank === 2 ? "text-silver-300" : r.rank === 3 ? "text-bronze-300" : "text-mist-400")}>
                        {r.rank}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-3">
                        <Avatar name={r.displayName} size={30} ring={r.rank <= 3 ? (["gold", "silver", "bronze"] as const)[r.rank - 1]! : null} />
                        <span className="truncate text-[14.5px] font-medium text-mist-100">{r.displayName}</span>
                      </span>
                    </td>
                    <td className="num px-3 py-3 text-right text-[14.5px] font-semibold text-mist-50">{fmtUsd(r.amountCents)}</td>
                    <td className="num hidden px-3 py-3 text-right text-[13.5px] text-mist-400 md:table-cell">{fmtInt(r.orders)}</td>
                    <td className="px-4 py-3 text-right sm:px-5"><MovementCell movement={r.movement} /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={<IconSearch size={20} />}
            title={search ? `No affiliates match “${search}”` : "No eligible sales in this period yet"}
            body={search ? "Try a different name or clear the search." : "Rankings appear as verified eligible sales come in."}
            action={search ? <Button sm onClick={() => setSearch("")}>Clear search</Button> : undefined}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-white/5 px-4 py-3 sm:px-5">
        <span className="num text-[12.5px] text-mist-600">
          {filtered.length > 0 ? `Showing ${(p - 1) * PAGE_SIZE + 1}–${Math.min(p * PAGE_SIZE, filtered.length)} of ${filtered.length}` : "0 results"}
          {scope === "team" && board && board.disconnectedCount > 0 ? ` · ${board.disconnectedCount} hidden (team data not verified)` : ""}
        </span>
        {board && !board.hasSnapshot ? (
          <span className="text-[12px] text-mist-600">Δ appears once a daily snapshot exists for this period.</span>
        ) : null}
        <Paginator className="ml-auto" page={p} pageCount={pageCount} onPage={setPage} />
      </div>
    </div>
  );
}

/* ————————————————————— recognition ————————————————————— */

function LiveRecognition({ members }: { members: PublicRecognitionRow[] }) {
  if (members.length === 0) {
    return (
      <div className="panel p-5 sm:p-6">
        <EmptyState
          icon={<IconTrophy size={22} />}
          title="No verified members yet"
          body="The first 50 verified qualifiers appear here with their approved display names. Purchases, progress and commissions always stay private."
        />
      </div>
    );
  }
  const active = members.filter((m) => !m.expired).length;
  return (
    <div className="panel p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13.5px] text-mist-400">
          <span className="num font-semibold text-mist-100">{members.length}</span> verified members ·{" "}
          <span className="num">{active}</span> active
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-mist-600">
          <IconShield size={13} /> Approved display names only — purchases and progress stay private
        </span>
      </div>
      <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => (
          <li key={m.seatNo} className={cx("panel-inset flex items-center gap-3 px-3.5 py-2.5", m.expired && "opacity-55")}>
            <Avatar name={m.displayName} size={34} ring={m.expired ? null : "gold"} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-mist-100">{m.displayName}</div>
              <div className="text-[11.5px] text-mist-600">
                Seat <span className="num">{m.seatNo}</span> · qualified {fmtLaDate(Date.parse(m.qualifiedAt))}
                {m.expired ? " · ended" : ""}
              </div>
            </div>
            {!m.expired ? <IconTrophy size={15} className="shrink-0 text-gold-400/80" /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ————————————————————— app ————————————————————— */

export function LiveApp() {
  const [summary, setSummary] = useState<PublicSummary | null>(null);
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [recognition, setRecognition] = useState<PublicRecognitionRow[]>([]);
  const [scope, setScope] = useState<Scope>("personal");
  const [period, setPeriod] = useState<PeriodType>("monthly");
  const [boardLoading, setBoardLoading] = useState(true);
  const [error, setError] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const heroRef = useReveal<HTMLDivElement>();

  const loadBoard = useCallback(
    async (signal?: AbortSignal) => {
      setBoardLoading(true);
      try {
        setBoard(await fetchBoard(scope, period, signal));
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setError(true);
      } finally {
        setBoardLoading(false);
      }
    },
    [scope, period],
  );

  // Board reloads whenever scope/period changes.
  useEffect(() => {
    const ac = new AbortController();
    void loadBoard(ac.signal);
    return () => ac.abort();
  }, [loadBoard]);

  // Summary + recognition on mount, then everything polls every 60s.
  const pollRef = useRef<() => void>(() => {});
  pollRef.current = () => {
    void (async () => {
      try {
        const [s, r] = await Promise.all([fetchSummary(), fetchRecognition()]);
        setSummary(s);
        setRecognition(r.members);
        setError(false);
      } catch {
        setError(true);
      } finally {
        setFirstLoad(false);
      }
      void loadBoard();
    })();
  };

  useEffect(() => {
    pollRef.current();
    const t = setInterval(() => pollRef.current(), POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const podium = useMemo<BoardRow[]>(
    () => (board?.rows ?? []).slice(0, 3).map((r) => ({ ...r, isMe: false })),
    [board],
  );

  return (
    <div className="min-h-dvh">
      <div className="scene-bg" />

      <header className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6 sm:pt-10">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div>
            <div className="wordmark flex items-center gap-2.5 text-[15px] text-mist-100 sm:text-base">
              AACTIVATED&nbsp;RX
              <span className="rounded-md border border-accent-500/40 bg-accent-500/12 px-1.5 py-0.5 text-[10px] tracking-[0.18em] text-accent-300">
                LEADERBOARD
              </span>
            </div>
            <h1 className="font-display mt-2.5 text-[30px] font-bold leading-[1.05] tracking-tight text-mist-50 sm:text-[40px]">
              Affiliate Leaderboard
            </h1>
            <p className="mt-2 mb-0 max-w-xl text-[14px] leading-relaxed text-mist-500">
              Live eligible sales — verified payments, net of discounts and refunds, excluding tax and
              shipping. Reported in Pacific Time · refreshes every 60 seconds.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2.5 sm:items-end">
            <LiveStatus summary={summary} error={error} />
            <span className="inline-flex items-center gap-1.5 text-[12px] text-mist-600">
              <IconLock size={13} /> Public board · sign in for My Performance &amp; Admin
            </span>
          </div>
        </div>

        {error ? (
          <div className="mt-5">
            <Banner tone="warn">
              Couldn’t reach the live feed just now — showing the last data received. Retrying every 60s.
            </Banner>
          </div>
        ) : null}
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 pb-28 pt-8 sm:gap-16 sm:px-6 sm:pt-10">
        <div ref={heroRef} className="reveal">
          {firstLoad && !board ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <SkeletonPanel lines={3} />
              <SkeletonPanel lines={4} />
              <SkeletonPanel lines={3} />
            </div>
          ) : podium.length === 3 ? (
            <Podium
              podium={podium}
              meLabel="Leader"
              caption={`${scope === "personal" ? "Personal" : "Team"} eligible sales · ${PERIOD_LABEL[period]} · Pacific Time`}
            />
          ) : (
            <EmptyState
              icon={<IconUsers size={22} />}
              title="Not enough ranked affiliates yet"
              body="The podium appears once at least three affiliates have eligible sales in this period."
            />
          )}
        </div>

        <Section kicker="Standings" title="Rankings">
          <LiveRankings
            board={board}
            loading={boardLoading}
            scope={scope}
            period={period}
            onScope={setScope}
            onPeriod={setPeriod}
          />
        </Section>

        <Section kicker="Founders Bonus Pool" title="The 30-Day Challenge">
          {summary ? <PoolCard summary={summary} /> : <SkeletonPanel lines={5} />}
        </Section>

        <Section kicker="Hall of Founders" title="Recognition">
          <LiveRecognition members={recognition} />
        </Section>
      </main>

      <footer className="mx-auto w-full max-w-7xl border-t border-white/5 px-4 py-8 text-[12px] leading-relaxed text-mist-600 sm:px-6">
        AACTIVATED RX · Affiliate Leaderboard. Times shown in America/Los_Angeles. Qualification does
        not guarantee a payout; pool value and distribution rules are not shown because none are
        configured. Rankings use eligible sales only.
      </footer>
    </div>
  );
}
