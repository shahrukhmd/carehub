import { prisma } from "./prisma";
import { logAudit } from "./audit";
import { importHl7Results } from "./orders";

// Inbound results interface: every message (HL7 v2 ORU^R01 over HTTP, a FHIR DiagnosticReport bundle, or an
// uploaded file) is stored first, then filed on the matching order. Whatever cannot be matched waits in the
// interface inbox on /orders where staff link it to an order and replay it.

export const MESSAGE_STATUS: Record<string, [string, string]> = {
  RECEIVED: ["Received", "info"],
  FILED: ["Filed", "ok"],
  PARTIAL: ["Partly filed", "warn"],
  UNMATCHED: ["No matching order", "warn"],
  FAILED: ["Failed", "danger"],
  DISCARDED: ["Discarded", "muted"],
};

export const RESULTS_SCOPE = "interface/results.write";

export type Hl7Header = { messageType: string | null; controlId: string | null; sender: string | null; requisition: string | null; patientHint: string | null; mrn: string | null; lastName: string | null; firstName: string | null; dob: string | null };

const hl7Date = (v: string) => (/^\d{8}/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null);

export function parseHl7Header(text: string): Hl7Header {
  const segs = text.replace(/\r\n|\n/g, "\r").split("\r").map((s) => s.trim()).filter(Boolean);
  const h: Hl7Header = { messageType: null, controlId: null, sender: null, requisition: null, patientHint: null, mrn: null, lastName: null, firstName: null, dob: null };
  for (const seg of segs) {
    const f = seg.split("|");
    if (f[0] === "MSH") {
      // MSH's first field is the separator itself, so indexes shift by one.
      h.sender = [f[2], f[3]].filter(Boolean).join(" / ") || null;
      h.messageType = (f[8] || "").replace(/\^/g, "^").split("^").slice(0, 2).join("^") || null;
      h.controlId = f[9] || null;
    } else if (f[0] === "PID") {
      h.mrn = (f[3] || "").split("~")[0].split("^")[0] || null;
      const name = (f[5] || "").split("^");
      h.lastName = name[0] || null;
      h.firstName = name[1] || null;
      h.dob = hl7Date(f[7] || "");
      h.patientHint = [[h.lastName, h.firstName].filter(Boolean).join(", "), h.dob ? `DOB ${h.dob}` : "", h.mrn ? `MRN ${h.mrn}` : ""].filter(Boolean).join(" · ") || null;
    } else if ((f[0] === "OBR" || f[0] === "ORC") && !h.requisition) {
      h.requisition = (f[2] || "").split("^")[0].trim() || null;
    }
  }
  return h;
}

const ts = () => new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

// ACK^R01 for the sender: AA accepted, AE application error (we kept the message), AR rejected.
export function buildAck(h: Hl7Header, code: "AA" | "AE" | "AR", text?: string) {
  const sender = (h.sender ?? "").split(" / ");
  return [
    `MSH|^~\\&|CAREHUB|CAREHUB|${sender[0] ?? ""}|${sender[1] ?? ""}|${ts()}||ACK^R01^ACK|${h.controlId ?? ts()}|P|2.5.1`,
    `MSA|${code}|${h.controlId ?? ""}${text ? `|${text.replace(/[|\r\n]/g, " ").slice(0, 200)}` : ""}`,
  ].join("\r");
}

// ---- FHIR R4 → HL7 so one filing path serves both. Accepts a Bundle (DiagnosticReport + Observation entries)
// or a single DiagnosticReport with contained Observations.
type FhirCoding = { code?: string; display?: string };
type FhirObs = { resourceType?: string; id?: string; code?: { coding?: FhirCoding[]; text?: string }; valueQuantity?: { value?: number; unit?: string; code?: string }; valueString?: string; referenceRange?: { text?: string; low?: { value?: number }; high?: { value?: number } }[]; interpretation?: { coding?: FhirCoding[] }[]; effectiveDateTime?: string; issued?: string };
type FhirReport = { resourceType?: string; id?: string; identifier?: { value?: string }[]; basedOn?: { identifier?: { value?: string }; reference?: string }[]; code?: { coding?: FhirCoding[]; text?: string }; subject?: { identifier?: { value?: string }; display?: string }; result?: { reference?: string }[]; contained?: FhirObs[]; conclusion?: string; presentedForm?: { data?: string; contentType?: string }[]; effectiveDateTime?: string; issued?: string; performer?: { display?: string }[] };

