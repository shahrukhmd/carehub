import "server-only";
import { prisma } from "@/lib/prisma";
import { claimNumber } from "@/lib/claim-format";

// Builds the ASC X12 005010X222A1 professional claim (837P) for one claim — the file a clearinghouse takes.
// Loop order follows the implementation guide (and OpenEMR's X125010837P, used as the checklist):
//   ISA/GS/ST/BHT · 1000A submitter · 1000B receiver · 2000A/2010AA billing provider · 2000B/SBR/2010BA
//   subscriber/2010BB payer · 2000C patient when not the subscriber · 2300 claim (CLM, DTP, REF, NTE, HI) ·
//   2310A referring/2310B rendering/2310C service facility/2310D supervising · 2400 lines (LX, SV1, DTP,
//   REF*6R, NTE, 2410 NDC) · SE/GE/IEA.
// One claim per interchange: the clearinghouse adapter sends it as-is, or a live adapter can batch several.

export const EDI_FILE_EVENT = "EDI_837";

const RECEIVER_IDS: Record<string, string> = { WAYSTAR: "ZIRMED", OPTUM: "OPTUM", AVAILITY: "030240928", MOCK: "CAREHUBTEST" };

// SBR09 claim filing indicator from the payer's insurance type.
export const FILING_INDICATOR: Record<string, string> = {
  MEDICARE: "MB",
  MEDICARE_ADVANTAGE: "16",
  MEDICARE_SUPPLEMENTAL: "CI",
  MEDICAID: "MC",
  MEDICAID_MCO: "MC",
  COMMERCIAL: "CI",
  TRICARE: "CH",
  CHAMPVA: "VA",
  FEDERAL_PROGRAM: "FI",
  WORKERS_COMP: "WC",
  AUTO: "AM",
  OTHER: "CI",
};

// PAT01 / SBR02 individual relationship codes (CareHub stores the CMS-1500 box 6 codes).
const RELATIONSHIP: Record<string, string> = { "18": "18", "01": "01", "19": "19", G8: "G8" };

