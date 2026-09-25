// Posting times. The AI suggests a day (1 = tomorrow) and a clock time in the shoppers' own time;
// this turns that into a moment, using the main time zone of the country the shop sells to.
// No project imports, so the offline check can load it directly.

const ZONES: Record<string, { tz: string; label: string }> = {
  US: { tz: "America/New_York", label: "US Eastern time" },
  GB: { tz: "Europe/London", label: "UK time" },
  CA: { tz: "America/Toronto", label: "Eastern time" },
  AU: { tz: "Australia/Sydney", label: "Sydney time" },
  NZ: { tz: "Pacific/Auckland", label: "New Zealand time" },
  DE: { tz: "Europe/Berlin", label: "German time" },
  FR: { tz: "Europe/Paris", label: "French time" },
  ES: { tz: "Europe/Madrid", label: "Spanish time" },
  IT: { tz: "Europe/Rome", label: "Italian time" },
  NL: { tz: "Europe/Amsterdam", label: "Dutch time" },
  IE: { tz: "Europe/Dublin", label: "Irish time" },
  SE: { tz: "Europe/Stockholm", label: "Swedish time" },
  DK: { tz: "Europe/Copenhagen", label: "Danish time" },
  NO: { tz: "Europe/Oslo", label: "Norwegian time" },
  FI: { tz: "Europe/Helsinki", label: "Finnish time" },
  BE: { tz: "Europe/Brussels", label: "Belgian time" },
  AT: { tz: "Europe/Vienna", label: "Austrian time" },
  CH: { tz: "Europe/Zurich", label: "Swiss time" },
  PT: { tz: "Europe/Lisbon", label: "Portuguese time" },
  PL: { tz: "Europe/Warsaw", label: "Polish time" },
  MX: { tz: "America/Mexico_City", label: "Mexico City time" },
  JP: { tz: "Asia/Tokyo", label: "Japan time" },
  SG: { tz: "Asia/Singapore", label: "Singapore time" },
  AE: { tz: "Asia/Dubai", label: "UAE time" },
};

/** The time zone posts are planned in for a country code; the US East coast when unknown. */
export function zoneFor(countryCode: string | null | undefined): { tz: string; label: string } {
  return ZONES[(countryCode ?? "").toUpperCase()] ?? ZONES.US;
}

/** Minutes the zone is ahead of UTC at this moment. */
export function offsetMinutes(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** The moment a wall-clock time happens in a zone (the later reading when clocks go back). */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetMinutes(guess, tz);
  let t = guess - first * 60000;
  const second = offsetMinutes(t, tz);
  if (second !== first) t = guess - second * 60000;
  return new Date(t);
}

/** Today's calendar date in a zone. */
export function zonedDate(now: Date, tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Day 1 is tomorrow in the shoppers' zone; the clock time is theirs too. */
export function suggestedMoment(now: Date, dayOffset: number, hour: number, minute: number, tz: string): Date {
  const today = zonedDate(now, tz);
  // Calendar arithmetic on a UTC noon never slips a day.
  const base = new Date(Date.UTC(today.year, today.month - 1, today.day, 12));
  base.setUTCDate(base.getUTCDate() + Math.min(7, Math.max(1, Math.round(dayOffset))));
  return zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, minute, tz);
}

/** Which of the next seven days (1..7) already have a post at these moments, in the zone. */
export function takenDays(now: Date, moments: Date[], tz: string): number[] {
  const today = zonedDate(now, tz);
  const t0 = Date.UTC(today.year, today.month - 1, today.day);
  const out = new Set<number>();
  for (const m of moments) {
    const d = zonedDate(m, tz);
    const diff = Math.round((Date.UTC(d.year, d.month - 1, d.day) - t0) / 86_400_000);
    if (diff >= 1 && diff <= 7) out.add(diff);
  }
  return [...out].sort((a, b) => a - b);
}
