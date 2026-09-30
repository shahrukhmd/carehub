import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import {
  ageFromDob,
  calcBmi,
  employmentStatusLabel,
  ethnicityLabel,
  formatDate,
  formatTime,
  maritalStatusLabel,
  patientAccountStatusLabel,
  patientName,
  raceLabel,
  smokingStatusLabel,
} from "@/lib/format";
import { requireUser } from "@/lib/auth";
import { etiologyLabel } from "@/lib/wound";
import { setGuarantorAccount, setPatientStatus } from "@/app/actions";
import { QuickActions } from "@/components/QuickActions";
import { PatientFormsPanel } from "@/app/(app)/connect/patient-forms-panel";
import { CareGapsPanel } from "@/app/(app)/care-gaps/care-gaps-panel";
import { ImmunizationsPanel, PrescriptionsPanel, RecallsPanel, RecordsPanel } from "./chart-panels";
import { startIntake } from "@/app/(app)/gateway/actions";
import {
  PATIENT_EDIT_ROLES,
  PATIENT_VIEW_ROLES,
  authStatusLabel,
  canWorkTeam,
  careStatusLabel,
  eligibilityStatusLabel,
  intakeStageLabel,
} from "@/lib/gateway";

type ChartSearch = { merged?: string; rxOk?: string; rxError?: string; ccdaError?: string; ccdaApplied?: string };

