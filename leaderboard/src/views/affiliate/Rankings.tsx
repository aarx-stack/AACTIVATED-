import { useEffect, useState } from "react";
import type { PeriodType, Scope } from "@shared/types";
import { fmtInt, fmtUsd } from "@shared/money";
import { store, type LeaderboardQuery, type SortDir, type SortKey } from "@/data/store";
import { useStoreVersion } from "@/data/useStore";
import {
  Avatar,
  Button,
  Chip,
  EmptyState,
  MovementCell,
  Paginator,
  Segmented,
  SkeletonRow,
  TextInput,
  cx,
} from "@/components/ui";
import { IconChevronD, IconSearch, IconUsers } from "@/components/icons";

const PAGE_SIZE = 10;

export interface BoardControls {
  scope: Scope;
  period: PeriodType;
}

function SortHeader(props: {
  label: string;
  me: SortKey;
  sort: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = props.me === props.sort;
  return (
    <button
      onClick={() => props.onSort(props.me)}
      className={cx(
        "inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11.5px] font-semibold uppercase tracking-[0.14em]",
        active ? "text-accent-300" : "text-mist-600 hover:text-mist-300",
        props.className,
      )}
      aria-label={`Sort by ${props.label}`}
    >
      {props.label}
      <IconChevronD
        size={12}
        className={cx("transition-transform", active ? "opacity-100" : "opacity-0", active && props.dir === "asc" && "rotate-180")}
      />
    </button>
  );
}

export function Rankings(props: {
  controls: BoardControls;
  onControls: (c: BoardControls) => void;
}) {
  useStoreVersion();
  const { scope, period } = props.controls;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortKey>("sales");
  const [dir, setDir] = useState<SortDir>("desc");

  useEffect(() => {
    setPage(1);
  }, [search, scope, period]);

  const q: LeaderboardQuery = { scope, period, page, pageSize: PAGE_SIZE, search, sort, dir };
  const board = store.board(q);
  const viewerDisconnected = scope === "team" && board.me === null && store.descendantsOf(store.viewerId) === null;
  const loading = store.loading;
  const flash = store.lastSimulatedSale;

  const onSort = (k: SortKey) => {
    if (k === sort) {
      setDir(dir === "desc" ? "asc" : "desc");
    } else {
      setSort(k);
      setDir(k === "name" ? "asc" : "desc");
    }
    setPage(1);
  };

  const defaultOrder = sort === "sales" && dir === "desc" && !search;
  const showJump =
    defaultOrder && board.me !== null && !board.rows.some((r) => r.isMe) && board.pageCount > 1;

  return (
    <div className="panel overflow-hidden">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-4 py-3.5 sm:px-5">
        <Segmented
          ariaLabel="Leaderboard scope"
          value={scope}
          onChange={(s) => props.onControls({ ...props.controls, scope: s })}
          options={[
            { value: "personal", label: "Personal Sales" },
            { value: "team", label: "Team Sales" },
          ]}
        />
        <Segmented
          ariaLabel="Ranking period"
          value={period}
          onChange={(p) => props.onControls({ ...props.controls, period: p })}
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

      {viewerDisconnected ? (
        <div className="border-b border-white/5 bg-warn-500/[0.06] px-4 py-2.5 text-[12.5px] text-warn-400 sm:px-5">
          <IconUsers size={13} className="mr-1.5 inline align-[-2px]" />
          Your team data isn’t connected yet — team relationships need verification before your team
          total can appear here.
        </div>
      ) : null}

      {/* table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-white/5">
              <th className="w-14 px-4 py-3 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mist-600 sm:px-5">
                Rank
              </th>
              <th className="px-3 py-3">
                <SortHeader label="Affiliate" me="name" sort={sort} dir={dir} onSort={onSort} />
              </th>
              <th className="px-3 py-3 text-right">
                <SortHeader label="Eligible sales" me="sales" sort={sort} dir={dir} onSort={onSort} className="justify-end" />
              </th>
              <th className="hidden px-3 py-3 text-right md:table-cell">
                <SortHeader label="Orders" me="orders" sort={sort} dir={dir} onSort={onSort} className="justify-end" />
              </th>
              <th
                className="w-20 whitespace-nowrap px-4 py-3 text-right text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mist-600 sm:px-5"
                title="Rank movement vs. the latest snapshot"
              >
                Δ Rank
              </th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/[0.04]">
                    <td className="px-4 py-3.5 sm:px-5"><SkeletonRow w="20px" /></td>
                    <td className="px-3 py-3.5"><SkeletonRow w="160px" /></td>
                    <td className="px-3 py-3.5"><SkeletonRow w="70px" /></td>
                    <td className="hidden px-3 py-3.5 md:table-cell"><SkeletonRow w="36px" /></td>
                    <td className="px-4 py-3.5 sm:px-5"><SkeletonRow w="24px" /></td>
                  </tr>
                ))
              : board.rows.map((r) => {
                  const flashing = flash && flash.affiliateId === r.affiliateId && Date.now() - flash.atMs < 2500;
                  return (
                    <tr
                      key={r.affiliateId}
                      className={cx(
                        "border-b border-white/[0.04] transition-colors",
                        r.isMe
                          ? "bg-accent-500/[0.09] shadow-[inset_2.5px_0_0_0_var(--color-accent-500)]"
                          : "hover:bg-white/[0.025]",
                        flashing && "flash-row",
                      )}
                    >
                      <td className="px-4 py-3 sm:px-5">
                        <span
                          className={cx(
                            "num text-[14.5px] font-semibold",
                            r.rank === 1 ? "text-gold-300" : r.rank === 2 ? "text-silver-300" : r.rank === 3 ? "text-bronze-300" : "text-mist-400",
                          )}
                        >
                          {r.rank}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-3">
                          <Avatar name={r.displayName} size={30} ring={r.rank <= 3 ? (["gold", "silver", "bronze"] as const)[r.rank - 1]! : null} />
                          <span className="truncate text-[14.5px] font-medium text-mist-100">{r.displayName}</span>
                          {r.isMe ? <Chip tone="accent">{store.meLabel}</Chip> : null}
                        </span>
                      </td>
                      <td className="num px-3 py-3 text-right text-[14.5px] font-semibold text-mist-50">
                        {fmtUsd(r.amountCents)}
                      </td>
                      <td className="num hidden px-3 py-3 text-right text-[13.5px] text-mist-400 md:table-cell">
                        {fmtInt(r.orders)}
                      </td>
                      <td className="px-4 py-3 text-right sm:px-5">
                        <MovementCell movement={r.movement} />
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      {!loading && board.rows.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={<IconSearch size={20} />}
            title={`No affiliates match “${search}”`}
            body="Try a different name, or clear the search to see the full board."
            action={<Button sm onClick={() => setSearch("")}>Clear search</Button>}
          />
        </div>
      ) : null}

      {/* footer */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-white/5 px-4 py-3 sm:px-5">
        <span className="num text-[12.5px] text-mist-600">
          {board.total > 0
            ? `Showing ${(board.page - 1) * PAGE_SIZE + 1}–${Math.min(board.page * PAGE_SIZE, board.total)} of ${board.total}`
            : "0 results"}
          {scope === "team" && board.disconnectedCount > 0
            ? ` · ${board.disconnectedCount} hidden (team data not verified)`
            : ""}
        </span>
        {!board.hasSnapshot ? (
          <span className="text-[12px] text-mist-600">
            Δ appears once a comparable snapshot exists for this period.
          </span>
        ) : null}
        {showJump && board.me ? (
          <Button sm variant="soft" onClick={() => setPage(board.me!.page)}>
            Jump to my rank · #{board.me.rank}
          </Button>
        ) : null}
        <Paginator className="ml-auto" page={board.page} pageCount={board.pageCount} onPage={setPage} />
      </div>
    </div>
  );
}
