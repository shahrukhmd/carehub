import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { openIntakeCase } from "@/lib/intake";
import { displayValue, parseFields, typedSignature, withClinic, type DocValues, type FieldDef } from "@/lib/chart-forms";
import { normalizeDate, normalizePhone, normalizeSex, type Extraction } from "@/lib/patient-docs";
import { CONSENT_FLAGS } from "@/lib/connect/patient-forms";
import { CONSENTS, OPEN_INTAKE_STAGES } from "@/lib/gateway";

export type PacketAnswers = Record<string, DocValues>;

export function parseAnswers(json: string | null | undefined): PacketAnswers {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" ? (v as PacketAnswers) : {};
  } catch {
    return {};
  }
}

export async function packetTemplates(practiceId: string, templateKeysJson: string) {
  let keys: string[] = [];
  try {
    keys = JSON.parse(templateKeysJson);
  } catch {
    keys = [];
  }
  const templates = await prisma.documentTemplate.findMany({ where: { practiceId, key: { in: keys }, active: true } });
  return keys.map((k) => templates.find((t) => t.key === k)).filter((t): t is NonNullable<typeof t> => Boolean(t));
}

// Standard PDF fonts only cover Latin-1.
const pdfSafe = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF\u2022]/g, "");

class Writer {
  page: PDFPage;
  y = 0;
  constructor(
    private pdf: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont
  ) {
    this.page = this.newPage();
  }
  newPage() {
    this.page = this.pdf.addPage([612, 792]);
    this.y = 750;
    return this.page;
  }
  ensure(h: number) {
    if (this.y - h < 50) this.newPage();
  }
  wrap(text: string, size: number, width: number, font: PDFFont) {
    const out: string[] = [];
    for (const para of pdfSafe(text).split(/\n/)) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  }
  text(text: string, { size = 10, bold = false, x = 50, width = 512, color = rgb(0.1, 0.1, 0.15), gap = 3 } = {}) {
    const font = bold ? this.bold : this.font;
    for (const line of this.wrap(text, size, width, font)) {
      this.ensure(size + gap);
      this.page.drawText(line, { x, y: this.y - size, size, font, color });
      this.y -= size + gap;
    }
  }
  space(h: number) {
    this.y -= h;
  }
  rule() {
    this.ensure(8);
    this.page.drawLine({ start: { x: 50, y: this.y }, end: { x: 562, y: this.y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.85) });
    this.y -= 8;
  }
}

function mappedExtraction(templates: { key: string; fields: string }[], answers: PacketAnswers): { extraction: Extraction; consents: string[] } {
  const fields: Extraction["fields"] = {};
  const consents: string[] = [];
  const notes: string[] = [];
  for (const t of templates) {
    const values = answers[t.key] ?? {};
    for (const f of parseFields(t.fields)) {
      const raw = values[f.id];
      const v = Array.isArray(raw) ? raw.join(", ") : (raw ?? "");
      if (!v) continue;
      if (f.map?.startsWith("consent.")) {
        consents.push(f.map);
        continue;
      }
      if (/medications|allerg/i.test(f.label) && f.type === "textarea") notes.push(`${f.label}: ${v}`);
      if (!f.map) continue;
      let value = v.trim();
      if (f.map.endsWith(".dob") || f.map.endsWith("Date")) value = normalizeDate(value) ?? value;
      else if (f.map === "patient.sex") value = normalizeSex(value) ?? value;
      else if (/phone|fax/i.test(f.map)) value = normalizePhone(value) ?? value;
      else if (f.map === "patient.state") value = value.toUpperCase().slice(0, 2);
      fields[f.map] = { value, confidence: "high", source: "Entered by the patient" };
    }
  }
  return {
    extraction: { docType: "INTAKE_PACKET", fields, notes: notes.length ? `Patient reported — ${notes.join(" · ")}`.slice(0, 1500) : undefined },
    consents,
  };
}

