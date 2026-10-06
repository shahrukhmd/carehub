import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { packOf } from "@/lib/specialties";
import { logAudit } from "@/lib/audit";
import { Flow, MUTED, letterhead, newPdf } from "@/lib/pdf-kit";
import { practiceLetterhead } from "@/lib/prescriptions";
import { drawCode39 } from "@/lib/letters";
import { createTask } from "@/lib/tasks";

// Lab & imaging orders: catalog, requisitions, sending, results (manual or HL7 ORU) and provider review.

export const ORDER_ROLES = ["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE"];
export const ORDER_WRITE_ROLES = ["ADMIN", "CLINICIAN"];

export const ORDER_STATUS: Record<string, [string, string]> = {
  DRAFT: ["Draft", "warn"],
  SIGNED: ["Signed — not sent", "info"],
  SENT: ["Sent — awaiting results", "info"],
  PARTIAL: ["Partial results", "warn"],
  RESULTED: ["Results to review", "bad"],
  REVIEWED: ["Reviewed", "ok"],
  CANCELLED: ["Cancelled", "muted"],
};
export const RESULT_FLAGS: Record<string, string> = { NORMAL: "Normal", HIGH: "High", LOW: "Low", ABNORMAL: "Abnormal", CRITICAL: "Critical" };
export const SEND_METHODS: Record<string, string> = { FAX: "Fax", PRINT: "Print (patient takes it)", ELECTRONIC: "Electronic interface (HL7)" };

