import { Lock, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { AGENT_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import { getCompanyTeam, type CompanyTeam } from "@/server/queries/team";

export const metadata: Metadata = { title: "Company Team" };

const DOT = {
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-subtle-foreground",
} as const;

type Department = CompanyTeam["departments"][number];

function OrgCard({
  title,
  rows,
  status,
  href,
  locked,
  testId,
  extra,
  large,
}: {
  title: string;
  rows: { label: string; value: string }[];
  status: { label: string; tone: keyof typeof DOT; live?: boolean };
  href?: string;
  locked?: boolean;
  testId?: string;
  extra?: string;
  large?: boolean;
}) {
  const body = (
    <>
      <div
        className={cn(
          "flex items-center justify-between gap-2 rounded-t-[17px] border-b border-[var(--border-strong)] px-4 py-2.5",
          "bg-[linear-gradient(180deg,rgba(64,150,255,0.8),rgba(18,82,214,0.55))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]",
          large ? "justify-center py-3" : "",
        )}
      >
        <h3 className={cn("leading-tight font-bold", large ? "text-xl" : "text-[15px]")}>
          {title}
        </h3>
        {locked && <Lock className="size-3.5 shrink-0 text-white/90" aria-label="Executive only" />}
      </div>
      <dl className="flex flex-1 flex-col gap-2 px-4 py-3 text-[13px]">
        {rows.map((r) => (
          <div key={r.label} className={large ? "flex gap-2" : undefined}>
            <dt className="text-muted-foreground">{r.label}:</dt>
            <dd className="font-semibold">{r.value}</dd>
          </div>
        ))}
        {extra && <p className="text-xs text-muted-foreground">{extra}</p>}
        <p className="mt-auto flex items-center gap-2 pt-1 font-semibold">
          <span
            className={cn("size-3 rounded-pill", DOT[status.tone], status.live && "live-dot")}
            aria-hidden
          />
          {status.label}
        </p>
      </dl>
    </>
  );
  const cls = cn(
    "glass flex h-full flex-col transition-shadow",
    large ? "w-full max-w-sm" : "",
    href ? "hover:shadow-glow focus-visible:shadow-glow" : "",
  );
  return href ? (
    <Link href={href} className={cls} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-testid={testId} aria-disabled={locked || undefined}>
      {body}
    </div>
  );
}

function DepartmentCard({ d }: { d: Department }) {
  const lead = d.agents.find((a) => a.status === "ACTIVE") ?? d.agents[0];
  const status = lead ? AGENT_STATUS[lead.status] : { label: "No agent", tone: "neutral" as const };
  return (
    <OrgCard
      testId={`dept-${d.name}`}
      title={d.divisionOf ? `${d.name} (${d.divisionOf} division)` : d.name}
      href={lead?.canOpen ? `/agents/${lead.id}` : undefined}
      locked={d.isConfidential}
      rows={[
        { label: "Agent Role", value: lead ? `${lead.title} (${lead.name})` : "Unassigned" },
        { label: "Human Owner", value: lead?.owner ?? d.owner ?? "Unassigned" },
      ]}
      extra={
        d.agents.length > 1
          ? `+${d.agents.length - 1} more agent${d.agents.length > 2 ? "s" : ""}`
          : undefined
      }
      status={{ label: status.label, tone: status.tone, live: lead?.status === "ACTIVE" }}
    />
  );
}

/** One row of the chart with a glowing bus line and drops to each card (desktop). */
function OrgRow({ items, cols }: { items: Department[]; cols: string }) {
  return (
    <div className="relative pt-7">
      <span
        aria-hidden
        className="absolute top-0 hidden h-px bg-[var(--accent-cyan)] shadow-[0_0_10px_var(--accent-cyan)] lg:block"
        style={{ left: `${50 / items.length}%`, right: `${50 / items.length}%` }}
      />
      <ul className={cn("grid gap-4 sm:grid-cols-2", cols)}>
        {items.map((d) => (
          <li key={d.id} className="relative">
            <span
              aria-hidden
              className="absolute -top-7 left-1/2 hidden h-7 w-px bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan)] lg:block"
            />
            <DepartmentCard d={d} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function CompanyTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requirePagePermission("company_team.view");
  const { q = "" } = await searchParams;
  const { brain, departments } = await getCompanyTeam(user.role);
  const query = q.trim().toLowerCase();
  const visible = query
    ? departments.filter(
        (d) =>
          d.name.toLowerCase().includes(query) ||
          d.agents.some((a) => `${a.title} ${a.name} ${a.owner}`.toLowerCase().includes(query)),
      )
    : departments;
  const split = Math.ceil(visible.length / 2) - (visible.length > 10 ? 1 : 0);
  const rows = query ? [visible] : [visible.slice(0, split), visible.slice(split)];
  const brainStatus = brain ? AGENT_STATUS[brain.status] : null;

  return (
    <>
      <PageHeader
        title="Company Team"
        description="Your AI-powered company organizational chart. Every agent has an accountable human owner."
        actions={
          <form
            role="search"
            className="glass flex items-center gap-2 rounded-pill px-4 py-2"
            action="/team"
          >
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <label htmlFor="team-search" className="sr-only">
              Search agents and departments
            </label>
            <input
              id="team-search"
              name="q"
              defaultValue={q}
              placeholder="Search agents, teams or owners…"
              className="w-56 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            />
          </form>
        }
      />

      <div className="flex flex-col items-center">
        <div className="relative w-full max-w-sm" data-testid="org-ceo">
          <OrgCard
            large
            title={brain?.name === "The Brain" ? "AI CEO" : (brain?.name ?? "AI CEO")}
            rows={[
              {
                label: "Agent Role",
                value:
                  brain?.title === "AI CEO"
                    ? "Chief Executive Officer (The Brain)"
                    : (brain?.title ?? "AI CEO"),
              },
              { label: "Human Owner", value: brain?.owner ?? "Unassigned" },
            ]}
            status={{
              label: brainStatus?.label ?? "Offline",
              tone: brainStatus?.tone ?? "neutral",
              live: brain?.status === "ACTIVE",
            }}
          />
        </div>
        <span
          aria-hidden
          className="hidden h-7 w-px bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan)] lg:block"
        />
      </div>

      <div className="mt-2 flex flex-col gap-8 lg:mt-0">
        {visible.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">No department matches “{q}”.</p>
        )}
        {rows
          .filter((r) => r.length > 0)
          .map((row, i) => (
            <OrgRow
              key={i}
              items={row}
              cols={
                row.length >= 6
                  ? "lg:grid-cols-6"
                  : row.length === 5
                    ? "lg:grid-cols-5"
                    : `lg:grid-cols-${Math.max(1, row.length)}`
              }
            />
          ))}
      </div>
    </>
  );
}