// Finishes a submitted packet: signed PDF into Patient documents (ready to review & apply), consents ticked.
export async function finalizeIntakeRequest(requestId: string) {
  const r = await prisma.intakeRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { patient: true, packet: true, practice: { include: { connectSettings: true } }, appointment: true },
  });
  const templates = await packetTemplates(r.practiceId, r.packet.templateKeys);
  const answers = parseAnswers(r.answers);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${r.packet.name}`);
  pdf.setCreator("CareHub Patient Connect");
  const w = new Writer(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold));
  const script = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const clinic = r.practice.connectSettings?.displayName || r.practice.name;
  const demo = answers["pt_demographics"] ?? {};
  const nameFromForm = (() => {
    const t = templates.find((x) => x.key === "pt_demographics");
    if (!t) return "";
    const fs = parseFields(t.fields);
    const get = (map: string) => {
      const f = fs.find((x) => x.map === map);
      return f ? String(demo[f.id] ?? "") : "";
    };
    return [get("patient.lastName"), get("patient.firstName")].filter(Boolean).join(", ");
  })();
  const who = r.patient ? `${r.patient.lastName}, ${r.patient.firstName}` : nameFromForm || "New patient";
  w.text(clinic, { size: 16, bold: true });
  w.text(`${r.packet.name} — ${who}`, { size: 12, bold: true });
  w.text(`Submitted ${new Date().toLocaleString()} · ${r.patient ? `MRN ${r.patient.mrn}` : "self-registered at kiosk"} · reference ${r.id.slice(-8).toUpperCase()}`, { size: 9 });
  w.rule();

  for (const t of templates) {
    const values = answers[t.key] ?? {};
    w.space(4);
    w.text(t.name, { size: 12, bold: true });
    for (const f of withClinic(parseFields(t.fields), clinic) as FieldDef[]) {
      if (f.type === "heading") {
        w.space(2);
        w.text(f.label.toUpperCase(), { size: 8.5, bold: true, color: rgb(0.2, 0.25, 0.45) });
        continue;
      }
      if (f.type === "note") continue;
      const v = values[f.id];
      if (f.type === "consent") {
        if (f.help) w.text(f.help, { size: 9, x: 60, width: 490 });
        w.text(v ? `[X] Agreed — ${new Date(String(v).slice(7)).toLocaleString()}` : "[ ] Not agreed", { size: 9.5, bold: true, x: 60 });
        continue;
      }
      if (f.type === "signature") {
        const typed = typedSignature(v);
        if (typed) {
          // The typed name is the signature: shown in script, with who signed and when underneath.
          const name = pdfSafe(typed.name);
          w.ensure(48);
          w.text(`${f.label}:`, { size: 9.5, bold: true });
          w.page.drawText(name, { x: 60, y: w.y - 18, size: 18, font: script, color: rgb(0.07, 0.11, 0.29) });
          w.page.drawLine({ start: { x: 60, y: w.y - 22 }, end: { x: 320, y: w.y - 22 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.55) });
          w.y -= 26;
          w.text(`Electronically signed by ${name} on ${typed.at.toLocaleString()} - typed name adopted as signature`, { size: 8, x: 60, color: rgb(0.35, 0.35, 0.4) });
        } else if (typeof v === "string" && v.startsWith("data:image/png;base64,")) {
          const img = await pdf.embedPng(Buffer.from(v.split(",")[1], "base64"));
          const scale = Math.min(200 / img.width, 55 / img.height);
          w.ensure(img.height * scale + 16);
          w.text(`${f.label}:`, { size: 9.5, bold: true });
          w.page.drawImage(img, { x: 60, y: w.y - img.height * scale, width: img.width * scale, height: img.height * scale });
          w.y -= img.height * scale + 6;
        } else {
          w.text(`${f.label}: not signed`, { size: 9.5 });
        }
        continue;
      }
      if (f.type === "file") {
        w.text(`${f.label}: ${v ? "uploaded (filed in Patient documents)" : "not provided"}`, { size: 9.5 });
        continue;
      }
      const shown = displayValue(f, v);
      if (!shown) continue;
      w.text(`${f.label}: ${shown}`, { size: 9.5, x: 55, width: 505 });
    }
    w.rule();
  }
  w.text(
    "Signed electronically on the CareHub patient portal after the signer's date of birth was verified: the patient (or their representative) agreed to each form and typed their full name as their signature.",
    { size: 8, color: rgb(0.4, 0.4, 0.45) }
  );

  const bytes = await pdf.save();
  const dir = path.resolve(process.cwd(), "uploads", r.practiceId);
  await mkdir(dir, { recursive: true });
  const stored = `${randomUUID()}.pdf`;
  await writeFile(path.join(dir, stored), bytes);

  const { extraction, consents } = mappedExtraction(templates, answers);
  let intakeCaseId: string | null = null;
  if (r.patientId) {
    // Use the patient's open Gateway case; open one only when a staff member sent the forms.
    const open = await prisma.intakeCase.findFirst({
      where: { patientId: r.patientId, stage: { in: OPEN_INTAKE_STAGES } },
      orderBy: { createdAt: "desc" },
    });
    if (open) intakeCaseId = open.id;
    else if (r.createdById) {
      try {
        intakeCaseId = (await openIntakeCase({ id: r.createdById, practiceId: r.practiceId }, r.patientId)).id;
      } catch {
        intakeCaseId = null;
      }
    }
  }
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  // A packet of signed consents with nothing to review goes straight into the patient's Scans under Consents;
  // a packet that also carries answers waits for review before its details are applied.
  const consentsOnly = consents.length > 0 && Object.keys(extraction.fields).length === 0;
  const doc = await prisma.patientDocument.create({
    data: {
      practiceId: r.practiceId,
      patientId: r.patientId,
      intakeCaseId,
      name: `${day} ${consentsOnly ? "Signed consents" : r.packet.name} - ${who}.pdf`.slice(0, 180),
      originalName: `${r.packet.name}.pdf`,
      filePath: path.posix.join(r.practiceId, stored),
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      docType: consentsOnly ? "CONSENT" : "INTAKE_PACKET",
      status: consentsOnly && r.patientId ? "APPLIED" : "READ",
      appliedAt: consentsOnly && r.patientId ? new Date() : null,
      readMethod: "PATIENT",
      pageCount: pdf.getPageCount(),
      extraction: JSON.stringify(extraction),
    },
  });

  // Signed consents tick the Patient Gateway scheduling consents.
  if (intakeCaseId && consents.length) {
    const flags = Object.fromEntries(consents.flatMap((c) => CONSENT_FLAGS[c] ?? []).map((flag) => [flag, true]));
    const c = await prisma.intakeCase.update({ where: { id: intakeCaseId }, data: flags });
    if (CONSENTS.every((k) => c[k.key]) && !c.consentsCompletedAt) {
      await prisma.intakeCase.update({ where: { id: c.id }, data: { consentsCompletedAt: new Date() } });
    }
    await prisma.intakeActivity.create({
      data: {
        caseId: c.id,
        userId: null,
        stage: c.stage,
        action: "PATIENT_FORMS",
        note: `Patient signed ${r.packet.name} online (${consents.length} consent${consents.length === 1 ? "" : "s"}) — saved to Scans as "${doc.name}"`,
      },
    });
  }
  // Uploaded card / ID photos were filed as their own documents; link them to the case too.
  const fileDocIds = templates.flatMap((t) =>
    parseFields(t.fields)
      .filter((f) => f.type === "file")
      .map((f) => answers[t.key]?.[f.id])
      .filter((v): v is string => typeof v === "string" && v.length > 10)
  );
  if (fileDocIds.length) {
    await prisma.patientDocument.updateMany({ where: { id: { in: fileDocIds }, practiceId: r.practiceId }, data: { intakeCaseId, patientId: r.patientId } });
  }
  await prisma.intakeRequest.update({ where: { id: r.id }, data: { status: "COMPLETED", completedAt: new Date(), documentId: doc.id, sessionHash: null } });
  await logAudit(r.practiceId, null, "PATIENT_FORMS_SUBMITTED", "IntakeRequest", r.id, r.packet.name);
  return doc;
}