// Starter catalog for a wound-care practice. Labs use LOINC, imaging uses CPT.
export const STANDARD_CATALOG: { kind: "LAB" | "IMAGING"; code: string; name: string; category: string; specimen?: string; fasting?: boolean }[] = [
  { kind: "LAB", code: "58410-2", name: "CBC with differential", category: "Hematology", specimen: "Blood (lavender)" },
  { kind: "LAB", code: "24323-8", name: "Comprehensive metabolic panel (CMP)", category: "Chemistry", specimen: "Blood (SST)", fasting: true },
  { kind: "LAB", code: "4548-4", name: "Hemoglobin A1c", category: "Chemistry", specimen: "Blood (lavender)" },
  { kind: "LAB", code: "1751-7", name: "Albumin", category: "Nutrition", specimen: "Blood (SST)" },
  { kind: "LAB", code: "14338-8", name: "Prealbumin", category: "Nutrition", specimen: "Blood (SST)" },
  { kind: "LAB", code: "1988-5", name: "C-reactive protein (CRP)", category: "Inflammation", specimen: "Blood (SST)" },
  { kind: "LAB", code: "4537-7", name: "Sedimentation rate (ESR)", category: "Inflammation", specimen: "Blood (lavender)" },
  { kind: "LAB", code: "6462-6", name: "Wound culture, aerobic", category: "Microbiology", specimen: "Wound swab" },
  { kind: "LAB", code: "635-3", name: "Wound culture, anaerobic", category: "Microbiology", specimen: "Wound swab" },
  { kind: "LAB", code: "600-7", name: "Blood culture", category: "Microbiology", specimen: "Blood culture bottles" },
  { kind: "LAB", code: "22634-0", name: "Tissue biopsy — pathology", category: "Pathology", specimen: "Tissue in formalin" },
  { kind: "LAB", code: "2276-4", name: "Ferritin", category: "Nutrition", specimen: "Blood (SST)" },
  { kind: "LAB", code: "1989-3", name: "Vitamin D, 25-hydroxy", category: "Nutrition", specimen: "Blood (SST)" },
  { kind: "LAB", code: "5763-8", name: "Zinc", category: "Nutrition", specimen: "Blood (royal blue)" },
  { kind: "LAB", code: "5902-2", name: "PT / INR", category: "Coagulation", specimen: "Blood (light blue)" },
  { kind: "LAB", code: "57698-3", name: "Lipid panel", category: "Chemistry", specimen: "Blood (SST)", fasting: true },
  { kind: "IMAGING", code: "73630", name: "X-ray foot, 3+ views", category: "X-ray" },
  { kind: "IMAGING", code: "73610", name: "X-ray ankle, 3+ views", category: "X-ray" },
  { kind: "IMAGING", code: "73590", name: "X-ray tibia/fibula, 2 views", category: "X-ray" },
  { kind: "IMAGING", code: "73718", name: "MRI lower extremity (not joint) w/o contrast", category: "MRI" },
  { kind: "IMAGING", code: "73720", name: "MRI lower extremity (not joint) w/o & w/ contrast", category: "MRI" },
  { kind: "IMAGING", code: "73700", name: "CT lower extremity w/o contrast", category: "CT" },
  { kind: "IMAGING", code: "78315", name: "Bone scan, 3-phase", category: "Nuclear medicine" },
  { kind: "IMAGING", code: "93922", name: "ABI / limited arterial study, bilateral", category: "Vascular" },
  { kind: "IMAGING", code: "93925", name: "Arterial duplex, lower extremities, bilateral", category: "Vascular" },
  { kind: "IMAGING", code: "93970", name: "Venous duplex, extremities, bilateral", category: "Vascular" },
  // ---- Primary care ----
  { kind: "LAB", code: "2951-2", name: "Basic metabolic panel (BMP)", category: "Chemistry", specimen: "Blood (SST)", fasting: true },
  { kind: "LAB", code: "2345-7", name: "Glucose, fasting", category: "Chemistry", specimen: "Blood (gray)", fasting: true },
  { kind: "LAB", code: "3016-3", name: "TSH", category: "Endocrine", specimen: "Blood (SST)" },
  { kind: "LAB", code: "2160-0", name: "Creatinine with eGFR", category: "Chemistry", specimen: "Blood (SST)" },
  { kind: "LAB", code: "14959-1", name: "Urine microalbumin / creatinine ratio", category: "Urine", specimen: "Urine" },
  { kind: "LAB", code: "24356-8", name: "Urinalysis with microscopy", category: "Urine", specimen: "Urine" },
  { kind: "LAB", code: "2857-1", name: "PSA", category: "Screening", specimen: "Blood (SST)" },
  { kind: "LAB", code: "19762-4", name: "Pap smear (cervical cytology)", category: "Screening", specimen: "Cervical (ThinPrep)" },
  { kind: "LAB", code: "29771-3", name: "FIT (fecal immunochemical test)", category: "Screening", specimen: "Stool" },
  { kind: "LAB", code: "75622-1", name: "HIV-1/2 antigen/antibody", category: "Screening", specimen: "Blood (SST)" },
  { kind: "LAB", code: "13955-0", name: "Hepatitis C antibody", category: "Screening", specimen: "Blood (SST)" },
  { kind: "LAB", code: "2132-9", name: "Vitamin B12", category: "Nutrition", specimen: "Blood (SST)" },
  { kind: "IMAGING", code: "77067", name: "Mammogram, screening, bilateral", category: "Screening" },
  { kind: "IMAGING", code: "77080", name: "DEXA bone density, axial", category: "Screening" },
  { kind: "IMAGING", code: "71271", name: "Low-dose CT chest, lung cancer screening", category: "Screening" },
  { kind: "IMAGING", code: "76706", name: "Ultrasound abdominal aorta (AAA screening)", category: "Screening" },
  { kind: "IMAGING", code: "71046", name: "X-ray chest, 2 views", category: "X-ray" },
  { kind: "IMAGING", code: "93000", name: "ECG, 12-lead with interpretation", category: "Cardiac" },
];

const setups = new Map<string, Promise<void>>();
export function ensureOrderCatalog(practiceId: string) {
  let run = setups.get(practiceId);
  if (!run) {
    run = (async () => {
      // Standard items the practice does not have yet (new packs add theirs); hidden items stay hidden.
      const have = new Set((await prisma.orderCatalogItem.findMany({ where: { practiceId }, select: { code: true } })).map((c) => c.code));
      const missing = STANDARD_CATALOG.filter((c) => !have.has(c.code));
      if (missing.length)
        await prisma.orderCatalogItem.createMany({ data: missing.map((c) => ({ practiceId, kind: c.kind, code: c.code, name: c.name, category: c.category, specimen: c.specimen ?? null, fasting: Boolean(c.fasting), specialty: packOf("order", c.code) })) });
    })().catch((err) => {
      setups.delete(practiceId);
      throw err;
    });
    setups.set(practiceId, run);
  }
  return run;
}

export function newRequisition() {
  const d = new Date();
  return `R${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${randomBytes(3).toString("hex").toUpperCase()}`;
}

// ---- Requisition PDF ----

