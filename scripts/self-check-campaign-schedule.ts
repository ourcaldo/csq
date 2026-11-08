// Assert-based self-check for the campaign schedule math (feature plan
// 2026-11-01, section 3.8). Run: npx tsx scripts/self-check-campaign-schedule.ts
// Pure functions, fixed clock, fixed timezone (Asia/Jakarta, UTC+7, no DST -
// same math holds for any zone via the Intl-based conversion).
import {
  nextCampaignOccurrence,
  nextIntervalOccurrence,
} from "../apps/dashboard/src/lib/campaign-schedule";

const TZ = "Asia/Jakarta";

function iso(d: Date | null): string {
  if (!d) return "null";
  return d.toISOString().slice(0, 16);
}

// Wednesday, 2026-11-04 08:30 UTC = 15:30 WIB.
const AFTER = new Date("2026-11-04T08:30:00Z");

const checks: Array<[string, boolean]> = [
  [
    "ONCE returns its fixed instant",
    iso(nextCampaignOccurrence("ONCE", { startAt: "2026-12-25T02:00:00.000Z" }, AFTER, TZ)) ===
      "2026-12-25T02:00",
  ],
  [
    "DAILY at 09:00 fires the next morning (02:00 UTC)",
    iso(nextCampaignOccurrence("DAILY", { time: "09:00" }, AFTER, TZ)) === "2026-11-05T02:00",
  ],
  [
    "DAILY at 14:00 fires tomorrow (already 15:30 WIB today)",
    iso(nextCampaignOccurrence("DAILY", { time: "14:00" }, AFTER, TZ)) === "2026-11-05T07:00",
  ],
  [
    "WEEKLY Monday at 09:00 jumps to the next Monday (Nov 9)",
    iso(nextCampaignOccurrence("WEEKLY", { time: "09:00", dayOfWeek: 1 }, AFTER, TZ)) ===
      "2026-11-09T02:00",
  ],
  [
    "WEEKLY Thursday at 09:00 fires tomorrow (Nov 5 is a Thursday)",
    iso(nextCampaignOccurrence("WEEKLY", { time: "09:00", dayOfWeek: 4 }, AFTER, TZ)) ===
      "2026-11-05T02:00",
  ],
  [
    "MONTHLY on the 5th at 09:00 fires tomorrow",
    iso(nextCampaignOccurrence("MONTHLY", { time: "09:00", dayOfMonth: 5 }, AFTER, TZ)) ===
      "2026-11-05T02:00",
  ],
  [
    "MONTHLY on the 31st clamps November to the 30th (from Nov 4)",
    iso(nextCampaignOccurrence("MONTHLY", { time: "09:00", dayOfMonth: 31 }, new Date("2026-11-04T00:00:00Z"), TZ)) ===
      "2026-11-30T02:00",
  ],
  [
    "MONTHLY on the 31st from Feb 10 clamps February to the 28th (2027, not a leap year)",
    iso(nextCampaignOccurrence("MONTHLY", { time: "09:00", dayOfMonth: 31 }, new Date("2027-02-10T00:00:00Z"), TZ)) ===
      "2027-02-28T02:00",
  ],
  [
    "INTERVAL anchors at the next 09:00 like DAILY",
    iso(nextCampaignOccurrence("INTERVAL", { time: "09:00", everyDays: 3 }, AFTER, TZ)) ===
      "2026-11-05T02:00",
  ],
  [
    "INTERVAL recurrence advances by whole days (Nov 5 + 3d = Nov 8)",
    iso(nextIntervalOccurrence(new Date("2026-11-05T02:00:00Z"), 3, TZ)) === "2026-11-08T02:00",
  ],
  [
    "INTERVAL recurrence crosses a month boundary (Nov 29 + 3d = Dec 2)",
    iso(nextIntervalOccurrence(new Date("2026-11-29T02:00:00Z"), 3, TZ)) === "2026-12-02T02:00",
  ],
  [
    "DAILY at 23:59 fires the same day (16:59 UTC)",
    iso(nextCampaignOccurrence("DAILY", { time: "23:59" }, AFTER, TZ)) === "2026-11-04T16:59",
  ],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(ok ? "PASS" : "FAIL", "-", name);
  if (!ok) failed++;
}
if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all campaign-schedule checks passed");
