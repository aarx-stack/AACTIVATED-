"use client";

import { UserPlus } from "lucide-react";
import { useActionState, useState } from "react";
import { inviteUserAction, type ActionResult } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Role } from "@/generated/prisma/enums";

export function InviteForm({
  roles,
  roleLabels,
}: {
  roles: Role[];
  roleLabels: Record<Role, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    inviteUserAction,
    null,
  );
  const [role, setRole] = useState<Role>(roles.includes("FREE_REP") ? "FREE_REP" : roles[0]!);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_12rem_auto] sm:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor="invite-name">Name</Label>
        <Input id="invite-name" name="name" required minLength={2} autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="invite-email">Email</Label>
        <Input id="invite-email" name="email" type="email" required autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label id="invite-role-label">Role</Label>
        <input type="hidden" name="role" value={role} />
        <Select value={role} onValueChange={(v) => setRole(v as Role)}>
          <SelectTrigger aria-labelledby="invite-role-label" className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r} value={r}>
                {roleLabels[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={pending}>
        <UserPlus aria-hidden /> Invite
      </Button>
      <div aria-live="polite" className="text-sm sm:col-span-4">
        {state && !state.ok && <p className="text-danger">{state.error}</p>}
        {state?.ok && <p className="text-success">{state.message}</p>}
      </div>
    </form>
  );
}
