import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { PrintButton } from "@/components/PrintButton";
import { visitStatusLabel } from "@/lib/visit-workflow";
import { calcBmi, formatDate, formatMoney, patientName } from "@/lib/format";
import { diagnosisPointerLetter, mdmLevelLabel, parsePointerIds, patientStatusLabel } from "@/lib/superbill";

export default async function EncounterPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["ADMIN", "CLINICIAN", "BILLER", "FRONT_DESK", "CDS"]);
  const { id } = await params;

  const encounter = await prisma.encounter.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      patient: { include: { allergies: true, problems: true } },
      provider: true,
      billingProvider: true,
      practice: true,
      vitals: true,
      diagnoses: { orderBy: { priority: "asc" } },
      charges: true,
      woundAssessments: { include: { wound: true }, orderBy: { assessedAt: "desc" } },
      signatures: { include: { user: true }, orderBy: { signedAt: "asc" } },
    },
  });

  if (!encounter) notFound();

  const bmi = calcBmi(encounter.vitals?.heightCm ?? null, encounter.vitals?.weightKg ?? null);

  return (
    <>
      <div className="page-head no-print">
        <div>
          <p className="muted">Chart output</p>
          <h1>Progress note</h1>
        </div>
        <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
          <Link className="btn secondary" href={`/encounters/${encounter.id}`}>
            Back to chart
          </Link>
          <PrintButton />
        </div>
      </div>

      <section className="panel print-doc">
        <div className="print-header">
          <div>
            <strong className="print-brand">CareHub</strong>
            <p className="muted">{encounter.practice.name}</p>
          </div>
          <div>
            <p className="muted">Progress note</p>
            <p>{formatDate(encounter.date)}</p>
          </div>
        </div>

        <div className="print-meta">
          <div>
            <span className="muted">Patient name</span>
            <p>{patientName(encounter.patient)}</p>
          </div>
          <div>
            <span className="muted">Patient number</span>
            <p>{encounter.patient.mrn}</p>
          </div>
          <div>
            <span className="muted">Date of birth</span>
            <p>{formatDate(encounter.patient.dob)}</p>
          </div>
          <div>
            <span className="muted">Provider</span>
            <p>{encounter.provider.name}</p>
          </div>
          <div>
            <span className="muted">Billing provider</span>
            <p>{encounter.billingProvider?.name ?? "—"}</p>
          </div>
          <div>
            <span className="muted">Visit type</span>
            <p>{encounter.type}</p>
          </div>
        </div>

        <div className="panel-section">
          <h3>Subjective</h3>
          <p>
            <strong>Chief complaint:</strong> {encounter.chiefComplaint ?? "—"}
          </p>
          <p>
            <strong>Allergies:</strong>{" "}
            {encounter.patient.allergies.map((a) => a.allergen).join(", ") || "NKDA"}
          </p>
          <p>
            <strong>Problem list:</strong>{" "}
            {encounter.patient.problems.map((p) => `${p.icd10} ${p.description}`).join("; ") || "None"}
          </p>
          {encounter.subjective && <p style={{ whiteSpace: "pre-wrap" }}>{encounter.subjective}</p>}
        </div>

        <div className="panel-section">
          <h3>Objective</h3>
          {encounter.vitals ? (
            <p>
              Height {encounter.vitals.heightCm ?? "—"} cm, Weight {encounter.vitals.weightKg ?? "—"} kg
              {bmi ? `, BMI ${bmi.toFixed(1)}` : ""}, Temp {encounter.vitals.tempC ?? "—"}°C, Pulse{" "}
              {encounter.vitals.heartRate ?? "—"} bpm, Resp {encounter.vitals.respRate ?? "—"} /min, BP{" "}
              {encounter.vitals.bpSystolic ?? "—"}/{encounter.vitals.bpDiastolic ?? "—"} mmHg, SpO2{" "}
              {encounter.vitals.spo2 ?? "—"}%
            </p>
          ) : (
            <p className="muted">No vitals recorded.</p>
          )}
          {encounter.objective && <p style={{ whiteSpace: "pre-wrap" }}>{encounter.objective}</p>}
          {encounter.woundAssessments.length > 0 && (
            <>
              <p>
                <strong>Wound assessment(s):</strong>
              </p>
              <ul>
                {encounter.woundAssessments.map((a) => (
                  <li key={a.id}>
                    {a.wound.label} ({a.wound.location}): {a.lengthCm ?? "—"} x {a.widthCm ?? "—"} x{" "}
                    {a.depthCm ?? "—"} cm{a.areaCm2 ? `, area ${a.areaCm2.toFixed(1)} cm²` : ""}
                    {a.stage ? `, stage ${a.stage}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="panel-section">
          <h3>Assessment</h3>
          {encounter.diagnoses.length === 0 ? (
            <p className="muted">No diagnoses recorded.</p>
          ) : (
            <ul>
              {encounter.diagnoses.map((d, i) => (
                <li key={d.id}>
                  ({diagnosisPointerLetter(i)}) {d.icd10} — {d.description}
                </li>
              ))}
            </ul>
          )}
          {encounter.assessment && <p style={{ whiteSpace: "pre-wrap" }}>{encounter.assessment}</p>}
          <p className="muted">
            Patient status: {encounter.patientStatus ? patientStatusLabel[encounter.patientStatus] : "—"} · MDM:{" "}
            {encounter.mdmLevel ? mdmLevelLabel[encounter.mdmLevel] : "—"}
            {encounter.hospice ? " · Hospice" : ""}
          </p>
        </div>

        <div className="panel-section">
          <h3>Plan</h3>
          {encounter.plan && <p style={{ whiteSpace: "pre-wrap" }}>{encounter.plan}</p>}
          {encounter.charges.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>CPT</th>
                  <th>Description</th>
                  <th>Mod</th>
                  <th>Dx</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {encounter.charges.map((c) => {
                  const pointerIds = parsePointerIds(c.diagnosisPointers);
                  const letters = pointerIds
                    .map((pid) => {
                      const idx = encounter.diagnoses.findIndex((d) => d.id === pid);
                      return idx >= 0 ? diagnosisPointerLetter(idx) : null;
                    })
                    .filter(Boolean);
                  return (
                    <tr key={c.id}>
                      <td>{c.cptCode}</td>
                      <td>{c.description}</td>
                      <td>{c.modifiers ?? "—"}</td>
                      <td>{letters.length ? letters.join(", ") : "—"}</td>
                      <td>{formatMoney(c.amountCents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel-section">
          <h3>Electronic signature</h3>
          {encounter.signatures.length > 0 ? (
            encounter.signatures.map((sig) => (
              <div key={sig.id}>
                {sig.signatureImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sig.signatureImage} alt={`Signature of ${sig.signedName}`} className="sig-img sig-print" />
                )}
                <p>
                  <strong>{sig.role === "PROVIDER" ? "Rendering provider" : "Supervising physician"}:</strong>{" "}
                  Electronically signed by {sig.signedName} ({sig.user.name}) on {formatDate(sig.signedAt)}
                </p>
                <p className="muted">{sig.attestation}</p>
              </div>
            ))
          ) : (
            <p className="muted">Not yet signed — {visitStatusLabel[encounter.status] ?? encounter.status}.</p>
          )}
        </div>
      </section>
    </>
  );
}