const FHIR_INTERP: Record<string, string> = { H: "H", HH: "HH", L: "L", LL: "LL", A: "A", AA: "AA", N: "N", HU: "HH", LU: "LL", CRIT: "AA", POS: "A", NEG: "N" };

export function fhirToHl7(body: unknown): string {
  const doc = body as { resourceType?: string; entry?: { resource?: FhirReport | FhirObs }[] };
  const resources: (FhirReport | FhirObs)[] = doc.resourceType === "Bundle" ? (doc.entry ?? []).map((e) => e.resource!).filter(Boolean) : [doc as FhirReport];
  const reports = resources.filter((r) => r.resourceType === "DiagnosticReport") as FhirReport[];
  if (reports.length === 0) throw new Error("No DiagnosticReport in the FHIR payload.");
  const byRef = new Map<string, FhirObs>();
  for (const r of resources) if (r.resourceType === "Observation" && r.id) byRef.set(`Observation/${r.id}`, r as FhirObs);
  const first = reports[0];
  const subj = first.subject?.display ?? "";
  const performer = first.performer?.[0]?.display ?? "FHIR";
  const segs = [`MSH|^~\\&|${performer.replace(/\|/g, " ")}||CAREHUB||${ts()}||ORU^R01^ORU_R01|${first.identifier?.[0]?.value ?? `FHIR${Date.now()}`}|P|2.5.1`, `PID|1||${first.subject?.identifier?.value ?? ""}||${subj.includes(",") ? subj.split(",").map((x) => x.trim()).join("^") : subj.split(" ").reverse().join("^")}`];
  let n = 0;
  for (const rep of reports) {
    const req = rep.basedOn?.find((b) => b.identifier?.value)?.identifier?.value ?? (rep.basedOn?.[0]?.reference ?? "").replace(/^ServiceRequest\//, "") ?? "";
    const code = rep.code?.coding?.[0];
    const when = (rep.effectiveDateTime ?? rep.issued ?? "").replace(/[-:T]/g, "").slice(0, 8);
    segs.push(`OBR|${++n}|${req}||${code?.code ?? ""}^${code?.display ?? rep.code?.text ?? ""}|||${when}`);
    const obs: FhirObs[] = [...(rep.contained ?? []).filter((c) => c.resourceType === "Observation"), ...(rep.result ?? []).map((r) => byRef.get(r.reference ?? "")).filter((o): o is FhirObs => Boolean(o))];
    let i = 0;
    for (const o of obs) {
      const c = o.code?.coding?.[0];
      const q = o.valueQuantity;
      const text = o.valueString;
      const rr = o.referenceRange?.[0];
      const range = rr?.text ?? (rr?.low?.value != null || rr?.high?.value != null ? `${rr?.low?.value ?? ""}-${rr?.high?.value ?? ""}` : "");
      const flag = FHIR_INTERP[(o.interpretation?.[0]?.coding?.[0]?.code ?? "").toUpperCase()] ?? "";
      const obsWhen = (o.effectiveDateTime ?? o.issued ?? "").replace(/[-:T]/g, "").slice(0, 8);
      segs.push(`OBX|${++i}|${q ? "NM" : "TX"}|${c?.code ?? ""}^${c?.display ?? o.code?.text ?? ""}||${q ? q.value ?? "" : (text ?? "").replace(/\r?\n/g, "\\.br\\")}|${q?.unit ?? q?.code ?? ""}|${range}|${flag}|||F||||${obsWhen}`);
    }
    if (rep.conclusion) segs.push(`OBX|${++i}|TX|CONCLUSION^Conclusion||${rep.conclusion.replace(/\r?\n/g, "\\.br\\")}||||||F`);
    const pdf = rep.presentedForm?.find((p) => p.contentType === "application/pdf" && p.data);
    if (pdf?.data) segs.push(`OBX|${++i}|ED|REPORT^Report||^application^pdf^Base64^${pdf.data}||||||F`);
  }
  return segs.join("\r");
}

// ---- Receive, store, file.
export async function receiveInterfaceMessage(practiceId: string, raw: string, opts: { channel: "HL7" | "FHIR" | "FILE"; apiClientId?: string | null; userId?: string | null }) {
  const h = parseHl7Header(raw);
  const msg = await prisma.interfaceMessage.create({
    data: { practiceId, apiClientId: opts.apiClientId ?? null, channel: opts.channel, messageType: h.messageType, controlId: h.controlId, sender: h.sender, raw, requisition: h.requisition, patientHint: h.patientHint },
  });
  return processInterfaceMessage(msg.id, opts.userId ?? null);
}

export async function processInterfaceMessage(id: string, userId: string | null, forceRequisition?: string) {
  const msg = await prisma.interfaceMessage.findUniqueOrThrow({ where: { id } });
  const h = parseHl7Header(msg.raw);
  let status = "FAILED";
  let detail = "";
  let filed = 0;
  let ack = "";
  let orderId: string | null = msg.orderId;
  try {
    const r = await importHl7Results(msg.practiceId, msg.raw, userId, forceRequisition ? { forceRequisition } : undefined);
    filed = r.filed.length;
    status = filed > 0 && r.unmatched.length === 0 ? "FILED" : filed > 0 ? "PARTIAL" : "UNMATCHED";
    detail = status === "FILED" ? `${filed} result${filed === 1 ? "" : "s"} filed on ${r.orders} order${r.orders === 1 ? "" : "s"}.` : status === "PARTIAL" ? `${filed} filed; no order for requisition ${r.unmatched.join(", ")}.` : `No order found for requisition ${r.unmatched.join(", ") || h.requisition || "(none in the message)"}.`;
    ack = buildAck(h, status === "UNMATCHED" ? "AE" : "AA", status === "FILED" ? undefined : detail);
    if (filed > 0) {
      const req = forceRequisition ?? r.filed[0].split(":")[0];
      const o = await prisma.clinicalOrder.findFirst({ where: { practiceId: msg.practiceId, requisition: req }, select: { id: true } });
      orderId = o?.id ?? orderId;
    }
  } catch (err) {
    detail = (err as Error).message.slice(0, 500);
    ack = buildAck(h, "AR", detail);
  }
  const updated = await prisma.interfaceMessage.update({ where: { id }, data: { status, detail, filedCount: msg.filedCount + filed, ack, orderId, processedAt: new Date(), ...(forceRequisition ? { requisition: forceRequisition } : {}) } });
  if (status !== "FILED") await logAudit(msg.practiceId, userId, "INTERFACE_MESSAGE", "InterfaceMessage", id, `${status}: ${detail}`.slice(0, 190));
  return { message: updated, ack, status, filed };
}

// Orders that could take an unmatched message: same patient (by MRN, else name + DOB), still waiting on results.
export async function suggestOrders(practiceId: string, h: Hl7Header) {
  const patient = h.mrn
    ? await prisma.patient.findFirst({ where: { practiceId, mrn: h.mrn }, select: { id: true } })
    : h.lastName && h.dob
      ? await prisma.patient.findFirst({ where: { practiceId, lastName: { equals: h.lastName, mode: "insensitive" }, ...(h.firstName ? { firstName: { startsWith: h.firstName.slice(0, 3), mode: "insensitive" } } : {}), dob: new Date(`${h.dob}T00:00:00`) }, select: { id: true } })
      : null;
  if (!patient) return [];
  return prisma.clinicalOrder.findMany({ where: { practiceId, patientId: patient.id, status: { in: ["SIGNED", "SENT", "PARTIAL"] } }, include: { items: true }, orderBy: { createdAt: "desc" }, take: 8 });
}

export function inboxCounts(practiceId: string) {
  return prisma.interfaceMessage.count({ where: { practiceId, status: { in: ["UNMATCHED", "PARTIAL", "FAILED"] } } });
}
