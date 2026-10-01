import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { RX_FAVORITES, RX_WRITE_ROLES, allergyConflicts } from "@/lib/prescriptions";
import { IMMUNIZATION_ROLES, MANUFACTURERS, ROUTES, SITES, VACCINES } from "@/lib/immunizations";
import { RECALL_REASONS, RECALL_ROLES } from "@/lib/recalls";
import { LETTER_ROLES } from "@/lib/letters";
import { cancelPrescription, createPrescription, deleteImmunization, faxPrescription, printPrescription, recordImmunization, signPrescription } from "../clinical-actions";
import { createRecall, closeRecall } from "@/app/(app)/recalls/actions";
import { uploadCcda } from "./ccda/actions";
import { PAYMENT_ROLES, patientBalance } from "@/lib/connect/payments";
import { sendPaymentLink } from "@/app/(app)/connect/actions";
import { formatMoney } from "@/lib/format";
import { ORDER_ROLES, ORDER_STATUS, ORDER_WRITE_ROLES, RESULT_FLAGS } from "@/lib/orders";
import { REFERRAL_ROLES, REFERRAL_STATUS } from "@/lib/referrals";
import { TASK_TYPES } from "@/lib/tasks";
import { CHECKOUT_ROLES } from "@/lib/checkout";

const RX_STATUS: Record<string, [string, string]> = {
  DRAFT: ["Draft — not signed", "warn"],
  SIGNED: ["Signed", "info"],
  PRINTED: ["Printed", "ok"],
  SENT: ["Faxed to pharmacy", "ok"],
  CANCELLED: ["Cancelled", "bad"],
};

