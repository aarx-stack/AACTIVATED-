import type { BoardRow } from "@/data/store";
import { fmtInt, fmtUsd } from "@shared/money";
import { useCountUp } from "@/data/useStore";
import { Avatar, Chip, MovementCell, cx } from "@/components/ui";
import { IconCrown } from "@/components/icons";

const PLACE = {
  1: { ring: "gold" as const, card: "gold-card", label: "text-gold-300", medal: "bg-gold-400 text-ink-950" },
  2: { ring: "silver" as const, card: "silver-card", label: "text-silver-300", medal: "bg-silver-400 text-ink-950" },
  3: { ring: "bronze" as const, card: "bronze-card", label: "text-bronze-300", medal: "bg-bronze-400 text-ink-950" },
};

function PodiumCard({ row, big }: { row: BoardRow; big?: boolean }) {
  const place = PLACE[row.rank as 1 | 2 | 3] ?? PLACE[3];
  const amount = useCountUp(row.amountCents);
  return (
    <div
      className={cx(
        "panel hover-lift relative flex flex-col items-center px-5 text-center",
        place.card,
        big ? "py-8 sm:py-10" : "py-6 sm:py-7",
      )}
    >
      <span
        aria-label={`Rank ${row.rank}`}
        className={cx(
          "num absolute left-4 top-4 grid size-7 place-items-center rounded-full text-[13px] font-bold",
          place.medal,
        )}
      >
        {row.rank}
      </span>
      {row.rank === 1 ? (
        <IconCrown size={big ? 26 : 20} className="mb-2 text-gold-400" aria-hidden="true" />
      ) : (
        <span className={cx("mb-2", big ? "h-[26px]" : "h-[20px]")} aria-hidden="true" />
      )}
      <Avatar name={row.displayName} size={big ? 72 : 56} ring={place.ring} />
      <div className={cx("font-display mt-3 font-semibold text-mist-50", big ? "text-xl" : "text-[16px]")}>
        {row.displayName}
        {row.isMe ? <Chip tone="accent" className="ml-2 align-middle">You</Chip> : null}
      </div>
      <div className={cx("mt-0.5 text-[12px] font-semibold tracking-[0.16em] uppercase", place.label)}>
        {row.rank === 1 ? "First place" : row.rank === 2 ? "Second place" : "Third place"}
      </div>
      <div className={cx("num mt-3 font-semibold text-mist-50", big ? "text-4xl sm:text-[44px]" : "text-[26px]")}>
        {fmtUsd(amount)}
      </div>
      <div className="mt-1.5 flex items-center gap-2.5 text-[12.5px] text-mist-500">
        <span className="num">{fmtInt(row.orders)} eligible orders</span>
        <MovementCell movement={row.movement} />
      </div>
    </div>
  );
}

export function Podium({ podium, caption }: { podium: BoardRow[]; caption: string }) {
  if (podium.length < 3) return null;
  const [first, second, third] = podium as [BoardRow, BoardRow, BoardRow];
  return (
    <div>
      {/* Desktop: 2 · 1 · 3 with the leader elevated; mobile: 1 then 2/3 */}
      <div className="hidden items-end gap-4 sm:grid sm:grid-cols-3">
        <PodiumCard row={second} />
        <PodiumCard row={first} big />
        <PodiumCard row={third} />
      </div>
      <div className="grid gap-3 sm:hidden">
        <PodiumCard row={first} big />
        <div className="grid grid-cols-2 gap-3">
          <PodiumCard row={second} />
          <PodiumCard row={third} />
        </div>
      </div>
      <p className="mb-0 mt-3 text-center text-[12px] text-mist-600">{caption}</p>
    </div>
  );
}
