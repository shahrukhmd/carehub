import { requireEncounterAccess } from "@/lib/privacy";
import Link from "next/link";
import { visitTypeNames } from "@/lib/scheduler-setup";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { PrintButton } from "@/components/PrintButton";
import { DocumentSummary } from "@/components/DocumentForm";
import { visitStatusLabel } from "@/lib/visit-workflow";
import { parseData, parseFields } from "@/lib/chart-forms";
import { ensureChartSetup } from "@/lib/chart-setup";
import { calcBmi, formatDate, formatMoney, patientName } from "@/lib/format";
import { diagnosisPointerLetter, mdmLevelLabel, parsePointerIds, patientStatusLabel } from "@/lib/superbill";
import { etiologyLabel } from "@/lib/wound";

// Patient reports that span every visit (Visit actions → Patient reports).
const PATIENT_REPORTS: Record<string, string> = {
  clinical: "Clinical Summary",
  visits: "All Visits",
  commlog: "Communication Log History",
  cds: "Clinical Decision Support Interventions",
  treatment: "Treatment Notes Summary",
};

const DEFAULT_PARTS = ["note", "signatures"];

export default async function EncounterPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireUser(["ADMIN", "CLINICIAN", "BILLER", "FRONT_DESK", "CDS"]);
  const vtNames = await visitTypeNames(user.practiceId);
  const { id } = await params;
  await requireEncounterAccess(user, id);
  const { view } = await searchParams;
  await ensureChartSetup(user.practiceId);

  const encounter = await prisma.encounter.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      patient: {
        include: {
          allergies: true,
          problems: { orderBy: { icd10: "asc" } },
          medications: { where: { status: "ACTIVE" } },
          insurances: { where: { active: true }, include: { payer: true } },
          wounds: { include: { assessments: { orderBy: { assessedAt: "desc" }, take: 1 } }, orderBy: { createdAt: "asc" } },
        },
      },
      provider: true,
      billingProvider: true,
      supervisingProvider: true,
      practice: true,
      vitals: true,
      appointment: { include: { location: true } },
      diagnoses: { orderBy: { priority: "asc" } },
      charges: true,
      woundAssessments: { include: { wound: true }, orderBy: { assessedAt: "desc" } },
      signatures: { include: { user: true }, orderBy: { signedAt: "asc" } },
      documents: { include: { template: true, completedBy: true } },
      attachments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!encounter) notFound();

  const docView = view && !(view in PATIENT_REPORTS) ? await prisma.documentationView.findFirst({ where: { id: view, practiceId: user.practiceId } }) : null;
  const report = view && view in PATIENT_REPORTS ? view : null;
  let parts: string[] = DEFAULT_PARTS;
  if (docView) {
    try {
      const p = JSON.parse(docView.parts);
      if (Array.isArray(p)) parts = p.map(String);
    } catch {
      parts = DEFAULT_PARTS;
    }
  }
  const heading = report ? PATIENT_REPORTS[report] : (docView?.name ?? "Progress note");
  const woundNo = new Map(encounter.patient.wounds.map((w, i) => [w.id, i + 1]));
  const woundTitle = (wid: string) => {
    const w = encounter.patient.wounds.find((x) => x.id === wid);
    return w ? `#${woundNo.get(w.id)} ${w.label}` : "";
  };
  const bmi = calcBmi(encounter.vitals?.heightCm ?? null, encounter.vitals?.weightKg ?? null);
  const completeDocs = encounter.documents.filter((d) => d.status === "COMPLETE" || d.status === "DRAFT");
  // Each document prints once: named documents in their own spot, the rest inside the note or under "All documents".
  const explicitKeys = new Set(parts.filter((p) => p.startsWith("doc:")).map((p) => p.slice(4)));
  const noteDocs = parts.includes("note")
    ? completeDocs
        .filter((d) => d.template.inProgressNote && d.status === "COMPLETE" && !explicitKeys.has(d.template.key))
        .sort((a, b) => a.template.noteOrder - b.template.noteOrder)
    : [];
  const noteDocIds = new Set(noteDocs.map((d) => d.id));

  const docBlock = (d: (typeof encounter.documents)[number]) => (
    <div key={d.id} className="panel-section">
      <h3>
        {d.template.name}
        {d.woundKey ? ` — ${woundTitle(d.woundKey)}` : ""}
        {d.status === "DRAFT" ? " (draft)" : ""}
      </h3>
      <DocumentSummary fields={parseFields(d.template.fields)} values={parseData(d.data)} score={d.score} />
      {d.signedAt && (
        <div className="print-docsig">
          {d.signatureImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.signatureImage} alt={`Signature of ${d.signedName}`} className="sig-img sig-print" />
          )}
          <p className="muted">
            Electronically signed by {d.signedName} on {formatDate(d.signedAt)}
          </p>
        </div>
      )}
    </div>
  );

  const renderPart = (part: string): ReactNode => {
    if (part.startsWith("doc:")) {
      const key = part.slice(4);
      const docs = completeDocs.filter((d) => d.template.key === key);
      return docs.length ? docs.map(docBlock) : null;
    }
    switch (part) {
      case "facesheet":
        return (
          <div key={part} className="panel-section">
            <h3>Face sheet</h3>
            <div className="print-meta">
              <div>
                <span className="muted">Address</span>
                <p>
                  {[encounter.patient.addressLine1, encounter.patient.city, [encounter.patient.state, encounter.patient.zip].filter(Boolean).join(" ")]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </p>
              </div>
              <div>
                <span className="muted">Phone</span>
                <p>{encounter.patient.phone ?? "—"}</p>
              </div>
              <div>
                <span className="muted">Sex</span>
                <p>{encounter.patient.sex}</p>
              </div>
              <div>
                <span className="muted">Emergency contact</span>
                <p>
                  {encounter.patient.emergencyContactName ?? "—"}
                  {encounter.patient.emergencyContactPhone ? ` · ${encounter.patient.emergencyContactPhone}` : ""}
                </p>
              </div>
              {encounter.patient.insurances.map((ins) => (
                <div key={ins.id}>
                  <span className="muted">{ins.rank.toLowerCase()} insurance</span>
                  <p>
                    {ins.payer.name} · {ins.memberId}
                    {ins.groupNumber ? ` · grp ${ins.groupNumber}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      case "note": {
        return (
          <div key={part}>
            <div className="panel-section">
              <h3>Subjective</h3>
              <p>
                <strong>Chief complaint:</strong> {encounter.chiefComplaint ?? "—"}
              </p>
              <p>
                <strong>Allergies:</strong> {encounter.patient.allergies.map((a) => a.allergen).join(", ") || "NKDA"}
              </p>
              <p>
                <strong>Problem list:</strong>{" "}
                {encounter.patient.problems
                  .filter((p) => p.status === "ACTIVE")
                  .map((p) => `${p.icd10} ${p.description}`)
                  .join("; ") || "None"}
              </p>
              {encounter.subjective && <p style={{ whiteSpace: "pre-wrap" }}>{encounter.subjective}</p>}
            </div>
            <div className="panel-section">
              <h3>Objective</h3>
              {encounter.vitals ? (
                <p>
                  Height {encounter.vitals.heightCm ?? "—"} cm, Weight {encounter.vitals.weightKg ?? "—"} kg
                  {bmi ? `, BMI ${bmi.toFixed(1)}` : ""}, Temp {encounter.vitals.tempC ?? "—"}°C, Pulse {encounter.vitals.heartRate ?? "—"} bpm, Resp{" "}
                  {encounter.vitals.respRate ?? "—"} /min, BP {encounter.vitals.bpSystolic ?? "—"}/{encounter.vitals.bpDiastolic ?? "—"} mmHg, SpO2{" "}
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
                        {woundTitle(a.woundId)} ({a.wound.location}): {a.lengthCm ?? "—"} x {a.widthCm ?? "—"} x {a.depthCm ?? "—"} cm
                        {a.areaCm2 ? `, area ${a.areaCm2.toFixed(1)} cm²` : ""}
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
              {encounter.plan ? <p style={{ whiteSpace: "pre-wrap" }}>{encounter.plan}</p> : <p className="muted">—</p>}
            </div>
            {noteDocs.map(docBlock)}
          </div>
        );
      }
      case "problems":
        return (
          <div key={part} className="panel-section">
            <h3>Problems, allergies &amp; medications</h3>
            <p>
              <strong>Problems:</strong> {encounter.patient.problems.map((p) => `${p.icd10} ${p.description} (${p.status.toLowerCase()})`).join("; ") || "None"}
            </p>
            <p>
              <strong>Allergies:</strong> {encounter.patient.allergies.map((a) => `${a.allergen} (${a.reaction})`).join(", ") || "NKDA"}
            </p>
            <p>
              <strong>Active medications:</strong> {encounter.patient.medications.map((m) => `${m.name} — ${m.sig}`).join("; ") || "None"}
            </p>
          </div>
        );
      case "wounds":
        return (
          <div key={part} className="panel-section">
            <h3>Wound assessments</h3>
            {encounter.woundAssessments.length === 0 ? (
              <p className="muted">No wounds assessed this visit.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Wound</th>
                    <th>L × W × D (cm)</th>
                    <th>Area</th>
                    <th>Stage</th>
                    <th>Tissue</th>
                    <th>Exudate</th>
                  </tr>
                </thead>
                <tbody>
                  {encounter.woundAssessments.map((a) => (
                    <tr key={a.id}>
                      <td>
                        {woundTitle(a.woundId)}
                        <div className="muted">
                          {a.wound.location} · {etiologyLabel[a.wound.etiology] ?? a.wound.etiology}
                        </div>
                      </td>
                      <td>
                        {a.lengthCm ?? "—"} × {a.widthCm ?? "—"} × {a.depthCm ?? "—"}
                      </td>
                      <td>{a.areaCm2 ? `${a.areaCm2.toFixed(1)} cm²` : "—"}</td>
                      <td>{a.stage ?? "—"}</td>
                      <td>
                        Gran {a.granulationPct ?? 0}% · Slough {a.sloughPct ?? 0}% · Eschar {a.escharPct ?? 0}%
                      </td>
                      <td>{[a.exudateAmount, a.exudateType].filter(Boolean).join(" ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      case "documents": {
        const rest = completeDocs.filter((d) => !noteDocIds.has(d.id) && !explicitKeys.has(d.template.key));
        return rest.length ? <div key={part}>{rest.map(docBlock)}</div> : null;
      }
      case "superbill":
        return (
          <div key={part} className="panel-section">
            <h3>Superbill</h3>
            <p>
              {encounter.diagnoses.map((d, i) => `(${diagnosisPointerLetter(i)}) ${d.icd10} ${d.description}`).join("; ") || "No diagnoses coded."}
            </p>
            {encounter.charges.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>CPT</th>
                    <th>Description</th>
                    <th>Mod</th>
                    <th>Dx</th>
                    <th>Units</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {encounter.charges.map((c) => {
                    const letters = parsePointerIds(c.diagnosisPointers)
                      .map((pid) => encounter.diagnoses.findIndex((d) => d.id === pid))
                      .filter((i) => i >= 0)
                      .map((i) => diagnosisPointerLetter(i));
                    return (
                      <tr key={c.id}>
                        <td>{c.cptCode}</td>
                        <td>{c.description}</td>
                        <td>{c.modifiers ?? "—"}</td>
                        <td>{letters.join(", ") || "—"}</td>
                        <td>{c.units}</td>
                        <td>{formatMoney(c.amountCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      case "attachments":
        return encounter.attachments.length ? (
          <div key={part} className="panel-section">
            <h3>Scans &amp; files on this visit</h3>
            <ul>
              {encounter.attachments.map((a) => (
                <li key={a.id}>
                  {a.title} ({a.category.replace("_", " ").toLowerCase()}) · {formatDate(a.createdAt)}
                </li>
              ))}
            </ul>
          </div>
        ) : null;
      case "signatures":
        return (
          <div key={part} className="panel-section">
            <h3>Electronic signature</h3>
            {encounter.signatures.length > 0 ? (
              encounter.signatures.map((sig) => (
                <div key={sig.id}>
                  {sig.signatureImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={sig.signatureImage} alt={`Signature of ${sig.signedName}`} className="sig-img sig-print" />
                  )}
                  <p>
                    <strong>{sig.role === "PROVIDER" ? "Rendering provider" : "Supervising physician"}:</strong> Electronically signed by {sig.signedName} (
                    {sig.user.name}) on {formatDate(sig.signedAt)}
                  </p>
                  <p className="muted">{sig.attestation}</p>
                </div>
              ))
            ) : (
              <p className="muted">Not yet signed — {visitStatusLabel[encounter.status] ?? encounter.status}.</p>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  // ---- Cross-visit patient reports ----
  const renderReport = async (key: string): Promise<ReactNode> => {
    const visits = await prisma.encounter.findMany({
      where: { practiceId: user.practiceId, patientId: encounter.patientId },
      include: {
        provider: true,
        diagnoses: { orderBy: { priority: "asc" } },
        appointment: true,
        events: { include: { user: true }, orderBy: { createdAt: "asc" } },
        documents: { include: { template: true } },
      },
      orderBy: { date: "desc" },
    });
    if (key === "clinical") {
      return (
        <>
          {renderPart("facesheet")}
          {renderPart("problems")}
          <div className="panel-section">
            <h3>Open wounds</h3>
            {encounter.patient.wounds.filter((w) => w.status !== "HEALED").length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <ul>
                {encounter.patient.wounds
                  .filter((w) => w.status !== "HEALED")
                  .map((w) => (
                    <li key={w.id}>
                      {woundTitle(w.id)} — {w.location}, {etiologyLabel[w.etiology] ?? w.etiology}
                      {w.assessments[0]?.areaCm2 ? ` · last area ${w.assessments[0].areaCm2.toFixed(1)} cm² (${formatDate(w.assessments[0].assessedAt)})` : ""}
                    </li>
                  ))}
              </ul>
            )}
          </div>
          <div className="panel-section">
            <h3>Recent visits</h3>
            <ul>
              {visits.slice(0, 5).map((v) => (
                <li key={v.id}>
                  {formatDate(v.date)} · {v.provider.name} · {v.diagnoses.map((d) => d.icd10).join(", ") || "no Dx"}
                </li>
              ))}
            </ul>
          </div>
        </>
      );
    }
    if (key === "visits") {
      return (
        <div className="panel-section">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Visit type</th>
                <th>Provider</th>
                <th>Diagnoses</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.id}>
                  <td>{formatDate(v.date)}</td>
                  <td>{v.appointment ? (vtNames[v.appointment.visitType] ?? v.appointment.visitType) : v.type}</td>
                  <td>{v.provider.name}</td>
                  <td>{v.diagnoses.map((d) => d.icd10).join(", ") || "—"}</td>
                  <td>{visitStatusLabel[v.status] ?? v.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (key === "cds") {
      const items = visits.flatMap((v) =>
        v.events
          .filter((ev) => ev.toStatus === "CDS_QUERY" || (ev.note ?? "").startsWith("Returned to CDS") || ev.toStatus === "READY_FOR_SIGNATURE")
          .map((ev) => ({ v, ev }))
      );
      return (
        <div className="panel-section">
          {items.length === 0 ? (
            <p className="muted">No CDS queries or coding interventions.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Visit</th>
                  <th>When</th>
                  <th>By</th>
                  <th>Intervention</th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ v, ev }) => (
                  <tr key={ev.id}>
                    <td>{formatDate(v.date)}</td>
                    <td>{formatDate(ev.createdAt)}</td>
                    <td>{ev.user?.name ?? "System"}</td>
                    <td>
                      <strong>{visitStatusLabel[ev.toStatus] ?? ev.toStatus}</strong>
                      {ev.note ? ` — ${ev.note}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      );
    }
    // commlog / treatment: one document type across every visit.
    const templateKey = key === "commlog" ? "communication_log" : "treatment_notes";
    const docs = visits.flatMap((v) => v.documents.filter((d) => d.template.key === templateKey).map((d) => ({ v, d })));
    return docs.length === 0 ? (
      <p className="muted">Nothing documented yet.</p>
    ) : (
      docs.map(({ v, d }) => (
        <div key={d.id} className="panel-section">
          <h3>
            {formatDate(v.date)}
            {d.woundKey ? ` — ${woundTitle(d.woundKey)}` : ""} · {v.provider.name}
          </h3>
          <DocumentSummary fields={parseFields(d.template.fields)} values={parseData(d.data)} score={d.score} />
        </div>
      ))
    );
  };

  return (
    <>
      <div className="page-head no-print">
        <div>
          <p className="muted">{report ? "Patient report" : "Documentation view"}</p>
          <h1>{heading}</h1>
        </div>
        <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
          <Link className="btn secondary" href={report ? `/encounters/${encounter.id}/reports` : `/encounters/${encounter.id}`}>
            {report ? "Back to reports" : "Back to chart"}
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
            <p className="muted">{heading}</p>
            <p>{report ? `Printed ${formatDate(new Date())}` : formatDate(encounter.date)}</p>
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
          {!report && (
            <>
              <div>
                <span className="muted">Provider</span>
                <p>
                  {encounter.provider.name}
                  {encounter.supervisingProvider ? ` (supervising: ${encounter.supervisingProvider.name})` : ""}
                </p>
              </div>
              <div>
                <span className="muted">Billing provider</span>
                <p>{encounter.billingProvider?.name ?? "—"}</p>
              </div>
              <div>
                <span className="muted">Visit type / location</span>
                <p>
                  {encounter.appointment ? (vtNames[encounter.appointment.visitType] ?? encounter.appointment.visitType) : encounter.type}
                  {encounter.appointment ? ` · ${encounter.appointment.location.name}` : ""}
                </p>
              </div>
            </>
          )}
        </div>

        {report ? await renderReport(report) : parts.map((p) => <div key={p}>{renderPart(p)}</div>)}
      </section>
    </>
  );
}
