import "server-only";
import { createRequire } from "node:module";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { readUpload } from "@/lib/storage";
import { extractFromText } from "@/lib/document-reader/parse";
import {
  DOC_FIELD_KEYS,
  DOC_TYPES,
  extensionOf,
  normalizeDate,
  normalizePhone,
  normalizeSex,
  suggestedDocumentName,
  type Extraction,
} from "@/lib/patient-docs";

const MAX_OCR_PAGES = 6;
const MIN_TEXT_PER_PAGE = 40;

// ---- On-device reading: PDF text layer, else render pages and OCR them ----

type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
let workerPromise: Promise<TesseractWorker> | null = null;
let ocrQueue: Promise<unknown> = Promise.resolve();

async function ocrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      // English language data ships in node_modules, so OCR never downloads anything.
      const eng = createRequire(import.meta.url)("@tesseract.js-data/eng") as { langPath: string };
      return createWorker("eng", 1, { langPath: eng.langPath, gzip: true, cacheMethod: "none" });
    })();
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

// One OCR job at a time; the worker is shared.
function ocr(image: Buffer): Promise<string> {
  const job = ocrQueue.then(async () => {
    const worker = await ocrWorker();
    const { data } = await worker.recognize(image);
    return data.text;
  });
  ocrQueue = job.catch(() => undefined);
  return job;
}

async function readPdf(bytes: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("") + "\n";
  }
  if (text.replace(/\s/g, "").length >= MIN_TEXT_PER_PAGE * Math.min(pdf.numPages, 3)) {
    return { text, method: "TEXT" as const, pageCount: pdf.numPages };
  }
  // Scanned / faxed PDF: no usable text layer, so render each page and OCR it.
  const { createCanvas } = await import("@napi-rs/canvas");
  let ocrText = "";
  for (let i = 1; i <= Math.min(pdf.numPages, MAX_OCR_PAGES); i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 3.5 }); // ~250 dpi: best OCR accuracy for fax-quality pages
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext("2d") as never, viewport, canvas: canvas as never }).promise;
    ocrText += (await ocr(canvas.toBuffer("image/png"))) + "\n";
  }
  return { text: ocrText, method: "OCR" as const, pageCount: pdf.numPages };
}

export async function readLocally(bytes: Buffer, mimeType: string) {
  if (mimeType === "application/pdf") return readPdf(bytes);
  if (mimeType.startsWith("image/")) return { text: await ocr(bytes), method: "OCR" as const, pageCount: 1 };
  throw new Error("Only PDF and image files can be read. Word documents can be stored but not read — save them as PDF to read them.");
}

// ---- Claude reading (Facility setup → "Read documents with Claude AI") ----

const ClaudeExtraction = z.object({
  docType: z.enum(Object.keys(DOC_TYPES) as [string, ...string[]]),
  fields: z.array(
    z.object({
      key: z.enum(DOC_FIELD_KEYS as [string, ...string[]]),
      value: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
      source: z.string(),
    })
  ),
  notes: z.string(),
});

const CLAUDE_INSTRUCTIONS = `You are reading a document a wound care practice received for a patient (a referral, face sheet, insurance card, ID, orders, etc.).
Classify the document and extract every field you can find, using only the field keys allowed by the schema.
Rules:
- Only report values that are actually written in the document; never guess or infer values that aren't there.
- Dates as YYYY-MM-DD. Phone and fax numbers as (555) 555-5555. Sex as M or F. State as the 2-letter code.
- patient.* is the patient themselves; referral.* is the referring facility, physician and contact; pcp.* is the primary care physician; pharmacy.* is the patient's pharmacy; homeHealth.* is the home health agency and nurse.
- patient.ssnLast4: the last four digits of the Social Security Number only - never the full number.
- insurance.* is the primary coverage and secondary.* the secondary. insurance.copay as a plain dollar amount (e.g. 25.00). insurance.subscriberRelationship is the patient's relationship to the subscriber (Spouse, Child, Other).
- patient.race and patient.ethnicity exactly as written in the document.
- referral.diagnoses: comma-separated ICD-10 codes (add the description only if no code is given).
- confidence: high when clearly printed, medium when partly legible or inferred from layout, low when uncertain.
- source: the short snippet of the document the value came from.
- notes: one or two sentences summarising the document for the intake team (e.g. what is being requested), no PHI beyond what is needed.`;

