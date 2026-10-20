import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { careStatusLabel } from "@/lib/gateway";
import { DAY_ABBR } from "@/lib/schedule";
import { formatDate } from "@/lib/format";
import { fullAddress } from "@/lib/gis/geocode";
import { displayName } from "@/lib/gis/settings";

// The GIS patients board: the practice's active patients with their field assignments, schedule, next visit, note,
// and a status read from the Patient Gateway care board (the latest intake case), which has the same columns as
// the PersonicGIS status chips.

export { GIS_STATUSES, gisStatus } from "@/lib/gis/shared";
import { gisStatus } from "@/lib/gis/shared";

const CARE_KEY: Record<string, string> = { CONFIRMED: "confirmed", RESCHEDULED: "rescheduled", ACTIVE: "active", ACTIVE_HOSPITALIZED: "active-hosp", PENDING_DISCHARGE: "pending-discharge", DISCHARGED: "discharged", UNSEEN_HOSPITALIZED: "unseen-hosp" };

// Status key for a patient from their latest intake case.
export function gisStatusKey(c: { stage: string; careStatus: string | null } | null | undefined) {
  if (!c) return "none";
  if (c.stage === "SCHEDULING") return "ready";
  if (c.stage === "UNABLE_TO_SEE") return "unable";
  if (c.stage === "SCHEDULED") return CARE_KEY[c.careStatus ?? ""] ?? "confirmed";
  return "pending";
}
void careStatusLabel;

export type BoardFilters = {
  q?: string;
  status?: string;
  np?: string;
  lpn?: string;
  ma?: string;
  zip?: string;
  county?: string;
  state?: string;
  hh?: string;
  ref?: string;
  next?: string; // blank | from,to
  nextFrom?: string;
  nextTo?: string;
  day?: string;
  pin?: string;
};
export const BOARD_FILTER_KEYS: (keyof BoardFilters)[] = ["q", "status", "np", "lpn", "ma", "zip", "county", "state", "hh", "ref", "next", "nextFrom", "nextTo", "day", "pin"];

export function parseSchedule(json: string | null | undefined): number[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort() : [];
  } catch {
    return [];
  }
}
export const scheduleLabel = (days: number[]) => days.map((d) => DAY_ABBR[d]).join(", ");

const assignment = (key: "npProviderId" | "lpnProviderId" | "maProviderId", v: string | undefined) => (!v ? {} : v === "blank" ? { [key]: null } : { [key]: v });
const dateOf = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : null);

export function boardWhere(f: BoardFilters, practiceId: string): Prisma.PatientWhereInput {
  const q = (f.q ?? "").trim();
  const dob = q && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(q) ? new Date(q) : null;
  const from = dateOf(f.nextFrom);
  const to = dateOf(f.nextTo);
  return {
    practiceId,
    status: "ACTIVE",
    ...(q
      ? {
          OR: [
            { lastName: { contains: q, mode: "insensitive" } },
            { firstName: { contains: q, mode: "insensitive" } },
            { mrn: { contains: q, mode: "insensitive" } },
            { addressLine1: { contains: q, mode: "insensitive" } },
            ...(dob && !Number.isNaN(dob.getTime()) ? [{ dob: new Date(Date.UTC(dob.getFullYear(), dob.getMonth(), dob.getDate())) }] : []),
          ],
        }
      : {}),
    ...assignment("npProviderId", f.np),
    ...assignment("lpnProviderId", f.lpn),
    ...assignment("maProviderId", f.ma),
    ...(f.zip ? { zip: { startsWith: f.zip } } : {}),
    ...(f.county ? (f.county === "blank" ? { OR: [{ county: null }, { county: "" }] } : { county: f.county }) : {}),
    ...(f.state ? (f.state === "blank" ? { OR: [{ state: null }, { state: "" }] } : { state: f.state }) : {}),
    ...(f.hh ? (f.hh === "blank" ? { OR: [{ homeHealthCompany: null }, { homeHealthCompany: "" }] } : { homeHealthCompany: f.hh }) : {}),
    ...(f.ref ? (f.ref === "blank" ? { referringPhysicianId: null } : { referringPhysicianId: f.ref }) : {}),
    ...(f.next === "blank" ? { gisNextVisit: null } : from || to ? { gisNextVisit: { ...(from ? { gte: from } : {}), ...(to ? { lte: new Date(to.getTime() + 86_399_000) } : {}) } } : {}),
    ...(f.day ? { weeklySchedule: { contains: f.day } } : {}),
    ...(f.pin === "yes" ? { latitude: { not: null } } : f.pin === "no" ? { latitude: null } : {}),
  };
}

export type BoardRow = Awaited<ReturnType<typeof loadBoard>>["rows"][number];