export default async function PatientChartPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ChartSearch> }) {
  const user = await requireUser(PATIENT_VIEW_ROLES);
  const { id } = await params;
  const sp = await searchParams;
  const patient = await prisma.patient.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      insurances: { include: { payer: true } },
      allergies: true,
      problems: true,
      medications: { orderBy: { startDate: "desc" } },
      appointments: { include: { provider: true }, orderBy: { startsAt: "desc" }, take: 8 },
      encounters: {
        include: { provider: true, vitals: true },
        orderBy: { date: "desc" },
        take: 8,
      },
      labOrders: {
        include: { result: true },
        orderBy: { orderedAt: "desc" },
        take: 8,
      },
      wounds: {
        include: { assessments: { orderBy: { assessedAt: "desc" }, take: 1 } },
        orderBy: { createdAt: "desc" },
      },
      referringPhysician: true,
      guarantorPatient: true,
      dependents: true,
      intakeCases: { orderBy: { createdAt: "desc" }, take: 1, include: { payer: true, assignedProvider: true } },
    },
  });

  if (!patient) notFound();
  const intake = patient.intakeCases[0];

  const otherPatients = await prisma.patient.findMany({
    where: { practiceId: user.practiceId, id: { not: patient.id } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, mrn: true },
  });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">{patient.mrn}</p>
          <h1>{patientName(patient)}</h1>
          <p className="chart-meta">
            <span>
              {ageFromDob(patient.dob)}y {patient.sex} · DOB {formatDate(patient.dob)}
            </span>
            <span>{patient.phone ?? "No phone"}</span>
            <span>{patient.insurances.find((i) => i.isPrimary)?.payer.name ?? "Self-pay"}</span>
            <StatusBadge value={patient.status} />
          </p>
        </div>
        <div className="stack" style={{ gridAutoFlow: "column", alignItems: "start", gap: "0.5rem" }}>
          <form
            action={setPatientStatus.bind(null, patient.id)}
            style={{ display: "flex", flexDirection: "row", gap: "0.4rem" }}
          >
            <select name="status" defaultValue={patient.status}>
              {Object.entries(patientAccountStatusLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button className="btn secondary" type="submit">
              Update status
            </button>
          </form>
          {PATIENT_EDIT_ROLES.includes(user.role) && (
            <Link className="btn secondary" href={`/patients/${patient.id}/edit`}>
              Edit patient
            </Link>
          )}
          <QuickActions
            patientId={patient.id}
            caseId={intake?.id}
            latestEncounterId={patient.encounters[0]?.id}
            canEdit={PATIENT_EDIT_ROLES.includes(user.role)}
            canSchedule={["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER"].includes(user.role)}
            canBill={["ADMIN", "BILLER", "FRONT_DESK"].includes(user.role)}
          />
        </div>
      </div>

      {sp.merged && <p className="notice-ok">Charts merged — moved {sp.merged}.</p>}
      {sp.rxOk && <p className="notice-ok">{sp.rxOk}</p>}
      {sp.rxError && (
        <p className="gw-error" role="alert">
          {sp.rxError}
        </p>
      )}

      <div className="two-col">
        <div className="stack">
          <CareGapsPanel practiceId={user.practiceId} patientId={patient.id} back={`/patients/${patient.id}`} />
          <section className="panel">
            <h2>Clinical summary</h2>
            <div className="panel-section">
              <h3>Problem list</h3>
              {patient.problems.length === 0 && <p className="muted">No active problems.</p>}
              <ul>
                {patient.problems.map((p) => (
                  <li key={p.id}>
                    <strong>{p.icd10}</strong> {p.description} <StatusBadge value={p.status} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel-section">
              <h3>Allergies</h3>
              {patient.allergies.length === 0 && <p className="muted">NKDA</p>}
              <ul>
                {patient.allergies.map((a) => (
                  <li key={a.id}>
                    {a.allergen} ({a.reaction}) <StatusBadge value={a.severity} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel-section">
              <h3>Medications</h3>
              {patient.medications.length === 0 && <p className="muted">No medications on file.</p>}
              <ul>
                {patient.medications.map((m) => (
                  <li key={m.id}>
                    <strong>{m.name}</strong> — {m.sig} <StatusBadge value={m.status} />
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel">
            <h2>Vitals, wounds &amp; labs</h2>
            <div className="panel-section">
              <h3>Vitals trend</h3>
              {patient.encounters.filter((e) => e.vitals).length === 0 && (
                <p className="muted">No vitals recorded yet.</p>
              )}
              {patient.encounters.filter((e) => e.vitals).length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>BP</th>
                      <th>HR</th>
                      <th>SpO2</th>
                      <th>BMI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patient.encounters
                      .filter((e) => e.vitals)
                      .map((e) => {
                        const bmi = calcBmi(e.vitals!.heightCm, e.vitals!.weightKg);
                        return (
                          <tr key={e.id}>
                            <td>{formatDate(e.date)}</td>
                            <td>
                              {e.vitals!.bpSystolic ?? "—"}/{e.vitals!.bpDiastolic ?? "—"}
                            </td>
                            <td>{e.vitals!.heartRate ?? "—"}</td>
                            <td>{e.vitals!.spo2 ?? "—"}</td>
                            <td>{bmi ? bmi.toFixed(1) : "—"}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="panel-section">
              <h3>Wounds</h3>
              {patient.wounds.length === 0 && <p className="muted">No wounds on file.</p>}
              <ul>
                {patient.wounds.map((w) => {
                  const latest = w.assessments[0];
                  const recentEncounterId = patient.encounters[0]?.id;
                  const label = (
                    <>
                      <strong>{w.label}</strong> <StatusBadge value={w.status} />
                      <div className="muted">
                        {w.location} · {etiologyLabel[w.etiology] ?? w.etiology}
                        {latest?.areaCm2 ? ` · Last area ${latest.areaCm2.toFixed(1)} cm²` : ""}
                      </div>
                    </>
                  );
                  return (
                    <li key={w.id}>
                      {recentEncounterId ? (
                        <Link href={`/encounters/${recentEncounterId}/wounds/${w.id}`}>{label}</Link>
                      ) : (
                        label
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="panel-section">
              <h3>Labs</h3>
              {patient.labOrders.length === 0 && <p className="muted">No labs ordered.</p>}
              <ul>
                {patient.labOrders.map((o) => (
                  <li key={o.id}>
                    <strong>{o.testName}</strong> <StatusBadge value={o.status} />
                    {o.result && (
                      <span className="muted">
                        {" "}
                        — {o.result.value} {o.result.unit ?? ""} <StatusBadge value={o.result.flag} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <PrescriptionsPanel patientId={patient.id} role={user.role} back={`/patients/${patient.id}`} />
          <ImmunizationsPanel patientId={patient.id} role={user.role} back={`/patients/${patient.id}`} />
        </div>
        <div className="stack">
          <section className="panel">
            <h2>Patient Gateway</h2>
            {intake ? (
              <>
                <p>
                  <Link href={`/gateway/${intake.id}`} className={`gw-stage gw-stage-${intake.stage.toLowerCase()}`}>
                    {intakeStageLabel[intake.stage]}
                  </Link>
                  {intake.careStatus ? ` · ${careStatusLabel[intake.careStatus]}` : ""}
                </p>
                <p className="muted">
                  {intake.payer?.name ?? "No payer"} · {eligibilityStatusLabel[intake.eligibilityStatus]}
                  {intake.verifiedAt ? ` (verified ${formatDate(intake.verifiedAt)})` : ""}
                </p>
                <p className="muted">
                  Prior auth: {authStatusLabel[intake.authStatus]}
                  {intake.authNumber ? ` #${intake.authNumber}` : ""}
                  {intake.authEndDate ? ` · thru ${formatDate(intake.authEndDate)}` : ""}
                </p>
                <p className="muted">Rendering provider: {intake.assignedProvider?.name ?? "not assigned"}</p>
                {intake.providerBrief && (
                  <p>
                    <span className="muted">Brief for the provider</span>
                    <br />
                    {intake.providerBrief}
                  </p>
                )}
              </>
            ) : canWorkTeam(user.role, "DATA_ENTRY") ? (
              <form action={startIntake.bind(null, patient.id)}>
                <p className="muted">No gateway case yet.</p>
                <button className="btn secondary" type="submit">
                  Start intake
                </button>
              </form>
            ) : (
              <p className="muted">No gateway case.</p>
            )}
          </section>
          <PatientFormsPanel practiceId={user.practiceId} patientId={patient.id} role={user.role} back={`/patients/${patient.id}`} />
          <RecallsPanel patientId={patient.id} role={user.role} back={`/patients/${patient.id}`} />
          <RecordsPanel patientId={patient.id} role={user.role} sp={sp} />
          <section className="panel">
            <h2>Patient info</h2>
            <div className="panel-section">
              <h3>Demographics</h3>
              <p className="muted">
                {patient.race ? raceLabel[patient.race] ?? patient.race : "Race not on file"} ·{" "}
                {patient.ethnicity ? ethnicityLabel[patient.ethnicity] ?? patient.ethnicity : "Ethnicity not on file"}
              </p>
              <p className="muted">
                {patient.maritalStatus
                  ? maritalStatusLabel[patient.maritalStatus] ?? patient.maritalStatus
                  : "Marital status not on file"}{" "}
                ·{" "}
                {patient.employmentStatus
                  ? employmentStatusLabel[patient.employmentStatus] ?? patient.employmentStatus
                  : "Employment not on file"}
              </p>
              <p className="muted">
                Smoking:{" "}
                {patient.smokingStatus ? smokingStatusLabel[patient.smokingStatus] ?? patient.smokingStatus : "Not on file"}
              </p>
              {patient.emergencyContactName && (
                <p>
                  <span className="muted">Emergency contact</span>
                  <br />
                  {patient.emergencyContactName}
                  {patient.emergencyContactRelationship ? ` (${patient.emergencyContactRelationship})` : ""}
                  {patient.emergencyContactPhone ? ` · ${patient.emergencyContactPhone}` : ""}
                </p>
              )}
              {patient.guarantorName && (
                <p>
                  <span className="muted">Guarantor</span>
                  <br />
                  {patient.guarantorName}
                  {patient.guarantorRelationship ? ` (${patient.guarantorRelationship})` : ""}
                  {patient.guarantorPhone ? ` · ${patient.guarantorPhone}` : ""}
                </p>
              )}
            </div>
            <div className="panel-section">
              <h3>Family / guarantor account</h3>
              {patient.guarantorPatient ? (
                <p>
                  Billed under{" "}
                  <Link href={`/patients/${patient.guarantorPatient.id}`}>
                    {patientName(patient.guarantorPatient)}
                  </Link>
                  &apos;s account.
                </p>
              ) : (
                <p className="muted">Billed under their own account.</p>
              )}
              {patient.dependents.length > 0 && (
                <>
                  <p className="muted">Dependents on this account:</p>
                  <ul>
                    {patient.dependents.map((d) => (
                      <li key={d.id}>
                        <Link href={`/patients/${d.id}`}>{patientName(d)}</Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <form
                action={setGuarantorAccount.bind(null, patient.id)}
                style={{ display: "flex", flexDirection: "row", gap: "0.4rem", marginTop: "0.6rem" }}
              >
                <select name="guarantorPatientId" defaultValue={patient.guarantorPatientId ?? ""}>
                  <option value="">— Self (own account) —</option>
                  {otherPatients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.lastName}, {p.firstName} ({p.mrn})
                    </option>
                  ))}
                </select>
                <button className="btn secondary" type="submit">
                  Update
                </button>
              </form>
            </div>
            <div className="panel-section">
              <h3>Coverage</h3>
              <p>
                <Link href={`/patients/${patient.id}/insurance`}>Manage insurance coverage</Link> ·{" "}
                <Link href={`/patients/${patient.id}/statement`}>View patient statement</Link>
              </p>
              {patient.insurances.map((i) => (
                <p key={i.id}>
                  {i.payer.name}
                  <br />
                  <span className="muted">
                    {i.planName} · {i.memberId}
                  </span>
                </p>
              ))}
              {patient.referringPhysician && (
                <p>
                  <span className="muted">Referred by</span>
                  <br />
                  {patient.referringPhysician.name}
                  {patient.referringPhysician.specialty ? ` · ${patient.referringPhysician.specialty}` : ""}
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <h2>Visit history</h2>
            <div className="panel-section">
              <h3>Upcoming &amp; recent visits</h3>
              {patient.appointments.length === 0 ? (
                <p className="muted">No visits scheduled.</p>
              ) : (
                <table>
                  <tbody>
                    {patient.appointments.map((a) => (
                      <tr key={a.id}>
                        <td>
                          {formatDate(a.startsAt)} {formatTime(a.startsAt)}
                        </td>
                        <td>{a.provider.name}</td>
                        <td>
                          <StatusBadge value={a.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="panel-section">
              <h3>Encounters</h3>
              {patient.encounters.length === 0 ? (
                <p className="muted">No encounters yet.</p>
              ) : (
                patient.encounters.map((e) => (
                  <p key={e.id}>
                    <Link href={`/encounters/${e.id}`}>
                      {formatDate(e.date)} · {e.provider.name}
                    </Link>
                  </p>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
