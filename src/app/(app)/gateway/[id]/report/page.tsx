import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { requireChartAccess } from "@/lib/privacy";
import { PrintButton } from "@/components/PrintButton";
import { formatDate, formatMoney, patientName, planSegmentLabel } from "@/lib/format";
import {
  CONSENTS,
  GATEWAY_ROLES,
  authStatusLabel,
  canSeeGatewayCase,
  careStatusLabel,
  eligibilityStatusLabel,
  intakeStageLabel,
  referralAppStatusLabel,
  referralSourceTypeLabel,
  referralStatusLabel,
  yesNoUnknownLabel,
} from "@/lib/gateway";
import { logAudit } from "@/lib/audit";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="muted">{label}</span>
      <p>{value === null || value === undefined || value === "" ? "—" : value}</p>
    </div>
  );
}

const date = (v: Date | null) => (v ? formatDate(v) : null);
const money = (v: number | null) => (v === null ? null : formatMoney(v));

export default async function AuthorizationReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(GATEWAY_ROLES);
  const { id } = await params;
  const c = await prisma.intakeCase.findFirst({
    where: { id, practiceId: user.practiceId },
    include: { patient: { include: { referringPhysician: true } }, payer: true, assignedProvider: true, practice: true },
  });
  // A team role sees the report only while the case is in its own team's stages.
  if (!c || !canSeeGatewayCase(user.role, c.stage)) notFound();
  await requireChartAccess(user, c.patientId, `/gateway/${c.id}/report`);
  await logAudit(user.practiceId, user.id, "intake.report_viewed", "IntakeCase", c.id);

  return (
    <>
      <div className="page-head no-print">
        <div>
          <p className="muted">Patient Gateway output</p>
          <h1>Patient authorization report</h1>
        </div>
        <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
          <Link className="btn secondary" href={`/gateway/${c.id}`}>
            Back to case
          </Link>
          <PrintButton />
        </div>
      </div>

      <section className="panel print-doc">
        <div className="print-header">
          <div>
            <strong className="print-brand">CareHub</strong>
            <p className="muted">{c.practice.name}</p>
          </div>
          <div>
            <p className="muted">Eligibility, benefits &amp; authorization</p>
            <p>Printed {formatDate(new Date())}</p>
          </div>
        </div>

        <div className="print-meta">
          <Field label="Patient" value={patientName(c.patient)} />
          <Field label="MRN" value={c.patient.mrn} />
          <Field label="Date of birth" value={formatDate(c.patient.dob)} />
          <Field label="Gateway stage" value={intakeStageLabel[c.stage]} />
          <Field label="Rendering provider" value={c.assignedProvider?.name} />
          <Field label="Referring physician" value={c.patient.referringPhysician?.name} />
        </div>

        <div className="panel-section">
          <h3>Referral</h3>
          <div className="print-meta">
            <Field label="Referral date" value={date(c.referralDate)} />
            <Field label="Source" value={c.referralSourceType ? referralSourceTypeLabel[c.referralSourceType] : null} />
            <Field label="Source name" value={c.referralSourceName} />
            <Field label="Contact" value={[c.referralContactName, c.referralContactPhone].filter(Boolean).join(" · ")} />
            <Field label="Services requested" value={c.servicesRequested} />
          </div>
        </div>

        <div className="panel-section">
          <h3>Eligibility &amp; benefits</h3>
          <div className="print-meta">
            <Field label="Payer" value={c.payer?.name} />
            <Field label="Plan segment" value={c.planSegment ? planSegmentLabel[c.planSegment] : null} />
            <Field label="Member ID" value={c.memberId} />
            <Field label="Eligibility" value={eligibilityStatusLabel[c.eligibilityStatus]} />
            <Field label="Coverage" value={[date(c.coverageEffectiveDate), date(c.coverageTermDate)].filter(Boolean).join(" – ")} />
            <Field label="Copay" value={money(c.copayCents)} />
            <Field label="Deductible / met" value={[money(c.deductibleCents), money(c.deductibleMetCents)].filter(Boolean).join(" / ")} />
            <Field label="Coinsurance" value={c.coinsurancePercent === null ? null : `${c.coinsurancePercent}%`} />
            <Field label="Out-of-pocket remaining" value={money(c.outOfPocketRemainingCents)} />
            <Field label="Verified" value={[date(c.verifiedAt), c.verifiedWith].filter(Boolean).join(" · ")} />
            <Field label="Reference #" value={c.verificationReference} />
          </div>
          {c.benefitsNotes && <p style={{ whiteSpace: "pre-wrap" }}>{c.benefitsNotes}</p>}
        </div>

        <div className="panel-section">
          <h3>Prior authorization</h3>
          <div className="print-meta">
            <Field label="Required" value={yesNoUnknownLabel[c.authRequired]} />
            <Field label="Status" value={authStatusLabel[c.authStatus]} />
            <Field label="Auth number" value={c.authNumber} />
            <Field label="Submitted" value={date(c.authSubmittedAt)} />
            <Field label="Valid" value={[date(c.authStartDate), date(c.authEndDate)].filter(Boolean).join(" – ")} />
            <Field label="Visits / units" value={c.authVisitsApproved} />
          </div>
          {c.authNotes && <p style={{ whiteSpace: "pre-wrap" }}>{c.authNotes}</p>}
        </div>

        <div className="panel-section">
          <h3>Referral (PCC) &amp; scheduling</h3>
          <div className="print-meta">
            <Field label="Referral required" value={yesNoUnknownLabel[c.referralRequired]} />
            <Field label="Referral status" value={referralStatusLabel[c.referralStatus]} />
            <Field label="Referral number" value={c.referralNumber} />
            <Field label="PCP" value={[c.pcpName, c.pcpPhone].filter(Boolean).join(" · ")} />
            <Field label="Referral application" value={referralAppStatusLabel[c.referralAppStatus]} />
            <Field label="Care status" value={c.careStatus ? careStatusLabel[c.careStatus] : null} />
            <Field label="Consents signed" value={CONSENTS.filter((x) => c[x.key]).map((x) => x.label).join(", ")} />
          </div>
          {c.networkOverrideNote && (
            <p>
              <strong>Network override:</strong> {c.networkOverrideNote}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
