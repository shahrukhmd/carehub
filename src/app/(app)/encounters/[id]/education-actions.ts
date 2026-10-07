"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rolesFor } from "@/lib/permissions";
import { lookupEducation } from "@/lib/education";

const str = (fd: FormData, k: string, max = 300) => String(fd.get(k) ?? "").trim().slice(0, max);
function back(encounterId: string, msg?: string): never {
  revalidatePath(`/encounters/${encounterId}`);
  redirect(`/encounters/${encounterId}${msg ? `?eduError=${encodeURIComponent(msg)}` : ""}#education`);
}

async function ownEncounter(encounterId: string) {
  const user = await requireUser(rolesFor("chart.edit"));
  const e = await prisma.encounter.findFirst({ where: { id: encounterId, practiceId: user.practiceId }, select: { id: true, patientId: true, diagnoses: { select: { icd10: true, description: true }, orderBy: { priority: "asc" } }, patient: { select: { preferredLanguage: true } } } });
  if (!e) redirect("/encounters");
  return { user, e: e! };
}

// Look up material for every diagnosis on the visit and attach what was found (the provider removes what
// does not fit). Spanish when the patient prefers it.
export async function lookupEducationForVisit(encounterId: string) {
  const { user, e } = await ownEncounter(encounterId);
  const lang = /^es|spanish/i.test(e.patient.preferredLanguage ?? "") ? "es" : "en";
  let added = 0;
  const existing = new Set((await prisma.educationResource.findMany({ where: { encounterId }, select: { url: true } })).map((r) => r.url));
  for (const d of e.diagnoses.slice(0, 8)) {
    const hits = await lookupEducation(d.icd10, lang);
    for (const h of hits.slice(0, 2)) {
      if (existing.has(h.url)) continue;
      await prisma.educationResource.create({ data: { practiceId: user.practiceId, encounterId, patientId: e.patientId, title: h.title, url: h.url, summary: h.summary, source: h.source, language: lang, forCode: d.icd10, addedById: user.id } });
      existing.add(h.url);
      added++;
    }
  }
  await logAudit(user.practiceId, user.id, "EDUCATION_LOOKUP", "Encounter", encounterId, `${added} resources (${lang})`);
  back(encounterId, added ? undefined : "No education material was found for the diagnoses on this visit (or the lookup service was unreachable).");
}

export async function addEducationNote(encounterId: string, fd: FormData) {
  const { user, e } = await ownEncounter(encounterId);
  const title = str(fd, "title", 200);
  const text = str(fd, "text", 2000);
  if (!title && !text) back(encounterId, "Write the instruction.");
  await prisma.educationResource.create({ data: { practiceId: user.practiceId, encounterId, patientId: e.patientId, title: title || "Instructions", url: str(fd, "url", 500) || null, summary: text || null, source: "Provider", language: "en", addedById: user.id } });
  back(encounterId);
}

export async function removeEducation(encounterId: string, id: string) {
  const { user } = await ownEncounter(encounterId);
  await prisma.educationResource.deleteMany({ where: { id, encounterId, practiceId: user.practiceId } });
  back(encounterId);
}
