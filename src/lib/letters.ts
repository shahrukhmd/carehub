import "server-only";
import { rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { formatDate, formatTime, formatMoney } from "@/lib/format";
import { Flow, MUTED, letterhead, newPdf, pdfSafe } from "@/lib/pdf-kit";
import { practiceLetterhead } from "@/lib/prescriptions";

export const LETTER_ROLES = ["ADMIN", "FRONT_DESK", "CLINICIAN", "BILLER", "INTAKE", "SCHEDULER"];

export const MERGE_FIELDS: [string, string][] = [
  ["patient.firstName", "Patient first name"],
  ["patient.lastName", "Patient last name"],
  ["patient.fullName", "Patient full name"],
  ["patient.dob", "Date of birth"],
  ["patient.mrn", "MRN"],
  ["patient.address", "Patient address (one line)"],
  ["practice.name", "Practice name"],
  ["practice.phone", "Practice phone"],
  ["provider.name", "Patient's last provider"],
  ["user.name", "Your name"],
  ["today", "Today's date"],
  ["lastVisit", "Last visit date"],
  ["nextAppointment", "Next appointment (date & time)"],
  ["balance", "Patient balance due"],
  ["recallReason", "Open recall reason"],
  ["recallDue", "Open recall due date"],
];

export const STANDARD_LETTERS: { key: string; name: string; subject: string; body: string }[] = [
  {
    key: "missed_appointment",
    name: "Missed appointment",
    subject: "We missed you",
    body: "Dear {{patient.firstName}},\n\nWe noticed you were unable to keep your recent appointment with {{practice.name}}. Regular wound care visits are important for healing and for preventing complications.\n\nPlease call us at {{practice.phone}} to reschedule at a time that works for you.\n\nSincerely,\n\n{{user.name}}\n{{practice.name}}",
  },
  {
    key: "recall_due",
    name: "Follow-up visit due (recall)",
    subject: "Time for your follow-up visit",
    body: "Dear {{patient.firstName}},\n\nOur records show you are due for a follow-up visit ({{recallReason}}) around {{recallDue}}.\n\nPlease call {{practice.phone}} to book your appointment.\n\nSincerely,\n\n{{practice.name}}",
  },
  {
    key: "balance_due",
    name: "Balance due",
    subject: "Account balance",
    body: "Dear {{patient.fullName}},\n\nOur records show a balance of {{balance}} on your account after insurance processing. Please call our billing office at {{practice.phone}} if you have questions or would like to set up a payment plan.\n\nThank you,\n\n{{practice.name}} Billing Office",
  },
  {
    key: "referral_thanks",
    name: "Thank you for the referral",
    subject: "Re: {{patient.fullName}} (DOB {{patient.dob}})",
    body: "Dear Colleague,\n\nThank you for referring {{patient.fullName}} (DOB {{patient.dob}}) to {{practice.name}}. We saw the patient on {{lastVisit}} and will keep you updated on wound progress and our plan of care.\n\nPlease don't hesitate to contact us at {{practice.phone}}.\n\nSincerely,\n\n{{provider.name}}",
  },
  {
    key: "healed_discharge",
    name: "Wound healed — discharge from care",
    subject: "Congratulations on your healing",
    body: "Dear {{patient.firstName}},\n\nWe're pleased to let you know your wound has healed and you have completed your treatment with {{practice.name}}.\n\nTo help prevent new wounds: check your skin daily, keep pressure off at-risk areas, wear the recommended footwear or compression, and call us at {{practice.phone}} right away if you notice any redness, swelling or opening of the skin.\n\nWishing you good health,\n\n{{provider.name}}",
  },
  {
    key: "medical_necessity",
    name: "Letter of medical necessity",
    subject: "Letter of medical necessity — {{patient.fullName}}",
    body: "To whom it may concern,\n\n{{patient.fullName}} (DOB {{patient.dob}}) is under my care at {{practice.name}} for a chronic wound. [Describe the diagnosis, wound history, treatments tried and why the requested service, supply or equipment is medically necessary.]\n\nPlease contact me at {{practice.phone}} with any questions.\n\nSincerely,\n\n{{provider.name}}",
  },
];

const setups = new Map<string, Promise<void>>();
export function ensureLetters(practiceId: string) {
  let run = setups.get(practiceId);
  if (!run) {
    run = (async () => {
      const have = new Set((await prisma.letterTemplate.findMany({ where: { practiceId }, select: { key: true } })).map((t) => t.key));
      const missing = STANDARD_LETTERS.filter((t) => !have.has(t.key));
      if (missing.length) await prisma.letterTemplate.createMany({ data: missing.map((t) => ({ practiceId, key: t.key, name: t.name, subject: t.subject, body: t.body, standard: true })) });
    })().catch((err) => {
      setups.delete(practiceId);
      throw err;
    });
    setups.set(practiceId, run);
  }
  return run;
}

export async function mergeValues(practiceId: string, patientId: string, userId: string) {
  const [p, head, user, lastEnc, next, claims, recall] = await Promise.all([
    prisma.patient.findFirstOrThrow({ where: { id: patientId, practiceId } }),
    practiceLetterhead(practiceId),
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.encounter.findFirst({ where: { patientId }, orderBy: { date: "desc" }, include: { provider: true } }),
    prisma.appointment.findFirst({ where: { patientId, startsAt: { gte: new Date() }, status: { notIn: ["CANCELLED", "NO_SHOW"] } }, orderBy: { startsAt: "asc" } }),
    prisma.claim.findMany({ where: { patientId, balanceResponsibility: "PATIENT", status: { notIn: ["VOID", "PAID", "WRITTEN_OFF"] } } }),
    prisma.recall.findFirst({ where: { patientId, status: "OPEN" }, orderBy: { dueDate: "asc" } }),
  ]);
  const balance = claims.reduce((s, c) => s + Math.max(c.billedCents - c.paidCents - c.adjustedCents, 0), 0);
  const values: Record<string, string> = {
    "patient.firstName": p.firstName,
    "patient.lastName": p.lastName,
    "patient.fullName": `${p.firstName} ${p.lastName}`,
    "patient.dob": formatDate(p.dob),
    "patient.mrn": p.mrn,
    "patient.address": [p.addressLine1, [p.city, p.state].filter(Boolean).join(", "), p.zip].filter(Boolean).join(" "),
    "practice.name": head.name,
    "practice.phone": head.phone ?? "the office",
    "provider.name": lastEnc?.provider.name ?? user.name,
    "user.name": user.name,
    today: formatDate(new Date()),
    lastVisit: lastEnc ? formatDate(lastEnc.date) : "—",
    nextAppointment: next ? `${formatDate(next.startsAt)} at ${formatTime(next.startsAt)}` : "not scheduled",
    balance: formatMoney(balance),
    recallReason: recall?.reason.toLowerCase() ?? "follow-up",
    recallDue: recall ? formatDate(recall.dueDate) : "soon",
  };
  return { values, patient: p, head, user };
}

export const fillTemplate = (text: string, values: Record<string, string>) => text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => values[k] ?? m);

