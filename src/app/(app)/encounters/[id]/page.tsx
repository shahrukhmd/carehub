import Link from "next/link";
import { notFound } from "next/navigation";
import {
  cancelLabOrder,
  discontinueMedication,
  orderLab,
  prescribeMedication,
  resultLab,
  saveEncounter,
  saveVitals,
} from "@/app/actions";
import {
  placeHold,
  queryProvider,
  releaseHold,
  returnToCds,
  sendForSignature,
  signEncounter,
  submitToCds,
  updateCareTeam,
} from "../workflow-actions";
import {
  ENCOUNTER_VIEW_ROLES,
  CHART_STEPS,
  HOLD_STATUSES,
  SIGNED_STATUSES,
  isChartStep,
  type ChartStep,
  PROVIDER_ATTESTATION,
  SUPERVISOR_ATTESTATION,
  VISIT_STEPS,
  canEditClinical,
  canEditCoding,
  canHold,
  chartChecklist,
  gapsFor,
  isCdsRole,
  stepIndex,
  visitStatusLabel,
  visitStatusTone,
} from "@/lib/visit-workflow";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import { calcBmi, formatDate, formatMoney, patientName } from "@/lib/format";
import { requireUser } from "@/lib/auth";
import { claimNumber, claimStatusLabel, claimStatusTone, payerRankLabel, visitBillingStatusLabel } from "@/lib/claim-format";
import { createWound } from "@/app/(app)/wounds/actions";
import { etiologyLabel } from "@/lib/wound";
import {
  diagnosisPointerLetter,
  parsePointerIds,
  placeOfServiceLabel,
} from "@/lib/superbill";

