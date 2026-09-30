"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { SATISFIER_KINDS, type CareCriteria } from "@/lib/care-rules";

const CLINICAL = ["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE", "CDS"];
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (v: string) => (/^\/(patients|encounters)\/[a-z0-9]+$|^\/care-gaps(\?[\w=&-]*)?$/.test(v) ? v : "/care-gaps");

export async function overrideCareGap(ruleId: string, patientId: string, fd: FormData) {
  const user = await requireUser(CLINICAL);
  const rule = await prisma.careRule.findFirst({ where: { id: ruleId, practiceId: user.practiceId } });
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
  if (rule && patient) {
    const status = ["DONE", "NOT_APPLICABLE", "REFUSED"].includes(str(fd, "status")) ? str(fd, "status") : "DONE";
    // Done elsewhere / refused come due again after the rule interval; not applicable lasts until removed.
    const until = status === "NOT_APPLICABLE" ? null : new Date(Date.now() + rule.intervalDays * 86_400_000);
    await prisma.careRuleOverride.create({ data: { ruleId, patientId, status, note: str(fd, "note").slice(0, 300) || null, until, userId: user.id } });
    await logAudit(user.practiceId, user.id, "CARE_GAP_OVERRIDE", "Patient", patientId, `${rule.name}: ${status}`);
  }
  const to = back(str(fd, "back"));
  revalidatePath(to);
  redirect(to);
}

export async function clearCareOverride(ruleId: string, patientId: string, fd: FormData) {
  const user = await requireUser(CLINICAL);
  await prisma.careRuleOverride.deleteMany({ where: { ruleId, patientId, rule: { practiceId: user.practiceId } } });
  const to = back(str(fd, "back"));
  revalidatePath(to);
  redirect(to);
}

function readRule(fd: FormData) {
  const name = str(fd, "name");
  const kind = str(fd, "kind");
  if (!name || !(kind in SATISFIER_KINDS)) return null;
  const arg = str(fd, "arg");
  if (["LAB", "DOCUMENT", "IMMUNIZATION"].includes(kind) && !arg) return null;
  const n = (k: string) => (str(fd, k) === "" ? undefined : Number(str(fd, k)));
  const criteria: CareCriteria = {
    ageMin: n("ageMin"),
    ageMax: n("ageMax"),
    sex: str(fd, "sex") === "F" || str(fd, "sex") === "M" ? (str(fd, "sex") as "F" | "M") : undefined,
    icd10: str(fd, "icd10") ? str(fd, "icd10").split(/[\s,]+/).filter(Boolean).slice(0, 30) : undefined,
    activeWound: fd.get("activeWound") === "on" || undefined,
    etiologies: fd.getAll("etiologies").map(String).filter(Boolean),
  };
  if (!criteria.etiologies?.length) delete criteria.etiologies;
  const days = Number(str(fd, "intervalDays"));
  return {
    name: name.slice(0, 120),
    description: str(fd, "description").slice(0, 400) || null,
    criteria: JSON.stringify(criteria),
    satisfiedBy: ["LAB", "DOCUMENT", "IMMUNIZATION"].includes(kind) ? `${kind}:${arg}` : kind,
    intervalDays: Number.isInteger(days) && days > 0 && days <= 3650 ? days : 365,
    message: str(fd, "message").slice(0, 200) || `${name} due`,
    severity: str(fd, "severity") === "INFO" ? "INFO" : "ALERT",
    active: fd.get("active") === "on",
  };
}

export async function saveCareRule(id: string, fd: FormData) {
  const user = await requireUser(["ADMIN"]);
  const data = readRule(fd);
  if (!data) redirect(`/settings/clinical-rules?error=${encodeURIComponent("Give the rule a name and say what satisfies it.")}${id !== "new" ? `&edit=${id}` : ""}`);
  if (id === "new") {
    const r = await prisma.careRule.create({ data: { ...data, practiceId: user.practiceId, key: `custom_${Date.now().toString(36)}` } });
    await logAudit(user.practiceId, user.id, "CREATE_CARE_RULE", "CareRule", r.id, r.name);
  } else {
    await prisma.careRule.updateMany({ where: { id, practiceId: user.practiceId }, data });
    await logAudit(user.practiceId, user.id, "UPDATE_CARE_RULE", "CareRule", id, data.name);
  }
  revalidatePath("/settings/clinical-rules");
  redirect("/settings/clinical-rules?saved=1");
}

export async function toggleCareRule(id: string) {
  const user = await requireUser(["ADMIN"]);
  const r = await prisma.careRule.findFirst({ where: { id, practiceId: user.practiceId } });
  if (r) await prisma.careRule.update({ where: { id }, data: { active: !r.active } });
  revalidatePath("/settings/clinical-rules");
  redirect("/settings/clinical-rules");
}

export async function deleteCareRule(id: string) {
  const user = await requireUser(["ADMIN"]);
  await prisma.careRule.deleteMany({ where: { id, practiceId: user.practiceId, standard: false } });
  revalidatePath("/settings/clinical-rules");
  redirect("/settings/clinical-rules");
}
