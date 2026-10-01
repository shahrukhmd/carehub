import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PrintButton } from "@/components/PrintButton";
import { formatDate, formatMoney, patientName } from "@/lib/format";
import { PATIENT_VIEW_ROLES } from "@/lib/gateway";
import { payerRankLabel } from "@/lib/claim-format";
import { yesNoUnknownLabel } from "@/lib/patient-fields";

// Printable summary of the patient's active coverages and every authorization on file.
export default async function InsuranceAuthorizationReport({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser([...PATIENT_VIEW_ROLES, "BILLER"]);
  const { id } = await params;
  const patient = await prisma.patient.findFirst({
    where: { id, practiceId: user.practiceId },
    include: { practice: true, insurances: { where: { active: true }, include: { payer: true, authorizations: { orderBy: [{ kind: "asc" }, { startDate: "asc" }] } }, orderBy: { rank: "asc" } } },
  });
  if (!patient) notFound();
  await logAudit(user.practiceId, user.id, "patient.insurance_report_viewed", "Patient", patient.id);

  return (
    <>
      <div className="page-head no-print">
        <div>
          <p className="muted">Patient output</p>
          <h1>Insurance authorization report</h1>
        </div>
        <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
          <Link className="btn secondary" href={`/patients/${patient.id}/insurance`}>
            Back to insurance
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
            <p className="muted">Insurance authorization report</p>
            <p>Printed {formatDate(new Date())}</p>
          </div>
        </div>
        <p>
          <strong>{patientName(patient)}</strong> · {patient.mrn} · DOB {formatDate(patient.dob)}
        </p>
        {patient.insurances.length === 0 && <p className="muted">No active insurance on file.</p>}
        {patient.insurances.map((i) => (
          <div key={i.id} className="panel-section">
            <h3>
              {payerRankLabel[i.rank] ?? i.rank}: {i.payer.name}
            </h3>
            <p>
              Policy # {i.memberId}
              {i.groupNumber ? ` · Group # ${i.groupNumber}` : ""}
              {i.copayCents !== null ? ` · Copay ${formatMoney(i.copayCents)}` : ""}
              {i.authRequired ? ` · Authorization required: ${yesNoUnknownLabel[i.authRequired] ?? i.authRequired}` : ""}
              {i.priorAuthRequired ? ` · Prior authorization required: ${yesNoUnknownLabel[i.priorAuthRequired] ?? i.priorAuthRequired}` : ""}
            </p>
            {i.authorizations.length === 0 ? (
              <p className="muted">No authorizations on file.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Reason</th>
                    <th>Authorization #</th>
                    <th>Authorized</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Verified</th>
                    <th>Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {i.authorizations.map((a) => (
                    <tr key={a.id}>
                      <td>{a.kind === "PROCEDURE" ? `Procedure ${a.procedureCode ?? ""}` : "Encounter"}</td>
                      <td>{a.reason}</td>
                      <td>{a.authNumber}</td>
                      <td>{a.authorizedCount ?? ""}</td>
                      <td>{a.startDate ? formatDate(a.startDate) : ""}</td>
                      <td>{a.endDate ? formatDate(a.endDate) : ""}</td>
                      <td>
                        {a.verifiedAt ? formatDate(a.verifiedAt) : ""}
                        {a.verifiedBy ? ` · ${a.verifiedBy}` : ""}
                      </td>
                      <td>{a.insuranceContact}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
