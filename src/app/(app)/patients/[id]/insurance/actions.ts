"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PATIENT_EDIT_ROLES, PATIENT_VIEW_ROLES } from "@/lib/gateway";
import { PAYER_RANKS, payerRankLabel } from "@/lib/claim-format";
import { US_STATES } from "@/lib/format";
import { runEligibilityCheck } from "@/lib/clearinghouse/service";
import { sexLabel, yesNoUnknownLabel } from "@/lib/patient-fields";

const EDIT_ROLES = [...PATIENT_EDIT_ROLES, "BILLER"];

function text(fd: FormData, key: string, max = 200) {
  return String(fd.get(key) ?? "").trim().slice(0, max) || null;
}

// Back to the insurance page with a banner; never returns.
function back(patientId: string, msg?: { error?: string; ok?: string }, extra = ""): never {
  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/patients/${patientId}/insurance`);
  const q = [extra, msg?.error ? `error=${encodeURIComponent(msg.error.slice(0, 300))}` : msg?.ok ? `ok=${encodeURIComponent(msg.ok)}` : ""].filter(Boolean).join("&");
  redirect(`/patients/${patientId}/insurance${q ? `?${q}` : ""}`);
}

async function editor(patientId: string) {
  const user = await requireUser(EDIT_ROLES);
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId }, select: { id: true } });
  if (!patient) redirect("/patients");
  return user;
}

// Add or update one coverage with its benefits and, when the patient isn't the policy holder, the holder's details.
export async function savePatientInsurance(patientId: string, insuranceId: string | null, fd: FormData) {
  const user = await editor(patientId);
  const where = insuranceId ? `edit=${insuranceId}` : "add=1";
  const fail = (m: string) => back(patientId, { error: m }, where);
  const date = (key: string, label: string) => {
    const v = text(fd, key);
    if (!v) return null;
    const d = new Date(`${v}T12:00:00`);
    if (Number.isNaN(d.getTime())) fail(`${label}: enter a valid date.`);
    return d;
  };
  const cents = (key: string, label: string) => {
    const v = text(fd, key);
    if (!v) return null;
    const n = Number(v.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) fail(`${label}: enter a dollar amount.`);
    return Math.round(n * 100);
  };

  const payerId = text(fd, "payerId");
  if (!payerId || !(await prisma.payer.findFirst({ where: { id: payerId, practiceId: user.practiceId } }))) fail("Choose the insurance payer.");
  const rank = text(fd, "rank") ?? "";
  if (!PAYER_RANKS.includes(rank)) fail("Choose the insurance classification (primary, secondary or tertiary).");
  const existing = insuranceId ? await prisma.insurance.findFirst({ where: { id: insuranceId, patientId } }) : null;
  if (insuranceId && !existing) fail("Coverage not found.");
  const holder = text(fd, "holder") !== "no";
  const insuredFirstName = holder ? null : text(fd, "insuredFirstName", 80);
  const insuredLastName = holder ? null : text(fd, "insuredLastName", 80);
  if (!holder && (!insuredFirstName || !insuredLastName)) fail("Enter the policy holder's first and last name.");
  const pctRaw = text(fd, "coveragePercent");
  const pct = pctRaw ? Number(pctRaw.replace(/%/g, "")) : null;
  if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) fail("Percent coverage must be between 0 and 100.");
  const relationship = text(fd, "relationship");
  const state = text(fd, "insuredState");
  const sex = text(fd, "insuredSex");
  const yn = (key: string) => {
    const v = text(fd, key);
    return v && v in yesNoUnknownLabel ? v : null;
  };

  const data = {
    payerId: payerId!,
    rank,
    isPrimary: rank === "PRIMARY",
    memberId: text(fd, "memberId", 60) ?? existing?.memberId ?? "PENDING",
    groupName: text(fd, "groupName", 100),
    groupNumber: text(fd, "groupNumber", 60),
    copayCents: cents("copay", "Copay"),
    deductibleCents: cents("deductible", "Deductible amount"),
    deductibleMetCents: cents("deductibleMet", "Deductible met"),
    coveragePercent: pct === null ? null : Math.round(pct),
    verifiedAt: date("verifiedAt", "Verification date"),
    verifiedWith: text(fd, "verifiedWith", 100),
    effectiveDate: date("effectiveDate", "Effective date"),
    terminationDate: date("terminationDate", "Termination date"),
    authRequired: yn("authRequired"),
    priorAuthRequired: yn("priorAuthRequired"),
    relationshipToInsured: holder ? "18" : relationship && ["01", "19", "G8"].includes(relationship) ? relationship : "G8",
    insuredFirstName,
    insuredMiddleName: holder ? null : text(fd, "insuredMiddleName", 80),
    insuredLastName,
    insuredDob: holder ? null : date("insuredDob", "DOB of insured"),
    insuredPhone: holder ? null : text(fd, "insuredPhone", 30),
    insuredSex: holder ? null : sex && sex in sexLabel ? sex : null,
    insuredAddressLine1: holder ? null : [text(fd, "insuredAddress1"), text(fd, "insuredAddress2")].filter(Boolean).join(", ") || null,
    insuredCity: holder ? null : text(fd, "insuredCity", 80),
    insuredState: holder ? null : state && US_STATES.includes(state) ? state : null,
    insuredZip: holder ? null : text(fd, "insuredZip", 10),
    notes: text(fd, "notes", 2000),
    active: existing?.active ?? true,
  };

  // Only one active coverage per classification: the one being saved takes the slot.
  if (data.active) {
    await prisma.insurance.updateMany({
      where: { patientId, rank, active: true, ...(insuranceId ? { id: { not: insuranceId } } : {}) },
      data: { active: false, isPrimary: false },
    });
  }
  const saved = existing ? await prisma.insurance.update({ where: { id: existing.id }, data }) : await prisma.insurance.create({ data: { ...data, patientId } });
  await logAudit(user.practiceId, user.id, existing ? "UPDATE_INSURANCE" : "ADD_INSURANCE", "Insurance", saved.id, payerRankLabel[rank]);
  back(patientId, { ok: existing ? "Insurance updated." : "Insurance payer added." });
}

export async function setInsuranceActive(patientId: string, insuranceId: string, active: boolean) {
  const user = await editor(patientId);
  const ins = await prisma.insurance.findFirst({ where: { id: insuranceId, patientId } });
  if (!ins) back(patientId, { error: "Coverage not found." });
  if (active) {
    await prisma.insurance.updateMany({ where: { patientId, rank: ins.rank, active: true, id: { not: ins.id } }, data: { active: false, isPrimary: false } });
  }
  await prisma.insurance.update({ where: { id: ins.id }, data: { active, isPrimary: active && ins.rank === "PRIMARY" } });
  await logAudit(user.practiceId, user.id, active ? "ACTIVATE_INSURANCE" : "INACTIVATE_INSURANCE", "Insurance", ins.id, payerRankLabel[ins.rank]);
  back(patientId, { ok: active ? "Coverage set active." : "Coverage set inactive." }, active ? "" : "tab=inactive");
}

export async function deletePatientInsurance(patientId: string, insuranceId: string) {
  const user = await editor(patientId);
  const ins = await prisma.insurance.findFirst({ where: { id: insuranceId, patientId }, include: { payer: true, _count: { select: { claims: true } } } });
  if (!ins) back(patientId, { error: "Coverage not found." });
  if (ins._count.claims > 0) back(patientId, { error: `${ins.payer.name} has ${ins._count.claims} claim(s) billed to it, so it can't be deleted. Set it inactive instead.` });
  await prisma.insurance.delete({ where: { id: ins.id } });
  await logAudit(user.practiceId, user.id, "DELETE_INSURANCE", "Insurance", ins.id, `${ins.payer.name} · ${ins.memberId}`);
  back(patientId, { ok: "Coverage deleted." });
}

