import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addCharge,
  addChargeFromTemplate,
  addDiagnosis,
  cancelLabOrder,
  discontinueMedication,
  moveDiagnosis,
  orderLab,
  prescribeMedication,
  removeDiagnosis,
  resultLab,
  saveEncounter,
  saveVitals,
  updateEncounterBilling,
} from "@/app/actions";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import { calcBmi, formatDate, formatMoney, patientName } from "@/lib/format";
import { requireUser } from "@/lib/auth";
import { createWound } from "@/app/(app)/wounds/actions";
import { etiologyLabel } from "@/lib/wound";
import {
  diagnosisPointerLetter,
  mdmLevelLabel,
  parsePointerIds,
  patientStatusLabel,
  placeOfServiceLabel,
} from "@/lib/superbill";

export default async function EncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  const { id } = await params;
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
      charges: { include: { claim: true } },
      vitals: true,
      labOrders: { include: { result: true }, orderBy: { orderedAt: "desc" } },
      diagnoses: { orderBy: { priority: "asc" } },
    },
  });

  if (!encounter) notFound();

  const billingProviders = await prisma.billingProvider.findMany({
    where: { practiceId: user.practiceId, active: true },
    orderBy: { name: "asc" },
  });

  const superbillTemplates = await prisma.superbillTemplate.findMany({
    where: { practiceId: user.practiceId, active: true },
    include: { items: { orderBy: { order: "asc" } } },
    orderBy: { name: "asc" },
  });

  const bmi = calcBmi(encounter.vitals?.heightCm ?? null, encounter.vitals?.weightKg ?? null);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">SOAP note</p>
          <h1>
            <Link href={`/patients/${encounter.patientId}`}>{patientName(encounter.patient)}</Link>
          </h1>
          <p className="chart-meta">
            <span>{formatDate(encounter.date)}</span>
            <span>{encounter.provider.name}</span>
            <span>{encounter.type}</span>
          </p>
        </div>
      </div>

      <div className="two-col">
        <div className="stack">
          <form className="panel stack" action={saveEncounter.bind(null, encounter.id)}>
            <label>
              Chief complaint
              <input name="chiefComplaint" defaultValue={encounter.chiefComplaint ?? ""} />
            </label>
            <div className="soap-grid">
              <label>
                Subjective
                <textarea name="subjective" defaultValue={encounter.subjective ?? ""} />
              </label>
              <label>
                Objective
                <textarea name="objective" defaultValue={encounter.objective ?? ""} />
              </label>
              <label>
                Assessment
                <textarea name="assessment" defaultValue={encounter.assessment ?? ""} />
              </label>
              <label>
                Plan
                <textarea name="plan" defaultValue={encounter.plan ?? ""} />
              </label>
            </div>
            <label>
              Status
              <select name="status" defaultValue={encounter.status}>
                <option value="IN_PROGRESS">In progress</option>
                <option value="SIGNED">Sign encounter</option>
              </select>
            </label>
            <button className="btn" type="submit">
              Save chart
            </button>
          </form>

          <section className="panel">
            <h2>Vitals</h2>
            {encounter.vitals && (
              <p className="chart-meta">
                <span>BP {encounter.vitals.bpSystolic ?? "—"}/{encounter.vitals.bpDiastolic ?? "—"}</span>
                <span>HR {encounter.vitals.heartRate ?? "—"}</span>
                <span>RR {encounter.vitals.respRate ?? "—"}</span>
                <span>Temp {encounter.vitals.tempC ?? "—"}°C</span>
                <span>SpO2 {encounter.vitals.spo2 ?? "—"}%</span>
                <span>{bmi ? `BMI ${bmi.toFixed(1)}` : "BMI —"}</span>
              </p>
            )}
            <form className="form-grid" action={saveVitals.bind(null, encounter.id)}>
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
              <button className="btn secondary" type="submit" style={{ gridColumn: "1 / -1" }}>
                Save vitals
              </button>
            </form>
          </section>

          <section className="panel">
            <h2>Wounds</h2>
            {encounter.patient.wounds.length === 0 && <p className="muted">No wounds on file.</p>}
            {encounter.patient.wounds.map((w) => {
              const latest = w.assessments[0];
              return (
                <div key={w.id} className="stack" style={{ marginBottom: "0.9rem" }}>
                  <Link href={`/encounters/${encounter.id}/wounds/${w.id}`}>
                    <strong>{w.label}</strong>
                  </Link>{" "}
                  <StatusBadge value={w.status} />
                  <div className="muted">
                    {w.location} · {etiologyLabel[w.etiology] ?? w.etiology}
                    {latest?.areaCm2 ? ` · Last area ${latest.areaCm2.toFixed(1)} cm²` : ""}
                  </div>
                </div>
              );
            })}
            <form className="stack" action={createWound.bind(null, encounter.patientId, encounter.id)}>
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
          </section>

          <section className="panel">
            <h2>Labs</h2>
            {encounter.labOrders.length === 0 && <p className="muted">No labs ordered this visit.</p>}
            {encounter.labOrders.map((order) => (
              <div key={order.id} className="stack" style={{ marginBottom: "0.9rem" }}>
                <p>
                  <strong>{order.testName}</strong> <StatusBadge value={order.status} />
                </p>
                {order.result ? (
                  <p className="muted">
                    Result: {order.result.value} {order.result.unit ?? ""}{" "}
                    {order.result.referenceRange ? `(ref ${order.result.referenceRange})` : ""}{" "}
                    <StatusBadge value={order.result.flag} />
                  </p>
                ) : order.status === "ORDERED" ? (
                  <form className="stack" action={resultLab.bind(null, order.id, encounter.id)}>
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
                    <div className="stack" style={{ gridAutoFlow: "column", justifyContent: "start", gap: "0.5rem" }}>
                      <button className="btn secondary" type="submit">
                        Enter result
                      </button>
                      <button
                        className="btn ghost"
                        type="submit"
                        formAction={cancelLabOrder.bind(null, order.id, encounter.id)}
                      >
                        Cancel order
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>
            ))}
            <form className="stack" action={orderLab.bind(null, encounter.patientId, encounter.id)}>
              <label>
                Order a test
                <input name="testName" placeholder="CBC, A1c, BMP..." required />
              </label>
              <button className="btn secondary" type="submit">
                Order lab
              </button>
            </form>
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <h2>Safety</h2>
            <p>
              Allergies:{" "}
              {encounter.patient.allergies.map((a) => a.allergen).join(", ") || "NKDA"}
            </p>
            <p>
              Problems:{" "}
              {encounter.patient.problems.map((p) => `${p.icd10} ${p.description}`).join("; ") || "None"}
            </p>
          </section>

          <section className="panel">
            <h2>Medications</h2>
            {encounter.patient.medications.length === 0 && <p className="muted">No medications on file.</p>}
            <ul>
              {encounter.patient.medications.map((m) => (
                <li key={m.id}>
                  <strong>{m.name}</strong> — {m.sig} <StatusBadge value={m.status} />
                  {m.status === "ACTIVE" && (
                    <form
                      action={discontinueMedication.bind(null, m.id, encounter.id)}
                      style={{ display: "inline", marginLeft: "0.5rem" }}
                    >
                      <button className="btn ghost" type="submit">
                        Discontinue
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            <form className="stack" action={prescribeMedication.bind(null, encounter.patientId, encounter.id)}>
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
          </section>

          <section className="panel">
            <h2>Diagnosis coding</h2>
            <p className="muted">Visit-level ICD-10 list, prioritized A–D for use as procedure diagnosis pointers.</p>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>ICD-10</th>
                  <th>Description</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {encounter.diagnoses.map((d, i) => (
                  <tr key={d.id}>
                    <td>{diagnosisPointerLetter(i)}</td>
                    <td>{d.icd10}</td>
                    <td>{d.description}</td>
                    <td>
                      <div className="stack" style={{ gridAutoFlow: "column", justifyContent: "start", gap: "0.3rem" }}>
                        {i > 0 && (
                          <form action={moveDiagnosis.bind(null, d.id, encounter.id, "up")}>
                            <button className="btn ghost" type="submit">
                              ↑
                            </button>
                          </form>
                        )}
                        {i < encounter.diagnoses.length - 1 && (
                          <form action={moveDiagnosis.bind(null, d.id, encounter.id, "down")}>
                            <button className="btn ghost" type="submit">
                              ↓
                            </button>
                          </form>
                        )}
                        <form action={removeDiagnosis.bind(null, d.id, encounter.id)}>
                          <button className="btn ghost" type="submit">
                            Remove
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
                {encounter.diagnoses.length === 0 && (
                  <tr>
                    <td colSpan={4}>No diagnoses added yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <form className="stack" action={addDiagnosis.bind(null, encounter.id)} style={{ marginTop: "0.9rem" }}>
              <label>
                ICD-10 code
                <input name="icd10" placeholder="L89.623" required />
              </label>
              <label>
                Description
                <input name="description" placeholder="Pressure ulcer of left heel, stage 3" required />
              </label>
              <button className="btn secondary" type="submit">
                Add diagnosis
              </button>
            </form>
          </section>

          <section className="panel">
            <h2>Billing details</h2>
            <form className="form-grid" action={updateEncounterBilling.bind(null, encounter.id)}>
              <label>
                Patient status
                <select name="patientStatus" defaultValue={encounter.patientStatus ?? ""}>
                  <option value="">—</option>
                  {Object.entries(patientStatusLabel).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Medical decision making
                <select name="mdmLevel" defaultValue={encounter.mdmLevel ?? ""}>
                  <option value="">—</option>
                  {Object.entries(mdmLevelLabel).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "0.4rem" }}>
                <input name="hospice" type="checkbox" style={{ width: "auto" }} defaultChecked={encounter.hospice} />
                Hospice patient
              </label>
              <label>
                Billing provider
                <select name="billingProviderId" defaultValue={encounter.billingProviderId ?? ""}>
                  <option value="">—</option>
                  {billingProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn secondary" type="submit" style={{ gridColumn: "1 / -1" }}>
                Save billing details
              </button>
            </form>
          </section>

          {superbillTemplates.length > 0 && (
            <section className="panel">
              <h2>Quick charges</h2>
              <p className="muted">One-click add from a superbill template. Fee and modifiers are preset.</p>
              {superbillTemplates.map((t) => (
                <div key={t.id} style={{ marginBottom: "0.9rem" }}>
                  <p className="muted">{t.name}</p>
                  <div className="stack" style={{ gridAutoFlow: "column", justifyContent: "start", flexWrap: "wrap", gap: "0.4rem" }}>
                    {t.items.map((item) => (
                      <form key={item.id} action={addChargeFromTemplate.bind(null, encounter.id, item.id)}>
                        <button className="btn ghost" type="submit">
                          {item.cptCode} — {item.description} ({formatMoney(item.amountCents)})
                        </button>
                      </form>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="panel">
            <h2>Charges</h2>
            <table>
              <thead>
                <tr>
                  <th>CPT</th>
                  <th>Description</th>
                  <th>Mod</th>
                  <th>Dx</th>
                  <th>POS</th>
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
                      <td>{c.placeOfService}</td>
                      <td>{formatMoney(c.amountCents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <form className="stack" action={addCharge.bind(null, encounter.id)} style={{ marginTop: "1rem" }}>
              <label>
                CPT
                <input name="cptCode" placeholder="99213" required />
              </label>
              <label>
                Description
                <input name="description" required />
              </label>
              <label>
                Amount (USD)
                <input name="amount" type="number" step="0.01" required />
              </label>
              <label>
                Place of service
                <select name="placeOfService" defaultValue="11">
                  {Object.entries(placeOfServiceLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  Modifier 1
                  <input name="modifiers" placeholder="25" />
                </label>
                <label>
                  Modifier 2
                  <input name="modifiers" placeholder="LT" />
                </label>
                <label>
                  Modifier 3
                  <input name="modifiers" />
                </label>
                <label>
                  Modifier 4
                  <input name="modifiers" />
                </label>
              </div>
              {encounter.diagnoses.length > 0 && (
                <fieldset className="stack">
                  <legend>Diagnosis pointers</legend>
                  {encounter.diagnoses.map((d, i) => (
                    <label key={d.id} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "0.4rem" }}>
                      <input type="checkbox" name="diagnosisPointers" value={d.id} style={{ width: "auto" }} />
                      {diagnosisPointerLetter(i)} — {d.icd10} {d.description}
                    </label>
                  ))}
                </fieldset>
              )}
              <button className="btn secondary" type="submit">
                Add charge
              </button>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}
