/**
 * Time policy (see docs/TIME_AND_BOUNDARIES.md):
 *  - Every stored instant is UTC (ISO 8601). The server is the only clock that
 *    matters for qualification; client clocks are display-only.
 *  - Reporting/display periods use America/Los_Angeles wall-clock boundaries.
 *  - Challenge windows are exact durations (windowDays × 24h), half-open
 *    [start, end): a transaction at `start` counts, one at `end` does not.
 */

import type { PeriodType } from "./types";

export const REPORTING_TZ = "America/Los_Angeles";
export const DAY_MS = 86_400_000;

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 1=Mon .. 7=Sun
}

const WEEKDAYS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORTING_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

/** LA wall-clock fields for a UTC instant. */
export function laWallClock(ms: number): WallClock {
  const parts = partsFmt.formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

function asUtcMs(w: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour ?? 0, w.minute ?? 0, w.second ?? 0);
}

/**
 * UTC instant whose LA wall clock reads the given fields. Two correction
 * passes converge across DST offset changes; a nonexistent wall time (the
 * spring-forward gap) resolves to the instant the clock actually reached.
 */
export function utcForLaWallClock(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const w = laWallClock(guess);
    const diff = asUtcMs(w) - target;
    if (diff === 0) return guess;
    guess -= diff;
  }
  return guess;
}

export interface PeriodRange {
  type: PeriodType;
  /** UTC ms, inclusive. 0 for all-time. */
  startMs: number;
  /** UTC ms, exclusive. Null for all-time (open-ended). */
  endMs: number | null;
  /** Stable key used to pair live rankings with stored snapshots. */
  key: string;
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** Calendar month in LA: [1st 00:00 LA, 1st of next month 00:00 LA). */
export function monthRange(nowMs: number): PeriodRange {
  const w = laWallClock(nowMs);
  const startMs = utcForLaWallClock(w.year, w.month, 1);
  const ny = w.month === 12 ? w.year + 1 : w.year;
  const nm = w.month === 12 ? 1 : w.month + 1;
  return {
    type: "monthly",
    startMs,
    endMs: utcForLaWallClock(ny, nm, 1),
    key: `${w.year}-${p2(w.month)}`,
  };
}

/** Calendar week in LA starting Monday 00:00; keyed by that Monday's LA date. */
export function weekRange(nowMs: number): PeriodRange {
  const w = laWallClock(nowMs);
  // Calendar-date arithmetic in the proleptic calendar (no timezone), then
  // resolve each boundary date back to its LA-midnight instant — DST days
  // (23h/25h) therefore cannot drift the boundary.
  const monday = new Date(Date.UTC(w.year, w.month - 1, w.day - (w.weekday - 1)));
  const my = monday.getUTCFullYear();
  const mm = monday.getUTCMonth() + 1;
  const md = monday.getUTCDate();
  const next = new Date(Date.UTC(my, mm - 1, md + 7));
  return {
    type: "weekly",
    startMs: utcForLaWallClock(my, mm, md),
    endMs: utcForLaWallClock(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
    key: `wk-${my}-${p2(mm)}-${p2(md)}`,
  };
}

export function periodRange(type: PeriodType, nowMs: number): PeriodRange {
  if (type === "monthly") return monthRange(nowMs);
  if (type === "weekly") return weekRange(nowMs);
  return { type: "alltime", startMs: 0, endMs: null, key: "all" };
}

export function inRange(ms: number, range: { startMs: number; endMs: number | null }): boolean {
  return ms >= range.startMs && (range.endMs === null || ms < range.endMs);
}

/* ————— display formatting (LA) ————— */

const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORTING_TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORTING_TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORTING_TZ,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

export const fmtLaDateTime = (ms: number) => dateTimeFmt.format(ms);
export const fmtLaDate = (ms: number) => dateFmt.format(ms);
export const fmtLaTime = (ms: number) => timeFmt.format(ms);

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
}

export function countdownTo(endMs: number, nowMs: number): CountdownParts {
  const totalMs = Math.max(0, endMs - nowMs);
  const s = Math.floor(totalMs / 1000);
  return {
    days: Math.floor(s / 86_400),
    hours: Math.floor((s % 86_400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    totalMs,
  };
}
