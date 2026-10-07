import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import { WoundTrendChart } from "@/components/WoundTrendChart";
import { calcBmi, formatDate, formatMoney, formatTime, patientAccountStatusLabel, patientName } from "@/lib/format";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { etiologyLabel } from "@/lib/wound";
import { setGuarantorAccount } from "@/app/actions";
import { PatientFormsPanel } from "@/app/(app)/connect/patient-forms-panel";
import { CareGapsPanel } from "@/app/(app)/care-gaps/care-gaps-panel";
import { BalancePanel, GrowthPanel, ImmunizationsPanel, OrdersPanel, PatientTasksPanel, PrescriptionsPanel, RecallsPanel, RecordsPanel, ReferralsPanel } from "./chart-panels";
import { startIntake } from "@/app/(app)/gateway/actions";
import { PATIENT_VIEW_ROLES, authStatusLabel, canWorkTeam, careStatusLabel, eligibilityStatusLabel, intakeStageLabel } from "@/lib/gateway";
import { payerRankLabel } from "@/lib/claim-format";
import { SCAN_GROUPS } from "@/lib/patient-docs";
import { yesNoUnknownLabel } from "@/lib/patient-fields";
import { WIDGETS, parseWidgets, type WidgetKey } from "@/lib/patient-dashboard";
import { PatientShell, loadPatientShell } from "./patient-shell";
import { checkCoverageEligibility } from "./insurance/actions";

type ChartSearch = { merged?: string; rxOk?: string; rxError?: string; ccdaError?: string; ccdaApplied?: string };

function Widget({ k, count, more, children }: { k: WidgetKey; count?: string; more?: string; children: React.ReactNode }) {
  return (
    <section className="pd-widget" style={{ gridColumn: `span ${WIDGETS[k].span}` }}>
      <header>
        <h2>
          {WIDGETS[k].title} {count && <span className="muted">({count})</span>}
        </h2>
        {more && <Link href={more}>More »</Link>}
      </header>
      {children}
    </section>
  );
}

// Existing chart panels bring their own frame; they only need a place in the grid.
function Slot({ k, children }: { k: WidgetKey; children: React.ReactNode }) {
  return (
    <div className="pd-slot" style={{ gridColumn: `span ${WIDGETS[k].span}` }}>
      {children}
    </div>
  );
}

