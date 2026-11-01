import { scheduleConfigSchema, type ScheduleKind } from "@/types/campaign";
import type { z } from "zod";

// Pure schedule math for campaigns (feature plan 2026-11-01, section 3.4).
// Kept free of Prisma and env reads at import time so the assert-based
// self-check can drive it with a fixed clock. Times are wall-clock in the
// platform schedule timezone; the mapping to UTC uses Intl (no date library
// dependency), converging in two iterations — exact for non-DST zones like
// Asia/Jakarta, correct elsewhere in practice.

export type ScheduleConfig = z.infer<typeof scheduleConfigSchema>;

const DEFAULT_TZ = "Asia/Jakarta";

export function scheduleTz(): string {
  return process.env.SCENARIO_SCHEDULE_TZ ?? DEFAULT_TZ;
}

// Offset (ms) such that: wall reading of `at` in `timeZone` (as UTC ms) =
// at.getTime() + offset(at).
function tzOffsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return asUtc - at.getTime();
}

// Wall-clock parts of `at` in `timeZone`. wd follows the JS convention
// (0 = Sunday).
function wallParts(
  at: Date,
  timeZone: string
): { y: number; mo: number; d: number; h: number; mi: number; wd: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = dtf.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[
    get("weekday")
  ];
  return {
    y: Number(get("year")),
    mo: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour")) % 24,
    mi: Number(get("minute")),
    wd: weekday ?? 0,
  };
}

// The UTC instant whose wall reading in `timeZone` equals `wallMsUtc`
// (a wall time expressed as if it were UTC). Iterates twice:
// t = wall - offset(t).
function wallClockToUtc(wallMsUtc: number, timeZone: string): Date {
  let t = wallMsUtc;
  for (let i = 0; i < 2; i++) {
    t = wallMsUtc - tzOffsetMs(new Date(t), timeZone);
  }
  return new Date(t);
}

// The next occurrence of a time (HH:MM) on or after `after`, optionally
// restricted to a weekday. Walks wall-clock days, so DST or month boundaries
// are handled by the wall→UTC conversion, not by arithmetic on UTC.
function nextWallTime(
  after: Date,
  time: string,
  timeZone: string,
  matchWeekday?: number
): Date {
  const [hh, mm] = time.split(":").map(Number);
  const wp = wallParts(after, timeZone);
  let dayMs = Date.UTC(wp.y, wp.mo - 1, wp.d);
  // 400 days of headroom covers any weekday/month search.
  for (let i = 0; i < 400; i++) {
    const day = new Date(dayMs);
    const weekdayOk = matchWeekday === undefined || day.getUTCDay() === matchWeekday;
    if (weekdayOk) {
      const candidate = wallClockToUtc(dayMs + (hh * 60 + mm) * 60_000, timeZone);
      if (candidate.getTime() > after.getTime()) return candidate;
    }
    dayMs += 86_400_000;
  }
  // Unreachable for valid inputs; keeps the return type total.
  return new Date(after.getTime() + 86_400_000_000);
}

function daysInWallMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

// Next occurrence of a day-of-month (clamped to the month length, so "31"
// fires on Feb 28/29) at `time`, strictly after `after`.
function nextWallMonthly(
  after: Date,
  dayOfMonth: number,
  time: string,
  timeZone: string
): Date {
  const [hh, mm] = time.split(":").map(Number);
  const wp = wallParts(after, timeZone);
  let y = wp.y;
  let mo = wp.mo;
  for (let i = 0; i < 24; i++) {
    const dom = Math.min(dayOfMonth, daysInWallMonth(y, mo));
    const candidate = wallClockToUtc(Date.UTC(y, mo - 1, dom, hh, mm), timeZone);
    if (candidate.getTime() > after.getTime()) return candidate;
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return new Date(after.getTime() + 2_592_000_000);
}

// The next fire time for a schedule, strictly after `after` (usually the
// fire instant or activation time). ONCE returns its fixed instant (may be in
// the past if the campaign was activated late — the caller checks).
export function nextCampaignOccurrence(
  kind: ScheduleKind,
  config: ScheduleConfig,
  after: Date,
  timeZone: string = scheduleTz()
): Date | null {
  switch (kind) {
    case "ONCE":
      return config.startAt ? new Date(config.startAt) : null;
    case "DAILY":
      return config.time ? nextWallTime(after, config.time, timeZone) : null;
    case "WEEKLY":
      return config.time !== undefined && config.dayOfWeek !== undefined
        ? nextWallTime(after, config.time, timeZone, config.dayOfWeek)
        : null;
    case "MONTHLY":
      return config.time !== undefined && config.dayOfMonth !== undefined
        ? nextWallMonthly(after, config.dayOfMonth, config.time, timeZone)
        : null;
    case "INTERVAL": {
      // First fire (no lastRunAt yet) = next occurrence of `time`; later
      // fires are advanced by the engine as lastRunAt + everyDays, so this
      // branch only computes the anchor.
      if (config.time === undefined || config.everyDays === undefined) return null;
      return nextWallTime(after, config.time, timeZone);
    }
  }
}

// INTERVAL recurrence between fires: lastRunAt + everyDays days, keeping the
// fire's wall-clock time-of-day in the schedule zone (which is exactly what
// adding whole days does — wall time shifts only on DST, which WIB has none).
export function nextIntervalOccurrence(
  lastRunAt: Date,
  everyDays: number,
  timeZone: string = scheduleTz()
): Date {
  const wp = wallParts(lastRunAt, timeZone);
  const dayMs = Date.UTC(wp.y, wp.mo - 1, wp.d) + everyDays * 86_400_000;
  return wallClockToUtc(dayMs + (wp.h * 60 + wp.mi) * 60_000, timeZone);
}