export async function PrescriptionsPanel({ patientId, role, back, encounterId }: { patientId: string; role: string; back: string; encounterId?: string }) {
  const [rxs, allergies] = await Promise.all([
    prisma.prescription.findMany({ where: { patientId }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.allergy.findMany({ where: { patientId } }),
  ]);
  const canWrite = RX_WRITE_ROLES.includes(role);
  return (
    <section className="panel" id="rx">
      <div className="gw-section-head">
        <h2>Prescriptions</h2>
        <span className="muted cn-small">Allergies: {allergies.length ? allergies.map((a) => a.allergen).join(", ") : "NKDA"}</span>
      </div>
      {rxs.length === 0 && <p className="muted">No prescriptions written in CareHub yet.</p>}
      <ul className="rx-list">
        {rxs.map((rx) => {
          const [label, tone] = RX_STATUS[rx.status] ?? [rx.status, "info"];
          const conflicts = rx.status === "DRAFT" ? allergyConflicts(rx.drug, allergies) : [];
          return (
            <li key={rx.id}>
              <div>
                <strong>
                  {rx.drug} {rx.strength} {rx.form}
                </strong>{" "}
                <span className={`gw-tag gw-tag-${tone}`}>{label}</span>
                {rx.controlled && <span className="cn-tag">controlled</span>}
                <div className="cn-small">
                  {rx.sig} · #{rx.quantity} {rx.quantityUnit ?? ""} · {rx.refills} refill{rx.refills === 1 ? "" : "s"}
                  {rx.dispenseAsWritten ? " · DAW" : ""}
                </div>
                <div className="muted cn-small">
                  {formatDate(rx.createdAt)}
                  {rx.signedName ? ` · signed by ${rx.signedName}` : ""}
                  {rx.pharmacyName ? ` · ${rx.pharmacyName}` : ""}
                  {rx.allergyOverride ? ` · allergy override: ${rx.allergyOverride}` : ""}
                  {rx.cancelledReason ? ` · ${rx.cancelledReason}` : ""}
                </div>
                {conflicts.length > 0 && <div className="gw-missing cn-small">⚠ Possible allergy conflict: {conflicts.map((a) => a.allergen).join(", ")}</div>}
              </div>
              <div className="cn-actions">
                <a className="btn ghost gw-mini" href={`/api/rx/${rx.id}`} target="_blank" rel="noreferrer">
                  View
                </a>
                {rx.status === "DRAFT" && canWrite && (
                  <form action={signPrescription.bind(null, rx.id)} className="cn-inline" style={{ margin: 0 }}>
                    <input type="hidden" name="back" value={back} />
                    {conflicts.length > 0 && <input name="override" placeholder="Reason to override allergy" required />}
                    <button className="btn secondary gw-mini" type="submit">
                      Sign
                    </button>
                  </form>
                )}
                {["SIGNED", "PRINTED", "SENT"].includes(rx.status) && (
                  <>
                    <form action={printPrescription.bind(null, rx.id)}>
                      <button className="btn ghost gw-mini" type="submit">
                        Print
                      </button>
                    </form>
                    {!rx.controlled && (
                      <form action={faxPrescription.bind(null, rx.id)} className="cn-inline" style={{ margin: 0 }}>
                        <input type="hidden" name="back" value={back} />
                        <input name="pharmacyFax" defaultValue={rx.pharmacyFax ?? ""} placeholder="Pharmacy fax" aria-label="Pharmacy fax" style={{ width: "9rem" }} />
                        <button className="btn ghost gw-mini" type="submit">
                          Fax
                        </button>
                      </form>
                    )}
                  </>
                )}
                {rx.status !== "CANCELLED" && canWrite && (
                  <form action={cancelPrescription.bind(null, rx.id)}>
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="reason" value="Cancelled by prescriber" />
                    <button className="btn ghost gw-mini" type="submit">
                      Cancel
                    </button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {canWrite && (
        <details className="rx-new">
          <summary className="btn secondary gw-mini">+ Write prescription</summary>
          <form action={createPrescription.bind(null, patientId)} className="form-grid gw-grid-3">
            <input type="hidden" name="back" value={back} />
            {encounterId && <input type="hidden" name="encounterId" value={encounterId} />}
            <label className="gw-span-2">
              Drug
              <input name="drug" list="rx-favorites" required placeholder="Start typing — common wound-care drugs are listed" />
              <datalist id="rx-favorites">
                {RX_FAVORITES.map((f) => (
                  <option key={f.drug} value={f.drug}>
                    {f.strength} {f.form} — {f.sig}
                  </option>
                ))}
              </datalist>
            </label>
            <label>
              Strength
              <input name="strength" placeholder="500 mg" />
            </label>
            <label>
              Form
              <input name="form" placeholder="capsule, cream…" />
            </label>
            <label>
              Route
              <select name="route" defaultValue="oral">
                {["oral", "topical", "intramuscular", "subcutaneous", "intravenous", "ophthalmic", "other"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label>
              Diagnosis (ICD-10)
              <input name="diagnosisCode" placeholder="L97.412" />
            </label>
            <label className="gw-span-3">
              Directions (sig)
              <input name="sig" required list="rx-sigs" placeholder="Take 1 capsule by mouth four times daily for 10 days" />
              <datalist id="rx-sigs">
                {RX_FAVORITES.map((f) => (
                  <option key={f.drug} value={f.sig} />
                ))}
              </datalist>
            </label>
            <label>
              Quantity
              <input name="quantity" required placeholder="40" />
            </label>
            <label>
              Unit
              <input name="quantityUnit" placeholder="capsules" />
            </label>
            <label>
              Refills
              <input type="number" name="refills" min={0} max={11} defaultValue={0} />
            </label>
            <label>
              Days supply
              <input type="number" name="daysSupply" min={1} max={365} />
            </label>
            <label>
              Pharmacy
              <input name="pharmacyName" placeholder="Walgreens #1234" />
            </label>
            <label>
              Pharmacy phone
              <input name="pharmacyPhone" />
            </label>
            <label>
              Pharmacy fax
              <input name="pharmacyFax" />
            </label>
            <label className="gw-span-2">
              Note to pharmacist
              <input name="notes" />
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="daw" /> Dispense as written
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="controlled" /> Controlled substance (print only)
            </label>
            <button className="btn" type="submit">
              Save draft
            </button>
          </form>
          <p className="muted cn-small">
            Prescriptions print on your letterhead with your signature, or fax straight to the pharmacy. Electronic prescribing (Surescripts / EPCS) needs a
            certified eRx vendor and is not connected.
          </p>
        </details>
      )}
    </section>
  );
}

export async function ImmunizationsPanel({ patientId, role, back }: { patientId: string; role: string; back: string }) {
  const imms = await prisma.immunization.findMany({ where: { patientId }, orderBy: { administeredAt: "desc" } });
  const can = IMMUNIZATION_ROLES.includes(role);
  return (
    <section className="panel" id="imm">
      <h2>Immunizations</h2>
      {imms.length === 0 ? (
        <p className="muted">None recorded.</p>
      ) : (
        <table className="cn-table">
          <tbody>
            {imms.map((i) => (
              <tr key={i.id}>
                <td>{formatDate(i.administeredAt)}</td>
                <td>
                  {i.vaccine}
                  <div className="muted cn-small">
                    {i.source === "HISTORICAL" ? "Historical record" : i.source === "REFUSED" ? `Refused — ${i.refusalReason ?? ""}` : [i.lotNumber && `Lot ${i.lotNumber}`, i.manufacturer && (MANUFACTURERS[i.manufacturer] ?? i.manufacturer), i.site && (SITES[i.site] ?? i.site)].filter(Boolean).join(" · ")}
                    {i.reportedAt ? " · reported to registry" : ""}
                  </div>
                </td>
                <td>
                  {can && (
                    <form action={deleteImmunization.bind(null, i.id)}>
                      <input type="hidden" name="back" value={back} />
                      <button className="btn ghost gw-mini" type="submit" aria-label={`Remove ${i.vaccine}`}>
                        Remove
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {can && (
        <details>
          <summary className="btn secondary gw-mini">+ Record immunization</summary>
          <form action={recordImmunization.bind(null, patientId)} className="form-grid gw-grid-3">
            <input type="hidden" name="back" value={back} />
            <label className="gw-span-2">
              Vaccine
              <select name="cvx" required defaultValue="">
                <option value="">Choose…</option>
                {VACCINES.map((v) => (
                  <option key={v.cvx} value={v.cvx}>
                    {v.name} (CVX {v.cvx})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Record type
              <select name="source" defaultValue="ADMINISTERED">
                <option value="ADMINISTERED">Given here</option>
                <option value="HISTORICAL">Historical (given elsewhere)</option>
                <option value="REFUSED">Patient refused</option>
              </select>
            </label>
            <label>
              Date
              <input type="date" name="administeredAt" defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
            <label>
              Lot number
              <input name="lotNumber" />
            </label>
            <label>
              Expiration
              <input type="date" name="expirationDate" />
            </label>
            <label>
              Manufacturer
              <select name="manufacturer" defaultValue="">
                <option value="">—</option>
                {Object.entries(MANUFACTURERS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Site
              <select name="site" defaultValue="">
                <option value="">—</option>
                {Object.entries(SITES).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Route
              <select name="route" defaultValue="">
                <option value="">Vaccine default</option>
                {Object.entries(ROUTES).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Dose (mL)
              <input name="doseMl" inputMode="decimal" />
            </label>
            <label>
              VIS given
              <input type="date" name="visDate" />
            </label>
            <label>
              Refusal reason
              <input name="refusalReason" />
            </label>
            <button className="btn" type="submit">
              Save
            </button>
          </form>
        </details>
      )}
    </section>
  );
}

export async function RecallsPanel({ patientId, role, back }: { patientId: string; role: string; back: string }) {
  const recalls = await prisma.recall.findMany({ where: { patientId, status: { not: "CLOSED" } }, include: { appointment: true }, orderBy: { dueDate: "asc" } });
  const can = RECALL_ROLES.includes(role);
  return (
    <section className="panel">
      <div className="gw-section-head">
        <h2>Recalls</h2>
        <Link className="muted" href="/recalls">
          Recall board
        </Link>
      </div>
      {recalls.length === 0 && <p className="muted">No open recalls.</p>}
      <ul className="pd-list">
        {recalls.map((r) => (
          <li key={r.id}>
            <span>{r.reason}</span>
            <span className="muted">due {formatDate(r.dueDate)}</span>
            <span className={`gw-tag gw-tag-${r.status === "SCHEDULED" ? "ok" : r.dueDate < new Date() ? "bad" : "info"}`}>
              {r.status === "SCHEDULED" ? `Booked ${r.appointment ? formatDate(r.appointment.startsAt) : ""}` : r.dueDate < new Date() ? "Overdue" : "Open"}
            </span>
            {can && r.status === "OPEN" && (
              <form action={closeRecall.bind(null, r.id)}>
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="reason" value="Not needed any more" />
                <button className="btn ghost gw-mini" type="submit">
                  Close
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {can && (
        <form action={createRecall} className="vw-inline pd-case-upload">
          <input type="hidden" name="patientId" value={patientId} />
          <input type="hidden" name="back" value={back} />
          <input name="reason" list="recall-reasons-chart" defaultValue="Wound re-check" aria-label="Reason" />
          <datalist id="recall-reasons-chart">
            {RECALL_REASONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <select name="weeks" defaultValue="4" aria-label="Due in">
            {[1, 2, 4, 6, 8, 12, 26, 52].map((w) => (
              <option key={w} value={w}>
                in {w < 26 ? `${w} wk` : w === 26 ? "6 mo" : "1 yr"}
              </option>
            ))}
          </select>
          <button className="btn secondary gw-mini" type="submit">
            Add recall
          </button>
        </form>
      )}
    </section>
  );
}

export function RecordsPanel({ patientId, role, sp }: { patientId: string; role: string; sp: { ccdaError?: string; ccdaApplied?: string } }) {
  const letters = LETTER_ROLES.includes(role);
  return (
    <section className="panel" id="records">
      <h2>Letters, labels &amp; records</h2>
      {sp.ccdaError && <p className="gw-error">{sp.ccdaError}</p>}
      {sp.ccdaApplied && <p className="notice-ok">{sp.ccdaApplied} items imported from the C-CDA.</p>}
      <div className="cn-actions">
        {letters && (
          <Link className="btn secondary gw-mini" href={`/patients/${patientId}/letter`}>
            Write letter
          </Link>
        )}
        {letters &&
          (["chart", "address", "barcode"] as const).map((k) => (
            <a key={k} className="btn ghost gw-mini" href={`/api/labels/${patientId}?kind=${k}&count=${k === "address" ? 1 : 30}`} target="_blank" rel="noreferrer">
              {k === "chart" ? "Chart labels" : k === "address" ? "Address label" : "Barcode labels"}
            </a>
          ))}
        <a className="btn ghost gw-mini" href={`/api/ccda/${patientId}`}>
          Export C-CDA
        </a>
        {role === "ADMIN" && (
          <Link className="btn ghost gw-mini" href={`/settings/patients/merge?a=${patientId}`}>
            Merge with another chart
          </Link>
        )}
      </div>
      <form action={uploadCcda.bind(null, patientId)} className="vw-inline pd-case-upload">
        <input type="file" name="file" accept=".xml,text/xml,application/xml" required aria-label="C-CDA file" />
        <button className="btn ghost gw-mini" type="submit">
          Import C-CDA
        </button>
      </form>
    </section>
  );
}

export async function BalancePanel({ patientId, role }: { patientId: string; role: string }) {
  if (!PAYMENT_ROLES.includes(role)) return null;
  const [{ items, totalCents }, settings, last] = await Promise.all([
    patientBalance(patientId),
    prisma.patient.findUnique({ where: { id: patientId }, select: { practice: { select: { connectSettings: true } } } }),
    prisma.patientPayment.findFirst({ where: { patientId }, orderBy: { createdAt: "desc" } }),
  ]);
  const enabled = settings?.practice.connectSettings?.paymentsEnabled;
  return (
    <section className="panel">
      <div className="gw-section-head">
        <h2>Patient balance</h2>
        <strong>{formatMoney(totalCents)}</strong>
      </div>
      {items.length > 0 && (
        <ul className="pd-list">
          {items.map((it) => (
            <li key={it.claimId}>
              <span>Visit {formatDate(it.date)}</span>
              <span className="muted">{it.number}</span>
              <span>{formatMoney(it.dueCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {CHECKOUT_ROLES.includes(role) && (
        <Link className="btn ghost gw-mini" href={`/checkout?patientId=${patientId}`}>
          Collect at the desk / receipts
        </Link>
      )}
      {last && (
        <p className="muted cn-small">
          Last pay link {formatDate(last.createdAt)} — {last.status === "PAID" ? `paid ${formatMoney(last.amountCents ?? 0)}` : last.status.toLowerCase()}
        </p>
      )}
      {totalCents > 0 &&
        (enabled ? (
          <form action={sendPaymentLink.bind(null, patientId)} className="vw-inline pd-case-upload">
            <input type="hidden" name="back" value={`/patients/${patientId}`} />
            <select name="channel" defaultValue="BOTH" aria-label="Send by">
              <option value="BOTH">Text + email</option>
              <option value="SMS">Text</option>
              <option value="EMAIL">Email</option>
              <option value="LINK">Link only</option>
            </select>
            <button className="btn secondary gw-mini" type="submit">
              Send pay link
            </button>
          </form>
        ) : (
          <p className="muted cn-small">Online payments are off (Patient Connect → Payments).</p>
        ))}
    </section>
  );
}

export async function OrdersPanel({ patientId, role }: { patientId: string; role: string }) {
  if (!ORDER_ROLES.includes(role)) return null;
  const orders = await prisma.clinicalOrder.findMany({ where: { patientId, status: { not: "CANCELLED" } }, include: { items: true, results: true }, orderBy: { createdAt: "desc" }, take: 8 });
  return (
    <section className="panel" id="orders">
      <div className="gw-section-head">
        <h2>Lab &amp; imaging orders</h2>
        {ORDER_WRITE_ROLES.includes(role) && (
          <span className="cn-actions">
            <Link className="btn ghost gw-mini" href={`/orders/new?kind=LAB&patientId=${patientId}`}>
              + Lab
            </Link>
            <Link className="btn ghost gw-mini" href={`/orders/new?kind=IMAGING&patientId=${patientId}`}>
              + Imaging
            </Link>
          </span>
        )}
      </div>
      {orders.length === 0 && <p className="muted">No orders.</p>}
      <ul className="pd-list">
        {orders.map((o) => {
          const [label, tone] = ORDER_STATUS[o.status] ?? [o.status, "info"];
          const flagged = o.results.filter((r) => r.flag !== "NORMAL");
          return (
            <li key={o.id}>
              <Link href={`/orders/${o.id}`}>
                {formatDate(o.createdAt)} · {o.items.map((i) => i.name).join(", ").slice(0, 80)}
              </Link>
              {flagged.length > 0 && <span className="gw-missing cn-small">{flagged.map((r) => `${r.name}: ${r.value ?? ""} ${RESULT_FLAGS[r.flag]}`).join("; ").slice(0, 90)}</span>}
              <span className={`gw-tag gw-tag-${tone}`}>{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export async function PatientTasksPanel({ patientId }: { patientId: string }) {
  const tasks = await prisma.task.findMany({ where: { patientId, status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 8 });
  return (
    <section className="panel">
      <div className="gw-section-head">
        <h2>Open tasks</h2>
        <Link className="btn ghost gw-mini" href={`/tasks?patientId=${patientId}#new`}>
          + Message / task
        </Link>
      </div>
      {tasks.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="pd-list">
          {tasks.map((t) => (
            <li key={t.id}>
              <Link href={`/tasks?view=all&open=${t.id}`}>{t.title}</Link>
              <span className="muted cn-small">{TASK_TYPES[t.type] ?? t.type}</span>
              {t.priority !== "NORMAL" && <span className="cn-tag">{t.priority.toLowerCase()}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export async function ReferralsPanel({ patientId, role }: { patientId: string; role: string }) {
  if (!REFERRAL_ROLES.includes(role)) return null;
  const refs = await prisma.outgoingReferral.findMany({ where: { patientId }, orderBy: { createdAt: "desc" }, take: 6 });
  return (
    <section className="panel">
      <div className="gw-section-head">
        <h2>Referrals out</h2>
        <Link className="btn ghost gw-mini" href={`/referrals/new?patientId=${patientId}`}>
          + Referral
        </Link>
      </div>
      {refs.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="pd-list">
          {refs.map((r) => {
            const [label, tone] = REFERRAL_STATUS[r.status] ?? [r.status, "info"];
            return (
              <li key={r.id}>
                <Link href={`/referrals/${r.id}`}>
                  {r.toName}
                  {r.toSpecialty ? ` · ${r.toSpecialty}` : ""}
                </Link>
                <span className="muted cn-small">{formatDate(r.sentAt ?? r.createdAt)}</span>
                <span className={`gw-tag gw-tag-${tone}`}>{label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
