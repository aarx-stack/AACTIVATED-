import {
  Briefcase,
  Database,
  Globe,
  Mail,
  Megaphone,
  MessageCircle,
  Rocket,
  Scale,
  SlidersHorizontal,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ApprovalType } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

const ICONS: Record<ApprovalType, LucideIcon> = {
  SOCIAL_POST: Megaphone,
  EMAIL: Mail,
  DIRECT_MESSAGE: MessageCircle,
  SPEND: Database,
  PAYMENT: Wallet,
  SITE_CHANGE: Globe,
  LEGAL: Scale,
  OUTSIDE_WORK: Briefcase,
  PROJECT_LAUNCH: Rocket,
  BUDGET_CHANGE: SlidersHorizontal,
};

/** Glowing square icon used on approval cards, like the concept's type tiles. */
export function ApprovalTypeIcon({ type, className }: { type: ApprovalType; className?: string }) {
  const Icon = ICONS[type];
  return (
    <span
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-control border border-[var(--border-strong)] bg-info-soft text-foreground shadow-glow-soft",
        className,
      )}
    >
      <Icon className="size-5" aria-hidden />
    </span>
  );
}
