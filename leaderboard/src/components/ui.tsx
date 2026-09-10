import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import type { ChallengeState, Movement } from "@shared/types";
import { fmtUsd } from "@shared/money";
import { usePrefersReducedMotion, useReveal } from "@/data/useStore";
import { subscribeToasts, type ToastMsg } from "@/lib/toast";
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconChevronL,
  IconChevronR,
  IconClock,
  IconLock,
  IconMinus,
  IconSparkle,
  IconTrophy,
  IconUsers,
  IconWarning,
  IconX,
} from "./icons";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ————— structure ————— */

export function Section(props: {
  id?: string;
  kicker: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const ref = useReveal<HTMLElement>();
  return (
    <section id={props.id} ref={ref} className="reveal scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <div className="kicker">{props.kicker}</div>
          <h2 className="font-display mt-1 text-xl font-semibold tracking-tight text-mist-50 sm:text-2xl">
            {props.title}
          </h2>
        </div>
        {props.aside ? <div className="flex items-center gap-3">{props.aside}</div> : null}
      </div>
      {props.children}
    </section>
  );
}

/* ————— chips & badges ————— */

type Tone = "neutral" | "accent" | "ok" | "warn" | "err" | "gold" | "cyan";

const chipTones: Record<Tone, string> = {
  neutral: "border-white/10 bg-white/[0.04] text-mist-300",
  accent: "border-accent-500/35 bg-accent-500/12 text-accent-200",
  ok: "border-pos-500/35 bg-pos-500/12 text-pos-400",
  warn: "border-warn-500/40 bg-warn-500/12 text-warn-400",
  err: "border-neg-500/40 bg-neg-500/12 text-neg-400",
  gold: "border-gold-400/40 bg-gold-500/12 text-gold-300",
  cyan: "border-glow-500/35 bg-glow-500/10 text-glow-400",
};

export function Chip(props: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={props.title}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold leading-none",
        chipTones[props.tone ?? "neutral"],
        props.className,
      )}
    >
      {props.children}
    </span>
  );
}

export const CHALLENGE_STATE_META: Record<
  ChallengeState,
  { label: string; tone: Tone; icon: ReactNode }
> = {
  not_started: { label: "Not started", tone: "neutral", icon: <IconClock size={13} /> },
  in_progress: { label: "In progress", tone: "accent", icon: <IconSparkle size={13} /> },
  pending_verification: { label: "Pending verification", tone: "warn", icon: <IconClock size={13} /> },
  qualified: { label: "Qualified", tone: "gold", icon: <IconTrophy size={13} /> },
  window_ended: { label: "Window ended", tone: "neutral", icon: <IconLock size={13} /> },
  capacity_reached: { label: "Capacity reached", tone: "err", icon: <IconUsers size={13} /> },
  membership_expired: { label: "Membership expired", tone: "neutral", icon: <IconClock size={13} /> },
};

export function StateChip({ state, className }: { state: ChallengeState; className?: string }) {
  const m = CHALLENGE_STATE_META[state];
  return (
    <Chip tone={m.tone} className={className}>
      {m.icon}
      {m.label}
    </Chip>
  );
}

export function MovementCell({ movement }: { movement: Movement | null }) {
  if (movement === null) {
    return (
      <span className="inline-flex items-center text-mist-700" title="No comparable snapshot yet">
        <IconMinus size={14} />
      </span>
    );
  }
  if (movement === "new") {
    return <Chip tone="cyan">NEW</Chip>;
  }
  if (movement === 0) {
    return (
      <span className="inline-flex items-center text-mist-600" title="Unchanged">
        <IconMinus size={14} />
      </span>
    );
  }
  const up = movement > 0;
  return (
    <span
      className={cx(
        "num inline-flex items-center gap-0.5 text-[13px] font-semibold",
        up ? "text-pos-400" : "text-neg-400",
      )}
      title={up ? `Up ${movement} since last snapshot` : `Down ${-movement} since last snapshot`}
    >
      {up ? <IconArrowUp size={13} /> : <IconArrowDown size={13} />}
      {Math.abs(movement)}
    </span>
  );
}

/* ————— buttons & inputs ————— */

type BtnVariant = "primary" | "ghost" | "soft" | "danger";

