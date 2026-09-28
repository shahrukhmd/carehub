import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { renderCms1500, type Cms1500Data } from "@/lib/cms1500-pdf";
import { claimNumber } from "@/lib/claim-format";
import { settingsAddress } from "@/lib/practice-settings";

const TYPE_TO_BOX1: Record<string, string> = {
  MEDICARE: "MEDICARE",
  MEDICAID: "MEDICAID",
  TRICARE: "TRICARE",
  CHAMPVA: "CHAMPVA",
  GROUP_HEALTH: "GROUP",
  FECA: "FECA",
};

function decodeDataUrl(value: string | null | undefined) {
  const m = value?.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  return { kind: m[1] === "png" ? ("png" as const) : ("jpg" as const), data: Uint8Array.from(Buffer.from(m[2], "base64")) };
}

const cityStateZip = (city?: string | null, state?: string | null, zip?: string | null) =>
  [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!["ADMIN", "BILLER"].includes(user.role)) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const formImage = new URL(request.url).searchParams.get("form") !== "0";

  const claim = await prisma.claim.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      lines: { orderBy: { lineNumber: "asc" } },
      diagnoses: { orderBy: { sequence: "asc" } },
      insurance: true,
      payer: true,
      patient: { include: { insurances: { where: { active: true } } } },
      billingProvider: true,
      renderingProvider: true,
      referringProvider: true,
      supervisingProvider: true,
      orderingProvider: true,
      serviceLocation: true,
      encounter: { include: { signatures: { where: { role: "PROVIDER" } }, provider: true } },
    },
  });
  if (!claim) return new Response("Not found", { status: 404 });
  const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId } });
  // Facility setup: box 33 uses the claim pay-to address when one is set; box 25 can use the practice tax ID.
  const payTo = settingsAddress(settings as unknown as Record<string, unknown>, "payTo");

  const { patient, insurance: ins, billingProvider: bp } = claim;
  const self = !ins || ins.relationshipToInsured === "18";
  const patientAddr = {
    street: patient.addressLine1 ?? "",
    city: patient.city ?? "",
    state: patient.state ?? "",
    zip: patient.zip ?? "",
    phone: patient.phone ?? "",
  };
  const box17 = claim.referringProvider
    ? { qualifier: "DN", p: claim.referringProvider }
    : claim.supervisingProvider
      ? { qualifier: "DQ", p: claim.supervisingProvider }
      : claim.orderingProvider
        ? { qualifier: "DK", p: claim.orderingProvider }
        : null;
  const providerSig = claim.encounter.signatures[0];
  const renderingNpi = claim.renderingProvider?.npi ?? bp?.npi ?? "";
  const facility = claim.serviceLocation;

  const data: Cms1500Data = {
    payerName: claim.payerName,
    payerAddress: [
      [claim.payer?.addressLine1, claim.payer?.addressLine2].filter(Boolean).join(" "),
      cityStateZip(claim.payer?.city, claim.payer?.state, claim.payer?.zip),
    ].filter(Boolean),
    insuranceType: TYPE_TO_BOX1[claim.payer?.insuranceType ?? ""] ?? (claim.payer?.insuranceType ? "OTHER" : "GROUP"),
    insuredId: ins?.memberId ?? "",
    patientName: `${patient.lastName}, ${patient.firstName}`,
    patientDob: patient.dob,
    patientSex: patient.sex,
    insuredName: self ? `${patient.lastName}, ${patient.firstName}` : `${ins?.insuredLastName ?? ""}, ${ins?.insuredFirstName ?? ""}`,
    patientAddress: patientAddr,
    relationship: ins?.relationshipToInsured ?? "18",
    insuredAddress: self
      ? patientAddr
      : { street: ins?.insuredAddressLine1 ?? "", city: ins?.insuredCity ?? "", state: ins?.insuredState ?? "", zip: ins?.insuredZip ?? "", phone: "" },
    insuredGroup: ins?.groupNumber ?? "",
    insuredDob: self ? patient.dob : (ins?.insuredDob ?? null),
    insuredSex: self ? patient.sex : (ins?.insuredSex ?? ""),
    planName: ins?.planName ?? "",
    employment: claim.employmentRelated,
    autoAccident: claim.autoAccident,
    autoAccidentState: claim.autoAccidentState ?? "",
    otherAccident: claim.otherAccident,
    hasOtherPlan: patient.insurances.some((i) => i.id !== ins?.id),
    onsetDate: claim.onsetDate,
    otherDate: claim.initialTreatmentDate,
    unableFrom: claim.unableToWorkFrom,
    unableTo: claim.unableToWorkTo,
    box17: box17 ? { qualifier: box17.qualifier, name: box17.p.name, npi: box17.p.npi ?? "" } : null,
    hospitalFrom: claim.hospitalFrom,
    hospitalTo: claim.hospitalTo,
    box19: claim.claimNote ?? "",
    outsideLab: claim.outsideLab,
    outsideLabCents: claim.outsideLabChargesCents,
    diagnoses: claim.diagnoses.map((d) => d.icd10),
    resubmissionCode: claim.frequencyCode === "1" ? "" : claim.frequencyCode,
    originalRef: claim.frequencyCode === "1" ? "" : (claim.originalReference ?? ""),
    priorAuth: claim.priorAuthNumber ?? claim.cliaNumber ?? "",
    lines: claim.lines.map((l) => ({
      from: l.dosFrom,
      to: l.dosTo,
      pos: l.placeOfService,
      emg: Boolean(settings?.includeEmergencyFlag) && l.emergency,
      cpt: l.cptCode,
      modifiers: (l.modifiers ?? "").split(",").filter(Boolean),
      pointers: l.pointers,
      chargeCents: l.chargeCents,
      units: l.units,
      renderingNpi,
      ndc: l.ndcCode ? `${l.ndcCode} ${l.ndcUnit ?? ""}${l.ndcQuantity ?? ""}`.trim() : null,
    })),
    taxId: (settings?.taxIdSource === "PRACTICE" && settings.practiceTaxId) || bp?.taxId || "",
    patientAccount: claim.patientAccountNumber ?? patient.mrn,
    acceptAssignment: claim.acceptAssignment,
    totalCents: claim.billedCents,
    paidCents: claim.paidCents,
    physicianName: [claim.renderingProvider?.name ?? claim.encounter.provider.name, claim.renderingProvider?.credential].filter(Boolean).join(", "),
    physicianSignature: decodeDataUrl(providerSig?.signatureImage),
    signedDate: providerSig?.signedAt ?? claim.createdAt,
    facility: facility
      ? {
          name: facility.name,
          street: facility.addressLine1 ?? "",
          cityStateZip: cityStateZip(facility.city, facility.state, facility.zip),
          npi: facility.npi ?? "",
        }
      : { name: "", street: "", cityStateZip: "", npi: "" },
    billing: payTo
      ? {
          name: payTo.name || bp?.name || "",
          street: [payTo.line1, payTo.line2].filter(Boolean).join(" "),
          cityStateZip: cityStateZip(payTo.city, payTo.state, payTo.zip),
          phone: settings?.billingPhone ?? bp?.phone ?? "",
          npi: bp?.npi ?? "",
        }
      : {
          name: bp?.name ?? "",
          street: bp?.addressLine1 ?? "",
          cityStateZip: cityStateZip(bp?.city, bp?.state, bp?.zip),
          phone: settings?.billingPhone ?? bp?.phone ?? "",
          npi: bp?.npi ?? "",
        },
  };

  const bytes = await renderCms1500(data, formImage);
  await logAudit(user.practiceId, user.id, "PRINT_CMS1500", "Claim", claim.id, formImage ? "form image" : "data only");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${claimNumber(claim)}-CMS1500.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
