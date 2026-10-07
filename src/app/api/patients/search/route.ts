import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PATIENT_VIEW_ROLES } from "@/lib/gateway";
import type { Prisma } from "@prisma/client";
import { allowed } from "@/lib/permissions";

// Global patient search (left menu magnifier): last/first name, DOB, MRN, phone, member ID or account number.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!allowed(user, PATIENT_VIEW_ROLES)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const by = url.searchParams.get("by") ?? "lastName";
  const inactive = url.searchParams.get("inactive") === "1";
  if (q.length < 2) return Response.json({ results: [] });

  const and: Prisma.PatientWhereInput[] = [{ practiceId: user.practiceId }];
  if (!inactive) and.push({ status: { notIn: ["INACTIVE", "DECEASED"] } });
  if (by === "dob") {
    const m = q.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/) ?? q.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return Response.json({ results: [], hint: "Enter the date of birth as MM/DD/YYYY" });
    const [y, mo, d] = q.includes("-") && m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[1], m[2]];
    const start = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    and.push({ dob: { gte: start, lt: new Date(start.getTime() + 86_400_000) } });
  } else if (by === "phone") {
    const digits = q.replace(/\D/g, "");
    and.push({ phone: { contains: digits.length >= 4 ? digits.slice(-4) : q, mode: "insensitive" } });
  } else if (by === "mrn") {
    and.push({ mrn: { contains: q, mode: "insensitive" } });
  } else if (by === "memberId") {
    and.push({ insurances: { some: { memberId: { contains: q, mode: "insensitive" } } } });
  } else if (by === "account") {
    and.push({ appointments: { some: { accountNumber: { contains: q, mode: "insensitive" } } } });
  } else if (by === "firstName") {
    and.push({ firstName: { contains: q, mode: "insensitive" } });
  } else {
    // Last name, or "Last, First".
    const [last, first] = q.split(",").map((s) => s.trim());
    and.push({ lastName: { contains: last, mode: "insensitive" } });
    if (first) and.push({ firstName: { contains: first, mode: "insensitive" } });
  }

  const patients = await prisma.patient.findMany({
    where: { AND: and },
    include: {
      appointments: { where: { startsAt: { gte: new Date() }, status: { notIn: ["CANCELLED", "NO_SHOW"] } }, orderBy: { startsAt: "asc" }, take: 1 },
      insurances: { where: { active: true, rank: "PRIMARY" }, include: { payer: true }, take: 1 },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 25,
  });
  let results = patients.map((p) => ({
    id: p.id,
    name: `${p.lastName}, ${p.firstName}`,
    mrn: p.mrn,
    dob: p.dob.toISOString().slice(0, 10),
    phone: p.phone,
    status: p.status,
    payer: p.insurances[0]?.payer.name ?? null,
    next: p.appointments[0]?.startsAt.toISOString() ?? null,
  }));
  if (by === "phone") {
    const digits = q.replace(/\D/g, "");
    results = results.filter((r) => (r.phone ?? "").replace(/\D/g, "").includes(digits));
  }
  return Response.json({ results });
}
