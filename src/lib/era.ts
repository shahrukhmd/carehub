import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { logClaimEvent, refreshVisitBillingStatus } from "@/lib/claims";
import { claimNumber } from "@/lib/claim-format";
import { applyPatientCredit } from "@/lib/checkout";
import { creditRecovery, recordDenial, resolveDenials } from "@/lib/denials";

// X12 835 (Health Care Claim Payment/Advice) reading, claim matching and auto-posting.

export type EraAdjustment = { group: string; reason: string; cents: number };
export type EraLine = { code: string; modifiers: string; billedCents: number; paidCents: number; units: number; adjustments: EraAdjustment[] };
export type ParsedEraClaim = {
  controlNumber: string;
  statusCode: string;
  billedCents: number;
  paidCents: number;
  patientRespCents: number;
  payerClaimNumber: string | null;
  patientName: string | null;
  memberId: string | null;
  adjustments: EraAdjustment[];
  lines: EraLine[];
  remarks: string[];
};
export type ParsedEra = {
  payerName: string;
  payerId: string | null;
  payeeName: string | null;
  payeeNpi: string | null;
  paymentMethod: string;
  traceNumber: string | null;
  paymentDate: Date | null;
  totalCents: number;
  claims: ParsedEraClaim[];
  // Provider-level adjustments (PLB): positive reduces the payment, negative (e.g. interest) adds to it.
  plb: EraPlb[];
};

export type EraPlb = { reason: string; reference: string; cents: number };

export const PLB_REASONS: Record<string, string> = {
  L6: "Interest owed",
  WO: "Overpayment recovery",
  FB: "Forwarding balance",
  CS: "Adjustment",
  "72": "Authorized return",
  J1: "Non-reimbursable",
  "50": "Late charge",
  L3: "Penalty",
  AP: "Acceleration of benefits",
  B2: "Rebate",
  LE: "Levy",
  WU: "Unspecified recovery",
  IR: "Internal Revenue Service withholding",
  "90": "Early payment allowance",
  BD: "Bad debt adjustment",
  C5: "Temporary allowance",
  OA: "Organ acquisition",
  RA: "Retro-activity adjustment",
  SL: "Student loan repayment",
  TL: "Third party liability",
};

export const CAS_GROUPS: Record<string, string> = {
  CO: "Contractual obligation",
  PR: "Patient responsibility",
  OA: "Other adjustment",
  PI: "Payer initiated reduction",
  CR: "Correction / reversal",
};

// Common Claim Adjustment Reason Codes (X12 CARC).
export const CARC: Record<string, string> = {
  "1": "Deductible amount",
  "2": "Coinsurance amount",
  "3": "Co-payment amount",
  "4": "Procedure code inconsistent with the modifier used",
  "5": "Procedure code/type of bill inconsistent with place of service",
  "6": "Procedure/revenue code inconsistent with the patient's age",
  "9": "Diagnosis inconsistent with the patient's age",
  "11": "Diagnosis inconsistent with the procedure",
  "15": "Authorization number is missing, invalid or does not apply to the billed services",
  "16": "Claim lacks information or has submission/billing error(s)",
  "18": "Exact duplicate claim/service",
  "22": "May be covered by another payer (coordination of benefits)",
  "23": "Impact of prior payer(s) adjudication",
  "24": "Covered under a capitation agreement / managed care plan",
  "26": "Expenses incurred prior to coverage",
  "27": "Expenses incurred after coverage terminated",
  "29": "Time limit for filing has expired",
  "31": "Patient cannot be identified as our insured",
  "32": "Our records indicate the patient is not an eligible dependent",
  "33": "Insured has no dependent coverage",
  "35": "Lifetime benefit maximum has been reached",
  "39": "Services denied at the time authorization/pre-certification was requested",
  "45": "Charge exceeds fee schedule / maximum allowable",
  "49": "Non-covered routine/preventive service",
  "50": "Not deemed a medical necessity by the payer",
  "55": "Procedure/treatment is deemed experimental or investigational",
  "56": "Procedure/treatment has not been deemed proven to be effective",
  "59": "Processed based on multiple or concurrent procedure rules",
  "96": "Non-covered charge(s)",
  "97": "Payment included in the allowance for another service",
  "109": "Claim not covered by this payer — send to the correct payer",
  "119": "Benefit maximum for this time period has been reached",
  "129": "Prior processing information appears incorrect",
  "150": "Information submitted does not support this level of service",
  "151": "Information submitted does not support this many/frequency of services",
  "152": "Information submitted does not support this length of service",
  "167": "Diagnosis is not covered",
  "170": "Payment denied when performed by this type of provider",
  "181": "Procedure code was invalid on the date of service",
  "182": "Procedure modifier was invalid on the date of service",
  "185": "Rendering provider is not eligible to perform the service billed",
  "197": "Precertification/authorization/notification absent",
  "198": "Precertification/authorization exceeded",
  "200": "Expenses incurred during a lapse in coverage",
  "204": "Service not covered under the patient's current benefit plan",
  "226": "Information requested from the billing/rendering provider was not provided or was incomplete",
  "227": "Information requested from the patient/insured was not provided or was incomplete",
  "234": "Procedure is not paid separately",
  "236": "Procedure or modifier not compatible with another procedure on the same day",
  "242": "Services not provided by network/primary care providers",
  "243": "Services not authorized by network/primary care providers",
  "251": "Attachment/other documentation received was incomplete or deficient",
  "252": "An attachment/other documentation is required to adjudicate this claim",
  "253": "Sequestration — reduction of federal payment",
  "B7": "Provider not certified/eligible to be paid for this procedure on this date",
  "B13": "Previously paid — payment for this claim/service may have been provided in a previous payment",
  "B15": "Qualifying service/procedure not received/adjudicated",
};