export async function requisitionPdf(orderId: string, practiceId: string) {
  const o = await prisma.clinicalOrder.findFirstOrThrow({
    where: { id: orderId, practiceId },
    include: { items: true, provider: true, patient: { include: { insurances: { where: { active: true }, include: { payer: true } } } } },
  });
  const doctor = await prisma.user.findUnique({ where: { id: o.orderedById }, include: { renderingProvider: true } });
  const { pdf, font, bold } = await newPdf(`${o.kind === "LAB" ? "Lab" : "Imaging"} requisition ${o.requisition}`);
  const f = new Flow(pdf, font, bold);
  letterhead(f, await practiceLetterhead(practiceId));
  f.text(`${o.kind === "LAB" ? "LABORATORY" : "IMAGING"} REQUISITION`, { size: 13, bold: true });
  drawCode39(f.page, o.requisition, 395, f.y - 6, 26, 0.72);
  f.text(`Requisition # ${o.requisition}    Priority: ${o.priority}${o.fasting ? "    FASTING" : ""}`, { size: 10 });
  f.gap(14);
  const p = o.patient;
  f.text("Patient", { bold: true, size: 10 });
  f.text(`${p.lastName}, ${p.firstName}    DOB ${p.dob.toISOString().slice(0, 10)}    Sex ${p.sex}    MRN ${p.mrn}`, { size: 10 });
  const addr = [p.addressLine1, [p.city, p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (addr || p.phone) f.text(`${addr}${p.phone ? `    Phone ${p.phone}` : ""}`, { size: 9.5, color: MUTED });
  const ins = p.insurances.sort((a, b) => a.rank.localeCompare(b.rank));
  if (ins.length) for (const i of ins) f.text(`${i.rank === "PRIMARY" ? "Primary" : i.rank === "SECONDARY" ? "Secondary" : "Tertiary"} insurance: ${i.payer.name} · Member ${i.memberId}${i.groupNumber ? ` · Group ${i.groupNumber}` : ""}`, { size: 9.5 });
  else f.text("Insurance: self-pay / bill patient", { size: 9.5 });
  f.gap(8);
  f.text("Ordering provider", { bold: true, size: 10 });
  f.text(`${doctor?.name ?? ""}${doctor?.npi || doctor?.renderingProvider?.npi ? `    NPI ${doctor?.npi ?? doctor?.renderingProvider?.npi}` : ""}`, { size: 10 });
  if (o.provider) f.text(`Performing ${o.kind === "LAB" ? "lab" : "facility"}: ${o.provider.name}${o.provider.accountNumber ? ` · Account ${o.provider.accountNumber}` : ""}${o.provider.fax ? ` · Fax ${o.provider.fax}` : ""}`, { size: 9.5, color: MUTED });
  f.gap(8);
  f.text("Diagnosis (ICD-10)", { bold: true, size: 10 });
  f.text(o.diagnosisCodes || "—", { size: 10 });
  f.gap(8);
  f.text(o.kind === "LAB" ? "Tests ordered" : "Studies ordered", { bold: true, size: 10 });
  for (const it of o.items) f.text(`☐  ${it.code}  ${it.name}${it.specimen ? `  (${it.specimen})` : ""}`.replace("☐", "[ ]"), { size: 10.5 });
  if (o.clinicalNotes) {
    f.gap(6);
    f.text("Clinical information", { bold: true, size: 10 });
    f.text(o.clinicalNotes, { size: 10 });
  }
  if (o.collectedAt) f.text(`Specimen collected ${o.collectedAt.toLocaleString("en-US")}${o.collectedBy ? ` by ${o.collectedBy}` : ""}`, { size: 9.5, color: MUTED });
  f.gap(18);
  if (o.signedAt) {
    if (!(await f.signature(doctor?.signatureImage, 60, 170, 40))) f.gap(20);
    f.text(`Electronically signed by ${doctor?.name ?? ""} ${o.signedAt.toLocaleString("en-US")}`, { size: 9, color: MUTED });
  } else f.text("UNSIGNED DRAFT — not valid until signed", { bold: true, color: MUTED });
  f.gap(10);
  f.text(`Please send results to ${(await practiceLetterhead(practiceId)).name}, referencing requisition # ${o.requisition}.`, { size: 9, color: MUTED });
  return Buffer.from(await pdf.save());
}

// ---- Results ----

export async function afterResults(orderId: string, userId: string | null) {
  const o = await prisma.clinicalOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, results: true, patient: true } });
  const allDone = o.items.length > 0 && o.items.every((it) => it.status !== "ORDERED");
  const status = o.results.length === 0 ? o.status : allDone || o.kind === "IMAGING" ? "RESULTED" : "PARTIAL";
  await prisma.clinicalOrder.update({ where: { id: o.id }, data: { status } });
  const critical = o.results.some((r) => r.flag === "CRITICAL" && !r.reviewedAt);
  const abnormal = o.results.some((r) => r.flag !== "NORMAL" && !r.reviewedAt);
  await createTask({
    practiceId: o.practiceId,
    type: o.kind === "LAB" ? "LAB_RESULT" : "IMAGING_RESULT",
    title: `${critical ? "CRITICAL " : abnormal ? "Abnormal " : ""}${o.kind === "LAB" ? "lab" : "imaging"} results — ${o.patient.lastName}, ${o.patient.firstName}`,
    body: o.items.map((i) => i.name).join(", "),
    patientId: o.patientId,
    assignedToId: o.orderedById,
    createdById: userId,
    priority: critical ? "URGENT" : abnormal ? "HIGH" : "NORMAL",
    link: `/orders/${o.id}`,
    sourceType: "ORDER_RESULT",
    sourceId: o.id,
  });
}

