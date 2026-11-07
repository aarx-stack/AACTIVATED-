import {
  BookOpen,
  BrainCircuit,
  Building2,
  CalendarDays,
  ClipboardCheck,
  LayoutDashboard,
  Map,
  MessageSquareCode,
  Settings2,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/server/authz/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Any one of these grants access. */
  permissions: Permission[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Brain",
    items: [
      {
        href: "/command-center",
        label: "Command Center",
        icon: LayoutDashboard,
        permissions: ["command_center.view"],
      },
      { href: "/team", label: "Company Team", icon: Building2, permissions: ["company_team.view"] },
      {
        href: "/agents",
        label: "Agent Workspace",
        icon: BrainCircuit,
        permissions: ["agent.view"],
      },
      {
        href: "/approvals",
        label: "Approvals",
        icon: ClipboardCheck,
        permissions: ["approvals.view"],
      },
      {
        href: "/prompts",
        label: "Prompt Generator",
        icon: MessageSquareCode,
        permissions: ["prompts.use"],
      },
    ],
  },
  {
    label: "Reps",
    items: [
      {
        href: "/my-team",
        label: "My AI Team",
        icon: Users,
        permissions: ["rep_pod.full", "rep_pod.coach"],
      },
      {
        href: "/content",
        label: "Content Studio",
        icon: CalendarDays,
        permissions: ["content_studio.view"],
      },
      {
        href: "/back-office",
        label: "Back Office",
        icon: Wallet,
        permissions: ["back_office.view_own"],
      },
    ],
  },
  {
    label: "Company",
    items: [
      { href: "/finance", label: "Finance & Budget", icon: Wallet, permissions: ["finance.view"] },
      {
        href: "/knowledge",
        label: "Knowledge Library",
        icon: BookOpen,
        permissions: ["knowledge.view"],
      },
      { href: "/roadmap", label: "Development Map", icon: Map, permissions: ["roadmap.view"] },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin", label: "Admin & Access", icon: ShieldCheck, permissions: ["admin.view"] },
      {
        href: "/settings",
        label: "Settings",
        icon: Settings2,
        permissions: ["account.manage_own"],
      },
    ],
  },
];