const two = (n: number) => String(n).padStart(2, "0");
const d8 = (d: Date) => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`;
const yymmdd = (d: Date) => d8(d).slice(2);
const hhmm = (d: Date) => `${two(d.getHours())}${two(d.getMinutes())}`;
const money = (cents: number) => (cents / 100).toFixed(2);
// X12 basic character set: the delimiters never appear inside an element.
const clean = (v: string | null | undefined, max = 60) =>
  (v ?? "")
    .replace(/[*~:^]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, max);
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const sex = (v: string | null | undefined) => (v === "M" || v === "F" ? v : "U");
// PRV03 takes the 10-character taxonomy code; a specialty typed as words is left off rather than sent.
const taxonomyCode = (v: string | null | undefined) => (v && /^[0-9A-Z]{10}$/i.test(v.trim()) ? v.trim().toUpperCase() : null);

function seg(...els: (string | number | null | undefined)[]) {
  const parts = els.map((e) => (e === null || e === undefined ? "" : String(e)));
  while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts.join("*") + "~";
}

// Address pair, only when there is a street line (N4 needs N3 before it).
function address(a: { addressLine1?: string | null; addressLine2?: string | null; city?: string | null; state?: string | null; zip?: string | null }) {
  if (!a.addressLine1) return [];
  return [seg("N3", clean(a.addressLine1, 55), clean(a.addressLine2, 55) || undefined), seg("N4", clean(a.city, 30), clean(a.state, 2), digits(a.zip).slice(0, 9))];
}

function personName(p: { firstName?: string | null; lastName?: string | null; name?: string | null; middleName?: string | null }) {
  if (p.lastName || p.firstName) return { last: clean(p.lastName, 60), first: clean(p.firstName, 35), middle: clean(p.middleName, 25) };
  // "Dr. Jane Q. Smith" from the display name when the parts aren't filled in.
  const words = clean(p.name, 80).replace(/^(DR|MD|DO|NP|PA)\.?\s+/, "").split(" ").filter(Boolean);
  return { last: words.pop() ?? "", first: words.shift() ?? "", middle: words.join(" ") };
}

export async function loadClaimForEdi(claimId: string, practiceId: string) {
  return prisma.claim.findFirst({
    where: { id: claimId, practiceId },
    include: {
      lines: { orderBy: { lineNumber: "asc" } },
      diagnoses: { orderBy: { sequence: "asc" } },
      insurance: true,
      payer: true,
      billingProvider: true,
      renderingProvider: true,
      referringProvider: true,
      supervisingProvider: true,
      serviceLocation: true,
      patient: true,
      practice: { select: { name: true } },
    },
  });
}
export type ClaimForEdi = NonNullable<Awaited<ReturnType<typeof loadClaimForEdi>>>;

export type Edi837 = { text: string; segments: number; controlNumber: string; missing: string[] };

export async function build837P(c: ClaimForEdi, now = new Date()): Promise<Edi837> {
  const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: c.practiceId } });
  const clearinghouse = settings?.clearinghouse ?? "MOCK";
  const bp = c.billingProvider;
  const taxId = digits((settings?.taxIdSource === "PRACTICE" && settings.practiceTaxId) || bp?.taxId);
  const missing: string[] = [];
  if (!bp) missing.push("billing provider");
  if (!bp?.npi) missing.push("billing provider NPI");
  if (!taxId) missing.push("tax ID");
  if (!c.payer?.payerCode) missing.push("payer ID");
  if (!c.insurance?.memberId) missing.push("member ID");
  if (!c.renderingProvider?.npi) missing.push("rendering provider NPI");
  if (c.diagnoses.length === 0) missing.push("diagnosis");
  if (c.lines.length === 0) missing.push("service line");

  const control = String(now.getTime()).slice(-9);
  const senderId = (bp?.npi ?? taxId ?? "CAREHUB").padEnd(15).slice(0, 15);
  const receiverId = (RECEIVER_IDS[clearinghouse] ?? clearinghouse).padEnd(15).slice(0, 15);
  const usage = clearinghouse === "MOCK" ? "T" : "P";
  const subscriberIsPatient = (c.insurance?.relationshipToInsured ?? "18") === "18";
  const ins = c.insurance;
  const subscriber = subscriberIsPatient
    ? { ...personName(c.patient), dob: c.patient.dob, sex: c.patient.sex, addressLine1: c.patient.addressLine1, city: c.patient.city, state: c.patient.state, zip: c.patient.zip }
    : {
        ...personName({ firstName: ins?.insuredFirstName, lastName: ins?.insuredLastName, middleName: ins?.insuredMiddleName }),
        dob: ins?.insuredDob ?? null,
        sex: ins?.insuredSex,
        addressLine1: ins?.insuredAddressLine1,
        city: ins?.insuredCity,
        state: ins?.insuredState,
        zip: ins?.insuredZip,
      };
  const rank = c.payerRank === "SECONDARY" ? "S" : c.payerRank === "TERTIARY" ? "T" : "P";
  const filing = FILING_INDICATOR[c.payer?.insuranceType ?? ""] ?? "CI";
  const pos = c.placeOfService ?? c.lines[0]?.placeOfService ?? "11";
  const claimNo = claimNumber(c);
  const account = clean(c.patientAccountNumber || claimNo, 20);

  const body: string[] = [];
  // ---- Header
  body.push(seg("ST", "837", "0001", "005010X222A1"));
  body.push(seg("BHT", "0019", "00", claimNo, d8(now), hhmm(now), "CH"));
  // ---- 1000A submitter / 1000B receiver
  body.push(seg("NM1", "41", "2", clean(bp?.name ?? c.practice.name, 60), "", "", "", "", "46", senderId.trim()));
  body.push(seg("PER", "IC", clean(bp?.name ?? c.practice.name, 60), "TE", digits(settings?.billingPhone || bp?.phone) || "0000000000"));
  body.push(seg("NM1", "40", "2", clean(clearinghouse, 60), "", "", "", "", "46", receiverId.trim()));
  // ---- 2000A / 2010AA billing provider
  let hl = 1;
  body.push(seg("HL", hl, "", "20", "1"));
  if (taxonomyCode(bp?.taxonomy)) body.push(seg("PRV", "BI", "PXC", taxonomyCode(bp?.taxonomy)));
  body.push(seg("NM1", "85", "2", clean(bp?.name, 60), "", "", "", "", "XX", digits(bp?.npi)));
  body.push(...address(bp ?? {}));
  body.push(seg("REF", "EI", taxId));
  // ---- 2000B subscriber
  const subscriberHl = ++hl;
  body.push(seg("HL", subscriberHl, "1", "22", subscriberIsPatient ? "0" : "1"));
  body.push(seg("SBR", rank, subscriberIsPatient ? "18" : "", clean(ins?.groupNumber, 50), clean(ins?.groupName ?? ins?.planName, 60), "", "", "", "", filing));
  body.push(seg("NM1", "IL", "1", subscriber.last, subscriber.first, subscriber.middle, "", "", "MI", clean(ins?.memberId, 80)));
  body.push(...address(subscriber));
  if (subscriber.dob) body.push(seg("DMG", "D8", d8(subscriber.dob), sex(subscriber.sex)));
  body.push(seg("NM1", "PR", "2", clean(c.payer?.name ?? c.payerName, 60), "", "", "", "", "PI", clean(c.payer?.payerCode, 80)));
  body.push(...address(c.payer ?? {}));
  // ---- 2000C patient, when someone else holds the policy
  if (!subscriberIsPatient) {
    body.push(seg("HL", ++hl, subscriberHl, "23", "0"));
    body.push(seg("PAT", RELATIONSHIP[ins?.relationshipToInsured ?? ""] ?? "G8"));
    const p = personName(c.patient);
    body.push(seg("NM1", "QC", "1", p.last, p.first, p.middle));
    body.push(...address(c.patient));
    body.push(seg("DMG", "D8", d8(c.patient.dob), sex(c.patient.sex)));
  }
  // ---- 2300 claim
  const related = [c.autoAccident ? "AA" : "", c.employmentRelated ? "EM" : "", c.otherAccident ? "OA" : ""].filter(Boolean);
  body.push(
    seg(
      "CLM",
      account,
      money(c.billedCents),
      "",
      "",
      `${pos}:B:${c.frequencyCode}`,
      "Y",
      c.acceptAssignment ? "A" : "C",
      c.acceptAssignment ? "Y" : "N",
      "Y",
      "",
      related.length ? [related[0], related[1] ?? "", related[2] ?? "", c.autoAccident ? clean(c.autoAccidentState, 2) : ""].join(":").replace(/:+$/, "") : "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      c.delayReasonCode ?? ""
    )
  );
  if (c.onsetDate) body.push(seg("DTP", "431", "D8", d8(c.onsetDate)));
  if (c.initialTreatmentDate) body.push(seg("DTP", "454", "D8", d8(c.initialTreatmentDate)));
  if (c.unableToWorkFrom && c.unableToWorkTo) body.push(seg("DTP", "314", "RD8", `${d8(c.unableToWorkFrom)}-${d8(c.unableToWorkTo)}`));
  if (c.hospitalFrom) body.push(seg("DTP", "435", "D8", d8(c.hospitalFrom)));
  if (c.hospitalTo) body.push(seg("DTP", "096", "D8", d8(c.hospitalTo)));
  if (c.priorAuthNumber) body.push(seg("REF", "G1", clean(c.priorAuthNumber, 50)));
  if (c.referralNumber) body.push(seg("REF", "9F", clean(c.referralNumber, 50)));
  if (c.frequencyCode !== "1" && c.originalReference) body.push(seg("REF", "F8", clean(c.originalReference, 50)));
  if (c.cliaNumber) body.push(seg("REF", "X4", clean(c.cliaNumber, 50)));
  if (c.claimNote) body.push(seg("NTE", "ADD", clean(c.claimNote, 80)));
  if (c.diagnoses.length) {
    body.push(seg("HI", ...c.diagnoses.slice(0, 12).map((d, i) => `${i === 0 ? "ABK" : "ABF"}:${d.icd10.replace(".", "").toUpperCase()}`)));
  }
  // ---- 2310 claim-level providers
  const ref = c.referringProvider;
  if (ref?.npi) {
    const n = personName(ref);
    body.push(seg("NM1", "DN", "1", n.last, n.first, n.middle, "", "", "XX", digits(ref.npi)));
  }
  const rp = c.renderingProvider;
  if (rp) {
    const n = personName(rp);
    body.push(seg("NM1", "82", "1", n.last, n.first, n.middle, "", "", "XX", digits(rp.npi)));
    if (taxonomyCode(rp.taxonomy)) body.push(seg("PRV", "PE", "PXC", taxonomyCode(rp.taxonomy)));
  }
  const loc = c.serviceLocation;
  if (loc && pos !== "12") {
    body.push(seg("NM1", "77", "2", clean(loc.name, 60), "", "", "", "", loc.npi ? "XX" : "", digits(loc.npi) || undefined));
    body.push(...address(loc));
  }
  const sup = c.supervisingProvider;
  if (sup?.npi) {
    const n = personName(sup);
    body.push(seg("NM1", "DQ", "1", n.last, n.first, n.middle, "", "", "XX", digits(sup.npi)));
  }
  // ---- 2400 service lines
  const letters = "ABCDEFGHIJKL";
  c.lines.forEach((l, i) => {
    const mods = (l.modifiers ?? "").split(",").map((m) => clean(m, 2)).filter(Boolean).slice(0, 4);
    const pointers = l.pointers
      .split(",")
      .map((p) => letters.indexOf(p.trim().toUpperCase()) + 1)
      .filter((n) => n > 0 && n <= c.diagnoses.length)
      .slice(0, 4);
    body.push(seg("LX", i + 1));
    body.push(
      seg("SV1", ["HC", clean(l.cptCode, 5), ...mods].join(":"), money(l.chargeCents), "UN", String(l.units), l.placeOfService !== pos ? l.placeOfService : "", "", pointers.join(":") || "1", "", l.emergency ? "Y" : "")
    );
    const from = l.dosFrom;
    const to = l.dosTo ?? l.dosFrom;
    body.push(d8(from) === d8(to) ? seg("DTP", "472", "D8", d8(from)) : seg("DTP", "472", "RD8", `${d8(from)}-${d8(to)}`));
    body.push(seg("REF", "6R", String(l.lineNumber)));
    if (l.lineNote) body.push(seg("NTE", "ADD", clean(l.lineNote, 80)));
    if (l.ndcCode) {
      body.push(seg("LIN", "", "N4", digits(l.ndcCode).slice(0, 11)));
      if (l.ndcQuantity) body.push(seg("CTP", "", "", "", String(l.ndcQuantity), clean(l.ndcUnit ?? "UN", 2)));
    }
  });
  body.push(seg("SE", body.length + 1, "0001"));

  const isa = [
    "ISA",
    "00",
    " ".repeat(10),
    "00",
    " ".repeat(10),
    "ZZ",
    senderId,
    "ZZ",
    receiverId,
    yymmdd(now),
    hhmm(now),
    "^",
    "00501",
    control,
    "0",
    usage,
    ":",
  ].join("*") + "~";
  const gs = seg("GS", "HC", senderId.trim(), receiverId.trim(), d8(now), hhmm(now), control, "X", "005010X222A1");
  const text = [isa, gs, ...body, seg("GE", "1", control), seg("IEA", "1", control)].join("\n");
  return { text, segments: body.length + 4, controlNumber: control, missing };
}

export async function build837ForClaim(claimId: string, practiceId: string) {
  const c = await loadClaimForEdi(claimId, practiceId);
  return c ? build837P(c) : null;
}
