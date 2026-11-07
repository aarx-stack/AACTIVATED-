import type { Metadata } from "next";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/session";
import { PERMISSIONS, permissionsFor, ROLE_LABELS } from "@/server/authz/permissions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requirePagePermission("account.manage_own");
  const granted = permissionsFor(user.role);

  return (
    <>
      <PageHeader title="Settings" description="Your profile, appearance and access." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-col items-stretch">
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{user.name}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="break-all">{user.email}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd>
                <Badge tone="info">{ROLE_LABELS[user.role]}</Badge>
              </dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Appearance</CardTitle>
              <CardDescription className="mt-1">
                Dark or light theme. Saved to your account.
              </CardDescription>
            </div>
            <ThemeToggle />
          </CardHeader>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex-col items-stretch">
            <CardTitle>What your role can do</CardTitle>
            <CardDescription>Enforced on the server for every request.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {granted.map((p) => (
                <li key={p}>
                  <Badge tone="outline">{PERMISSIONS[p].label}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