const HL7_FLAG: Record<string, string> = { H: "HIGH", HH: "CRITICAL", L: "LOW", LL: "CRITICAL", A: "ABNORMAL", AA: "CRITICAL", N: "NORMAL", "": "NORMAL", ">": "HIGH", "<": "LOW" };

// Reads HL7 v2 ORU^R01 result messages and files each OBX against the order whose requisition is in OBR-2/ORC-2.
export async function importHl7Results(practiceId: string, text: string, userId: string | null) {
  const segs = text.replace(/\r\n|\n/g, "\r").split("\r").map((s) => s.trim()).filter(Boolean);
  if (!segs.some((s) => s.startsWith("MSH"))) throw new Error("This isn't an HL7 v2 file (no MSH segment).");
  const filed: string[] = [];
  const unmatched: string[] = [];
  let order: Awaited<ReturnType<typeof prisma.clinicalOrder.findFirst>> = null;
  let currentReq = "";
  let obrName = "";
  const touched = new Set<string>();
  for (const seg of segs) {
    const f = seg.split("|");
    const tag = f[0];
    if (tag === "OBR" || tag === "ORC") {
      const req = (f[2] || "").split("^")[0].trim();
      if (req && req !== currentReq) {
        currentReq = req;
        order = await prisma.clinicalOrder.findFirst({ where: { practiceId, requisition: req } });
        if (!order) unmatched.push(req);
      }
      if (tag === "OBR") obrName = (f[4] || "").split("^")[1] || (f[4] || "").split("^")[0] || "";
    } else if (tag === "OBX" && order) {
      const id = (f[3] || "").split("^");
      const type = f[2];
      const value = (f[5] || "").replace(/\\.br\\/g, "\n");
      const isText = type === "TX" || type === "FT";
      await prisma.clinicalResult.create({
        data: {
          orderId: order.id,
          code: id[0] || null,
          name: id[1] || obrName || id[0] || "Result",
          value: isText ? null : value.slice(0, 200),
          unit: (f[6] || "").split("^")[0] || null,
          referenceRange: f[7] || null,
          flag: HL7_FLAG[(f[8] || "").trim()] ?? "ABNORMAL",
          reportText: isText ? value.slice(0, 20000) : null,
          source: "HL7",
          resultedAt: /^\d{8}/.test(f[14] || "") ? new Date(`${f[14].slice(0, 4)}-${f[14].slice(4, 6)}-${f[14].slice(6, 8)}T12:00:00`) : new Date(),
        },
      });
      // Mark the matching ordered item as resulted (by code or name).
      const items = await prisma.clinicalOrderItem.findMany({ where: { orderId: order.id, status: "ORDERED" } });
      const it = items.find((x) => x.code === id[0] || x.name.toLowerCase() === (obrName || "").toLowerCase()) ?? (items.length === 1 ? items[0] : null);
      if (it) await prisma.clinicalOrderItem.update({ where: { id: it.id }, data: { status: "RESULTED" } });
      touched.add(order.id);
      filed.push(`${order.requisition}: ${id[1] || id[0]}`);
    }
  }
  for (const id of touched) await afterResults(id, userId);
  await logAudit(practiceId, userId, "IMPORT_HL7_RESULTS", "ClinicalOrder", [...touched].join(",").slice(0, 190) || "none", `${filed.length} results filed, ${unmatched.length} unmatched`);
  return { filed, unmatched: [...new Set(unmatched)], orders: touched.size };
}
