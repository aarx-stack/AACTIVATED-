import { fmtLaDate } from "@shared/time";
import { store } from "@/data/store";
import { useStoreVersion } from "@/data/useStore";
import { Avatar, SkeletonPanel, cx } from "@/components/ui";
import { IconShield, IconTrophy } from "@/components/icons";

export function Recognition() {
  useStoreVersion();
  if (store.loading) return <SkeletonPanel lines={5} />;

  const rows = store.recognition();
  const activeCount = rows.filter((r) => !r.expired).length;

  return (
    <div className="panel p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13.5px] text-mist-400">
          <span className="num font-semibold text-mist-100">{rows.length}</span> verified members ·{" "}
          <span className="num">{activeCount}</span> active
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-mist-600">
          <IconShield size={13} />
          Approved display names only — purchases, progress and commissions stay private
        </span>
      </div>
      <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <li
            key={r.affiliateId}
            className={cx(
              "panel-inset flex items-center gap-3 px-3.5 py-2.5",
              r.expired && "opacity-55",
            )}
          >
            <Avatar name={r.displayName} size={34} ring={r.expired ? null : "gold"} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-mist-100">{r.displayName}</div>
              <div className="text-[11.5px] text-mist-600">
                Seat <span className="num">{r.seatNo}</span> · qualified {fmtLaDate(r.qualifiedAtMs)}
                {r.expired ? " · membership ended" : ""}
              </div>
            </div>
            {!r.expired ? <IconTrophy size={15} className="shrink-0 text-gold-400/80" /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
