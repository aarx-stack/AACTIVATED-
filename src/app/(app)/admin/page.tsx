import {
  ChevronRight,
  CircleCheck,
  FileClock,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  UserCog,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { HealthCheckButton } from "@/components/admin/health-check-button";
import { IntegrationToggle } from "@/components/admin/integration-toggle";
import { InviteForm } from "@/components/admin/invite-form";
import { UsersTable, type AdminUserRow } from "@/components/admin/users-table";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SwitchIndicator } from "@/components/ui/switch-indicator";
import { Role } from "@/generated/prisma/enums";
import { HEALTH_STATUS } from "@/lib/status";
import { cn, formatRelativeTime } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/session";
import {
  ALL_PERMISSIONS,
  can,
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_ORDER,
  type PermissionGroup,
} from "@/server/authz/permissions";
import { canChangeRole, canChangeUserStatus } from "@/server/authz/policies";
import { getSystemHealth } from "@/server/health/health";
import { getIntegrations, missingCredentials } from "@/server/integrations";
import { getAdminData } from "@/server/queries/admin";

export const metadata: Metadata = { title: "Admin & Access Control" };

const INTEGRATION_MARK: Record<string, string> = {
  GOHIGHLEVEL: "bg-[linear-gradient(135deg,#f59e0b,#22c55e_50%,#3b82f6)]",
  QUICKBOOKS: "bg-[#2ca01c]",
  SLACK: "bg-[linear-gradient(135deg,#e01e5a,#36c5f0_50%,#2eb67d)]",
  ANTHROPIC: "bg-[linear-gradient(135deg,#d97757,#f0c8a8)]",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const actor = await requirePagePermission("admin.view");
  const modes = Object.fromEntries(getIntegrations().map((a) => [a.key, a.mode])) as Partial<
    Record<string, "mock" | "live">
  >;
  const liveCount = Object.values(modes).filter((m) => m === "live").length;
  const canManageIntegrations = can(actor.role, "integrations.manage");
  const { q = "" } = await searchParams;
  const [{ users, totalUsers, integrations, uptime }, health] = await Promise.all([
    getAdminData(q),
    getSystemHealth(),
  ]);
  const canManage = can(actor.role, "users.manage");

  const rows: AdminUserRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    title: u.title,
    role: u.role,
    status: u.status,
    lastActive: u.lastActiveAt ? formatRelativeTime(u.lastActiveAt) : "Never",
    assignableRoles: canManage ? ROLE_ORDER.filter((r) => canChangeRole(actor, u, r).ok) : [],
    canToggleStatus: canManage && u.status !== "INVITED" && canChangeUserStatus(actor, u).ok,
    isSelf: u.id === actor.id,
  }));

  const invitableRoles = ROLE_ORDER.filter(
    (r) => r !== Role.EXECUTIVE || actor.role === Role.EXECUTIVE,
  );
  const groups = [
    ...new Set(ALL_PERMISSIONS.map((p) => PERMISSIONS[p].group)),
  ] as PermissionGroup[];
  const allUp = health.status === "OPERATIONAL";
  const uptimeText = uptime.ratio === null ? "—" : `${(uptime.ratio * 100).toFixed(2)}%`;

  return (
    <>
      <PageHeader
        title="Admin & Access Control"
        description="Manage users, roles, permissions, system access and integrations. Every change is audited."
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="p-5" id="users">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold">Users</h2>
              <Badge tone="info" className="px-3">
                {totalUsers} Users
              </Badge>
              <form
                action="/admin"
                role="search"
                className="ml-auto flex items-center gap-2 tile rounded-pill px-3"
              >
                <Search className="size-4 text-muted-foreground" aria-hidden />
                <label htmlFor="user-search" className="sr-only">
                  Search users by name or email
                </label>
                <input
                  id="user-search"
                  name="q"
                  defaultValue={q}
                  placeholder="Search users by name or email…"
                  className="h-9 w-56 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
                />
              </form>
            </div>
            {canManage && (
              <details className="mb-4 tile p-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="inline-flex cursor-pointer items-center gap-2 rounded-control fill-primary px-4 py-2 text-sm font-semibold">
                  Add User
                </summary>
                <p className="mt-3 mb-3 text-xs text-muted-foreground">
                  Accounts are invite-only. Only an executive can invite or promote an executive.
                </p>
                <InviteForm roles={invitableRoles} roleLabels={ROLE_LABELS} />
              </details>
            )}
            <UsersTable rows={rows} roleLabels={ROLE_LABELS} />
          </Card>

          <Card className="p-5" id="matrix">
            <h2 className="text-xl font-semibold">Permission Matrix</h2>
            <p className="text-xs text-muted-foreground">
              What each role can access and do. Defined in code (src/server/authz/permissions.ts)
              and enforced on the server for every request.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm" data-testid="permission-matrix">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      Permission
                    </th>
                    {ROLE_ORDER.map((r) => (
                      <th key={r} className="px-2 py-2 text-center">
                        <span className="inline-block rounded-pill fill-primary px-3 py-1 text-xs font-semibold whitespace-nowrap">
                          {ROLE_LABELS[r]}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.flatMap((group) => [
                    <tr key={group}>
                      <td
                        colSpan={ROLE_ORDER.length + 1}
                        className="px-3 pt-4 pb-1 text-xs font-semibold tracking-wide text-cyan uppercase"
                      >
                        {group}
                      </td>
                    </tr>,
                    ...ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].group === group).map((p) => (
                      <tr
                        key={p}
                        className="border-b border-border last:border-0 hover:bg-surface-hover"
                      >
                        <td className="px-3 py-2">
                          <p>{PERMISSIONS[p].label}</p>
                          <p className="font-mono text-[11px] text-subtle-foreground">{p}</p>
                        </td>
                        {ROLE_ORDER.map((r) => (
                          <td key={r} className="px-2 py-2 text-center">
                            <SwitchIndicator
                              on={can(r, p)}
                              label={`${ROLE_LABELS[r]}, ${PERMISSIONS[p].label}`}
                            />
                          </td>
                        ))}
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card className="p-5" data-testid="system-status">
            <h2 className="text-xl font-semibold">System Status</h2>
            <div className="mt-4 flex items-start gap-3">
              {allUp ? (
                <CircleCheck
                  className="size-12 shrink-0 text-success drop-shadow-[0_0_10px_var(--success)]"
                  aria-hidden
                />
              ) : (
                <ShieldAlert className="size-12 shrink-0 text-warning" aria-hidden />
              )}
              <div>
                <p className="text-lg font-bold">
                  Always On{uptime.ratio !== null ? ` · ${uptimeText} uptime` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {allUp
                    ? "All systems operational."
                    : "Some services are degraded. The portal stays available."}
                </p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-3 divide-x divide-border tile text-xs">
              <div className="p-3">
                <dt className="text-muted-foreground">Uptime (30 days)</dt>
                <dd className="mt-1 text-base font-bold tabular-nums">{uptimeText}</dd>
              </div>
              <div className="p-3">
                <dt className="text-muted-foreground">Avg. response</dt>
                <dd className="mt-1 text-base font-bold tabular-nums">
                  {uptime.avgLatencyMs === null ? "—" : `${uptime.avgLatencyMs} ms`}
                </dd>
              </div>
              <div className="p-3">
                <dt className="text-muted-foreground">System health</dt>
                <dd className="mt-1">
                  <Badge tone={HEALTH_STATUS[health.status].tone}>
                    {HEALTH_STATUS[health.status].label}
                  </Badge>
                </dd>
              </div>
            </dl>
            <ul className="mt-4 flex flex-col gap-1.5 text-sm">
              {health.components.map((c) => (
                <li
                  key={c.component}
                  className="flex items-center justify-between gap-2"
                  title={c.message}
                >
                  <span>{c.label}</span>
                  <span className="flex items-center gap-2">
                    {c.latencyMs !== null && (
                      <span className="text-xs text-subtle-foreground tabular-nums">
                        {c.latencyMs} ms
                      </span>
                    )}
                    <Badge tone={HEALTH_STATUS[c.status].tone}>
                      {HEALTH_STATUS[c.status].label}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <HealthCheckButton />
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">Integrations</h2>
              <Badge tone={liveCount > 0 ? "warning" : "info"}>
                {liveCount > 0 ? `${liveCount} live` : "Mock mode"}
              </Badge>
            </div>
            <ul className="mt-3 flex flex-col divide-y divide-border">
              {integrations.map((i) => {
                const tone = HEALTH_STATUS[i.status];
                const key = i.provider as "GOHIGHLEVEL" | "QUICKBOOKS" | "SLACK";
                const adapterMode = modes[key];
                const missing = adapterMode === "live" ? missingCredentials(key) : [];
                return (
                  <li
                    key={i.id}
                    className="flex items-center gap-3 py-3"
                    title={i.lastError ?? undefined}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-9 shrink-0 rounded-[10px]",
                        INTEGRATION_MARK[i.provider] ?? "bg-primary",
                      )}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="font-semibold">{i.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {missing.length > 0 ? `Live, missing ${missing.join(", ")}` : i.description}
                      </p>
                      <div>
                        {!i.enabled ? (
                          <Badge tone="danger">Off</Badge>
                        ) : (
                          <Badge tone={tone.tone}>
                            {adapterMode === "live" ? "Live" : "Mock"} · {tone.label}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {adapterMode && canManageIntegrations ? (
                      <IntegrationToggle provider={key} name={i.name} enabled={i.enabled} />
                    ) : (
                      <ChevronRight className="size-4 text-subtle-foreground" aria-hidden />
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Live connections are switched on per integration with an environment flag and
              credentials, after approval. Credentials live in the server environment, never in the
              app. Turning an integration off stops every call to it immediately.
            </p>
          </Card>

          <Card className="p-5">
            <h2 className="text-xl font-semibold">Admin Quick Actions</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="#users"
                className="inline-flex items-center gap-2 tile rounded-pill px-3 py-2 text-sm font-medium hover:border-[var(--border-strong)]"
              >
                <UserCog className="size-4" aria-hidden /> Assign Role
              </a>
              <a
                href="#matrix"
                className="inline-flex items-center gap-2 tile rounded-pill px-3 py-2 text-sm font-medium hover:border-[var(--border-strong)]"
              >
                <SlidersHorizontal className="size-4" aria-hidden /> Permissions
              </a>
              {can(actor.role, "audit_log.view") && (
                <Link
                  href="/admin/audit"
                  className="inline-flex items-center gap-2 tile rounded-pill px-3 py-2 text-sm font-medium hover:border-[var(--border-strong)]"
                >
                  <FileClock className="size-4" aria-hidden /> Audit Log
                </Link>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
