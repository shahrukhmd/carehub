// Telehealth scheduler: the rules shared by the booking panel (client), the server actions and the admin page.
// Telehealth Initial Wound Care visits are booked as 20-minute blocks inside a doctor's availability window, in the
// window's own time zone; every instant is stored in UTC. (No server imports — the booking panel runs in the browser.)

export const TELEHEALTH_VISIT_TYPE = "TELE_INIT";
export const BLOCK_MIN = 20;
const ALLOWED_START_MINUTES = [0, 20, 40];
const DAY_MS = 86_400_000;
const asDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

export const RESERVATION_STATUSES: Record<string, string> = {
  RESERVED: "Reserved",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  MISSED: "Missed",
};

// The zones a window can be entered in, by IANA id (what is stored) with the short label staff know.
export const TELEHEALTH_ZONES: { iana: string; label: string; name: string }[] = [
  { iana: "America/New_York", label: "EST", name: "Eastern" },
  { iana: "America/Chicago", label: "CST", name: "Central" },
  { iana: "America/Denver", label: "MST", name: "Mountain" },
  { iana: "America/Phoenix", label: "MST (AZ)", name: "Arizona" },
  { iana: "America/Los_Angeles", label: "PST", name: "Pacific" },
  { iana: "America/Anchorage", label: "AKST", name: "Alaska" },
  { iana: "Pacific/Honolulu", label: "HST", name: "Hawaii" },
];

export function zoneLabel(iana: string) {
  return TELEHEALTH_ZONES.find((z) => z.iana === iana)?.label ?? iana;
}

export function isKnownZone(iana: string) {
  return TELEHEALTH_ZONES.some((z) => z.iana === iana);
}

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// Each state's predominant zone: the default when a window is entered for a doctor in that state.
export const STATE_ZONE: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles",
  CO: "America/Denver", CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Denver", IL: "America/Chicago", IN: "America/New_York",
  IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/New_York", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago",
  OH: "America/New_York", OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York", WI: "America/Chicago",
  WY: "America/Denver",
};

export function parseLicenses(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s in STATE_NAMES) : [];
  } catch {
    return [];
  }
}

// ---- Time zone arithmetic (Intl only; works in the browser and in Node) ----

export type ZoneParts = { y: number; m: number; d: number; h: number; min: number; s: number; weekday: number };

const partFormatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = partFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partFormatters.set(tz, f);
  }
  return f;
}
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The wall-clock parts of an instant in a zone.
export function zoneParts(date: Date, tz: string): ZoneParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(date)) parts[p.type] = p.value;
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour) % 24,
    min: Number(parts.minute),
    s: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

// Offset (ms) of a zone at an instant: wall clock as if UTC, minus the real UTC.
function zoneOffsetMs(utcMs: number, tz: string) {
  const p = zoneParts(new Date(utcMs), tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - utcMs;
}

// "2026-10-20" + "09:00" in a zone -> the UTC instant (daylight saving handled by the zone).
export function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const tm = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(timeStr);
  if (!dm || !tm) return null;
  const guess = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  let utc = guess - zoneOffsetMs(guess, tz);
  const again = guess - zoneOffsetMs(utc, tz);
  if (again !== utc) utc = again;
  const out = new Date(utc);
  return Number.isNaN(out.getTime()) ? null : out;
}

const pad = (n: number) => String(n).padStart(2, "0");

