import { Check, Minus } from "lucide-react";
import type { Metadata } from "next";
import { HealthCheckButton } from "@/components/admin/health-check-button";
import { InviteForm } from "@/components/admin/invite-form";
import { UsersTable, type AdminUserRow } from "@/components/admin/users-table";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Role } from "@/generated/prisma/enums";
import { HEALTH_STATUS } from "@/lib/status";
import { formatRelativeTime } from "@/lib/utils";
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
import { getAdminData } from "@/server/queries/admin";

export const metadata: Metadata = { title: "Admin & Access Control" };

export default async function AdminPage() {
  const actor = await requirePagePermission("admin.view");
  const [{ users, integrations, audit }, health] = await Promise.all([
    getAdminData(),
    getSystemHealth(),
  ]);
  const canManage = can(actor.role, "users.manage");
  const canSeeAudit = can(actor.role, "audit_log.view");

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
  const healthTone = HEALTH_STATUS[health.status];

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Admin & Access Control"
        description="Users and roles, the permission matrix, integrations and system status. Every change is audited."
        actions={
          <Badge tone={healthTone.tone}>
            <StatusDot tone={healthTone.tone} live={health.status === "OPERATIONAL"} /> System{" "}
            {healthTone.label.toLowerCase()}
          </Badge>
        }
      />

      <Tabs defaultValue="users">
        <TabsList aria-label="Admin sections">
          <TabsTrigger value="users">Users & roles</TabsTrigger>
          <TabsTrigger value="matrix">Permission matrix</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="status">System status</TabsTrigger>
          {canSeeAudit && <TabsTrigger value="audit">Audit log</TabsTrigger>}
        </TabsList>

        <TabsContent value="users" className="flex flex-col gap-4">
          {canManage && (
            <Card>
              <CardHeader className="flex-col items-stretch">
                <CardTitle>Invite a user</CardTitle>
                <CardDescription>
                  Accounts are invite-only. Only an executive can invite or promote an executive.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <InviteForm roles={invitableRoles} roleLabels={ROLE_LABELS} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Users</CardTitle>
              <CardDescription>
                {users.length} accounts. Nobody can change their own role.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UsersTable rows={rows} roleLabels={ROLE_LABELS} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="matrix">
          <Card>
            <CardHeader className="flex-col items-stretch">
              <CardTitle>Permission matrix</CardTitle>
              <CardDescription>
                Generated from the same code the server enforces (src/server/authz/permissions.ts).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table data-testid="permission-matrix">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-56">Permission</TableHead>
                    {ROLE_ORDER.map((r) => (
                      <TableHead key={r} className="text-center">
                        {ROLE_LABELS[r]}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.flatMap((group) => [
                    <TableRow key={group} className="hover:bg-transparent">
                      <TableCell
                        colSpan={ROLE_ORDER.length + 1}
                        className="pt-5 pb-2 text-xs font-semibold tracking-wide text-primary uppercase"
                      >
                        {group}
                      </TableCell>
                    </TableRow>,
                    ...ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].group === group).map((p) => (
                      <TableRow key={p}>
                        <TableCell>
                          <p className="text-sm">{PERMISSIONS[p].label}</p>
                          <p className="font-mono text-xs text-subtle-foreground">{p}</p>
                        </TableCell>
                        {ROLE_ORDER.map((r) => (
                          <TableCell key={r} className="text-center">
                            {can(r, p) ? (
                              <Check className="mx-auto size-4 text-success" aria-label="Allowed" />
                            ) : (
                              <Minus
                                className="mx-auto size-4 text-subtle-foreground"
                                aria-label="Not allowed"
                              />
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    )),
                  ])}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <div className="grid gap-4 md:grid-cols-2">
            {integrations.map((i) => {
              const tone = HEALTH_STATUS[i.status];
              return (
                <Card key={i.id} className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{i.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{i.description}</p>
                    </div>
                    <Badge tone={tone.tone}>
                      <StatusDot tone={tone.tone} /> {tone.label}
                    </Badge>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Mode</dt>
                      <dd>
                        <Badge tone={i.mode === "MOCK" ? "neutral" : "info"}>
                          {i.mode === "MOCK" ? "Mock" : "Live"}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Last checked</dt>
                      <dd>{i.lastCheckedAt ? formatRelativeTime(i.lastCheckedAt) : "Never"}</dd>
                    </div>
                  </dl>
                  {i.lastError && <p className="mt-3 text-xs text-danger">{i.lastError}</p>}
                  <p className="mt-3 text-xs text-subtle-foreground">
                    Live mode is switched by environment flag and requires executive approval (Phase
                    5). No real credentials are stored in the app.
                  </p>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="status">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>System status</CardTitle>
                <CardDescription className="mt-1">
                  Checked {formatRelativeTime(new Date(health.checkedAt))}. Integrations degrade the
                  system; they never take it down.
                </CardDescription>
              </div>
              <HealthCheckButton />
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {health.components.map((c) => {
                  const tone = HEALTH_STATUS[c.status];
                  return (
                    <li
                      key={c.component}
                      className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{c.label}</p>
                        <p className="text-xs text-muted-foreground">{c.message}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {c.latencyMs !== null && (
                          <span className="text-xs text-subtle-foreground tabular-nums">
                            {c.latencyMs} ms
                          </span>
                        )}
                        <Badge tone={tone.tone}>
                          <StatusDot tone={tone.tone} /> {tone.label}
                        </Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {canSeeAudit && (
          <TabsContent value="audit">
            <Card>
              <CardHeader className="flex-col items-stretch">
                <CardTitle>Audit log</CardTitle>
                <CardDescription>
                  Append-only. The database rejects any edit or deletion of these records.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="hidden md:table-cell">Record</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                          <time dateTime={a.createdAt.toISOString()}>
                            {formatRelativeTime(a.createdAt)}
                          </time>
                        </TableCell>
                        <TableCell className="text-sm">
                          {a.actorType === "USER"
                            ? (a.actorUser?.name ?? a.actorUser?.email)
                            : a.actorType === "AGENT"
                              ? "Agent"
                              : "System"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{a.action}</TableCell>
                        <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                          {a.entityType}
                          {a.before !== null && a.after !== null && (
                            <span className="ml-2 font-mono">
                              {JSON.stringify(a.before)} → {JSON.stringify(a.after)}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