export const CLP_STATUS: Record<string, string> = {
  "1": "Processed as primary",
  "2": "Processed as secondary",
  "3": "Processed as tertiary",
  "4": "Denied",
  "19": "Processed as primary, forwarded to another payer",
  "20": "Processed as secondary, forwarded",
  "21": "Processed as tertiary, forwarded",
  "22": "Reversal of previous payment",
  "23": "Not our claim, forwarded",
};

export const adjustmentText = (a: EraAdjustment) => `${a.group}-${a.reason} ${CARC[a.reason] ?? ""}`.trim();

const cents = (v: string | undefined) => {
  const n = Number(v ?? "0");
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

function d8(v: string | undefined) {
  if (!v || !/^\d{8}$/.test(v)) return null;
  return new Date(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T12:00:00`);
}

function readCas(el: string[]): EraAdjustment[] {
  // CAS*group*reason*amount*qty*reason*amount*qty...
  const out: EraAdjustment[] = [];
  for (let i = 2; i < el.length; i += 3) {
    if (!el[i]) continue;
    out.push({ group: el[1], reason: el[i], cents: cents(el[i + 1]) });
  }
  return out;
}

export function parse835(text: string): ParsedEra {
  const raw = text.replace(/^﻿/, "").trim();
  if (!raw.startsWith("ISA")) throw new Error("This isn't an X12 835 file (it should start with ISA).");
  const elementSep = raw[3];
  // Segment terminator is the character after ISA16 (position 105); fall back to "~".
  const segSep = raw.length > 105 && raw[105] !== elementSep ? raw[105] : "~";
  // ISA16 component separator (e.g. HC:97597).
  const compSep = raw.length > 104 && raw[104] !== elementSep ? raw[104] : ":";
  const segments = raw
    .split(segSep)
    .map((s) => s.replace(/[\r\n]/g, "").trim())
    .filter(Boolean)
    .map((s) => s.split(elementSep));
  if (!segments.some((s) => s[0] === "ST" && s[1] === "835")) throw new Error("No 835 transaction found in this file.");

  const era: ParsedEra = { payerName: "Unknown payer", payerId: null, payeeName: null, payeeNpi: null, paymentMethod: "NON", traceNumber: null, paymentDate: null, totalCents: 0, claims: [], plb: [] };
  let claim: ParsedEraClaim | null = null;
  let line: EraLine | null = null;
  let loop: "header" | "payer" | "payee" | "claim" = "header";
  for (const el of segments) {
    const tag = el[0];
    if (tag === "BPR") {
      era.totalCents = cents(el[2]);
      era.paymentMethod = el[4] || "NON";
      era.paymentDate = d8(el[16]);
    } else if (tag === "TRN") {
      era.traceNumber = el[2] || null;
    } else if (tag === "N1" && el[1] === "PR") {
      loop = "payer";
      era.payerName = el[2] || era.payerName;
    } else if (tag === "N1" && el[1] === "PE") {
      loop = "payee";
      era.payeeName = el[2] || null;
      if (el[3] === "XX") era.payeeNpi = el[4] || null;
    } else if (tag === "REF" && loop === "payer" && el[1] === "2U") {
      era.payerId = el[2] || null;
    } else if (tag === "CLP") {
      loop = "claim";
      line = null;
      claim = {
        controlNumber: el[1] ?? "",
        statusCode: el[2] ?? "",
        billedCents: cents(el[3]),
        paidCents: cents(el[4]),
        patientRespCents: cents(el[5]),
        payerClaimNumber: el[7] || null,
        patientName: null,
        memberId: null,
        adjustments: [],
        lines: [],
        remarks: [],
      };
      era.claims.push(claim);
    } else if (tag === "NM1" && claim && el[1] === "QC") {
      claim.patientName = [el[3], el[4]].filter(Boolean).join(", ") || null;
      claim.memberId = el[9] || null;
    } else if (tag === "CAS" && claim) {
      (line ? line.adjustments : claim.adjustments).push(...readCas(el));
    } else if (tag === "SVC" && claim) {
      const proc = (el[1] ?? "").split(compSep);
      line = { code: proc[1] ?? proc[0] ?? "", modifiers: proc.slice(2).join(","), billedCents: cents(el[2]), paidCents: cents(el[3]), units: Number(el[5] || "1") || 1, adjustments: [] };
      claim.lines.push(line);
    } else if (tag === "LQ" && claim) {
      claim.remarks.push(el[2]);
    } else if (tag === "PLB") {
      // PLB*provider id*fiscal date*reason:reference*amount (up to six pairs)
      for (let i = 3; i + 1 < el.length; i += 2) {
        if (!el[i]) continue;
        const [reason, reference = ""] = el[i].split(compSep);
        era.plb.push({ reason, reference, cents: cents(el[i + 1]) });
      }
    } else if (tag === "MIA" || tag === "MOA") {
      if (claim) claim.remarks.push(...el.slice(1).filter((v) => /^[MN]A?\d+/.test(v)));
    }
  }
  return era;
}

// Every adjustment on the claim, claim-level plus line-level.
export function allAdjustments(c: { adjustments: EraAdjustment[]; lines: EraLine[] }) {
  return [...c.adjustments, ...c.lines.flatMap((l) => l.adjustments)];
}

// ---- Import & match ----

export async function importEra(practiceId: string, fileName: string, text: string, userId: string | null) {
  const era = parse835(text);
  if (era.claims.length === 0) throw new Error("The 835 has no claims in it.");
  if (era.traceNumber) {
    const dup = await prisma.eraFile.findFirst({ where: { practiceId, traceNumber: era.traceNumber, totalCents: era.totalCents } });
    if (dup) throw new Error(`This remittance (trace ${era.traceNumber}) was already imported on ${dup.createdAt.toLocaleDateString("en-US")}.`);
  }
  const file = await prisma.eraFile.create({
    data: {
      practiceId,
      fileName: fileName.slice(0, 200),
      payerName: era.payerName.slice(0, 120),
      payerId: era.payerId,
      payeeName: era.payeeName,
      payeeNpi: era.payeeNpi,
      paymentMethod: era.paymentMethod,
      traceNumber: era.traceNumber,
      paymentDate: era.paymentDate,
      totalCents: era.totalCents,
      raw: text.slice(0, 2_000_000),
      plbCents: era.plb.reduce((sum, x) => sum + x.cents, 0),
      plbDetail: JSON.stringify(era.plb),
      importedById: userId,
    },
  });
  for (const c of era.claims) {
    const match = await findClaim(practiceId, c);
    await prisma.eraClaim.create({
      data: {
        eraFileId: file.id,
        claimId: match?.id ?? null,
        controlNumber: c.controlNumber.slice(0, 60),
        statusCode: c.statusCode,
        billedCents: c.billedCents,
        paidCents: c.paidCents,
        patientRespCents: c.patientRespCents,
        payerClaimNumber: c.payerClaimNumber,
        patientName: c.patientName,
        memberId: c.memberId,
        adjustments: JSON.stringify(c.adjustments),
        lines: JSON.stringify(c.lines),
        remarks: c.remarks.join(", ") || null,
        matchStatus: match ? "MATCHED" : "UNMATCHED",
      },
    });
  }
  await logAudit(practiceId, userId, "IMPORT_ERA", "EraFile", file.id, `${era.payerName} · ${era.claims.length} claims · $${(era.totalCents / 100).toFixed(2)}`);
  return file;
}

async function findClaim(practiceId: string, c: ParsedEraClaim) {
  const control = c.controlNumber.trim().toUpperCase();
  const open = { practiceId, status: { notIn: ["VOID", "DRAFT", "READY", "HOLD"] } };
  // Our claim number (CLM-YY + last six of the id).
  const m = /^CLM-(\d{2})([A-Z0-9]{6})$/.exec(control);
  if (m) {
    const hits = await prisma.claim.findMany({ where: { ...open, id: { endsWith: m[2].toLowerCase() } } });
    const hit = hits.find((h) => claimNumber(h) === control);
    if (hit) return hit;
  }
  // Patient account number (MRN or visit number, box 26) + billed amount.
  const byAccount = await prisma.claim.findMany({ where: { ...open, patientAccountNumber: c.controlNumber.trim() }, orderBy: { createdAt: "desc" } });
  return byAccount.find((h) => h.billedCents === c.billedCents) ?? (byAccount.length === 1 ? byAccount[0] : null);
}

// ---- Posting ----

export type PostResult = { posted: number; skipped: number; messages: string[] };

// Posts matched claims: payment, contractual write-off, patient responsibility or denial.
export async function postEra(eraFileId: string, practiceId: string, userId: string | null): Promise<PostResult> {
  const file = await prisma.eraFile.findFirstOrThrow({ where: { id: eraFileId, practiceId }, include: { claims: true } });
  let depositId = file.depositId;
  if (!depositId) {
    const dep = await prisma.deposit.create({
      data: {
        practiceId,
        payerType: "INSURANCE",
        payerName: file.payerName,
        paymentMethod: file.paymentMethod === "ACH" ? "EFT" : file.paymentMethod === "CHK" ? "CHECK" : "OTHER",
        checkNumber: file.traceNumber,
        totalCents: file.totalCents,
        unappliedCents: file.totalCents,
        note: `ERA ${file.fileName}${file.plbCents ? ` · provider adjustments $${(file.plbCents / 100).toFixed(2)}` : ""}`,
      },
    });
    depositId = dep.id;
    await prisma.eraFile.update({ where: { id: file.id }, data: { depositId } });
  }
  const result: PostResult = { posted: 0, skipped: 0, messages: [] };
  for (const ec of file.claims) {
    if (ec.matchStatus !== "MATCHED" || !ec.claimId) continue;
    const msg = await postOne(ec.id, depositId, userId);
    if (msg) {
      result.skipped++;
      result.messages.push(msg);
    } else result.posted++;
  }
  // Copays collected at the desk now apply to whatever the patient owes after this remittance.
  const posted = await prisma.eraClaim.findMany({ where: { eraFileId: file.id, matchStatus: "POSTED", claimId: { not: null } }, select: { claimId: true } });
  const patients = await prisma.claim.findMany({ where: { id: { in: posted.map((p) => p.claimId!) } }, select: { patientId: true } });
  for (const pid of new Set(patients.map((p) => p.patientId))) await applyPatientCredit(pid, userId);
  const left = await prisma.eraClaim.count({ where: { eraFileId: file.id, matchStatus: { in: ["MATCHED", "UNMATCHED"] } } });
  await prisma.eraFile.update({ where: { id: file.id }, data: { status: left ? "PARTIAL" : "POSTED", postedAt: new Date() } });
  await logAudit(practiceId, userId, "POST_ERA", "EraFile", file.id, `${result.posted} posted, ${result.skipped} skipped`);
  return result;
}

async function postOne(eraClaimId: string, depositId: string, userId: string | null): Promise<string | null> {
  const ec = await prisma.eraClaim.findUniqueOrThrow({ where: { id: eraClaimId } });
  const claim = await prisma.claim.findUnique({ where: { id: ec.claimId! }, include: { lines: { orderBy: { lineNumber: "asc" } }, patient: { include: { insurances: true } } } });
  if (!claim) return `${ec.controlNumber}: claim no longer exists`;
  const label = claimNumber(claim);
  if (ec.statusCode === "22" || ec.paidCents < 0) {
    await prisma.eraClaim.update({ where: { id: ec.id }, data: { matchStatus: "SKIPPED", note: "Payment reversal — review and post manually" } });
    return `${label}: payer reversal — post manually`;
  }
  const adjustments = allAdjustments({ adjustments: JSON.parse(ec.adjustments), lines: JSON.parse(ec.lines) as EraLine[] });
  const writeOff = adjustments.filter((a) => a.group !== "PR").reduce((s, a) => s + a.cents, 0);
  const patientResp = ec.patientRespCents || adjustments.filter((a) => a.group === "PR").reduce((s, a) => s + a.cents, 0);
  const denied = ec.statusCode === "4" || (ec.paidCents === 0 && patientResp === 0 && adjustments.some((a) => a.group !== "PR" && a.reason !== "45"));

  const paidCents = claim.paidCents + ec.paidCents;
  const adjustedCents = claim.adjustedCents + (denied ? 0 : writeOff);
  const balance = claim.billedCents - paidCents - adjustedCents;
  const nextRank = claim.payerRank === "PRIMARY" ? "SECONDARY" : claim.payerRank === "SECONDARY" ? "TERTIARY" : null;
  const hasNextPayer = Boolean(nextRank && claim.patient.insurances.some((i) => i.rank === nextRank && i.active));
  const reasonText = [...new Set(adjustments.filter((a) => a.group !== "PR").map(adjustmentText))].join("; ");
  const status = denied ? "DENIED" : balance <= 0 ? "PAID" : hasNextPayer || ["19", "20", "21"].includes(ec.statusCode) ? "TRANSFERRED" : "PARTIAL";
  const balanceResponsibility = !denied && balance > 0 && !hasNextPayer ? "PATIENT" : claim.balanceResponsibility;

  const deposit = await prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
  const ops = [];
  if (ec.paidCents > 0) {
    ops.push(prisma.paymentApplication.create({ data: { depositId, claimId: claim.id, amountCents: ec.paidCents, type: "PAYMENT" } }));
    ops.push(prisma.deposit.update({ where: { id: depositId }, data: { unappliedCents: Math.max(deposit.unappliedCents - ec.paidCents, 0) } }));
  }
  // Contractual write-offs are recorded against the ERA deposit but don't use its cash.
  if (!denied && writeOff > 0) ops.push(prisma.paymentApplication.create({ data: { depositId, claimId: claim.id, amountCents: writeOff, type: "ADJUSTMENT" } }));
  ops.push(
    prisma.claim.update({
      where: { id: claim.id },
      data: {
        paidCents,
        adjustedCents,
        status,
        balanceResponsibility,
        denialReason: denied ? reasonText || CLP_STATUS[ec.statusCode] || "Denied" : claim.denialReason,
        statusNote: ec.payerClaimNumber ? `Payer claim # ${ec.payerClaimNumber}` : claim.statusNote,
      },
    })
  );
  ops.push(prisma.eraClaim.update({ where: { id: ec.id }, data: { matchStatus: "POSTED", postedAt: new Date() } }));
  await prisma.$transaction(ops);

  // Line-level amounts where the payer sent service lines.
  const lines = JSON.parse(ec.lines) as EraLine[];
  const used = new Set<string>();
  for (const l of lines) {
    const target = claim.lines.find((cl) => cl.cptCode === l.code && !used.has(cl.id));
    if (!target) continue;
    used.add(target.id);
    const lineAdj = l.adjustments.filter((a) => a.group !== "PR").reduce((s, a) => s + a.cents, 0);
    await prisma.claimLine.update({ where: { id: target.id }, data: { paidCents: target.paidCents + l.paidCents, adjustedCents: target.adjustedCents + (denied ? 0 : lineAdj) } });
  }

  const parts = [`ERA ${ec.payerClaimNumber ?? ""}`.trim(), `paid $${(ec.paidCents / 100).toFixed(2)}`];
  if (!denied && writeOff) parts.push(`write-off $${(writeOff / 100).toFixed(2)}`);
  if (patientResp) parts.push(`patient resp. $${(patientResp / 100).toFixed(2)}`);
  if (denied) parts.push(`denied: ${reasonText || "see ERA"}`);
  await logClaimEvent(claim.id, userId, denied ? "DENIED" : "PAYMENT", { note: parts.join(" · ") });
  if (denied) {
    // The denial is filed under the reason carrying the most money (ignoring patient share and fee-schedule reductions).
    const main = adjustments.filter((a) => a.group !== "PR" && a.reason !== "45").sort((a, b) => b.cents - a.cents)[0];
    await recordDenial({
      claimId: claim.id,
      source: "ERA",
      reason: reasonText || CLP_STATUS[ec.statusCode] || "Denied",
      groupCode: main?.group,
      code: main?.reason,
      remarks: ec.remarks,
      userId,
    });
  } else {
    await creditRecovery(claim.id, ec.paidCents);
    await resolveDenials(claim.id, ec.paidCents > 0 ? "PAID" : status === "PAID" ? "WRITTEN_OFF" : "PATIENT", userId);
  }
  await refreshVisitBillingStatus(claim.encounterId);
  return null;
}

