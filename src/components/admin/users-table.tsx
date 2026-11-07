"use client";

import { useState, useTransition } from "react";
import { changeRoleAction, setStatusAction, type ActionResult } from "@/app/(app)/admin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Role, UserStatus } from "@/generated/prisma/enums";

export interface AdminUserRow {
  id: string;
  name: string | null;
  email: string;
  title: string | null;
  role: Role;
  status: UserStatus;
  lastActive: string;
  /** Roles this actor may assign to this user (computed by the server policy). */
  assignableRoles: Role[];
  canToggleStatus: boolean;
  isSelf: boolean;
}

const STATUS_TONE = { ACTIVE: "success", INVITED: "info", SUSPENDED: "danger" } as const;

export function UsersTable({
  rows,
  roleLabels,
}: {
  rows: AdminUserRow[];
  roleLabels: Record<Role, string>;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => setResult(await fn()));

  return (
    <div>
      <div aria-live="polite" className="min-h-6 px-1 pb-2 text-sm">
        {result && !result.ok && <p className="text-danger">{result.error}</p>}
        {result?.ok && <p className="text-success">{result.message}</p>}
      </div>
      <Table aria-busy={pending}>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Last active</TableHead>
            <TableHead className="text-right">Access</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((u) => (
            <TableRow key={u.id} data-testid={`user-row-${u.email}`}>
              <TableCell>
                <p className="font-medium">
                  {u.name}{" "}
                  {u.isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                </p>
                <p className="text-xs text-muted-foreground">{u.title ?? u.email}</p>
              </TableCell>
              <TableCell className="min-w-44">
                <Select
                  value={u.role}
                  disabled={pending || u.assignableRoles.length === 0}
                  onValueChange={(role) => run(() => changeRoleAction(u.id, role as Role))}
                >
                  <SelectTrigger aria-label={`Role for ${u.name ?? u.email}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={u.role}>{roleLabels[u.role]}</SelectItem>
                    {u.assignableRoles.map((r) => (
                      <SelectItem key={r} value={r}>
                        {roleLabels[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Badge tone={STATUS_TONE[u.status]}>
                  {u.status.charAt(0) + u.status.slice(1).toLowerCase()}
                </Badge>
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                {u.lastActive}
              </TableCell>
              <TableCell className="text-right">
                {u.canToggleStatus && (
                  <Button
                    size="sm"
                    variant={u.status === "SUSPENDED" ? "secondary" : "ghost"}
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        setStatusAction(u.id, u.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED"),
                      )
                    }
                  >
                    {u.status === "SUSPENDED" ? "Reactivate" : "Suspend"}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
