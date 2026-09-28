import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { PrintButton } from "@/components/PrintButton";
import { formatDate, formatMoney, patientName } from "@/lib/format";
import { placeOfServiceLabel } from "@/lib/superbill";
import {
  DX_LETTERS,
  claimFrequencyLabel,
  claimNumber,
  claimStatusLabel,
  payerRankLabel,
  relationshipToInsuredLabel,
} from "@/lib/claim-format";

function Box({ n, label, children }: { n: string; label: string; children: React.ReactNode }) {
  return (
    <div className="cl-box">
      <span className="cl-box-label">
        {n}. {label}
      </span>
      <span className="cl-box-value">{children || "—"}</span>
    </div>
  );
}

const date = (v: Date | null | undefined) => (v ? formatDate(v) : "");

export default async function ClaimPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const { id } = await params;

  const claim = await prisma.claim.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      lines: { orderBy: { lineNumber: "asc" } },
      diagnoses: { orderBy: { sequence: "asc" } },
      insurance: true,
      payer: true,
      patient: true,
      billingProvider: true,
      renderingProvider: true,
      referringProvider: true,
      supervisingProvider: true,
      orderingProvider: true,
      serviceLocation: true,
    },
  });
  if (!claim) notFound();

  const { patient, insurance: ins, billingProvider: bp } = claim;
  const self = !ins || ins.relationshipToInsured === "18";
  const insuredName = self ? patientName(patient) : `${ins?.insuredLastName ?? ""}, ${ins?.insuredFirstName ?? ""}`;
  const box17 = claim.referringProvider
    ? { q: "DN", p: claim.referringProvider }
    : claim.supervisingProvider
      ? { q: "DQ", p: claim.supervisingProvider }
      : claim.orderingProvider
        ? { q: "DK", p: claim.orderingProvider }
        : null;
  const balance = claim.billedCents - claim.paidCents - claim.adjustedCents;

  return (
    <>
      <div className="page-head no-print">
        <div>
          <p className="muted">
            {claimNumber(claim)} · {claimStatusLabel[claim.status] ?? claim.status}
          </p>
          <h1>CMS-1500 claim form</h1>
        </div>
        <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
          <Link className="btn secondary" href={`/billing/claims/${claim.id}`}>
            Back to claim
          </Link>
          <PrintButton />
        </div>
      </div>

      <section className="panel print-doc cl-print">
        <div className="print-header">
          <div>
            <strong className="print-brand">HEALTH INSURANCE CLAIM FORM</strong>
            <p className="muted">Approved by NUCC 02/12 · data layout</p>
          </div>
          <div>
            <p>
              <strong>{claim.payerName}</strong>
            </p>
            <p className="muted">
              {claim.payer?.addressLine1 ?? ""} {claim.payer?.city ?? ""} {claim.payer?.state ?? ""} {claim.payer?.zip ?? ""}
            </p>
            <p className="muted">
              {payerRankLabel[claim.payerRank]} · Payer ID {claim.payer?.payerCode ?? "—"}
            </p>
          </div>
        </div>

        <h3>Patient &amp; insured (1–13)</h3>
        <div className="cl-box-grid">
          <Box n="1" label="Insurance type">{claim.payer?.insuranceType ?? ""}</Box>
          <Box n="1a" label="Insured's ID number">{ins?.memberId}</Box>
          <Box n="2" label="Patient's name">{patientName(patient)}</Box>
          <Box n="3" label="Patient's birth date / sex">
            {formatDate(patient.dob)} · {patient.sex}
          </Box>
          <Box n="4" label="Insured's name">{insuredName}</Box>
          <Box n="5" label="Patient's address">
            {[patient.addressLine1, patient.city, patient.state, patient.zip].filter(Boolean).join(", ")} {patient.phone ?? ""}
          </Box>
          <Box n="6" label="Patient relationship to insured">{relationshipToInsuredLabel[ins?.relationshipToInsured ?? "18"]}</Box>
          <Box n="7" label="Insured's address">
            {self
              ? [patient.addressLine1, patient.city, patient.state, patient.zip].filter(Boolean).join(", ")
              : [ins?.insuredAddressLine1, ins?.insuredCity, ins?.insuredState, ins?.insuredZip].filter(Boolean).join(", ")}
          </Box>
          <Box n="10a–c" label="Condition related to">
            {[claim.employmentRelated && "Employment", claim.autoAccident && `Auto accident (${claim.autoAccidentState ?? ""})`, claim.otherAccident && "Other accident"]
              .filter(Boolean)
              .join(", ") || "None"}
          </Box>
          <Box n="11" label="Insured's policy group">{ins?.groupNumber}</Box>
          <Box n="11a" label="Insured's DOB / sex">
            {self ? `${formatDate(patient.dob)} · ${patient.sex}` : `${date(ins?.insuredDob)} · ${ins?.insuredSex ?? ""}`}
          </Box>
          <Box n="11c" label="Insurance plan name">{ins?.planName}</Box>
          <Box n="12/13" label="Signatures">SIGNATURE ON FILE</Box>
        </div>

        <h3>Claim information (14–23)</h3>
        <div className="cl-box-grid">
          <Box n="14" label="Date of current illness">{date(claim.onsetDate)}</Box>
          <Box n="15" label="Other date">{date(claim.initialTreatmentDate)}</Box>
          <Box n="16" label="Unable to work">
            {claim.unableToWorkFrom ? `${date(claim.unableToWorkFrom)} – ${date(claim.unableToWorkTo)}` : ""}
          </Box>
          <Box n="17" label="Referring / other provider">
            {box17 ? `${box17.q} ${box17.p.name} · NPI ${box17.p.npi ?? "—"}` : ""}
          </Box>
          <Box n="18" label="Hospitalization dates">
            {claim.hospitalFrom ? `${date(claim.hospitalFrom)} – ${date(claim.hospitalTo)}` : ""}
          </Box>
          <Box n="19" label="Additional claim information">{claim.claimNote}</Box>
          <Box n="20" label="Outside lab / charges">
            {claim.outsideLab ? `Yes · ${formatMoney(claim.outsideLabChargesCents ?? 0)}` : "No"}
          </Box>
          <Box n="22" label="Resubmission code / original ref">
            {claim.frequencyCode !== "1" ? `${claimFrequencyLabel[claim.frequencyCode]} · ${claim.originalReference ?? ""}` : ""}
          </Box>
          <Box n="23" label="Prior authorization number">{claim.priorAuthNumber ?? claim.cliaNumber}</Box>
        </div>

        <h3>21 · Diagnosis codes (ICD-10, indicator 0)</h3>
        <div className="cl-dx-print">
          {DX_LETTERS.map((l, i) => (
            <span key={l}>
              <strong>{l}.</strong> {claim.diagnoses[i]?.icd10 ?? ""}
            </span>
          ))}
        </div>

        <h3>24 · Service lines</h3>
        <table>
          <thead>
            <tr>
              <th>DOS from</th>
              <th>DOS to</th>
              <th>POS</th>
              <th>EMG</th>
              <th>CPT/HCPCS</th>
              <th>Modifiers</th>
              <th>Dx ptr</th>
              <th>Charges</th>
              <th>Units</th>
              <th>Rendering NPI</th>
            </tr>
          </thead>
          <tbody>
            {claim.lines.map((l) => (
              <tr key={l.id}>
                <td>{formatDate(l.dosFrom)}</td>
                <td>{formatDate(l.dosTo)}</td>
                <td title={placeOfServiceLabel[l.placeOfService]}>{l.placeOfService}</td>
                <td>{l.emergency ? "Y" : ""}</td>
                <td>
                  {l.cptCode}
                  {l.ndcCode && <div className="muted">N4{l.ndcCode} {l.ndcUnit}{l.ndcQuantity ?? ""}</div>}
                </td>
                <td>{l.modifiers?.replaceAll(",", " ") ?? ""}</td>
                <td>{l.pointers.replaceAll(",", "")}</td>
                <td>{formatMoney(l.chargeCents)}</td>
                <td>{l.units}</td>
                <td>{claim.renderingProvider?.npi ?? bp?.npi ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Billing (25–33)</h3>
        <div className="cl-box-grid">
          <Box n="25" label="Federal tax ID (EIN)">{bp?.taxId}</Box>
          <Box n="26" label="Patient's account no.">{claim.patientAccountNumber}</Box>
          <Box n="27" label="Accept assignment">{claim.acceptAssignment ? "Yes" : "No"}</Box>
          <Box n="28" label="Total charge">{formatMoney(claim.billedCents)}</Box>
          <Box n="29" label="Amount paid">{formatMoney(claim.paidCents)}</Box>
          <Box n="—" label="Balance">{formatMoney(Math.max(balance, 0))}</Box>
          <Box n="31" label="Signature of physician">
            {claim.renderingProvider?.name ?? bp?.name} · {formatDate(claim.createdAt)}
          </Box>
          <Box n="32" label="Service facility">
            {claim.serviceLocation
              ? `${claim.serviceLocation.name}, ${[claim.serviceLocation.addressLine1, claim.serviceLocation.city, claim.serviceLocation.state, claim.serviceLocation.zip].filter(Boolean).join(", ")}${claim.serviceLocation.npi ? ` · NPI ${claim.serviceLocation.npi}` : ""}`
              : "Same as billing provider"}
          </Box>
          <Box n="33" label="Billing provider">
            {bp ? `${bp.name}, ${[bp.addressLine1, bp.city, bp.state, bp.zip].filter(Boolean).join(", ")} · NPI ${bp.npi ?? "—"}` : ""}
          </Box>
        </div>
      </section>
    </>
  );
}