// "2026-10-20" for an instant in a zone.
export function dateKeyInZone(date: Date | string, tz: string) {
  const p = zoneParts(asDate(date), tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

// "09:00" (24h) for an instant in a zone.
export function timeKeyInZone(date: Date | string, tz: string) {
  const p = zoneParts(asDate(date), tz);
  return `${pad(p.h)}:${pad(p.min)}`;
}

// "9:00 AM" in a zone.
export function timeInZone(date: Date | string, tz: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(asDate(date));
}

// "Tue, Oct 20, 2026" in a zone.
export function dateInZone(date: Date | string, tz: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(asDate(date));
}

// Every Monday–Friday from one date to another (inclusive), as "YYYY-MM-DD": batch availability entry skips weekends.
export function weekdaysBetween(from: string, to: string): string[] {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return [];
  const out: string[] = [];
  for (let t = a.getTime(); t <= b.getTime() && out.length < 90; t += DAY_MS) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// ---- Windows and blocks ----

export type ReservationLike = { id?: string; startsAt: Date | string; endsAt: Date | string; status: string };
export type WindowLike = { startsAt: Date | string; endsAt: Date | string; timezone: string; breakAfterBlocks?: number | null };

export type Block = {
  id: string;
  startsAt: string;
  endsAt: string;
  label: string;
  isBooked: boolean;
  isPast: boolean;
  isBreak: boolean;
  isSelectable: boolean;
};

const ACTIVE = (r: ReservationLike) => r.status !== "CANCELLED";

// Round an instant up to the next :00 / :20 / :40 of the zone's wall clock (09:10 -> 09:20; 09:00 stays).
export function roundUpToBlock(date: Date, tz: string) {
  const p = zoneParts(date, tz);
  const over = p.min % BLOCK_MIN || p.s ? BLOCK_MIN - (p.min % BLOCK_MIN) : 0;
  const rounded = new Date(date.getTime() + over * 60_000 - p.s * 1000);
  rounded.setUTCMilliseconds(0);
  return rounded;
}

export function startsOnGrid(date: Date, tz: string) {
  const p = zoneParts(date, tz);
  return ALLOWED_START_MINUTES.includes(p.min) && p.s === 0;
}

// The window split into 20-minute blocks: booked ones (any reservation that is not cancelled) and past ones cannot
// be chosen, and the window's break rule turns every (N+1)th bookable block into a break.
export function buildBlocks(
  window: WindowLike,
  reservations: ReservationLike[],
  opts: { now?: Date; excludeReservationId?: string | null } = {}
): Block[] {
  const tz = window.timezone;
  const now = opts.now ?? new Date();
  const start = roundUpToBlock(asDate(window.startsAt), tz);
  const end = asDate(window.endsAt);
  const booked = reservations
    .filter(ACTIVE)
    .filter((r) => !opts.excludeReservationId || r.id !== opts.excludeReservationId)
    .map((r) => [asDate(r.startsAt).getTime(), asDate(r.endsAt).getTime()] as const);
  const isPastDay = dateKeyInZone(start, tz) < dateKeyInZone(now, tz);

  const blocks: Block[] = [];
  for (let cursor = start; ; cursor = new Date(cursor.getTime() + BLOCK_MIN * 60_000)) {
    const next = new Date(cursor.getTime() + BLOCK_MIN * 60_000);
    if (next > end) break;
    const c = cursor.getTime();
    const n = next.getTime();
    const isBooked = booked.some(([bs, be]) => c < be && n > bs);
    const isPast = isPastDay || n <= now.getTime();
    blocks.push({
      id: `${cursor.toISOString()}-${next.toISOString()}`,
      startsAt: cursor.toISOString(),
      endsAt: next.toISOString(),
      label: `${timeInZone(cursor, tz)} - ${timeInZone(next, tz)}`,
      isBooked,
      isPast,
      isBreak: false,
      isSelectable: startsOnGrid(cursor, tz) && !isBooked && !isPast,
    });
  }

  // Break rule: after N consecutive bookable blocks the next one is a break; the counter resets after each break and
  // the last block of the window is never a break.
  const breakAfter = window.breakAfterBlocks ?? null;
  if (breakAfter && breakAfter > 0) {
    let run = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (run >= breakAfter && i < blocks.length - 1) {
        b.isBreak = true;
        b.isSelectable = false;
        run = 0;
        continue;
      }
      if (b.isSelectable) run += 1;
    }
  }
  return blocks;
}

export function blockLabel(b: Block) {
  if (b.isBreak) return `${b.label} - Break`;
  if (b.isBooked) return `${b.label} - Booked`;
  if (b.isPast) return `${b.label} - Past`;
  return b.label;
}

export type WindowSummary = { durationMin: number; bookedMin: number; availableMin: number; status: "AVAILABLE" | "PARTIAL" | "FULL" };

// Minutes in the window, minutes reserved (cancelled excluded) and the derived window status.
export function windowSummary(window: WindowLike, reservations: ReservationLike[]): WindowSummary {
  const durationMin = Math.floor((asDate(window.endsAt).getTime() - asDate(window.startsAt).getTime()) / 60_000);
  const bookedMin = reservations.filter(ACTIVE).reduce((sum, r) => sum + (asDate(r.endsAt).getTime() - asDate(r.startsAt).getTime()) / 60_000, 0);
  const availableMin = Math.max(0, durationMin - bookedMin);
  const status = bookedMin === 0 ? "AVAILABLE" : availableMin < BLOCK_MIN ? "FULL" : "PARTIAL";
  return { durationMin, bookedMin, availableMin, status };
}

export const WINDOW_STATUS_LABEL: Record<WindowSummary["status"], string> = {
  AVAILABLE: "Available",
  PARTIAL: "Partially booked",
  FULL: "Full",
};

// Two windows touch or overlap (inclusive, as the source system: back-to-back windows must be entered as one).
export function windowsClash(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) {
  return a.startsAt <= b.endsAt && a.endsAt >= b.startsAt;
}

// "Chen, Maya, MD" from the provider directory's name and credential.
export function doctorName(p: { name: string; credential?: string | null }) {
  return p.credential ? `${p.name}, ${p.credential}` : p.name;
}