// The board rows, status derived and filtered in memory (status lives on the intake case, not the patient).
export async function loadBoard(practiceId: string, f: BoardFilters, { page = 1, pageSize = 100, nameFormat = "FORMAL", all = false } = {}) {
  const patients = await prisma.patient.findMany({
    where: boardWhere(f, practiceId),
    include: {
      npProvider: { select: { id: true, name: true } },
      lpnProvider: { select: { id: true, name: true } },
      maProvider: { select: { id: true, name: true } },
      referringPhysician: { select: { id: true, name: true } },
      intakeCases: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, stage: true, careStatus: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  const rows = patients
    .map((p) => {
      const statusKey = gisStatusKey(p.intakeCases[0]);
      return {
        id: p.id,
        mrn: p.mrn,
        name: displayName(p, nameFormat),
        dob: p.dob,
        phone: p.phone,
        address: fullAddress(p),
        addressLine1: p.addressLine1,
        city: p.city,
        state: p.state,
        zip: p.zip,
        county: p.county,
        statusKey,
        status: gisStatus(statusKey).label,
        caseId: p.intakeCases[0]?.id ?? null,
        homeHealth: p.homeHealthCompany,
        referral: p.referringPhysician?.name ?? null,
        np: p.npProvider,
        lpn: p.lpnProvider,
        ma: p.maProvider,
        nextVisit: p.gisNextVisit,
        schedule: parseSchedule(p.weeklySchedule),
        note: p.gisNote,
        latitude: p.latitude,
        longitude: p.longitude,
        geocodeError: p.geocodeError,
        updatedAt: p.updatedAt,
      };
    })
    .filter((r) => !f.status || r.statusKey === f.status);
  const total = rows.length;
  return { rows: all ? rows : rows.slice((page - 1) * pageSize, page * pageSize), total, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

// Export columns (the user picks which).
export const EXPORT_COLUMNS: { key: string; label: string; cell: (r: BoardRow) => string }[] = [
  { key: "mrn", label: "MRN", cell: (r) => r.mrn },
  { key: "name", label: "Patient", cell: (r) => r.name },
  { key: "dob", label: "DOB", cell: (r) => formatDate(r.dob) },
  { key: "phone", label: "Phone", cell: (r) => r.phone ?? "" },
  { key: "address", label: "Address", cell: (r) => r.address },
  { key: "county", label: "County", cell: (r) => r.county ?? "" },
  { key: "state", label: "State", cell: (r) => r.state ?? "" },
  { key: "zip", label: "ZIP", cell: (r) => r.zip ?? "" },
  { key: "status", label: "Status", cell: (r) => r.status },
  { key: "np", label: "Nurse Practitioner", cell: (r) => r.np?.name ?? "" },
  { key: "lpn", label: "Wound Nurse (LPN)", cell: (r) => r.lpn?.name ?? "" },
  { key: "ma", label: "Wound Tech (MA)", cell: (r) => r.ma?.name ?? "" },
  { key: "hh", label: "Home Healthcare Provider", cell: (r) => r.homeHealth ?? "" },
  { key: "ref", label: "Referral Source", cell: (r) => r.referral ?? "" },
  { key: "next", label: "Next Visit", cell: (r) => (r.nextVisit ? formatDate(r.nextVisit) : "") },
  { key: "schedule", label: "Weekly Schedule", cell: (r) => scheduleLabel(r.schedule) },
  { key: "note", label: "Notes", cell: (r) => r.note ?? "" },
  { key: "pin", label: "Coordinates", cell: (r) => (r.latitude != null ? `${r.latitude.toFixed(5)}, ${r.longitude!.toFixed(5)}` : "") },
];
export const DEFAULT_EXPORT = ["mrn", "name", "dob", "address", "county", "zip", "status", "np", "lpn", "ma", "hh", "next", "schedule", "note"];

// Distinct filter values for the board's dropdowns.
export async function boardChoices(practiceId: string) {
  const [counties, states, hhs, refs] = await Promise.all([
    prisma.patient.findMany({ where: { practiceId, status: "ACTIVE", county: { not: null } }, distinct: ["county"], select: { county: true }, orderBy: { county: "asc" } }),
    prisma.patient.findMany({ where: { practiceId, status: "ACTIVE", state: { not: null } }, distinct: ["state"], select: { state: true }, orderBy: { state: "asc" } }),
    prisma.patient.findMany({ where: { practiceId, status: "ACTIVE", homeHealthCompany: { not: null } }, distinct: ["homeHealthCompany"], select: { homeHealthCompany: true }, orderBy: { homeHealthCompany: "asc" } }),
    prisma.renderingProvider.findMany({ where: { practiceId, isReferring: true, referredPatients: { some: { status: "ACTIVE" } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    counties: counties.map((c) => c.county!).filter(Boolean),
    states: states.map((s) => s.state!).filter(Boolean),
    homeHealth: hhs.map((h) => h.homeHealthCompany!).filter(Boolean),
    referrals: refs,
  };
}
