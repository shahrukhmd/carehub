import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { Flow, MUTED, letterhead, newPdf } from "@/lib/pdf-kit";
import { practiceLetterhead } from "@/lib/prescriptions";
import { createTask } from "@/lib/tasks";

// Outgoing referrals to specialists (vascular surgery, podiatry, infectious disease, plastics, endocrinology…).

export const REFERRAL_ROLES = ["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE", "SCHEDULER"];
export const REFERRAL_STATUS: Record<string, [string, string]> = {
  DRAFT: ["Draft", "warn"],
  SENT: ["Sent — waiting for appointment", "info"],
  SCHEDULED: ["Appointment scheduled", "info"],
  CONSULT_RECEIVED: ["Consult note received", "ok"],
  CLOSED: ["Closed", "muted"],
  CANCELLED: ["Cancelled", "muted"],
};
export const COMMON_SPECIALTIES = [
  "Vascular surgery",
  "Podiatry",
  "Infectious disease",
  "Plastic surgery",
  "Endocrinology",
  "Orthopedic surgery",
  "Dermatology",
  "Nephrology",
  "Cardiology",
  "Hyperbaric medicine",
  "Nutrition / dietitian",
  "Physical therapy",
  "Orthotics / prosthetics",
  "Home health",
];

export async function referralLetterPdf(referralId: string, practiceId: string) {
  const r = await prisma.outgoingReferral.findFirstOrThrow({
    where: { id: referralId, practiceId },
    include: {
      patient: {
        include: {
          insurances: { where: { active: true }, include: { payer: true } },
          problems: { where: { status: "ACTIVE" } },
          medications: { where: { status: "ACTIVE" } },
          allergies: true,
          wounds: { where: { status: "ACTIVE" } },
          encounters: { orderBy: { date: "desc" }, take: 3, include: { provider: true } },
        },
      },
    },
  });
  const author = r.createdById ? await prisma.user.findUnique({ where: { id: r.createdById } }) : null;
  const head = await practiceLetterhead(practiceId);
  const { pdf, font, bold } = await newPdf(`Referral ${r.patient.lastName}`);
  const f = new Flow(pdf, font, bold);
  letterhead(f, head);
  f.text(`REFERRAL${r.urgency === "URGENT" ? " — URGENT" : ""}`, { size: 13, bold: true });
  f.text(formatDate(r.sentAt ?? new Date()), { size: 10, color: MUTED });
  f.gap(8);
  f.text(`To: ${r.toName}${r.toSpecialty ? ` (${r.toSpecialty})` : ""}`, { bold: true });
  if (r.toFax || r.toPhone) f.text([r.toPhone ? `Phone ${r.toPhone}` : "", r.toFax ? `Fax ${r.toFax}` : ""].filter(Boolean).join(" · "), { size: 9.5, color: MUTED });
  f.gap(8);
  const p = r.patient;
  f.text("Patient", { bold: true, size: 10 });
  f.text(`${p.lastName}, ${p.firstName}    DOB ${p.dob.toISOString().slice(0, 10)}    Sex ${p.sex}    MRN ${p.mrn}`, { size: 10 });
  f.text([p.addressLine1, [p.city, p.state, p.zip].filter(Boolean).join(" "), p.phone ? `Phone ${p.phone}` : ""].filter(Boolean).join(" · "), { size: 9.5, color: MUTED });
  for (const i of p.insurances) f.text(`${i.rank.toLowerCase()} insurance: ${i.payer.name} · Member ${i.memberId}${i.groupNumber ? ` · Group ${i.groupNumber}` : ""}`, { size: 9.5 });
  if (r.authNumber) f.text(`Referral / authorization #: ${r.authNumber}`, { size: 9.5 });
  f.gap(8);
  f.text("Reason for referral", { bold: true, size: 10 });
  f.text(r.reason, { size: 10.5 });
  if (r.diagnosisCodes) f.text(`Diagnosis: ${r.diagnosisCodes}`, { size: 10 });
  if (r.notes) {
    f.gap(4);
    f.text(r.notes, { size: 10 });
  }
  f.gap(8);
  f.text("Clinical summary", { bold: true, size: 10 });
  if (p.wounds.length) f.text(`Active wounds: ${p.wounds.map((w) => `${w.label} ${w.location} (${w.etiology.toLowerCase().replace(/_/g, " ")})`).join("; ")}`, { size: 9.5 });
  f.text(`Problems: ${p.problems.map((x) => `${x.icd10} ${x.description}`).join("; ") || "none recorded"}`, { size: 9.5 });
  f.text(`Medications: ${p.medications.map((m) => m.name).join("; ") || "none recorded"}`, { size: 9.5 });
  f.text(`Allergies: ${p.allergies.map((a) => a.allergen).join(", ") || "NKDA"}`, { size: 9.5 });
  if (p.encounters.length) f.text(`Recent visits: ${p.encounters.map((e) => `${formatDate(e.date)} (${e.provider.name})`).join(", ")}`, { size: 9.5 });
  f.gap(10);
  f.text(`Please send your consult note to ${head.name}${head.fax ? ` at fax ${head.fax}` : ""}. Thank you for seeing this patient.`, { size: 10 });
  f.gap(16);
  if (!(await f.signature(author?.signatureImage, 60, 170, 40))) f.gap(14);
  f.text(author?.name ?? head.name, { bold: true });
  return Buffer.from(await pdf.save());
}

// Referrals sent N days ago with no consult note yet get a follow-up task (run with the automations).
export async function flagOverdueReferrals(practiceId?: string) {
  const open = await prisma.outgoingReferral.findMany({ where: { status: { in: ["SENT", "SCHEDULED"] }, sentAt: { not: null }, ...(practiceId ? { practiceId } : {}) }, include: { patient: true } });
  let n = 0;
  for (const r of open) {
    if (!r.sentAt || Date.now() - r.sentAt.getTime() < r.followUpDays * 86_400_000) continue;
    await createTask({
      practiceId: r.practiceId,
      type: "REFERRAL",
      title: `No consult note yet — ${r.patient.lastName}, ${r.patient.firstName} → ${r.toName}`,
      body: `Referral sent ${formatDate(r.sentAt)} for: ${r.reason}. Call the specialist's office for the appointment status / consult note.`,
      patientId: r.patientId,
      assignedRole: "FRONT_DESK",
      link: `/referrals/${r.id}`,
      sourceType: "REFERRAL_OVERDUE",
      sourceId: r.id,
    });
    n++;
  }
  return n;
}