export async function letterPdf(opts: { practiceId: string; patient: { firstName: string; lastName: string; addressLine1: string | null; city: string | null; state: string | null; zip: string | null }; subject: string; body: string; signatureImage?: string | null }) {
  const { pdf, font, bold } = await newPdf(opts.subject || "Letter");
  const f = new Flow(pdf, font, bold);
  letterhead(f, await practiceLetterhead(opts.practiceId));
  f.text(formatDate(new Date()), { size: 10.5 });
  f.gap(12);
  const p = opts.patient;
  f.text(`${p.firstName} ${p.lastName}`, { gap: 2 });
  if (p.addressLine1) f.text(p.addressLine1, { gap: 2 });
  const cityLine = [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (cityLine) f.text(cityLine, { gap: 2 });
  f.gap(14);
  if (opts.subject) {
    f.text(`Re: ${opts.subject}`, { bold: true });
    f.gap(8);
  }
  // The signature goes above the last paragraph (the signer's name).
  const body = opts.body.trimEnd();
  const cut = body.lastIndexOf("\n\n");
  f.text(cut > 0 ? body.slice(0, cut) : body, { size: 11, gap: 5 });
  if (cut > 0) {
    f.gap(6);
    if (!(await f.signature(opts.signatureImage, 60, 170, 42))) f.gap(10);
    f.text(body.slice(cut + 2), { size: 11, gap: 5 });
  }
  return Buffer.from(await pdf.save());
}

// ---- Labels (Avery 5160 / 8160: 30 per sheet, 2-5/8" x 1") ----

const CODE39: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn", F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
  K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn", P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn", Z: "nwwnwnnnn", "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "*": "nwnnwnwnn",
};

// Code 39 barcode (0-9, A-Z, - . space) drawn as bars; returns the width used.
export function drawCode39(page: import("pdf-lib").PDFPage, value: string, x: number, y: number, height = 28, narrow = 0.9) {
  const text = `*${value.toUpperCase().replace(/[^0-9A-Z.\- ]/g, "")}*`;
  const wide = narrow * 2.5;
  let bx = x;
  for (const ch of text) {
    const pat = CODE39[ch];
    if (!pat) continue;
    [...pat].forEach((w, k) => {
      const width = w === "w" ? wide : narrow;
      if (k % 2 === 0) page.drawRectangle({ x: bx, y, width, height, color: rgb(0, 0, 0) });
      bx += width;
    });
    bx += narrow;
  }
  return bx - x;
}

export type LabelKind = "chart" | "address" | "barcode";

export async function labelSheetPdf(kind: LabelKind, p: { firstName: string; lastName: string; dob: Date; mrn: string; sex: string; addressLine1: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null }, count: number, startAt = 1) {
  const { pdf, font, bold } = await newPdf(`${kind} labels`);
  const page = pdf.addPage([612, 792]);
  const W = 189, H = 72, left = 13.5, top = 36, gapX = 9;
  const n = Math.min(Math.max(count, 1), 30);
  for (let i = 0; i < n; i++) {
    const slot = startAt - 1 + i;
    if (slot >= 30) break;
    const col = slot % 3, row = Math.floor(slot / 3);
    const x = left + col * (W + gapX) + 8;
    const yTop = 792 - top - row * H - 12;
    const line = (t: string, dy: number, size = 9, b = false) => page.drawText(pdfSafe(t).slice(0, 48), { x, y: yTop - dy, size, font: b ? bold : font, color: rgb(0.05, 0.05, 0.08) });
    if (kind === "address") {
      line(`${p.firstName} ${p.lastName}`, 6, 10, true);
      line(p.addressLine1 ?? "", 20);
      line([p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "), 32);
    } else if (kind === "chart") {
      line(`${p.lastName.toUpperCase()}, ${p.firstName}`, 6, 10, true);
      line(`DOB ${p.dob.toISOString().slice(0, 10)}   Sex ${p.sex}`, 20);
      line(`MRN ${p.mrn}`, 32);
      if (p.phone) line(p.phone, 44, 8);
    } else {
      drawCode39(page, p.mrn, x, yTop - 34);
      line(`${p.lastName}, ${p.firstName}  ·  ${p.mrn}`, 46, 8, true);
    }
  }
  page.drawText("CareHub labels · Avery 5160/8160", { x: 36, y: 14, size: 6, font, color: MUTED });
  return Buffer.from(await pdf.save());
}