const btnStyles: Record<BtnVariant, string> = {
  primary:
    "bg-accent-500 text-white shadow-[0_8px_24px_-10px_rgb(46_107_255/0.8)] hover:bg-accent-400 border border-accent-400/40",
  soft: "bg-accent-500/12 text-accent-200 border border-accent-500/30 hover:bg-accent-500/20",
  ghost: "bg-white/[0.04] text-mist-300 border border-white/10 hover:bg-white/[0.08] hover:text-mist-100",
  danger: "bg-neg-500/12 text-neg-400 border border-neg-500/35 hover:bg-neg-500/20",
};

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; sm?: boolean },
) {
  const { variant = "ghost", sm, className, ...rest } = props;
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        sm ? "px-2.5 py-1.5 text-[12.5px]" : "px-3.5 py-2 text-[13.5px]",
        btnStyles[variant],
        className,
      )}
    />
  );
}

export function TextInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <label className={cx("relative block", props.className)}>
      {props.icon ? (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-600">
          {props.icon}
        </span>
      ) : null}
      <input
        type="text"
        aria-label={props.ariaLabel ?? props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className={cx(
          "w-full rounded-lg border border-white/10 bg-ink-900/70 py-2 text-[14px] text-mist-100 placeholder:text-mist-600 focus:border-accent-500/50 focus:outline-none",
          props.icon ? "pl-9 pr-3" : "px-3",
        )}
      />
    </label>
  );
}

export function Select<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <select
      aria-label={props.ariaLabel}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as T)}
      className={cx(
        "cursor-pointer rounded-lg border border-white/10 bg-ink-900/70 px-2.5 py-2 text-[13px] font-medium text-mist-200 focus:border-accent-500/50 focus:outline-none",
        props.className,
      )}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value} className="bg-ink-850">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={props.ariaLabel}
      className={cx(
        "inline-flex rounded-xl border border-white/10 bg-ink-900/80 p-1",
        props.className,
      )}
    >
      {props.options.map((o) => {
        const active = o.value === props.value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => props.onChange(o.value)}
            className={cx(
              "cursor-pointer rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
              active
                ? "bg-accent-500/18 text-accent-200 shadow-[inset_0_0_0_1px_rgb(46_107_255/0.35)]"
                : "text-mist-500 hover:text-mist-200",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Paginator(props: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
  className?: string;
}) {
  if (props.pageCount <= 1) return null;
  return (
    <div className={cx("flex items-center gap-2", props.className)}>
      <Button
        sm
        aria-label="Previous page"
        disabled={props.page <= 1}
        onClick={() => props.onPage(props.page - 1)}
      >
        <IconChevronL size={15} />
      </Button>
      <span className="num text-[13px] text-mist-500">
        Page <span className="text-mist-200">{props.page}</span> / {props.pageCount}
      </span>
      <Button
        sm
        aria-label="Next page"
        disabled={props.page >= props.pageCount}
        onClick={() => props.onPage(props.page + 1)}
      >
        <IconChevronR size={15} />
      </Button>
    </div>
  );
}

/* ————— identity ————— */

const AVATAR_HUES = [214, 262, 190, 226, 250, 205, 238, 274];

export function Avatar(props: { name: string; size?: number; ring?: "gold" | "silver" | "bronze" | null }) {
  const size = props.size ?? 38;
  const initials = props.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  let hash = 0;
  for (const ch of props.name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length]!;
  const ringColor =
    props.ring === "gold"
      ? "var(--color-gold-400)"
      : props.ring === "silver"
        ? "var(--color-silver-400)"
        : props.ring === "bronze"
          ? "var(--color-bronze-400)"
          : "rgb(151 178 255 / 0.18)";
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 select-none place-items-center rounded-full font-display font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        color: "var(--color-mist-100)",
        background: `linear-gradient(135deg, hsl(${hue} 70% 26%), hsl(${hue + 24} 65% 16%))`,
        boxShadow: `0 0 0 1.5px ${ringColor}`,
      }}
    >
      {initials}
    </span>
  );
}

/* ————— data display ————— */

export function Sparkline(props: { points: number[]; width?: number; height?: number }) {
  const w = props.width ?? 120;
  const h = props.height ?? 34;
  const pts = props.points;
  const max = Math.max(1, ...pts);
  const step = w / Math.max(1, pts.length - 1);
  const y = (v: number) => h - 3 - (v / max) * (h - 6);
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lastX = (pts.length - 1) * step;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="overflow-visible">
      <path d={d} fill="none" stroke="rgb(151 178 255 / 0.35)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={y(pts[pts.length - 1] ?? 0)} r={3.5} fill="var(--color-accent-400)" stroke="var(--color-ink-850)" strokeWidth={2} />
    </svg>
  );
}

