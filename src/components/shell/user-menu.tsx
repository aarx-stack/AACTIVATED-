"use client";

import { LogOut, Settings2 } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/app/(app)/actions";

export interface ShellUser {
  name: string | null;
  email: string;
  roleLabel: string;
}

export function UserMenu({ user }: { user: ShellUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="ml-1 flex items-center gap-2 rounded-pill p-1 pr-2 hover:bg-surface-hover"
        aria-label={`Account menu for ${user.name ?? user.email}`}
        data-testid="user-menu"
      >
        <Avatar name={user.name ?? user.email} />
        <span className="hidden text-left sm:block">
          <span className="block text-sm leading-tight font-medium">{user.name ?? user.email}</span>
          <span className="block text-xs leading-tight text-muted-foreground">
            {user.roleLabel}
          </span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings2 aria-hidden /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOutAction()} data-testid="sign-out">
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
