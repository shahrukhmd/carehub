import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PrintButton } from "@/components/PrintButton";
import {
  ageFromDob,
  employmentStatusLabel,
  ethnicityLabel,
  formatDate,
  maritalStatusLabel,
  patientAccountStatusLabel,
  patientName,
  raceLabel,
} from "@/lib/format";
import { PATIENT_VIEW_ROLES, referralSourceTypeLabel } from "@/lib/gateway";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="muted">{label}</span>
      <p>{value === null || value === undefined || value === "" ? "—" : value}</p>
    </div>
  );
}

// Patient demographic sheet ("face sheet") for referrals, payers and the chart.
export default async function FaceSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(PATIENT_VIEW_ROLES);
  const { id } = await params;
  const patient = await prisma.patient.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      practice: true,
      insurances: { include: { payer: true }, orderBy: { isPrimary: "desc" } },
      referringPhysician: true,
      guarantorPatient: true,
      intakeCases: { orderBy: { createdAt: "desc" }, take: 1, include: { assignedProvider: true } },
    },
  });
  if (!patient) notFound();
  await logAudit(user.practiceId, user.id, "patient.face_sheet_viewed", "Patient", patient.id);
  const intake = patient.intakeCases[0];

  return (
    <>
      <div className="page-head no-print">
        <div>
          <p className="muted">Patient output</p>
          <h1>Patient demographic sheet</h1>
        </div>
        <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
          <Link className="btn secondary" href={`/patients/${patient.id}`}>
            Back to patient
          </Link>
          <PrintButton />
        </div>
      </div>

      <section className="panel print-doc">
        <div className="print-header">
          <div>
            <strong className="print-brand">CareHub</strong>
            <p className="muted">{patient.practice.name}</p>
          </div>
          <div>
            <p className="muted">Patient demographic sheet</p>
            <p>Printed {formatDate(new Date())}</p>
          </div>
        </div>

        <div className="panel-section">
          <h3>Patient information</h3>
          <div className="print-meta">
            <Field label="Patient name" value={patientName(patient)} />
            <Field label="Medical record #" value={patient.mrn} />
            <Field label="Birth date / age" value={`${formatDate(patient.dob)} · ${ageFromDob(patient.dob)} yrs`} />
            <Field label="Sex" value={patient.sex} />
            <Field label="Race" value={patient.race ? (raceLabel[patient.race] ?? patient.race) : null} />
            <Field label="Ethnicity" value={patient.ethnicity ? (ethnicityLabel[patient.ethnicity] ?? patient.ethnicity) : null} />
            <Field
              label="Marital status"
              value={patient.maritalStatus ? (maritalStatusLabel[patient.maritalStatus] ?? patient.maritalStatus) : null}
            />
            <Field label="Language" value={patient.preferredLanguage} />
            <Field label="Account status" value={patientAccountStatusLabel[patient.status] ?? patient.status} />
            <Field
              label="Address"
              value={[patient.addressLine1, [patient.city, patient.state, patient.zip].filter(Boolean).join(" ")]
                .filter(Boolean)
                .join(", ")}
            />
            <Field label="Home phone" value={patient.phone} />
            <Field label="Email" value={patient.email} />
          </div>
        </div>

        <div className="panel-section">
          <h3>Employer</h3>
          <div className="print-meta">
            <Field
              label="Employment"
              value={patient.employmentStatus ? (employmentStatusLabel[patient.employmentStatus] ?? patient.employmentStatus) : null}
            />
          </div>
        </div>

        <div className="panel-section">
          <h3>Guarantor</h3>
          <div className="print-meta">
            <Field
              label="Name"
              value={patient.guarantorPatient ? patientName(patient.guarantorPatient) : (patient.guarantorName ?? "Self")}
            />
            <Field label="Relationship" value={patient.guarantorPatient ? "Account holder" : (patient.guarantorRelationship ?? "Self")} />
            <Field label="Phone" value={patient.guarantorPhone} />
          </div>
        </div>

        <div className="panel-section">
          <h3>Emergency contact</h3>
          <div className="print-meta">
            <Field label="Name" value={patient.emergencyContactName} />
            <Field label="Relationship" value={patient.emergencyContactRelationship} />
            <Field label="Phone" value={patient.emergencyContactPhone} />
          </div>
        </div>

        <div className="panel-section">
          <h3>Insurance</h3>
          {patient.insurances.length === 0 && <p className="muted">Self-pay — no insurance on file.</p>}
          {patient.insurances.map((i) => (
            <div key={i.id} className="print-meta">
              <Field label={i.isPrimary ? "Primary insurance" : "Secondary insurance"} value={i.payer.name} />
              <Field label="Policy / member #" value={i.memberId} />
              <Field label="Group #" value={i.groupNumber} />
              <Field label="Plan" value={i.planName} />
              <Field
                label="Payer address"
                value={[i.payer.addressLine1, [i.payer.city, i.payer.state, i.payer.zip].filter(Boolean).join(" ")]
                  .filter(Boolean)
                  .join(", ")}
              />
              <Field label="Payer ID" value={i.payer.payerCode} />
            </div>
          ))}
        </div>

        <div className="panel-section">
          <h3>Medical</h3>
          <div className="print-meta">
            <Field
              label="Referring physician"
              value={
                patient.referringPhysician
                  ? `${patient.referringPhysician.name}${patient.referringPhysician.npi ? ` · NPI ${patient.referringPhysician.npi}` : ""}`
                  : null
              }
            />
            <Field label="Rendering provider" value={intake?.assignedProvider?.name} />
            <Field label="PCP" value={intake?.pcpName} />
            <Field label="Referral source" value={intake?.referralSourceName} />
            <Field label="Source type" value={intake?.referralSourceType ? referralSourceTypeLabel[intake.referralSourceType] : null} />
            <Field label="Referral date" value={intake?.referralDate ? formatDate(intake.referralDate) : null} />
          </div>
          {intake?.servicesRequested && (
            <p>
              <strong>Services requested:</strong> {intake.servicesRequested}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
