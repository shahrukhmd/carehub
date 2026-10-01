import Link from "next/link";
import { CareGapsPanel } from "@/app/(app)/care-gaps/care-gaps-panel";
import { visitTypeNames } from "@/lib/scheduler-setup";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { DocumentTemplate } from "@prisma/client";
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
  addProblem,
  removeAttachment,
  saveDocument,
  setEncounterWorkflow,
  setProblemStatus,
  signDocument,
  unsignDocument,
  uploadAttachment,
} from "../document-actions";
import {
  ENCOUNTER_VIEW_ROLES,
  HOLD_STATUSES,
  SIGNED_STATUSES,
  PROVIDER_ATTESTATION,
  SUPERVISOR_ATTESTATION,
  VISIT_STEPS,
  builtinDoneMap,
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
import {
  DOCUMENT_SECTIONS,
  WORKFLOW_SECTIONS,
  finalizeGaps,
  parseData,
  parseFields,
  stepStatus,
  type DocState,
} from "@/lib/chart-forms";
import { ensureChartSetup, resolveWorkflow, workflowSteps } from "@/lib/chart-setup";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import { DocumentFields, DocumentSummary } from "@/components/DocumentForm";
import { PanelToggle } from "@/components/SidebarNav";
import { calcBmi, formatDate, formatMoney, patientName } from "@/lib/format";
import { requireUser } from "@/lib/auth";
import { claimNumber, claimStatusLabel, claimStatusTone, payerRankLabel, visitBillingStatusLabel } from "@/lib/claim-format";
import { createWound } from "@/app/(app)/wounds/actions";
import { etiologyLabel } from "@/lib/wound";
import { diagnosisPointerLetter, parsePointerIds, placeOfServiceLabel } from "@/lib/superbill";

// Views reached from "Visit actions" rather than the document workflow.
const ACTION_VIEWS: Record<string, string> = {
  info: "Encounter info",
  results: "Test results",
  scans: "Scans & files",
  connections: "Connections",
  all: "Full note — all sections",
};

const DOC_ATTESTATION = "I attest that this document is accurate and complete and reflects care I provided or supervised.";

type Entry = {
  value: string; // "templateKey" or "templateKey.woundId"
  key: string;
  woundId?: string;
  label: string;
  done: boolean;
  required: boolean;
  critical: boolean;
  sub?: boolean;
};

export default async function EncounterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; step?: string; wound?: string }>;
}) {
  const user = await requireUser(ENCOUNTER_VIEW_ROLES);
  const vtNames = await visitTypeNames(user.practiceId);
  const { id } = await params;
  const { error, step: stepParam, wound: woundParam } = await searchParams;
  const encounter = await prisma.encounter.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      patient: {
        include: {
          allergies: true,
          problems: { orderBy: [{ status: "asc" }, { icd10: "asc" }] },
          medications: { orderBy: { startDate: "desc" } },
          wounds: {
            include: { assessments: { orderBy: { assessedAt: "desc" }, take: 3 } },
            orderBy: { createdAt: "asc" },
          },
          intakeCases: { select: { id: true, stage: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 3 },
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
      woundAssessments: true,
      appointment: { include: { location: true } },
      documents: { include: { template: true, completedBy: true, signedBy: true } },
      attachments: { include: { uploadedBy: true }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!encounter) notFound();

  await ensureChartSetup(user.practiceId);
  const [staffMembers, supervisors, templates, workflows, views, otherVisits, me, workflow] = await Promise.all([
    prisma.membership.findMany({
      where: { practiceId: user.practiceId, role: { in: ["CLINICIAN", "FRONT_DESK", "ADMIN"] }, user: { active: true } },
      include: { user: true },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.renderingProvider.findMany({
      where: { practiceId: user.practiceId, isSupervising: true, status: "ACTIVE" },
      orderBy: { name: "asc" },
    }),
    prisma.documentTemplate.findMany({ where: { practiceId: user.practiceId, active: true, audience: "STAFF" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.chartWorkflow.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    prisma.documentationView.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.encounter.findMany({
      where: { practiceId: user.practiceId, patientId: encounter.patientId, id: { not: encounter.id } },
      select: { id: true, date: true, status: true, provider: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 10,
    }),
    prisma.user.findUnique({ where: { id: user.id }, select: { signatureImage: true } }),
    resolveWorkflow(user.practiceId, encounter),
  ]);

  const status = encounter.status;
  const clinicalEditable = canEditClinical(status, user.role);
  const codingEditable = canEditCoding(status, user.role);
  const assessedWounds = new Set(encounter.woundAssessments.map((w) => w.woundId));
  const woundNo = new Map(encounter.patient.wounds.map((w, i) => [w.id, i + 1]));
  const openWounds = encounter.patient.wounds.filter((w) => w.status !== "HEALED");
  const openWoundIds = openWounds.map((w) => w.id);
  const woundTitle = (wid: string) => {
    const w = encounter.patient.wounds.find((x) => x.id === wid);
    return w ? `#${woundNo.get(w.id)} ${w.label}` : "Wound";
  };
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
  const cdsGaps = gapsFor(checklist, "cds");
  const builtinDone = builtinDoneMap(
    checklist,
    encounter.patient.problems.filter((p) => p.status === "ACTIVE").length
  );
  const docStates: DocState[] = encounter.documents.map((d) => ({
    templateKey: d.template.key,
    woundKey: d.woundKey,
    status: d.status,
    signedAt: d.signedAt,
  }));
  const steps = workflowSteps(workflow);
  const gaps = finalizeGaps(steps, docStates, builtinDone, openWoundIds);

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
  const mySignatureImage = me?.signatureImage ?? null;
  const onHold = HOLD_STATUSES.includes(status);
  const current = stepIndex(status);
  const bmi = calcBmi(encounter.vitals?.heightCm ?? null, encounter.vitals?.weightKg ?? null);

  // ---- Document workflow rail ----
  const bySection = WORKFLOW_SECTIONS.map((sec) => ({ sec, steps: steps.filter((s) => s.section === sec) })).filter((g) => g.steps.length);
  const entries: Entry[] = [];
  for (const g of bySection) {
    for (const s of g.steps) {
      const st = stepStatus(s, docStates, builtinDone, openWoundIds);
      if (s.perWound && s.kind === "FORM" && openWounds.length) {
        for (const w of openWounds) {
          entries.push({ value: `${s.key}.${w.id}`, key: s.key, woundId: w.id, label: woundTitle(w.id), done: st.woundsDone.has(w.id), required: s.required, critical: s.critical, sub: true });
        }
      } else {
        entries.push({ value: s.key, key: s.key, label: s.name, done: st.done, required: s.required, critical: s.critical });
      }
    }
  }
  const inWorkflow = new Set(steps.map((s) => s.key));
  const additional = templates.filter((t) => !inWorkflow.has(t.key));
  const templateByKey = new Map(templates.map((t) => [t.key, t]));

  const docDone = (t: DocumentTemplate) => {
    if (t.kind === "BUILTIN") return Boolean(builtinDone[t.key]);
    return encounter.documents.some((d) => d.templateId === t.id && d.status === "COMPLETE");
  };

  // Which view to show: requested, or where this person's work is.
  const defaultValue =
    status === "READY_FOR_SIGNATURE" || SIGNED_STATUSES.includes(status) || onHold
      ? "signatures"
      : status === "READY_FOR_CDS"
        ? "superbill"
        : (entries.find((e) => !e.done)?.value ?? entries[0]?.value ?? "cc");
  let view: string;
  let currentTemplate: DocumentTemplate | undefined;
  let currentWound: string | undefined;
  if (stepParam && stepParam in ACTION_VIEWS) {
    view = stepParam;
  } else if (stepParam && templateByKey.has(stepParam)) {
    view = stepParam;
    currentTemplate = templateByKey.get(stepParam);
    if (currentTemplate?.perWound && woundParam && openWoundIds.includes(woundParam)) currentWound = woundParam;
  } else {
    const [k, w] = defaultValue.split(".");
    view = k;
    currentTemplate = templateByKey.get(k);
    currentWound = w;
  }
  const currentValue = currentWound ? `${view}.${currentWound}` : view;
  const seqIndex = entries.findIndex((e) => e.value === currentValue);
  const prevEntry = seqIndex > 0 ? entries[seqIndex - 1] : null;
  const nextEntry = seqIndex >= 0 && seqIndex < entries.length - 1 ? entries[seqIndex + 1] : null;
  const hrefFor = (value: string) => {
    const [k, w] = value.split(".");
    return `/encounters/${encounter.id}?step=${k}${w ? `&wound=${w}` : ""}`;
  };
  const isAll = view === "all";
  const StepSave = ({ current: cur }: { current: string }) => (
    <div className="vw-step-actions">
      <button className="btn secondary" type="submit" name="next" value={isAll ? "all" : cur}>
        Save
      </button>
      {!isAll && nextEntry && cur === currentValue && (
        <button className="btn" type="submit" name="next" value={nextEntry.value}>
          Save &amp; next ›
        </button>
      )}
    </div>
  );

  // Critical documents that were started outside the workflow but aren't complete.
  const criticalOpen = [
    ...steps.filter((s) => s.critical && !stepStatus(s, docStates, builtinDone, openWoundIds).done).map((s) => s.name),
    ...additional
      .filter((t) => t.critical && t.kind === "FORM")
      .filter((t) => encounter.documents.some((d) => d.templateId === t.id) && !docDone(t))
      .map((t) => t.name),
  ];

  // ---------------- Built-in sections ----------------
  const renderBuiltin = (key: string) => {
    switch (key) {
      case "cc":
        return (
          <fieldset className="stack gw-fieldset" disabled={!clinicalEditable}>
            <form className="stack" action={saveEncounter.bind(null, encounter.id)}>
              <label>
                Chief complaint
                <input name="chiefComplaint" defaultValue={encounter.chiefComplaint ?? ""} />
              </label>
              <label>
                History of present illness (subjective)
                <textarea name="subjective" defaultValue={encounter.subjective ?? ""} className="vw-tall" />
              </label>
              {clinicalEditable && <StepSave current="cc" />}
            </form>
          </fieldset>
        );
      case "vitals":
        return (
          <fieldset className="stack gw-fieldset" disabled={!clinicalEditable}>
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
              {clinicalEditable && <StepSave current="vitals" />}
            </form>
          </fieldset>
        );
      case "wounds":
        return (
          <fieldset className="stack gw-fieldset" disabled={!clinicalEditable}>
            {encounter.patient.wounds.length === 0 && <p className="muted">No wounds on file.</p>}
            {encounter.patient.wounds
              .filter((w) => w.status !== "HEALED")
              .map((w) => {
                const latest = w.assessments[0];
                return (
                  <div key={w.id} className="vw-wound">
                    <Link href={`/encounters/${encounter.id}/wounds/${w.id}`}>
                      <strong>{woundTitle(w.id)}</strong>
                    </Link>{" "}
                    <StatusBadge value={w.status} />
                    <span className={`gw-tag gw-tag-${assessedWounds.has(w.id) ? "ok" : "warn"}`}>
                      {assessedWounds.has(w.id) ? "Assessed this visit" : "Not assessed this visit"}
                    </span>
                    <div className="muted">
                      {w.location} · {etiologyLabel[w.etiology] ?? w.etiology}
                      {latest?.areaCm2 ? ` · Last area ${latest.areaCm2.toFixed(1)} cm²` : ""}
                    </div>
                    <Link className="btn secondary gw-mini" href={`/encounters/${encounter.id}/wounds/${w.id}`}>
                      {assessedWounds.has(w.id) ? "Review assessment" : "Assess wound"}
                    </Link>
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
        );
      case "problems":
        return (
          <div className="stack">
            {encounter.patient.problems.length === 0 ? (
              <p className="muted">No problems on file.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>ICD-10</th>
                    <th>Problem</th>
                    <th>Onset</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {encounter.patient.problems.map((p) => (
                    <tr key={p.id}>
                      <td className="cl-code">{p.icd10}</td>
                      <td>{p.description}</td>
                      <td>{p.onsetDate ? formatDate(p.onsetDate) : "—"}</td>
                      <td>
                        {clinicalEditable ? (
                          <form action={setProblemStatus.bind(null, encounter.id, p.id)} className="vw-inline">
                            <select name="status" defaultValue={p.status} aria-label={`Status of ${p.description}`}>
                              <option value="ACTIVE">Active</option>
                              <option value="INACTIVE">Inactive</option>
                              <option value="RESOLVED">Resolved</option>
                            </select>
                            <button className="btn ghost gw-mini" type="submit">
                              Update
                            </button>
                          </form>
                        ) : (
                          <StatusBadge value={p.status} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {clinicalEditable && (
              <form className="form-grid gw-grid-3" action={addProblem.bind(null, encounter.id)}>
                <label>
                  ICD-10
                  <input name="icd10" placeholder="L89.154" required />
                </label>
                <label>
                  Description
                  <input name="description" placeholder="Pressure ulcer of sacral region, stage 4" required />
                </label>
                <label>
                  Onset date
                  <input name="onsetDate" type="date" />
                </label>
                <button className="btn secondary" type="submit">
                  Add problem
                </button>
              </form>
            )}
          </div>
        );
      case "exam":
        return (
          <fieldset className="stack gw-fieldset" disabled={!clinicalEditable}>
            <form className="stack" action={saveEncounter.bind(null, encounter.id)}>
              <label>
                Objective findings / physical exam
                <textarea name="objective" defaultValue={encounter.objective ?? ""} className="vw-tall" />
              </label>
              {clinicalEditable && <StepSave current="exam" />}
            </form>
          </fieldset>
        );
      case "assessment":
        return (
          <fieldset className="stack gw-fieldset" disabled={!clinicalEditable}>
            <p className="muted">
              Problems:{" "}
              {encounter.patient.problems
                .filter((p) => p.status === "ACTIVE")
                .map((p) => `${p.icd10} ${p.description}`)
                .join("; ") || "None on file"}
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
              {clinicalEditable && <StepSave current="assessment" />}
            </form>
          </fieldset>
        );
      case "meds":
        return (
          <fieldset className="stack gw-fieldset" disabled={!clinicalEditable}>
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
        );
      case "multiwound":
        return (
          <div className="stack">
            {openWounds.length === 0 ? (
              <p className="muted">No open wounds.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Wound</th>
                      <th>Etiology</th>
                      <th>This visit (L × W × D cm)</th>
                      <th>Area</th>
                      <th>Prior area</th>
                      <th>Change</th>
                      <th>Stage</th>
                      <th>Tissue (gran / slough / eschar)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openWounds.map((w) => {
                      const now = encounter.woundAssessments.find((a) => a.woundId === w.id);
                      const prior = w.assessments.find((a) => a.encounterId !== encounter.id);
                      const change =
                        now?.areaCm2 && prior?.areaCm2 ? Math.round(((now.areaCm2 - prior.areaCm2) / prior.areaCm2) * 100) : null;
                      return (
                        <tr key={w.id}>
                          <td>
                            <Link href={`/encounters/${encounter.id}/wounds/${w.id}`}>{woundTitle(w.id)}</Link>
                            <div className="muted">{w.location}</div>
                          </td>
                          <td>{etiologyLabel[w.etiology] ?? w.etiology}</td>
                          <td>{now ? `${now.lengthCm ?? "—"} × ${now.widthCm ?? "—"} × ${now.depthCm ?? "—"}` : <span className="gw-missing">not assessed</span>}</td>
                          <td>{now?.areaCm2 ? `${now.areaCm2.toFixed(1)} cm²` : "—"}</td>
                          <td>{prior?.areaCm2 ? `${prior.areaCm2.toFixed(1)} cm²` : "—"}</td>
                          <td>{change === null ? "—" : <span className={change <= 0 ? "vw-good" : "gw-missing"}>{change > 0 ? `+${change}` : change}%</span>}</td>
                          <td>{now?.stage ?? "—"}</td>
                          <td>{now ? `${now.granulationPct ?? 0} / ${now.sloughPct ?? 0} / ${now.escharPct ?? 0}%` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Link className="btn secondary" href={`/encounters/${encounter.id}/wound-analysis`}>
              Wound analysis (trends) →
            </Link>
          </div>
        );
      case "inactivewounds": {
        const inactive = encounter.patient.wounds.filter((w) => w.status === "HEALED" || w.status === "INACTIVE");
        return inactive.length === 0 ? (
          <p className="muted">No healed or inactive wounds.</p>
        ) : (
          <ul>
            {inactive.map((w) => (
              <li key={w.id}>
                <strong>{woundTitle(w.id)}</strong> — {w.location} · {etiologyLabel[w.etiology] ?? w.etiology} · <StatusBadge value={w.status} />
                {w.healedDate ? ` · healed ${formatDate(w.healedDate)}` : ""}
              </li>
            ))}
          </ul>
        );
      }
      case "progress": {
        const noteDocs = encounter.documents
          .filter((d) => d.template.inProgressNote && d.status === "COMPLETE")
          .sort((a, b) => a.template.noteOrder - b.template.noteOrder);
        return (
          <div className="stack">
            <p className="muted">
              The progress note compiles from the documents above. Choose a documentation view to print.
            </p>
            <div className="vw-note-preview">
              <p>
                <strong>Chief complaint:</strong> {encounter.chiefComplaint ?? "—"}
              </p>
              {encounter.subjective && <p className="pre">{encounter.subjective}</p>}
              {encounter.objective && (
                <p className="pre">
                  <strong>Exam:</strong> {encounter.objective}
                </p>
              )}
              {encounter.assessment && (
                <p className="pre">
                  <strong>Assessment:</strong> {encounter.assessment}
                </p>
              )}
              {encounter.plan && (
                <p className="pre">
                  <strong>Plan:</strong> {encounter.plan}
                </p>
              )}
              {noteDocs.map((d) => (
                <div key={d.id}>
                  <h4>
                    {d.template.name}
                    {d.woundKey ? ` — ${woundTitle(d.woundKey)}` : ""}
                  </h4>
                  <DocumentSummary fields={parseFields(d.template.fields)} values={parseData(d.data)} score={d.score} />
                </div>
              ))}
            </div>
            <div className="vw-view-links">
              {views.map((v) => (
                <Link key={v.id} className="btn secondary gw-mini" href={`/encounters/${encounter.id}/print?view=${v.id}`}>
                  {v.name}
                </Link>
              ))}
            </div>
          </div>
        );
      }
      case "superbill":
        return (
          <div className="stack">
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
        );
      case "signatures":
        return (
          <div className="stack">
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
        );
      default:
        return <p className="muted">This section isn&apos;t available.</p>;
    }
  };

  // ---------------- Designed forms ----------------
  const renderForm = (t: DocumentTemplate, woundId?: string) => {
    if (t.perWound && !woundId) {
      return (
        <div className="stack">
          <p className="muted">Completed for each open wound.</p>
          {openWounds.length === 0 && <p className="muted">No open wounds on this patient.</p>}
          <ul className="vw-pick">
            {openWounds.map((w) => {
              const d = encounter.documents.find((x) => x.templateId === t.id && x.woundKey === w.id);
              return (
                <li key={w.id}>
                  <Link href={hrefFor(`${t.key}.${w.id}`)}>{woundTitle(w.id)}</Link>{" "}
                  <span className={`gw-tag gw-tag-${d?.status === "COMPLETE" ? "ok" : d ? "warn" : "muted"}`}>
                    {d?.status === "COMPLETE" ? (d.signedAt ? "Signed" : "Complete") : d ? "Draft" : "Not started"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }
    const fields = parseFields(t.fields);
    const doc = encounter.documents.find((d) => d.templateId === t.id && d.woundKey === (woundId ?? ""));
    const values = parseData(doc?.data);
    const locked = !clinicalEditable || Boolean(doc?.signedAt);
    const value = woundId ? `${t.key}.${woundId}` : t.key;
    const back = isAll ? "all" : value;
    return (
      <div className="stack">
        <p className="vw-doc-status">
          <span className={`gw-tag gw-tag-${doc?.status === "COMPLETE" ? "ok" : doc ? "warn" : "muted"}`}>
            {doc?.status === "COMPLETE" ? "Complete" : doc ? "Draft" : "Not started"}
          </span>
          {doc?.completedBy && (
            <span className="muted">
              Completed by {doc.completedBy.name}
              {doc.completedAt ? ` · ${formatDate(doc.completedAt)}` : ""}
            </span>
          )}
          {t.signatureRequired && <span className="gw-tag gw-tag-info">Signature required</span>}
          {t.critical && <span className="gw-tag gw-tag-bad">Critical document</span>}
        </p>
        {fields.length === 0 ? (
          <p className="muted">
            This template has no fields yet.{" "}
            {user.role === "ADMIN" && <Link href={`/settings/documentation/templates/${t.id}`}>Design it</Link>}
          </p>
        ) : (
          <form className="stack" action={saveDocument.bind(null, encounter.id, t.id, woundId ?? "")}>
            <input type="hidden" name="back" value={back} />
            <fieldset className="gw-fieldset stack" disabled={locked}>
              <DocumentFields fields={fields} values={values} idPrefix={value.replace(".", "-")} />
            </fieldset>
            {!locked && <StepSave current={value} />}
          </form>
        )}
        {t.signatureRequired && (
          <div className="vw-doc-sign">
            {doc?.signedAt ? (
              <div className="vw-signed">
                {doc.signatureImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={doc.signatureImage} alt={`Signature of ${doc.signedName}`} className="sig-img" />
                )}
                <span>
                  <span className="gw-tag gw-tag-ok">Signed</span> {doc.signedName} · {formatDate(doc.signedAt)}
                </span>
                {clinicalEditable && (doc.signedById === user.id || user.role === "ADMIN") && (
                  <form action={unsignDocument.bind(null, encounter.id, doc.id)}>
                    <input type="hidden" name="back" value={back} />
                    <button className="btn ghost gw-mini" type="submit">
                      Remove signature to edit
                    </button>
                  </form>
                )}
              </div>
            ) : doc?.status === "COMPLETE" && clinicalEditable ? (
              <form className="vw-sign-form" action={signDocument.bind(null, encounter.id, doc.id)}>
                <input type="hidden" name="back" value={back} />
                {mySignatureImage ? (
                  <div className="vw-signed">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mySignatureImage} alt="Your signature on file" className="sig-img" />
                    <span className="muted">Your signature on file will be stamped on this document.</span>
                  </div>
                ) : (
                  <p className="muted">
                    No signature image on file — the typed name is used. <Link href="/settings/signature">Add your signature</Link>
                  </p>
                )}
                <label className="checkbox-inline">
                  <input type="checkbox" name="attest" required />
                  <span>{DOC_ATTESTATION}</span>
                </label>
                <div className="vw-sign-row">
                  <input name="signedName" required placeholder="Type your full name to sign" />
                  <button className="btn" type="submit">
                    Sign document
                  </button>
                </div>
              </form>
            ) : (
              <p className="muted">This document must be signed once it&apos;s complete.</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderTemplate = (t: DocumentTemplate, woundId?: string) => (t.kind === "BUILTIN" ? renderBuiltin(t.builtin ?? t.key) : renderForm(t, woundId));

  // ---------------- Visit action views ----------------
  const attachmentList = (cats: string[]) => {
    const list = encounter.attachments.filter((a) => cats.includes(a.category));
    return list.length === 0 ? (
      <p className="muted">No files yet.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Type</th>
            <th>Uploaded</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id}>
              <td>
                <a href={`/api/files/attachment/${a.id}`} target="_blank" rel="noreferrer">
                  {a.title}
                </a>
                <div className="muted">{a.fileName}</div>
              </td>
              <td>{a.category.replace("_", " ").toLowerCase()}</td>
              <td>
                {formatDate(a.createdAt)}
                <div className="muted">{a.uploadedBy?.name ?? ""}</div>
              </td>
              <td>
                {(a.uploadedById === user.id || user.role === "ADMIN") && (
                  <form action={removeAttachment.bind(null, encounter.id, a.id)}>
                    <input type="hidden" name="back" value={view} />
                    <button className="btn ghost gw-mini" type="submit">
                      Remove
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };
  const uploadForm = (categories: [string, string][]) => (
    <form className="form-grid gw-grid-3" action={uploadAttachment.bind(null, encounter.id)}>
      <input type="hidden" name="back" value={view} />
      <label>
        Title
        <input name="title" placeholder="e.g. Arterial duplex report" />
      </label>
      <label>
        Type
        <select name="category" defaultValue={categories[0][0]}>
          {categories.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        File (PDF, PNG, JPG, DOC — up to 10 MB)
        <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" required />
      </label>
      <button className="btn secondary" type="submit">
        Upload
      </button>
    </form>
  );

  const renderActionView = (key: string) => {
    switch (key) {
      case "info":
        return (
          <dl className="vw-info">
            <div>
              <dt>Date of service</dt>
              <dd>{formatDate(encounter.date)}</dd>
            </div>
            <div>
              <dt>Visit type</dt>
              <dd>{encounter.appointment ? (vtNames[encounter.appointment.visitType] ?? encounter.appointment.visitType) : encounter.type}</dd>
            </div>
            <div>
              <dt>Chart workflow</dt>
              <dd>{workflow?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{visitStatusLabel[status] ?? status}</dd>
            </div>
            <div>
              <dt>Billing status</dt>
              <dd>{visitBillingStatusLabel[encounter.billingStatus] ?? encounter.billingStatus}</dd>
            </div>
            <div>
              <dt>Physician / extender</dt>
              <dd>{encounter.provider.name}</dd>
            </div>
            <div>
              <dt>Supervising physician</dt>
              <dd>{encounter.supervisingProvider?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Clinician</dt>
              <dd>{encounter.clinicalStaff?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Site of service</dt>
              <dd>{encounter.placeOfService ? (placeOfServiceLabel[encounter.placeOfService] ?? encounter.placeOfService) : "—"}</dd>
            </div>
            <div>
              <dt>Location / room</dt>
              <dd>
                {encounter.appointment?.location.name ?? "—"}
                {encounter.appointment?.room ? ` · Room ${encounter.appointment.room}` : ""}
              </dd>
            </div>
            <div>
              <dt>Billing provider</dt>
              <dd>{encounter.billingProvider?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Visit started</dt>
              <dd>{formatDate(encounter.createdAt)}</dd>
            </div>
          </dl>
        );
      case "results":
        return (
          <div className="stack">
            <h3>Lab results</h3>
            {encounter.labOrders.length === 0 ? (
              <p className="muted">
                No labs ordered this visit. Order labs in <Link href={hrefFor("meds")}>Medications, Orders &amp; Labs</Link>.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Result</th>
                    <th>Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {encounter.labOrders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        {o.testName} <StatusBadge value={o.status} />
                      </td>
                      <td>{o.result ? `${o.result.value} ${o.result.unit ?? ""} ${o.result.referenceRange ? `(ref ${o.result.referenceRange})` : ""}` : "Pending"}</td>
                      <td>{o.result ? <StatusBadge value={o.result.flag} /> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h3>Test result files</h3>
            {attachmentList(["TEST_RESULT"])}
            {uploadForm([["TEST_RESULT", "Test result"]])}
          </div>
        );
      case "scans":
        return (
          <div className="stack">
            {attachmentList(["SCAN", "PHOTO", "OTHER"])}
            {uploadForm([
              ["SCAN", "Scanned document"],
              ["PHOTO", "Photo"],
              ["OTHER", "Other"],
            ])}
          </div>
        );
      case "connections":
        return (
          <div className="two-col">
            <div>
              <h3>Scheduling</h3>
              {encounter.appointment ? (
                <p>
                  <Link href={`/schedule?date=${encounter.appointment.startsAt.toISOString().slice(0, 10)}`}>Appointment</Link>{" "}
                  {formatDate(encounter.appointment.startsAt)} · {encounter.appointment.location.name}
                  {encounter.appointment.seriesId ? " · recurring series" : ""}
                </p>
              ) : (
                <p className="muted">Started without an appointment.</p>
              )}
              <h3>Patient Gateway</h3>
              {encounter.patient.intakeCases.length === 0 ? (
                <p className="muted">No intake case.</p>
              ) : (
                <ul>
                  {encounter.patient.intakeCases.map((c) => (
                    <li key={c.id}>
                      <Link href={`/gateway/${c.id}`}>Intake case</Link> · {c.stage.replaceAll("_", " ").toLowerCase()} · {formatDate(c.createdAt)}
                    </li>
                  ))}
                </ul>
              )}
              <h3>Claims</h3>
              {encounter.claims.length === 0 ? (
                <p className="muted">No claims.</p>
              ) : (
                <ul>
                  {encounter.claims.map((c) => (
                    <li key={c.id}>
                      {["ADMIN", "BILLER"].includes(user.role) ? <Link href={`/billing/claims/${c.id}`}>{claimNumber(c)}</Link> : claimNumber(c)} ·{" "}
                      {claimStatusLabel[c.status] ?? c.status}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3>Other visits</h3>
              {otherVisits.length === 0 ? (
                <p className="muted">No other visits.</p>
              ) : (
                <ul>
                  {otherVisits.map((v) => (
                    <li key={v.id}>
                      <Link href={`/encounters/${v.id}`}>{formatDate(v.date)}</Link> · {v.provider.name} · {visitStatusLabel[v.status] ?? v.status}
                    </li>
                  ))}
                </ul>
              )}
              <h3>This visit</h3>
              <ul>
                <li>{encounter.documents.length} document(s)</li>
                <li>{encounter.attachments.length} file(s)</li>
                <li>{encounter.signatures.length} signature(s)</li>
                <li>
                  <Link href={`/patients/${encounter.patientId}`}>Patient chart</Link> · <Link href={`/patients/${encounter.patientId}/insurance`}>Insurance</Link>
                </li>
              </ul>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const title = view in ACTION_VIEWS ? ACTION_VIEWS[view] : `${currentTemplate?.name ?? view}${currentWound ? ` — ${woundTitle(currentWound)}` : ""}`;
  const canFinalize = ["IN_PROGRESS", "CDS_QUERY"].includes(status) && clinicalEditable;
  const railCollapsed = (await cookies()).get("ch_rail")?.value === "collapsed";

  return (
    <div className={`vw-layout${railCollapsed ? " rail-collapsed" : ""}`}>
      <aside className="vw-rail panel">
        <div className="vw-rail-head">
          <PanelToggle target=".vw-layout" cookie="ch_rail" initialCollapsed={railCollapsed} label="document workflow" />
          <p className="vw-rail-title">Document workflow</p>
        </div>
        {bySection.map((g) => (
          <div key={g.sec} className="vw-rail-sec">
            <p className="vw-rail-sectitle">{DOCUMENT_SECTIONS[g.sec as keyof typeof DOCUMENT_SECTIONS]}</p>
            <ol>
              {g.steps.map((s) => {
                const st = stepStatus(s, docStates, builtinDone, openWoundIds);
                const marks = (
                  <>
                    {s.required && !st.done && <span className="vw-req">req</span>}
                    {s.critical && !st.done && <span className="vw-crit" title="Critical document">!</span>}
                  </>
                );
                if (s.perWound && s.kind === "FORM" && openWounds.length) {
                  return (
                    <li key={s.key} className="vw-rail-group">
                      <div className={`vw-rail-parent${st.done ? " done" : ""}`}>
                        <Link href={hrefFor(s.key)}>{s.name}</Link>
                        {marks}
                      </div>
                      <ol>
                        {openWounds.map((w) => {
                          const v = `${s.key}.${w.id}`;
                          return (
                            <li key={w.id} className={`${st.woundsDone.has(w.id) ? "done" : ""}${currentValue === v ? " current" : ""}`}>
                              <Link href={hrefFor(v)}>{woundTitle(w.id)}</Link>
                            </li>
                          );
                        })}
                      </ol>
                    </li>
                  );
                }
                return (
                  <li key={s.key} className={`${st.done ? "done" : ""}${currentValue === s.key ? " current" : ""}`}>
                    <Link href={hrefFor(s.key)}>{s.name}</Link>
                    {marks}
                    {s.key === "wounds" && openWounds.length > 0 && (
                      <ol className="vw-rail-subs">
                        {openWounds.map((w) => (
                          <li key={w.id} className={assessedWounds.has(w.id) ? "done" : undefined}>
                            <Link href={`/encounters/${encounter.id}/wounds/${w.id}`}>{woundTitle(w.id)}</Link>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
        {canFinalize && (
          <form action={submitToCds.bind(null, encounter.id)} className="vw-finalize">
            <button className="btn" type="submit" disabled={gaps.length > 0} title={gaps.length ? `Still needed: ${gaps.join(", ")}` : undefined}>
              Finalize Visit
            </button>
            {gaps.length > 0 && <span className="muted">Needed: {gaps.join(", ")}</span>}
          </form>
        )}
        <details className="vw-rail-more" open={Boolean(currentTemplate && !inWorkflow.has(currentTemplate.key))}>
          <summary>Additional documents</summary>
          <ol>
            {additional.map((t) => (
              <li key={t.id} className={`${docDone(t) ? "done" : ""}${currentTemplate?.id === t.id ? " current" : ""}`}>
                <Link href={hrefFor(t.key)}>{t.name}</Link>
                {t.critical && <span className="vw-crit" title="Critical document">!</span>}
              </li>
            ))}
            {additional.length === 0 && <li className="muted">All documents are in this workflow.</li>}
          </ol>
        </details>
        <Link className="btn ghost vw-rail-btn" href={`/encounters/${encounter.id}?step=all`}>
          Full note (all sections)
        </Link>
        <Link className="btn ghost vw-rail-btn" href="/encounters">
          « Visit worklist
        </Link>
        {user.role === "ADMIN" && (
          <Link className="vw-rail-admin" href="/settings/documentation">
            Chart templates &amp; workflows
          </Link>
        )}
      </aside>

      <div className="stack">
        <div className="page-head vw-head" style={{ marginBottom: 0 }}>
          <div>
            <p className="muted">
              {formatDate(encounter.date)} ·{" "}
              {encounter.appointment ? (vtNames[encounter.appointment.visitType] ?? encounter.appointment.visitType) : encounter.type} · DOB{" "}
              {formatDate(encounter.patient.dob)} · MRN {encounter.patient.mrn}
            </p>
            <h1>
              <Link href={`/patients/${encounter.patientId}`}>{patientName(encounter.patient)}</Link>{" "}
              <span className={`gw-tag gw-tag-${visitStatusTone(status)}`}>{visitStatusLabel[status] ?? status}</span>
            </h1>
            {clinicalEditable && workflows.length > 1 ? (
              <form className="vw-wf-switch" action={setEncounterWorkflow.bind(null, encounter.id)}>
                <select name="workflowId" defaultValue={workflow?.id ?? ""} aria-label="Chart workflow">
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                      {w.isDefault ? " (Default Workflow)" : ""}
                    </option>
                  ))}
                </select>
                <button className="btn ghost gw-mini" type="submit">
                  Change workflow
                </button>
              </form>
            ) : (
              <p className="vw-wf-name">
                {workflow?.name ?? "No workflow"}
                {workflow?.isDefault ? " (Default Workflow)" : ""}
              </p>
            )}
          </div>
          <div className="vw-menus">
            <details className="vw-menu">
              <summary>Progress Note ▾</summary>
              <div className="vw-menu-list">
                <Link href={`/encounters/${encounter.id}/print`}>Progress note</Link>
                {views.map((v) => (
                  <Link key={v.id} href={`/encounters/${encounter.id}/print?view=${v.id}`}>
                    {v.name}
                  </Link>
                ))}
              </div>
            </details>
            <details className="vw-menu">
              <summary>Visit Actions ▾</summary>
              <div className="vw-menu-list">
                <Link href={hrefFor("info")}>Encounter Info</Link>
                <Link href={`/patients/${encounter.patientId}/insurance`}>Insurance</Link>
                <Link href={hrefFor("results")}>Test Results</Link>
                <Link href={hrefFor("meds")}>Medications</Link>
                <Link href={`/encounters/${encounter.id}/reports`}>Patient Reports</Link>
                <Link href={hrefFor("scans")}>Scans</Link>
                <Link href={`/encounters/${encounter.id}/wound-analysis`}>Wound Analysis</Link>
                <Link href={`/orders/new?kind=LAB&patientId=${encounter.patientId}&encounterId=${encounter.id}`}>Order labs</Link>
                <Link href={`/orders/new?kind=IMAGING&patientId=${encounter.patientId}&encounterId=${encounter.id}`}>Order imaging / vascular</Link>
                <Link href={`/referrals/new?patientId=${encounter.patientId}&encounterId=${encounter.id}`}>Refer to specialist</Link>
                <Link href={`/tasks?patientId=${encounter.patientId}#new`}>Message staff about patient</Link>
                <Link href={hrefFor("connections")}>Connections</Link>
              </div>
            </details>
          </div>
        </div>

        {error && (
          <p className="gw-error" role="alert">
            {error}
          </p>
        )}

        {!SIGNED_STATUSES.includes(status) && <CareGapsPanel practiceId={user.practiceId} patientId={encounter.patientId} back={`/encounters/${encounter.id}`} compact />}

        {criticalOpen.length > 0 && !SIGNED_STATUSES.includes(status) && (
          <p className="vw-critical" role="status">
            <strong>Critical documents not complete:</strong> {criticalOpen.join(", ")}
          </p>
        )}

        <ol className="gw-stepper vw-stepper">
          {VISIT_STEPS.map((vs, i) => (
            <li key={vs.key} className={i < current ? "done" : i === current && !onHold ? "current" : undefined}>
              <strong>{vs.label}</strong>
              <span>{vs.owner}</span>
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

        {canFinalize && (
          <section className="panel gw-handoff">
            <div>
              <strong>{status === "CDS_QUERY" ? "Answer the query and finalize again" : "Finalize visit"}</strong>
              <p className="muted">
                {gaps.length
                  ? `Still needed: ${gaps.join(", ")}`
                  : "Required documents are complete — finalizing sends the chart to CDS to review and build the superbill."}
              </p>
            </div>
            <form action={submitToCds.bind(null, encounter.id)}>
              <button className="btn" type="submit" disabled={gaps.length > 0}>
                {status === "CDS_QUERY" ? "Resubmit to CDS →" : "Finalize visit →"}
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
                Review the note and superbill.{" "}
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

        {/* ---------------- One document at a time ---------------- */}
        <section className="panel vw-step">
          <div className="gw-section-head">
            <h2>{title}</h2>
            <span className="muted">
              {isAll ? (
                <Link href={hrefFor(entries[0]?.value ?? "cc")}>Chart one document at a time</Link>
              ) : seqIndex >= 0 ? (
                <>
                  Step {seqIndex + 1} of {entries.length} · <Link href={hrefFor("all")}>View full note</Link>
                </>
              ) : currentTemplate ? (
                <>
                  {DOCUMENT_SECTIONS[currentTemplate.section as keyof typeof DOCUMENT_SECTIONS] ?? "Additional document"} ·{" "}
                  <Link href={hrefFor(defaultValue)}>Back to workflow</Link>
                </>
              ) : (
                <Link href={hrefFor(defaultValue)}>Back to workflow</Link>
              )}
            </span>
          </div>

          {isAll
            ? steps.map((s) => {
                const t = templateByKey.get(s.key);
                if (!t) return null;
                if (t.perWound && t.kind === "FORM") {
                  return openWounds.map((w) => (
                    <div key={`${s.key}.${w.id}`} className="vw-all-part">
                      <h3>
                        {s.name} — {woundTitle(w.id)}
                      </h3>
                      {renderForm(t, w.id)}
                    </div>
                  ));
                }
                return (
                  <div key={s.key} className="vw-all-part">
                    <h3>{s.name}</h3>
                    {renderTemplate(t)}
                  </div>
                );
              })
            : view in ACTION_VIEWS
              ? renderActionView(view)
              : currentTemplate
                ? renderTemplate(currentTemplate, currentWound)
                : null}

          {!isAll && seqIndex >= 0 && (
            <nav className="vw-step-nav" aria-label="Chart sections">
              {prevEntry ? (
                <Link className="btn secondary" href={hrefFor(prevEntry.value)}>
                  ‹ Previous
                </Link>
              ) : (
                <span />
              )}
              {nextEntry && (
                <Link className="btn ghost" href={hrefFor(nextEntry.value)}>
                  {clinicalEditable ? "Skip ›" : "Next ›"}
                </Link>
              )}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