export default async function PatientDashboardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ChartSearch> }) {
  const user = await requireUser(PATIENT_VIEW_ROLES);
  const { id } = await params;
  const sp = await searchParams;
  const shell = await loadPatientShell(id, user);
  const patient = shell.patient;
  const widgets = parseWidgets(user.patientDashboard);
  const has = (k: WidgetKey) => widgets.includes(k);
  const back = `/patients/${id}`;

  const [insurances, checks, scans, scanCount, messages, activities, problems, allergies, medications, appointments, encounters, labOrders, wounds, intake, site, members, family, otherPatients] = await Promise.all([
    has("insurance") || has("authorizations")
      ? prisma.insurance.findMany({ where: { patientId: id, active: true }, include: { payer: true, authorizations: { orderBy: { endDate: "desc" } } }, orderBy: { rank: "asc" } })
      : [],
    has("insurance") ? prisma.eligibilityCheck.findMany({ where: { patientId: id, practiceId: user.practiceId }, orderBy: { checkedAt: "desc" }, take: 20 }) : [],
    has("scans") ? prisma.patientDocument.findMany({ where: { patientId: id, practiceId: user.practiceId }, orderBy: { createdAt: "desc" }, take: 5 }) : [],
    has("scans") ? prisma.patientDocument.count({ where: { patientId: id, practiceId: user.practiceId } }) : 0,
    has("communications") ? prisma.messageLog.findMany({ where: { patientId: id, practiceId: user.practiceId }, orderBy: { createdAt: "desc" }, take: 8 }) : [],
    has("communications")
      ? prisma.intakeActivity.findMany({ where: { case: { patientId: id, practiceId: user.practiceId }, note: { not: null } }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 8 })
      : [],
    has("diagnosis") ? prisma.problem.findMany({ where: { patientId: id } }) : [],
    has("medications") ? prisma.allergy.findMany({ where: { patientId: id } }) : [],
    has("medications") ? prisma.medication.findMany({ where: { patientId: id }, orderBy: { startDate: "desc" } }) : [],
    has("encounters") ? prisma.appointment.findMany({ where: { patientId: id }, include: { provider: true }, orderBy: { startsAt: "desc" }, take: 8 }) : [],
    has("encounters") || has("results") ? prisma.encounter.findMany({ where: { patientId: id }, include: { provider: true, vitals: true }, orderBy: { date: "desc" }, take: 8 }) : [],
    has("results") ? prisma.labOrder.findMany({ where: { patientId: id }, include: { result: true }, orderBy: { orderedAt: "desc" }, take: 8 }) : [],
    has("wounds") ? prisma.wound.findMany({ where: { patientId: id }, include: { assessments: { orderBy: { assessedAt: "asc" } } }, orderBy: { createdAt: "desc" } }) : [],
    has("gateway") ? prisma.intakeCase.findFirst({ where: { patientId: id, practiceId: user.practiceId }, orderBy: { createdAt: "desc" }, include: { payer: true, assignedProvider: true } }) : null,
    has("admissions") && patient.siteOfServiceId ? prisma.location.findFirst({ where: { id: patient.siteOfServiceId, practiceId: user.practiceId }, select: { name: true } }) : null,
    has("insurance") || has("communications") ? prisma.membership.findMany({ where: { practiceId: user.practiceId }, include: { user: { select: { id: true, name: true } } } }) : [],
    has("account") ? prisma.patient.findFirst({ where: { id }, select: { guarantorPatient: true, dependents: true } }) : null,
    has("account")
      ? prisma.patient.findMany({ where: { practiceId: user.practiceId, id: { not: id } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true, mrn: true } })
      : [],
  ]);
  const nameOf = (uid: string | null) => members.find((m) => m.user.id === uid)?.user.name ?? "";
  const log = [
    ...messages.map((m) => ({ at: m.createdAt, text: `${m.channel === "SMS" ? "Text" : "Email"} ${m.status === "SENT" ? "sent" : "failed"}: ${m.subject ?? m.body}`, by: nameOf(m.createdById) || "Automatic" })),
    ...activities.map((a) => ({ at: a.createdAt, text: a.note ?? a.action, by: a.user?.name ?? "System" })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 8);
  const auths = insurances.flatMap((i) => i.authorizations.map((a) => ({ ...a, payer: i.payer.name })));
  const withVitals = encounters.filter((e) => e.vitals);

  const render: Record<WidgetKey, () => React.ReactNode> = {
    insurance: () => (
      <Widget k="insurance" count={`${insurances.length ? 1 : 0}-${insurances.length} of ${insurances.length}`} more={`${back}/insurance`}>
        {insurances.length === 0 ? (
          <p className="muted">
            No insurance on file — self-pay. <Link href={`${back}/insurance?add=1`}>Add insurance payer</Link>
          </p>
        ) : (
          <div className="pd-ins">
            {insurances.map((i) => {
              const last = checks.find((c) => c.insuranceId === i.id || (!c.insuranceId && c.payerId === i.payerId));
              return (
                <div key={i.id} className="pd-ins-card">
                  <dl>
                    <dt>Payer</dt>
                    <dd>{i.payer.name}</dd>
                    <dt>Classification</dt>
                    <dd>{payerRankLabel[i.rank] ?? i.rank}</dd>
                    <dt>Policy number</dt>
                    <dd>{i.memberId === "PENDING" ? "" : i.memberId}</dd>
                    <dt>Group number</dt>
                    <dd>{i.groupNumber}</dd>
                    <dt>Copay</dt>
                    <dd>{i.copayCents !== null ? formatMoney(i.copayCents) : ""}</dd>
                    <dt>Authorization required</dt>
                    <dd>{yesNoUnknownLabel[i.authRequired ?? ""]}</dd>
                    <dt>Prior authorization required</dt>
                    <dd>{yesNoUnknownLabel[i.priorAuthRequired ?? ""]}</dd>
                  </dl>
                  <form action={checkCoverageEligibility.bind(null, id, i.id, "dashboard")}>
                    <button className="btn secondary gw-mini" type="submit">
                      Check eligibility
                    </button>
                    {last && (
                      <span className={`gw-tag gw-tag-${last.status === "ACTIVE" ? "ok" : last.status === "INACTIVE" ? "bad" : "warn"}`}>
                        {last.status === "ACTIVE" ? "✓ Active coverage" : (eligibilityStatusLabel[last.status] ?? last.status)}
                      </span>
                    )}
                  </form>
                  {last && (
                    <p className="muted pd-verified">
                      Verified {formatDate(last.checkedAt)} {formatTime(last.checkedAt)}
                      {nameOf(last.checkedById) ? ` by ${nameOf(last.checkedById)}` : ""}
                    </p>
                  )}
                </div>
              );
            })}
            {insurances.length === 1 && <p className="muted">No additional insurance information has been entered.</p>}
          </div>
        )}
      </Widget>
    ),
    scans: () => (
      <Widget k="scans" count={`${scans.length ? 1 : 0}-${scans.length} of ${scanCount}`} more={`${back}/scans`}>
        {scans.length === 0 ? (
          <p className="muted">
            No scans yet. <Link href={`${back}/scans?add=1`}>Add a scan</Link>
          </p>
        ) : (
          <table className="pd-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>File name</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{SCAN_GROUPS[s.docType] ?? SCAN_GROUPS.OTHER}</td>
                  <td>
                    <a href={`/api/files/patientdoc/${s.id}`} target="_blank" rel="noopener">
                      {s.name}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Widget>
    ),
    admissions: () => (
      <Widget k="admissions" count={patient.admissionDate ? "1 of 1" : undefined} more={can(user, "patients.edit") ? `${back}/edit` : undefined}>
        <table className="pd-table">
          <tbody>
            <tr>
              <th>Admission date</th>
              <td>{patient.admissionDate ? formatDate(patient.admissionDate) : "Not recorded"}</td>
            </tr>
            <tr>
              <th>Site of service</th>
              <td>{site?.name ?? ""}</td>
            </tr>
            <tr>
              <th>Palliative care</th>
              <td>{patient.palliativeCare ? "Yes" : "No"}</td>
            </tr>
            <tr>
              <th>Consult</th>
              <td>{patient.consult ? "Yes" : "No"}</td>
            </tr>
            <tr>
              <th>Status</th>
              <td>{patientAccountStatusLabel[patient.status] ?? patient.status}</td>
            </tr>
          </tbody>
        </table>
      </Widget>
    ),
    communications: () => (
      <Widget k="communications" count={log.length ? `1-${log.length}` : undefined} more={shell.caseId ? `/gateway/${shell.caseId}` : undefined}>
        {log.length === 0 ? (
          <p className="muted">No calls, messages or notes logged for this patient.</p>
        ) : (
          <table className="pd-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Communication log</th>
                <th>Added by</th>
              </tr>
            </thead>
            <tbody>
              {log.map((l, i) => (
                <tr key={i}>
                  <td>{formatDate(l.at)}</td>
                  <td>{l.text.length > 160 ? `${l.text.slice(0, 160)}…` : l.text}</td>
                  <td>{l.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Widget>
    ),
    diagnosis: () => (
      <Widget k="diagnosis">
        <table className="pd-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Diagnosis description</th>
              <th>Active date</th>
            </tr>
          </thead>
          <tbody>
            {problems.map((p) => (
              <tr key={p.id}>
                <td>{p.icd10}</td>
                <td>
                  {p.description} {p.status !== "ACTIVE" && <StatusBadge value={p.status} />}
                </td>
                <td>{p.onsetDate ? formatDate(p.onsetDate) : ""}</td>
              </tr>
            ))}
            {problems.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No active problems have been documented.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Widget>
    ),
    orders: () => (
      <Slot k="orders">
        <OrdersPanel patientId={id} role={user} />
      </Slot>
    ),
    medications: () => (
      <Widget k="medications">
        <table className="pd-table">
          <thead>
            <tr>
              <th>Medication</th>
              <th>Directions</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {medications.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.sig}</td>
                <td>
                  <StatusBadge value={m.status} />
                </td>
              </tr>
            ))}
            {medications.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No medications on file.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="pd-foot">
          <strong>Allergies:</strong> {allergies.length ? allergies.map((a) => `${a.allergen} (${a.reaction})`).join("; ") : "NKDA"}
        </p>
      </Widget>
    ),
    tasks: () => (
      <Slot k="tasks">
        <PatientTasksPanel patientId={id} />
      </Slot>
    ),
    results: () => (
      <Widget k="results">
        <table className="pd-table">
          <thead>
            <tr>
              <th>Test</th>
              <th>Result</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {labOrders.map((o) => (
              <tr key={o.id}>
                <td>{o.testName}</td>
                <td>
                  {o.result ? `${o.result.value} ${o.result.unit ?? ""}` : ""} {o.result && o.result.flag !== "NORMAL" && <StatusBadge value={o.result.flag} />}
                </td>
                <td>
                  <StatusBadge value={o.status} />
                </td>
              </tr>
            ))}
            {labOrders.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No test results on file.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {withVitals.length > 0 && (
          <table className="pd-table">
            <thead>
              <tr>
                <th>Vitals</th>
                <th>BP</th>
                <th>HR</th>
                <th>SpO2</th>
                <th>BMI</th>
              </tr>
            </thead>
            <tbody>
              {withVitals.map((e) => {
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
      </Widget>
    ),
    encounters: () => (
      <Widget k="encounters" more={`/schedule?patientId=${id}`}>
        <table className="pd-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Visit note</th>
            </tr>
          </thead>
          <tbody>
            {appointments.map((a) => {
              const visit = encounters.find((e) => e.appointmentId === a.id);
              return (
                <tr key={a.id}>
                  <td>
                    {formatDate(a.startsAt)} {formatTime(a.startsAt)}
                  </td>
                  <td>{a.provider.name}</td>
                  <td>
                    <StatusBadge value={a.status} />
                  </td>
                  <td>{visit ? <Link href={`/encounters/${visit.id}`}>Open</Link> : ""}</td>
                </tr>
              );
            })}
            {encounters
              .filter((e) => !appointments.some((a) => a.id === e.appointmentId))
              .map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.date)}</td>
                  <td>{e.provider.name}</td>
                  <td>
                    <StatusBadge value={e.status} />
                  </td>
                  <td>
                    <Link href={`/encounters/${e.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            {appointments.length === 0 && encounters.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No visits scheduled and no encounters yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Widget>
    ),
    wounds: () => (
      <Widget k="wounds">
        {wounds.length === 0 ? (
          <p className="muted">This graph appears once a wound assessment has been recorded for the patient.</p>
        ) : (
          <div className="pd-wounds">
            {wounds.map((w) => {
              const latest = w.assessments[w.assessments.length - 1];
              return (
                <div key={w.id}>
                  <p>
                    <strong>{w.label}</strong> <StatusBadge value={w.status} />
                    <span className="muted">
                      {" "}
                      {w.location} · {etiologyLabel[w.etiology] ?? w.etiology}
                      {latest?.areaCm2 ? ` · last area ${latest.areaCm2.toFixed(1)} cm²` : ""}
                    </span>
                  </p>
                  <WoundTrendChart points={w.assessments.map((a) => ({ date: a.assessedAt, areaCm2: a.areaCm2 }))} />
                </div>
              );
            })}
          </div>
        )}
      </Widget>
    ),
    authorizations: () => (
      <Widget k="authorizations" more={`${back}/insurance`}>
        {auths.length === 0 ? (
          <p className="muted">No authorizations on file.</p>
        ) : (
          <table className="pd-table">
            <thead>
              <tr>
                <th>Authorization</th>
                <th>Dates</th>
              </tr>
            </thead>
            <tbody>
              {auths.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.authNumber ?? a.reason}
                    <div className="muted">
                      {a.payer} · {a.kind === "PROCEDURE" ? `procedure ${a.procedureCode ?? ""}` : "encounters"}
                      {a.authorizedCount !== null ? ` × ${a.authorizedCount}` : ""}
                    </div>
                  </td>
                  <td>
                    {a.startDate ? formatDate(a.startDate) : ""} – {a.endDate ? formatDate(a.endDate) : ""}
                    {a.endDate && a.endDate.getTime() < Date.now() && <span className="gw-tag gw-tag-bad"> expired</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Widget>
    ),
    caregaps: () => (
      <Slot k="caregaps">
        <CareGapsPanel practiceId={user.practiceId} patientId={id} back={back} />
      </Slot>
    ),
    gateway: () => (
      <Widget k="gateway" more={intake ? `/gateway/${intake.id}` : undefined}>
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
            {intake.providerBrief && <p>{intake.providerBrief}</p>}
          </>
        ) : canWorkTeam(user.role, "DATA_ENTRY") ? (
          <form action={startIntake.bind(null, id)}>
            <p className="muted">No gateway case yet.</p>
            <button className="btn secondary gw-mini" type="submit">
              Start intake
            </button>
          </form>
        ) : (
          <p className="muted">No gateway case.</p>
        )}
      </Widget>
    ),
    forms: () => (
      <Slot k="forms">
        <PatientFormsPanel practiceId={user.practiceId} patientId={id} role={user} back={back} />
      </Slot>
    ),
    prescriptions: () => (
      <Slot k="prescriptions">
        <PrescriptionsPanel patientId={id} role={user} back={back} />
      </Slot>
    ),
    immunizations: () => (
      <Slot k="immunizations">
        <ImmunizationsPanel patientId={id} role={user} back={back} />
      </Slot>
    ),
    growth: () => (
      <Slot k="growth">
        <GrowthPanel patientId={id} />
      </Slot>
    ),
    referrals: () => (
      <Slot k="referrals">
        <ReferralsPanel patientId={id} role={user} />
      </Slot>
    ),
    recalls: () => (
      <Slot k="recalls">
        <RecallsPanel patientId={id} role={user} back={back} />
      </Slot>
    ),
    balance: () => (
      <Slot k="balance">
        <BalancePanel patientId={id} role={user} />
      </Slot>
    ),
    records: () => (
      <Slot k="records">
        <RecordsPanel patientId={id} role={user} sp={sp} />
      </Slot>
    ),
    account: () => (
      <Widget k="account" more={`${back}/statement`}>
        {family?.guarantorPatient ? (
          <p>
            Billed under <Link href={`/patients/${family.guarantorPatient.id}`}>{patientName(family.guarantorPatient)}</Link>&apos;s account.
          </p>
        ) : (
          <p className="muted">Billed under their own account.</p>
        )}
        {family && family.dependents.length > 0 && (
          <p className="muted">
            Dependents:{" "}
            {family.dependents.map((d, i) => (
              <span key={d.id}>
                {i ? ", " : ""}
                <Link href={`/patients/${d.id}`}>{patientName(d)}</Link>
              </span>
            ))}
          </p>
        )}
        <form action={setGuarantorAccount.bind(null, id)} className="cn-inline">
          <select name="guarantorPatientId" defaultValue={patient.guarantorPatientId ?? ""} aria-label="Guarantor account">
            <option value="">— Self (own account) —</option>
            {otherPatients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.lastName}, {p.firstName} ({p.mrn})
              </option>
            ))}
          </select>
          <button className="btn secondary gw-mini" type="submit">
            Update
          </button>
        </form>
      </Widget>
    ),
  };

  return (
    <PatientShell data={shell}>
      <div className="pd-head">
        <h1>Patient dashboard</h1>
        <Link className="btn secondary" href={`${back}/widgets`}>
          Add widgets
        </Link>
      </div>
      {sp.merged && <p className="notice-ok">Charts merged — moved {sp.merged}.</p>}
      {sp.rxOk && <p className="notice-ok">{sp.rxOk}</p>}
      {sp.rxError && (
        <p className="gw-error" role="alert">
          {sp.rxError}
        </p>
      )}
      {widgets.length === 0 ? (
        <section className="panel">
          <p className="muted">
            Your dashboard has no widgets. <Link href={`${back}/widgets`}>Add widgets</Link> to choose what you see when you open a patient.
          </p>
        </section>
      ) : (
        <div className="pd-grid">
          {widgets.map((k) => (
            <div key={k} className="pd-cell" style={{ display: "contents" }}>
              {render[k]()}
            </div>
          ))}
        </div>
      )}
    </PatientShell>
  );
}