export async function matchEraClaim(eraClaimId: string, claimId: string | null, practiceId: string) {
  const ec = await prisma.eraClaim.findFirst({ where: { id: eraClaimId, eraFile: { practiceId } } });
  if (!ec || ec.matchStatus === "POSTED") throw new Error("That remittance line can't be changed.");
  if (claimId && !(await prisma.claim.findFirst({ where: { id: claimId, practiceId } }))) throw new Error("Claim not found.");
  await prisma.eraClaim.update({ where: { id: ec.id }, data: { claimId, matchStatus: claimId ? "MATCHED" : "UNMATCHED" } });
}

export async function skipEraClaim(eraClaimId: string, practiceId: string, note: string) {
  await prisma.eraClaim.updateMany({ where: { id: eraClaimId, eraFile: { practiceId }, matchStatus: { not: "POSTED" } }, data: { matchStatus: "SKIPPED", note: note || "Skipped" } });
}

// ---- Test remittance ----

// Builds an 835 for submitted claims (allowed = 70% of billed, 80% paid, 20% coinsurance), for testing without a clearinghouse.
export function buildTest835(
  payer: { name: string; code: string | null },
  claims: { number: string; billedCents: number; patient: { lastName: string; firstName: string }; memberId: string | null; lines: { cptCode: string; chargeCents: number; units: number }[] }[],
  opts: { denyFirst?: boolean } = {}
) {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const money = (c: number) => (c / 100).toFixed(2);
  const trace = `TEST${Date.now().toString().slice(-8)}`;
  const segs: string[] = [];
  let total = 0;
  const body: string[] = [];
  claims.forEach((c, i) => {
    const deny = opts.denyFirst && i === 0;
    let paid = 0;
    let pr = 0;
    const svc: string[] = [];
    for (const l of c.lines) {
      const allowed = Math.round(l.chargeCents * 0.7);
      const lp = deny ? 0 : Math.round(allowed * 0.8);
      const lpr = deny ? 0 : allowed - lp;
      paid += lp;
      pr += lpr;
      svc.push(`SVC*HC:${l.cptCode}*${money(l.chargeCents)}*${money(lp)}**${l.units}`);
      svc.push(`DTM*472*${ymd}`);
      if (deny) svc.push(`CAS*CO*50*${money(l.chargeCents)}`);
      else {
        svc.push(`CAS*CO*45*${money(l.chargeCents - allowed)}`);
        if (lpr) svc.push(`CAS*PR*2*${money(lpr)}`);
      }
    }
    total += paid;
    body.push(`CLP*${c.number}*${deny ? "4" : "1"}*${money(c.billedCents)}*${money(paid)}*${money(pr)}*12*TST${String(i + 1).padStart(6, "0")}*11*1`);
    body.push(`NM1*QC*1*${c.patient.lastName.toUpperCase()}*${c.patient.firstName.toUpperCase()}****MI*${c.memberId ?? "UNKNOWN"}`);
    body.push(...svc);
  });
  segs.push(`ISA*00*          *00*          *ZZ*TESTPAYER      *ZZ*CAREHUB        *${ymd.slice(2)}*1200*^*00501*000000001*0*T*:`);
  segs.push(`GS*HP*TESTPAYER*CAREHUB*${ymd}*1200*1*X*005010X221A1`);
  segs.push(`ST*835*0001`);
  segs.push(`BPR*I*${money(total)}*C*ACH*CCP*01*999999999*DA*123456*1512345678**01*999999999*DA*654321*${ymd}`);
  segs.push(`TRN*1*${trace}*1512345678`);
  segs.push(`DTM*405*${ymd}`);
  segs.push(`N1*PR*${payer.name.toUpperCase().slice(0, 60)}`);
  segs.push(`REF*2U*${payer.code ?? "TEST"}`);
  segs.push(`N1*PE*CAREHUB PRACTICE*XX*1234567893`);
  segs.push(...body);
  segs.push(`SE*${segs.length - 1}*0001`);
  segs.push(`GE*1*1`);
  segs.push(`IEA*1*000000001`);
  return segs.join("~\n") + "~\n";
}