export default async function EncounterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; step?: string }>;
}) {
  const user = await requireUser(ENCOUNTER_VIEW_ROLES);
  const { id } = await params;
  const { error, step: stepParam } = await searchParams;
  const encounter = await prisma.encounter.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      patient: {
        include: {
          allergies: true,
          problems: true,
          medications: { orderBy: { startDate: "desc" } },
          wounds: {
            include: { assessments: { orderBy: { assessedAt: "desc" }, take: 1 } },
            orderBy: { createdAt: "desc" },
          },
        },
      },
      provider: true,
      billingProvider: true,
      charges: { include: { claimLines: { select: { id: true } } } },
      claims: { orderBy: { createdAt: "asc" } },
      vitals: true,
      labOrders: { include: { result: true }, orderBy: { orderedAt: "desc" } },
      diagnoses: { orderBy: { priority: "asc" } },
      clinicalStaff: true,
      supervisingProvider: true,
      codedBy: true,
      signatures: { include: { user: true }, orderBy: { signedAt: "asc" } },
      events: { include: { user: true }, orderBy: { createdAt: "desc" } },
      woundAssessments: { select: { woundId: true } },
    },
  });

  if (!encounter) notFound();

  const [staffMembers, supervisors] = await Promise.all([
    prisma.membership.findMany({
      where: { practiceId: user.practiceId, role: { in: ["CLINICIAN", "FRONT_DESK", "ADMIN"] }, user: { active: true } },
      include: { user: true },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.renderingProvider.findMany({
      where: { practiceId: user.practiceId, isSupervising: true, status: "ACTIVE" },
      orderBy: { name: "asc" },
    }),
  ]);

  const status = encounter.status;
  const clinicalEditable = canEditClinical(status, user.role);
  const codingEditable = canEditCoding(status, user.role);
  const assessedWounds = new Set(encounter.woundAssessments.map((w) => w.woundId));
  const openWounds = encounter.patient.wounds.filter((w) => w.status !== "HEALED");
  const requiredRoles = encounter.supervisingProviderId ? ["PROVIDER", "SUPERVISOR"] : ["PROVIDER"];
  const checklist = chartChecklist({
    chiefComplaint: encounter.chiefComplaint,
    subjective: encounter.subjective,
    objective: encounter.objective,
    assessment: encounter.assessment,
    plan: encounter.plan,
    vitals: encounter.vitals,
    woundCount: openWounds.length,
    woundAssessedCount: openWounds.filter((w) => assessedWounds.has(w.id)).length,
    diagnosisCount: encounter.diagnoses.length,
    chargeCount: encounter.charges.length,
    chargesMissingPointers: encounter.charges.filter((c) => parsePointerIds(c.diagnosisPointers).length === 0).length,
    billingProviderId: encounter.billingProviderId,
    mdmLevel: encounter.mdmLevel,
    signatureCount: encounter.signatures.length,
    signaturesRequired: requiredRoles.length,
  });
  const providerGaps = gapsFor(checklist, "provider");
  const cdsGaps = gapsFor(checklist, "cds");
  const signedRoles = new Set(encounter.signatures.map((sig) => sig.role));
  const mySignatureRole =
    status === "READY_FOR_SIGNATURE"
      ? encounter.providerId === user.id && !signedRoles.has("PROVIDER")
        ? "PROVIDER"
        : encounter.supervisingProvider?.userId === user.id && !signedRoles.has("SUPERVISOR")
          ? "SUPERVISOR"
          : null
      : null;
  const isSigner = encounter.providerId === user.id || encounter.supervisingProvider?.userId === user.id;
  const mySignatureImage = mySignatureRole
    ? (await prisma.user.findUnique({ where: { id: user.id }, select: { signatureImage: true } }))?.signatureImage
    : null;
  const onHold = HOLD_STATUSES.includes(status);
  const current = stepIndex(status);

  const bmi = calcBmi(encounter.vitals?.heightCm ?? null, encounter.vitals?.weightKg ?? null);

  // Which section to show: the requested one, or where this person's work is.
  const done = new Map(checklist.map((c) => [c.key, c.done]));
  const stepDone: Record<string, boolean> = {
    cc: Boolean(done.get("cc")),
    vitals: Boolean(done.get("vitals")),
    wounds: Boolean(done.get("wounds")),
    exam: Boolean(done.get("exam")),
    assessment: Boolean(done.get("assessment")),
    meds: Boolean(done.get("meds")),
    superbill: Boolean(done.get("dx") && done.get("superbill")),
    signatures: Boolean(done.get("signatures")),
  };
  const defaultStep: ChartStep =
    status === "READY_FOR_SIGNATURE" || SIGNED_STATUSES.includes(status) || HOLD_STATUSES.includes(status)
      ? "signatures"
      : status === "READY_FOR_CDS"
        ? "superbill"
        : (CHART_STEPS.find((s) => !stepDone[s.key])?.key ?? "signatures");
  const step: ChartStep = isChartStep(stepParam) ? stepParam : defaultStep;
  const stepNo = step === "all" ? 0 : CHART_STEPS.findIndex((s) => s.key === step) + 1;
  const prevKey = stepNo > 1 ? CHART_STEPS[stepNo - 2].key : null;
  const nextKey = stepNo > 0 && stepNo < CHART_STEPS.length ? CHART_STEPS[stepNo].key : "";
  const show = (key: string) => step === "all" || step === key;
  const StepSave = () => (
    <div className="vw-step-actions">
      <button className="btn secondary" type="submit" name="next" value={step}>
        Save
      </button>
      {nextKey && (
        <button className="btn" type="submit" name="next" value={nextKey}>
          Save &amp; next ›
        </button>
      )}
    </div>
  );

  return (
    <div className="vw-layout">
      <aside className="vw-rail panel">
        <p className="vw-rail-title">Document workflow</p>
        <ol>
          {CHART_STEPS.map((s, i) => {
            const req = checklist.find((c) => (s.key === "superbill" ? c.key === "superbill" || c.key === "dx" : c.key === s.key) && c.required && !c.done);
            return (
              <li key={s.key} className={`${stepDone[s.key] ? "done" : ""}${step === s.key ? " current" : ""}`}>
                <Link href={`/encounters/${encounter.id}?step=${s.key}`}>
                  {i + 1}. {s.label}
                </Link>
                {req?.required === "provider" && <span className="vw-req">provider</span>}
                {req?.required === "cds" && <span className="vw-req">CDS</span>}
              </li>
            );
          })}
          <li className={step === "all" ? "current" : undefined}>
            <Link href={`/encounters/${encounter.id}?step=all`}>Full note (all sections)</Link>
          </li>
        </ol>
        <Link className="btn secondary vw-rail-btn" href={`/encounters/${encounter.id}/print`}>
          Print progress note
        </Link>
        <Link className="btn ghost vw-rail-btn" href="/encounters">
          « Visit worklist
        </Link>
      </aside>

      <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            {formatDate(encounter.date)} · {encounter.type} · DOB {formatDate(encounter.patient.dob)}
          </p>
          <h1>
            <Link href={`/patients/${encounter.patientId}`}>{patientName(encounter.patient)}</Link>{" "}
            <span className={`gw-tag gw-tag-${visitStatusTone(status)}`}>{visitStatusLabel[status] ?? status}</span>
          </h1>
        </div>
      </div>

      {error && (
        <p className="gw-error" role="alert">
          {error}
        </p>
      )}

      <ol className="gw-stepper vw-stepper">
        {VISIT_STEPS.map((step, i) => (
          <li key={step.key} className={i < current ? "done" : i === current && !onHold ? "current" : undefined}>
            <strong>{step.label}</strong>
            <span>{step.owner}</span>
          </li>
        ))}
      </ol>

      {/* ---------------- Care team ---------------- */}
      <form className="panel vw-careteam" action={updateCareTeam.bind(null, encounter.id)}>
        <fieldset disabled={!clinicalEditable} className="gw-fieldset vw-careteam-grid">
          <label>
            Physician / extender
            <input value={encounter.provider.name} disabled readOnly />
          </label>
          <label>
            Clinician (clinical staff)
            <select name="clinicalStaffId" defaultValue={encounter.clinicalStaffId ?? ""}>
              <option value="">—</option>
              {staffMembers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.user.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Supervising physician
            <select name="supervisingProviderId" defaultValue={encounter.supervisingProviderId ?? ""}>
              <option value="">— Not supervised —</option>
              {supervisors.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.credential ? `, ${p.credential}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Site of service
            <select name="placeOfService" defaultValue={encounter.placeOfService ?? ""}>
              <option value="">—</option>
              {Object.entries(placeOfServiceLabel).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {clinicalEditable && (
            <button className="btn secondary" type="submit">
              Save care team
            </button>
          )}
        </fieldset>
      </form>

      {/* ---------------- Hand-off for whoever owns the current stage ---------------- */}
      {status === "CDS_QUERY" && encounter.cdsQueryNote && (
        <section className="panel vw-query">
          <strong>CDS query — documentation incomplete</strong>
          <p>{encounter.cdsQueryNote}</p>
        </section>
      )}

      {["IN_PROGRESS", "CDS_QUERY"].includes(status) && clinicalEditable && (
        <section className="panel gw-handoff">
          <div>
            <strong>{status === "CDS_QUERY" ? "Answer the query and resubmit" : "Finalize documentation"}</strong>
            <p className="muted">
              {providerGaps.length ? `Still needed: ${providerGaps.join(", ")}` : "Documentation is complete — CDS reviews the record and builds the superbill next."}
            </p>
          </div>
          <form action={submitToCds.bind(null, encounter.id)}>
            <button className="btn" type="submit" disabled={providerGaps.length > 0}>
              {status === "CDS_QUERY" ? "Resubmit to CDS →" : "Send to CDS →"}
            </button>
          </form>
        </section>
      )}

      {status === "READY_FOR_CDS" && isCdsRole(user.role) && (
        <section className="panel gw-handoff">
          <div>
            <strong>CDS review</strong>
            <p className="muted">
              {cdsGaps.length ? `Superbill still needs: ${cdsGaps.join(", ")}` : "Superbill coded — send it to the provider for signature."}
            </p>
          </div>
          <form action={sendForSignature.bind(null, encounter.id)}>
            <button className="btn" type="submit" disabled={cdsGaps.length > 0}>
              Send for signature →
            </button>
          </form>
          <details className="gw-inline-form">
            <summary>Query provider (incomplete documentation)</summary>
            <form action={queryProvider.bind(null, encounter.id)}>
              <input name="note" required placeholder="What's missing or needs clarification?" />
              <button className="btn secondary" type="submit">
                Send query
              </button>
            </form>
          </details>
        </section>
      )}

      {status === "READY_FOR_SIGNATURE" && (
        <section className="panel gw-handoff vw-sign">
          <div>
            <strong>Signatures</strong>
            <p className="muted">
              Review the note and superbill below.{" "}
              {requiredRoles
                .map((r) => `${r === "PROVIDER" ? "Provider" : "Supervising physician"}: ${signedRoles.has(r) ? "signed" : "pending"}`)
                .join(" · ")}
            </p>
          </div>
          {mySignatureRole ? (
            <form action={signEncounter.bind(null, encounter.id)} className="vw-sign-form">
              {mySignatureImage ? (
                <div className="vw-signed">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mySignatureImage} alt="Your signature on file" className="sig-img" />
                  <span className="muted">
                    Your signature on file will be stamped on this record. <Link href="/settings/signature">Change</Link>
                  </span>
                </div>
              ) : (
                <p className="muted">
                  No signature image on file — the typed name is used. <Link href="/settings/signature">Add your signature</Link>
                </p>
              )}
              <label className="checkbox-inline">
                <input type="checkbox" name="attest" required />
                <span>{mySignatureRole === "PROVIDER" ? PROVIDER_ATTESTATION : SUPERVISOR_ATTESTATION}</span>
              </label>
              <div className="vw-sign-row">
                <input name="signedName" required placeholder="Type your full name to sign" defaultValue="" />
                <button className="btn" type="submit">
                  Sign {mySignatureRole === "SUPERVISOR" ? "as supervising physician" : "visit"}
                </button>
              </div>
            </form>
          ) : (
            <p className="muted">{isSigner ? "You've signed; waiting on the other signature." : "Waiting on the provider's signature."}</p>
          )}
          {isSigner && (
            <details className="gw-inline-form">
              <summary>Return to CDS</summary>
              <form action={returnToCds.bind(null, encounter.id)}>
                <input name="note" required placeholder="What should change on the superbill?" />
                <button className="btn secondary" type="submit">
                  Return
                </button>
              </form>
            </details>
          )}
        </section>
      )}

      {status === "READY_FOR_BILLING" && (
        <section className="panel gw-handoff">
          <div>
            <strong>Signed — ready for billing</strong>
            <p className="muted">Finalized {encounter.finalizedAt ? formatDate(encounter.finalizedAt) : ""}. Claims are submitted from Revenue cycle.</p>
          </div>
          {["ADMIN", "BILLER"].includes(user.role) && (
            <Link className="btn" href="/billing">
              Go to billing →
            </Link>
          )}
        </section>
      )}

      {onHold && (
        <section className="panel vw-query">
          <strong>{visitStatusLabel[status]}</strong>
          <p>{encounter.holdReason}</p>
          {canHold(user.role) && (
            <form action={releaseHold.bind(null, encounter.id)}>
              <button className="btn secondary" type="submit">
                Release hold
              </button>
            </form>
          )}
        </section>
      )}

      {!onHold && status !== "BILLED" && canHold(user.role) && (
        <details className="gw-inline-form">
          <summary>Place a hold (billing hold, audit, do not bill)</summary>
          <form action={placeHold.bind(null, encounter.id)}>
            <select name="kind" defaultValue="BILLING_HOLD">
              {HOLD_STATUSES.map((h) => (
                <option key={h} value={h}>
                  {visitStatusLabel[h]}
                </option>
              ))}
            </select>
            <input name="reason" required placeholder="Reason" />
            <button className="btn secondary" type="submit">
              Place hold
            </button>
          </form>
        </details>
      )}

      {/* ---------------- One section at a time ---------------- */}
      <section className="panel vw-step">
        <div className="gw-section-head">
          <h2>
            {step === "all" ? "Full note — all sections" : `${stepNo}. ${CHART_STEPS[stepNo - 1].label}`}
          </h2>
          <span className="muted">
            {step === "all" ? (
              <Link href={`/encounters/${encounter.id}?step=cc`}>Chart one section at a time</Link>
            ) : (
              <>
                Step {stepNo} of {CHART_STEPS.length} · <Link href={`/encounters/${encounter.id}?step=all`}>View full note</Link>
              </>
            )}
          </span>
        </div>

        {show("cc") && (
          <fieldset className="stack gw-fieldset" disabled={!clinicalEditable}>
            {step === "all" && <h3>Chief complaint / HPI</h3>}
            <form className="stack" action={saveEncounter.bind(null, encounter.id)}>
              <label>
                Chief complaint
                <input name="chiefComplaint" defaultValue={encounter.chiefComplaint ?? ""} />
              </label>
              <label>
                History of present illness (subjective)
                <textarea name="subjective" defaultValue={encounter.subjective ?? ""} className="vw-tall" />
              </label>
              {clinicalEditable && <StepSave />}
            </form>
          </fieldset>
        )}

        {show("vitals") && (
          <fieldset className="stack gw-fieldset" disabled={!clinicalEditable}>
            {step === "all" && <h3>Vital signs</h3>}
            {encounter.vitals && (
              <p className="chart-meta">
                <span>
                  BP {encounter.vitals.bpSystolic ?? "—"}/{encounter.vitals.bpDiastolic ?? "—"}
                </span>
                <span>HR {encounter.vitals.heartRate ?? "—"}</span>
                <span>RR {encounter.vitals.respRate ?? "—"}</span>
                <span>Temp {encounter.vitals.tempC ?? "—"}°C</span>
                <span>SpO2 {encounter.vitals.spo2 ?? "—"}%</span>
                <span>{bmi ? `BMI ${bmi.toFixed(1)}` : "BMI —"}</span>
              </p>
            )}
            <form className="stack" action={saveVitals.bind(null, encounter.id)}>
              <div className="form-grid gw-grid-3">
                <label>
                  Height (cm)
                  <input name="heightCm" type="number" step="0.1" defaultValue={encounter.vitals?.heightCm ?? ""} />
                </label>
                <label>
                  Weight (kg)
                  <input name="weightKg" type="number" step="0.1" defaultValue={encounter.vitals?.weightKg ?? ""} />
                </label>
                <label>
                  Temp (°C)
                  <input name="tempC" type="number" step="0.1" defaultValue={encounter.vitals?.tempC ?? ""} />
                </label>
                <label>
                  Heart rate
                  <input name="heartRate" type="number" defaultValue={encounter.vitals?.heartRate ?? ""} />
                </label>
                <label>
                  Resp. rate
                  <input name="respRate" type="number" defaultValue={encounter.vitals?.respRate ?? ""} />
                </label>
                <label>
                  SpO2 (%)
                  <input name="spo2" type="number" defaultValue={encounter.vitals?.spo2 ?? ""} />
                </label>
                <label>
                  BP systolic
                  <input name="bpSystolic" type="number" defaultValue={encounter.vitals?.bpSystolic ?? ""} />
                </label>
                <label>
                  BP diastolic
                  <input name="bpDiastolic" type="number" defaultValue={encounter.vitals?.bpDiastolic ?? ""} />
                </label>
              </div>
              {clinicalEditable && <StepSave />}
            </form>
          </fieldset>
        )}

        {show("wounds") && (
          <fieldset className="stack gw-fieldset" disabled={!clinicalEditable}>
            {step === "all" && <h3>Wound assessments</h3>}
            {encounter.patient.wounds.length === 0 && <p className="muted">No wounds on file.</p>}
            {encounter.patient.wounds.map((w) => {
              const latest = w.assessments[0];
              return (
                <div key={w.id} className="vw-wound">
                  <Link href={`/encounters/${encounter.id}/wounds/${w.id}`}>
                    <strong>{w.label}</strong>
                  </Link>{" "}
                  <StatusBadge value={w.status} />
                  {w.status !== "HEALED" && (
                    <span className={`gw-tag gw-tag-${assessedWounds.has(w.id) ? "ok" : "warn"}`}>
                      {assessedWounds.has(w.id) ? "Assessed this visit" : "Not assessed this visit"}
                    </span>
                  )}
                  <div className="muted">
                    {w.location} · {etiologyLabel[w.etiology] ?? w.etiology}
                    {latest?.areaCm2 ? ` · Last area ${latest.areaCm2.toFixed(1)} cm²` : ""}
                  </div>
                  {w.status !== "HEALED" && (
                    <Link className="btn secondary gw-mini" href={`/encounters/${encounter.id}/wounds/${w.id}`}>
                      {assessedWounds.has(w.id) ? "Review assessment" : "Assess wound"}
                    </Link>
                  )}
                </div>
              );
            })}
            {clinicalEditable && (
              <details className="gw-inline-form">
                <summary>Add a new wound</summary>
                <form className="form-grid gw-grid-3" action={createWound.bind(null, encounter.patientId, encounter.id)}>
                  <label>
                    Wound label
                    <input name="label" placeholder="Sacral pressure injury" required />
                  </label>
                  <label>
                    Location
                    <input name="location" placeholder="Sacrum" required />
                  </label>
                  <label>
                    Etiology
                    <select name="etiology" defaultValue="PRESSURE">
                      {Object.entries(etiologyLabel).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Onset date
                    <input name="onsetDate" type="date" />
                  </label>
                  <button className="btn secondary" type="submit">
                    Add wound
                  </button>
                </form>
              </details>
            )}
          </fieldset>
        )}

        {show("exam") && (
          <fieldset className="stack gw-fieldset" disabled={!clinicalEditable}>
            {step === "all" && <h3>Objective / physical exam</h3>}
            <form className="stack" action={saveEncounter.bind(null, encounter.id)}>
              <label>
                Objective findings / physical exam
                <textarea name="objective" defaultValue={encounter.objective ?? ""} className="vw-tall" />
              </label>
              {clinicalEditable && <StepSave />}
            </form>
          </fieldset>
        )}

        {show("assessment") && (
          <fieldset className="stack gw-fieldset" disabled={!clinicalEditable}>
            {step === "all" && <h3>Assessment &amp; plan of care</h3>}
            <p className="muted">
              Problems: {encounter.patient.problems.map((p) => `${p.icd10} ${p.description}`).join("; ") || "None on file"}
            </p>
            <form className="stack" action={saveEncounter.bind(null, encounter.id)}>
              <div className="soap-grid">
                <label>
                  Assessment
                  <textarea name="assessment" defaultValue={encounter.assessment ?? ""} className="vw-tall" />
                </label>
                <label>
                  Plan of care
                  <textarea name="plan" defaultValue={encounter.plan ?? ""} className="vw-tall" />
                </label>
              </div>
              {clinicalEditable && <StepSave />}
            </form>
          </fieldset>
        )}

        {show("meds") && (
          <fieldset className="stack gw-fieldset" disabled={!clinicalEditable}>
            {step === "all" && <h3>Medications, orders &amp; labs</h3>}
            <div className="two-col">
              <div>
                <h3>Safety</h3>
                <p>Allergies: {encounter.patient.allergies.map((a) => a.allergen).join(", ") || "NKDA"}</p>
                <h3>Medications</h3>
                {encounter.patient.medications.length === 0 && <p className="muted">No medications on file.</p>}
                <ul>
                  {encounter.patient.medications.map((m) => (
                    <li key={m.id}>
                      <strong>{m.name}</strong> — {m.sig} <StatusBadge value={m.status} />
                      {m.status === "ACTIVE" && clinicalEditable && (
                        <form action={discontinueMedication.bind(null, m.id, encounter.id)} style={{ display: "inline", marginLeft: "0.5rem" }}>
                          <button className="btn ghost gw-mini" type="submit">
                            Discontinue
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
                {clinicalEditable && (
                  <form className="form-grid" action={prescribeMedication.bind(null, encounter.patientId, encounter.id)}>
                    <label>
                      Medication
                      <input name="name" placeholder="Amoxicillin 500 mg" required />
                    </label>
                    <label>
                      Sig
                      <input name="sig" placeholder="1 cap PO TID x 7 days" required />
                    </label>
                    <button className="btn secondary" type="submit">
                      Prescribe
                    </button>
                  </form>
                )}
              </div>
              <div>
                <h3>Labs &amp; orders</h3>
                {encounter.labOrders.length === 0 && <p className="muted">No labs ordered this visit.</p>}
                {encounter.labOrders.map((order) => (
                  <div key={order.id} className="stack" style={{ marginBottom: "0.9rem" }}>
                    <p>
                      <strong>{order.testName}</strong> <StatusBadge value={order.status} />
                    </p>
                    {order.result ? (
                      <p className="muted">
                        Result: {order.result.value} {order.result.unit ?? ""}{" "}
                        {order.result.referenceRange ? `(ref ${order.result.referenceRange})` : ""} <StatusBadge value={order.result.flag} />
                      </p>
                    ) : order.status === "ORDERED" && clinicalEditable ? (
                      <form className="form-grid" action={resultLab.bind(null, order.id, encounter.id)}>
                        <label>
                          Result value
                          <input name="value" required />
                        </label>
                        <label>
                          Unit
                          <input name="unit" />
                        </label>
                        <label>
                          Reference range
                          <input name="referenceRange" />
                        </label>
                        <label>
                          Flag
                          <select name="flag" defaultValue="NORMAL">
                            <option value="NORMAL">Normal</option>
                            <option value="ABNORMAL">Abnormal</option>
                            <option value="CRITICAL">Critical</option>
                          </select>
                        </label>
                        <button className="btn secondary" type="submit">
                          Enter result
                        </button>
                        <button className="btn ghost" type="submit" formAction={cancelLabOrder.bind(null, order.id, encounter.id)}>
                          Cancel order
                        </button>
                      </form>
                    ) : null}
                  </div>
                ))}
                {clinicalEditable && (
                  <form className="form-grid" action={orderLab.bind(null, encounter.patientId, encounter.id)}>
                    <label>
                      Order a test
                      <input name="testName" placeholder="CBC, A1c, BMP..." required />
                    </label>
                    <button className="btn secondary" type="submit">
                      Order lab
                    </button>
                  </form>
                )}
              </div>
            </div>
          </fieldset>
        )}

        {show("superbill") && (
          <div className="stack">
            {step === "all" && <h3>Superbill</h3>}
            <div className="gw-section-head">
              <p className="muted" style={{ margin: 0 }}>
                {codingEditable
                  ? "Select diagnoses and procedures on the superbill."
                  : `Coding is worked by ${status === "READY_FOR_CDS" ? "CDS during review" : "the provider or CDS"} — view only.`}
              </p>
              <Link className="btn" href={`/encounters/${encounter.id}/superbill`}>
                {codingEditable ? "Open superbill →" : "View superbill →"}
              </Link>
            </div>
            <div className="two-col">
              <div>
                <h3>Diagnoses</h3>
                {encounter.diagnoses.length === 0 ? (
                  <p className="muted">None selected yet.</p>
                ) : (
                  <ol className="sb-summary">
                    {encounter.diagnoses.map((d, i) => (
                      <li key={d.id}>
                        <strong>{diagnosisPointerLetter(i)}</strong> <span className="cl-code">{d.icd10}</span> {d.description}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div>
                <h3>Procedures</h3>
                {encounter.charges.length === 0 ? (
                  <p className="muted">None selected yet.</p>
                ) : (
                  <table>
                    <tbody>
                      {encounter.charges.map((c) => {
                        const letters = parsePointerIds(c.diagnosisPointers)
                          .map((pid) => encounter.diagnoses.findIndex((d) => d.id === pid))
                          .filter((i) => i >= 0)
                          .map((i) => diagnosisPointerLetter(i));
                        return (
                          <tr key={c.id}>
                            <td className="cl-code">{c.cptCode}</td>
                            <td>
                              {c.description}
                              {c.modifiers ? <span className="muted"> · {c.modifiers}</span> : null}
                            </td>
                            <td>{letters.length ? letters.join(",") : <span className="gw-missing">no Dx</span>}</td>
                            <td>{formatMoney(c.amountCents)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {show("signatures") && (
          <div className="stack">
            {step === "all" && <h3>Attestation &amp; signatures</h3>}
            <table>
              <tbody>
                {requiredRoles.map((r) => {
                  const sig = encounter.signatures.find((x) => x.role === r);
                  const who = r === "PROVIDER" ? encounter.provider.name : (encounter.supervisingProvider?.name ?? "—");
                  return (
                    <tr key={r}>
                      <td>
                        <strong>{r === "PROVIDER" ? "Rendering provider" : "Supervising physician"}</strong>
                        <div className="muted">{who}</div>
                      </td>
                      <td>
                        {sig ? (
                          <div className="vw-signed">
                            {sig.signatureImage && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={sig.signatureImage} alt={`Signature of ${sig.signedName}`} className="sig-img" />
                            )}
                            <span>
                              <span className="gw-tag gw-tag-ok">Signed</span> {sig.signedName} · {formatDate(sig.signedAt)}
                            </span>
                          </div>
                        ) : (
                          <span className="gw-tag gw-tag-warn">Pending</span>
                        )}
                        {r === "SUPERVISOR" && encounter.supervisingProvider && !encounter.supervisingProvider.userId && (
                          <div className="gw-missing">No user linked to this supervising physician — link one in Directories to sign.</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {encounter.codedBy && (
              <p className="muted">
                Superbill coded by {encounter.codedBy.name}
                {encounter.codedAt ? ` on ${formatDate(encounter.codedAt)}` : ""}
              </p>
            )}
            {(encounter.claims.length > 0 || ["ADMIN", "BILLER"].includes(user.role)) && (
              <>
                <h3>Claims · {visitBillingStatusLabel[encounter.billingStatus] ?? encounter.billingStatus}</h3>
                {encounter.claims.length === 0 ? (
                  <p className="muted">
                    No claims yet.
                    {SIGNED_STATUSES.includes(status) && ["ADMIN", "BILLER"].includes(user.role) && (
                      <>
                        {" "}
                        <Link href="/billing?tab=visits&billing=READY_FOR_CLAIM">Create the claim from Revenue cycle</Link>.
                      </>
                    )}
                  </p>
                ) : (
                  <ul>
                    {encounter.claims.map((c) => (
                      <li key={c.id}>
                        {["ADMIN", "BILLER"].includes(user.role) ? <Link href={`/billing/claims/${c.id}`}>{claimNumber(c)}</Link> : claimNumber(c)} ·{" "}
                        {payerRankLabel[c.payerRank]} {c.payerName} ·{" "}
                        <span className={`gw-tag gw-tag-${claimStatusTone(c.status)}`}>{claimStatusLabel[c.status] ?? c.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <h3>Visit status history</h3>
            <ul className="gw-timeline">
              {encounter.events.map((ev) => (
                <li key={ev.id}>
                  <span className="muted">
                    {formatDate(ev.createdAt)} · {ev.user?.name ?? "System"} ·{" "}
                    {ev.fromStatus && ev.fromStatus !== ev.toStatus
                      ? `${visitStatusLabel[ev.fromStatus] ?? ev.fromStatus} → ${visitStatusLabel[ev.toStatus] ?? ev.toStatus}`
                      : (visitStatusLabel[ev.toStatus] ?? ev.toStatus)}
                  </span>
                  {ev.note && <div>{ev.note}</div>}
                </li>
              ))}
              {encounter.events.length === 0 && <li className="muted">No status changes yet.</li>}
            </ul>
          </div>
        )}

        {step !== "all" && (
          <nav className="vw-step-nav" aria-label="Chart sections">
            {prevKey ? (
              <Link className="btn secondary" href={`/encounters/${encounter.id}?step=${prevKey}`}>
                ‹ Previous
              </Link>
            ) : (
              <span />
            )}
            {nextKey && (
              <Link className="btn ghost" href={`/encounters/${encounter.id}?step=${nextKey}`}>
                {["cc", "vitals", "exam", "assessment"].includes(step) && clinicalEditable ? "Skip ›" : "Next ›"}
              </Link>
            )}
          </nav>
        )}
      </section>
      </div>
    </div>
  );
}
