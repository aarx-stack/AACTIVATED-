import { useState } from "react";
import { fmtLaDate } from "@shared/time";
import { store } from "@/data/store";
import { useStoreVersion } from "@/data/useStore";
import { Section, SkeletonPanel } from "@/components/ui";
import { Podium } from "./Podium";
import { Rankings, type BoardControls } from "./Rankings";
import { Performance } from "./Performance";
import { Challenge } from "./Challenge";
import { Recognition } from "./Recognition";

const PERIOD_LABEL = { monthly: "This month", weekly: "This week", alltime: "All-time" } as const;

export function AffiliateView() {
  useStoreVersion();
  const [controls, setControls] = useState<BoardControls>({ scope: "personal", period: "monthly" });
  const board = store.board({
    scope: controls.scope,
    period: controls.period,
    page: 1,
    pageSize: 10,
    search: "",
    sort: "sales",
    dir: "desc",
  });

  const viewerName = store.affiliate(store.viewerId).displayName;
  const periodCaption =
    controls.period === "alltime"
      ? "All-time"
      : `${PERIOD_LABEL[controls.period]} · since ${fmtLaDate(board.range.startMs)}`;

  return (
    <>
      <Section
        kicker="Top three"
        title={`${PERIOD_LABEL[controls.period]}’s leaders`}
        aside={null}
      >
        {store.loading ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <SkeletonPanel lines={3} />
            <SkeletonPanel lines={4} />
            <SkeletonPanel lines={3} />
          </div>
        ) : (
          <Podium
            podium={board.podium}
            caption={`${controls.scope === "personal" ? "Personal" : "Team"} eligible sales · ${periodCaption} · Pacific Time`}
          />
        )}
      </Section>

      <Section id="rankings" kicker="Standings" title="Rankings">
        <Rankings controls={controls} onControls={setControls} />
      </Section>

      <Section kicker={viewerName} title="My Performance">
        <Performance />
      </Section>

      <Section kicker="Founders Bonus Pool" title="The 30-Day Challenge">
        <Challenge />
      </Section>

      <Section kicker="Hall of Founders" title="Recognition">
        <Recognition />
      </Section>
    </>
  );
}
