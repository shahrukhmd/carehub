import "server-only";
import { prisma } from "@/lib/prisma";

// US federal holidays (observed dates: Saturday -> Friday, Sunday -> Monday).
export const FEDERAL_HOLIDAYS = [
  "New Year's Day",
  "Martin Luther King Jr. Day",
  "Presidents' Day",
  "Memorial Day",
  "Juneteenth",
  "Independence Day",
  "Labor Day",
  "Columbus Day",
  "Veterans Day",
  "Thanksgiving Day",
  "Day after Thanksgiving",
  "Christmas Eve",
  "Christmas Day",
  "New Year's Eve",
];
// Closed by most clinics by default.
export const DEFAULT_HOLIDAYS = ["New Year's Day", "Memorial Day", "Independence Day", "Labor Day", "Thanksgiving Day", "Christmas Day"];

const nth = (y: number, m: number, weekday: number, n: number) => {
  const d = new Date(y, m, 1, 12);
  const shift = (weekday - d.getDay() + 7) % 7;
  return new Date(y, m, 1 + shift + (n - 1) * 7, 12);
};
const last = (y: number, m: number, weekday: number) => {
  const d = new Date(y, m + 1, 0, 12);
  return new Date(y, m, d.getDate() - ((d.getDay() - weekday + 7) % 7), 12);
};
const observed = (d: Date) => (d.getDay() === 6 ? new Date(d.getTime() - 86_400_000) : d.getDay() === 0 ? new Date(d.getTime() + 86_400_000) : d);

export function holidaysFor(year: number): [string, Date][] {
  const thanksgiving = nth(year, 10, 4, 4);
  return [
    ["New Year's Day", observed(new Date(year, 0, 1, 12))],
    ["Martin Luther King Jr. Day", nth(year, 0, 1, 3)],
    ["Presidents' Day", nth(year, 1, 1, 3)],
    ["Memorial Day", last(year, 4, 1)],
    ["Juneteenth", observed(new Date(year, 5, 19, 12))],
    ["Independence Day", observed(new Date(year, 6, 4, 12))],
    ["Labor Day", nth(year, 8, 1, 1)],
    ["Columbus Day", nth(year, 9, 1, 2)],
    ["Veterans Day", observed(new Date(year, 10, 11, 12))],
    ["Thanksgiving Day", thanksgiving],
    ["Day after Thanksgiving", new Date(thanksgiving.getTime() + 86_400_000)],
    ["Christmas Eve", new Date(year, 11, 24, 12)],
    ["Christmas Day", observed(new Date(year, 11, 25, 12))],
    ["New Year's Eve", new Date(year, 11, 31, 12)],
  ];
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Closures (holidays and one-off closed days) that touch [from, to).
export async function closuresBetween(practiceId: string, from: Date, to: Date, locationId?: string | null) {
  // Whole days: closures are stored at midday.
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  if (end.getHours() || end.getMinutes() || end.getSeconds()) end.setHours(24, 0, 0, 0);
  return prisma.clinicClosure.findMany({
    where: { practiceId, date: { gte: start, lt: end }, ...(locationId ? { OR: [{ locationId: null }, { locationId }] } : {}) },
    orderBy: { date: "asc" },
  });
}
