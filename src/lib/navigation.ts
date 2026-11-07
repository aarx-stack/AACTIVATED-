import {
  BookOpen,
  BrainCircuit,
  CalendarDays,
  ClipboardCheck,
  LayoutDashboard,
  MessageSquareCode,
  Network,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  Waypoints,
  BadgeDollarSign,
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

/** One flat list, as in the Obsidian Glass concepts. Filtered per role on the server. */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/command-center",
    label: "Brain Command Center",
    icon: LayoutDashboard,
    permissions: ["command_center.view"],
  },
  {
    href: "/my-team",
    label: "My AI Team",
    icon: Users,
    permissions: ["rep_pod.full", "rep_pod.coach"],
  },
  { href: "/team", label: "Company Team", icon: Network, permissions: ["company_team.view"] },
  { href: "/agents", label: "AI Agents", icon: BrainCircuit, permissions: ["agent.view"] },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck, permissions: ["approvals.view"] },
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
  {
    href: "/finance",
    label: "Finance & Budget",
    icon: BadgeDollarSign,
    permissions: ["finance.view"],
  },
  {
    href: "/knowledge",
    label: "Knowledge Library",
    icon: BookOpen,
    permissions: ["knowledge.view"],
  },
  {
    href: "/prompts",
    label: "Prompt Generator",
    icon: MessageSquareCode,
    permissions: ["prompts.use"],
  },
  { href: "/roadmap", label: "Development Map", icon: Waypoints, permissions: ["roadmap.view"] },
  {
    href: "/admin",
    label: "Admin & Access Control",
    icon: ShieldCheck,
    permissions: ["admin.view"],
  },
  { href: "/settings", label: "Settings", icon: Settings2, permissions: ["account.manage_own"] },
];

/** Kept for callers that iterate groups; a single group now. */
export const NAV_GROUPS = [{ label: "Main", items: NAV_ITEMS }];

export const BRAIN_ICON = Sparkles;