/** Meter: fill carries progress; track is a lighter step of the same ramp. */
export function ProgressBar(props: {
  value: number;
  max: number;
  label: string;
  sublabel?: string;
  done?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, props.max === 0 ? 0 : props.value / props.max));
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-mist-300">{props.label}</span>
        <span className="num text-[13px] text-mist-400">
          <span className="font-semibold text-mist-100">{fmtUsd(props.value)}</span>
          {" / "}
          {fmtUsd(props.max)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={props.max}
        aria-valuenow={props.value}
        aria-label={props.label}
        className="h-2.5 overflow-hidden rounded-full bg-accent-500/12"
      >
        <div
          className={cx(
            "bar-fill h-full rounded-full",
            props.done
              ? "bg-gradient-to-r from-pos-500 to-pos-400"
              : "bg-gradient-to-r from-accent-600 via-accent-500 to-glow-500",
          )}
          style={{ width: `${(pct * 100).toFixed(2)}%` }}
        />
      </div>
      {props.sublabel ? <div className="mt-1 text-[12px] text-mist-500">{props.sublabel}</div> : null}
    </div>
  );
}

export function ProgressRing(props: {
  pct: number; // 0..1
  size?: number;
  stroke?: number;
  children?: ReactNode;
  tone?: "accent" | "gold" | "warn";
}) {
  const size = props.size ?? 92;
  const stroke = props.stroke ?? 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, props.pct));
  const reduced = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(reduced);
  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);
  const shown = mounted ? pct : 0;
  const color =
    props.tone === "gold"
      ? "var(--color-gold-400)"
      : props.tone === "warn"
        ? "var(--color-warn-400)"
        : "var(--color-accent-400)";
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(46 107 255 / 0.14)" strokeWidth={stroke} />
        <circle
          className="ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{props.children}</div>
    </div>
  );
}

/* ————— states ————— */

export function SkeletonRow({ w = "100%" }: { w?: string }) {
  return <div className="skeleton h-4" style={{ width: w }} />;
}

export function SkeletonPanel({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx("panel space-y-3 p-5", className)} aria-hidden="true">
      <div className="skeleton h-5 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonRow key={i} w={`${88 - i * 9}%`} />
      ))}
    </div>
  );
}

export function EmptyState(props: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="panel-inset flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="text-mist-600">{props.icon ?? <IconWarning size={22} />}</div>
      <div className="text-[15px] font-semibold text-mist-200">{props.title}</div>
      {props.body ? <p className="m-0 max-w-md text-[13.5px] leading-relaxed text-mist-500">{props.body}</p> : null}
      {props.action}
    </div>
  );
}

export function Banner(props: { tone: "warn" | "err" | "ok"; children: ReactNode; action?: ReactNode }) {
  const tones = {
    warn: "border-warn-500/35 bg-warn-500/10 text-warn-400",
    err: "border-neg-500/35 bg-neg-500/10 text-neg-400",
    ok: "border-pos-500/35 bg-pos-500/10 text-pos-400",
  } as const;
  return (
    <div className={cx("flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3", tones[props.tone])}>
      <div className="flex items-center gap-2.5 text-[13.5px] font-medium">
        <IconWarning size={16} />
        <span className="text-mist-200">{props.children}</span>
      </div>
      {props.action}
    </div>
  );
}

/* ————— modal ————— */

export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);
  if (!props.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink-950/72 p-4 backdrop-blur-[3px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx("panel panel-strong w-full p-5 sm:p-6", props.wide ? "max-w-2xl" : "max-w-md")}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 id={titleId} className="font-display m-0 text-lg font-semibold text-mist-50">
            {props.title}
          </h3>
          <Button sm aria-label="Close dialog" onClick={props.onClose}>
            <IconX size={15} />
          </Button>
        </div>
        <div className="space-y-4">{props.children}</div>
        {props.footer ? <div className="mt-5 flex justify-end gap-2">{props.footer}</div> : null}
      </div>
    </div>
  );
}

/* ————— toasts ————— */

export function Toasts() {
  const [list, setList] = useState<ToastMsg[]>([]);
  useEffect(() => subscribeToasts(setList), []);
  if (!list.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(94vw,420px)] -translate-x-1/2 flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            "panel panel-strong pointer-events-auto flex items-center gap-2.5 px-4 py-3 text-[13.5px] font-medium text-mist-100",
            t.tone === "err" && "border-neg-500/45",
            t.tone === "warn" && "border-warn-500/45",
            t.tone === "ok" && "border-pos-500/40",
          )}
        >
          {t.tone === "ok" ? (
            <IconCheck size={16} className="text-pos-400" />
          ) : (
            <IconWarning size={16} className={t.tone === "err" ? "text-neg-400" : "text-warn-400"} />
          )}
          {t.text}
        </div>
      ))}
    </div>
  );
}