export function claudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

async function readWithClaude(bytes: Buffer, mimeType: string): Promise<Extraction> {
  const client = new Anthropic();
  const data = bytes.toString("base64");
  const file =
    mimeType === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
      : ({
          type: "image",
          source: { type: "base64", media_type: mimeType as "image/png" | "image/jpeg", data },
        } as const);
  const response = await client.beta.messages.parse({
    model: process.env.CAREHUB_DOCUMENT_MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(ClaudeExtraction) },
    messages: [{ role: "user", content: [file, { type: "text", text: CLAUDE_INSTRUCTIONS }] }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to read this document.");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Claude's answer couldn't be read.");
  const fields: Extraction["fields"] = {};
  for (const f of parsed.fields) {
    let value = f.value.trim();
    // Same normalisation as the on-device reader so the review screen gets consistent formats.
    if (/dob$/i.test(f.key) || f.key.endsWith("Date")) value = normalizeDate(value) ?? "";
    else if (f.key === "patient.ssnLast4") value = value.replace(/\D/g, "").slice(-4);
    else if (/phone|fax/i.test(f.key)) value = normalizePhone(value) ?? value;
    else if (f.key === "patient.sex") value = normalizeSex(value) ?? "";
    if (!fields[f.key] || (!fields[f.key].value && value)) fields[f.key] = { value, confidence: f.confidence, source: f.source.slice(0, 160) };
  }
  return { docType: parsed.docType, fields, notes: parsed.notes };
}

// ---- Pipeline ----

// Reads an uploaded document and stores what was found; runs after the upload request returns.
export async function processDocument(documentId: string) {
  const doc = await prisma.patientDocument.findUnique({ where: { id: documentId } });
  if (!doc) return;
  try {
    const bytes = await readUpload(doc.filePath);
    const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: doc.practiceId } });
    const payers = await prisma.payer.findMany({ where: { practiceId: doc.practiceId }, select: { name: true } });

    let extraction: Extraction;
    let text: string | null = null;
    let method: "TEXT" | "OCR" | "CLAUDE";
    let pageCount: number | null = null;
    let note: string | null = null;

    if (settings?.documentAiEnabled && claudeConfigured() && /^(application\/pdf|image\/(png|jpeg))$/.test(doc.mimeType)) {
      try {
        extraction = await readWithClaude(bytes, doc.mimeType);
        method = "CLAUDE";
      } catch (err) {
        // Fall back to reading on this machine so the team isn't blocked.
        note = `Claude reading failed (${err instanceof Error ? err.message.slice(0, 120) : "error"}); read on this computer instead.`;
        const local = await readLocally(bytes, doc.mimeType);
        extraction = extractFromText(local.text, { ocr: local.method === "OCR", knownPayers: payers.map((p) => p.name) });
        ({ text, method, pageCount } = local);
      }
    } else {
      const local = await readLocally(bytes, doc.mimeType);
      extraction = extractFromText(local.text, { ocr: local.method === "OCR", knownPayers: payers.map((p) => p.name) });
      ({ text, method, pageCount } = local);
    }
    if (note) extraction.notes = [extraction.notes, note].filter(Boolean).join(" ");

    const docType = doc.docType === "OTHER" ? extraction.docType : doc.docType;
    const f = extraction.fields;
    const renamed =
      doc.name === doc.originalName
        ? suggestedDocumentName({
            docType,
            lastName: f["patient.lastName"]?.value,
            firstName: f["patient.firstName"]?.value,
            date: f["referral.referralDate"]?.value || null,
            ext: extensionOf(doc.originalName, doc.mimeType),
          })
        : doc.name;

    await prisma.patientDocument.update({
      where: { id: doc.id },
      data: {
        status: "READ",
        readMethod: method,
        pageCount,
        extractedText: text ? text.slice(0, 100_000) : null,
        extraction: JSON.stringify(extraction),
        docType,
        name: renamed,
        error: null,
      },
    });
  } catch (err) {
    await prisma.patientDocument.update({
      where: { id: doc.id },
      data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 500) : "Could not read the document" },
    });
  }
}