// ---- Authorization schedules ----

export async function saveAuthorization(patientId: string, insuranceId: string, kind: "ENCOUNTER" | "PROCEDURE", authId: string | null, fd: FormData) {
  const user = await editor(patientId);
  const ins = await prisma.insurance.findFirst({ where: { id: insuranceId, patientId } });
  if (!ins) back(patientId, { error: "Coverage not found." });
  const date = (key: string) => {
    const v = text(fd, key);
    const d = v ? new Date(`${v}T12:00:00`) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const countRaw = text(fd, "authorizedCount");
  const count = countRaw ? Number(countRaw) : null;
  if (count !== null && (!Number.isInteger(count) || count < 0)) back(patientId, { error: "Number of authorizations must be a whole number." });
  const startDate = date("startDate");
  const endDate = date("endDate");
  if (startDate && endDate && endDate < startDate) back(patientId, { error: "The authorization end date is before its start date." });
  const procedureCode = kind === "PROCEDURE" ? text(fd, "procedureCode", 10)?.toUpperCase() ?? null : null;
  if (kind === "PROCEDURE" && !procedureCode) back(patientId, { error: "Enter the procedure code (CPT / HCPCS) the authorization covers." });
  if (!text(fd, "authNumber", 60) && !text(fd, "reason", 120)) back(patientId, { error: "Enter the authorization number or the reason." });
  const data = {
    kind,
    reason: text(fd, "reason", 120),
    procedureCode,
    authNumber: text(fd, "authNumber", 60),
    authorizedCount: count,
    startDate,
    endDate,
    insuranceContact: text(fd, "insuranceContact", 100),
    verifiedAt: date("verifiedAt"),
    verifiedBy: text(fd, "verifiedBy", 100),
    notes: text(fd, "notes", 1000),
  };
  const existing = authId ? await prisma.insuranceAuthorization.findFirst({ where: { id: authId, insuranceId } }) : null;
  const saved = existing
    ? await prisma.insuranceAuthorization.update({ where: { id: existing.id }, data })
    : await prisma.insuranceAuthorization.create({ data: { ...data, practiceId: user.practiceId, patientId, insuranceId, createdById: user.id } });
  await logAudit(user.practiceId, user.id, existing ? "UPDATE_AUTHORIZATION" : "ADD_AUTHORIZATION", "Insurance", insuranceId, `${kind.toLowerCase()} ${saved.authNumber ?? ""}`.trim());
  back(patientId, { ok: "Authorization saved." });
}

export async function deleteAuthorization(patientId: string, authId: string) {
  const user = await editor(patientId);
  const auth = await prisma.insuranceAuthorization.findFirst({ where: { id: authId, patientId, practiceId: user.practiceId } });
  if (!auth) back(patientId, { error: "Authorization not found." });
  await prisma.insuranceAuthorization.delete({ where: { id: auth.id } });
  await logAudit(user.practiceId, user.id, "DELETE_AUTHORIZATION", "Insurance", auth.insuranceId, auth.authNumber ?? auth.reason ?? "");
  back(patientId, { ok: "Authorization removed." });
}

// ---- Eligibility ----

export async function checkCoverageEligibility(patientId: string, insuranceId: string, returnTo: "insurance" | "dashboard") {
  const user = await requireUser([...PATIENT_VIEW_ROLES, "BILLER"]);
  const ins = await prisma.insurance.findFirst({ where: { id: insuranceId, patientId, patient: { practiceId: user.practiceId } } });
  if (!ins) redirect("/patients");
  const check = await runEligibilityCheck({ practiceId: user.practiceId, patientId, insuranceId: ins.id, checkedById: user.id });
  await logAudit(user.practiceId, user.id, "CHECK_ELIGIBILITY", "Insurance", ins.id, check?.status ?? "no result");
  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/patients/${patientId}/insurance`);
  if (returnTo === "dashboard") redirect(`/patients/${patientId}`);
  back(patientId, { ok: "Eligibility checked." });
}
