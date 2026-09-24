export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfWeek(date: Date) {
  const d = startOfDay(date);
  return addDays(d, -d.getDay());
}

export function parseDateParam(value: string | undefined) {
  if (!value) return startOfDay(new Date());
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? startOfDay(new Date()) : parsed;
}

export function toDateParam(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// "09:00" -> minutes since midnight
export function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minutesToTime(minutes: number) {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function formatTimeLabel(time: string) {
  const minutes = timeToMinutes(time);
  const d = new Date();
  d.setHours(0, minutes, 0, 0);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d);
}
