import Link from "next/link";
import { notFound } from "next/navigation";
import type { Insurance } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { US_STATES, formatDate, patientName } from "@/lib/format";
import { PATIENT_EDIT_ROLES, PATIENT_VIEW_ROLES } from "@/lib/gateway";
import { payerRankLabel, relationshipToInsuredLabel } from "@/lib/claim-format";
import { savePatientInsurance } from "./actions";

const d = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : "");

function CoverageForm({
  patientId,
  ins,
  payers,
  disabled,
}: {
  patientId: string;
  ins: Insurance | null;
  payers: { id: string; name: string; payerCode: string | null }[];
  disabled: boolean;
}) {
  return (
    <form action={savePatientInsurance.bind(null, patientId, ins?.id ?? null)}>
      <fieldset className="gw-fieldset" disabled={disabled}>
        <div className="form-grid gw-grid-3">
          <label>
            Coverage
            <select name="rank" defaultValue={ins?.rank ?? "PRIMARY"}>
              {Object.entries(payerRankLabel).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Insurance payer
            <select name="payerId" defaultValue={ins?.payerId ?? ""} required>
              <option value="">—</option>
              {payers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.payerCode ? ` (${p.payerCode})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Member / subscriber ID (1a)
            <input name="memberId" defaultValue={ins?.memberId ?? ""} required />
          </label>
          <label>
            Group number (11)
            <input name="groupNumber" defaultValue={ins?.groupNumber ?? ""} />
          </label>
          <label>
            Plan name (11c)
            <input name="planName" defaultValue={ins?.planName ?? ""} />
          </label>
          <label>
            Patient relationship to insured (6)
            <select name="relationshipToInsured" defaultValue={ins?.relationshipToInsured ?? "18"}>
              {Object.entries(relationshipToInsuredLabel).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Effective date
            <input type="date" name="effectiveDate" defaultValue={d(ins?.effectiveDate)} />
          </label>
          <label>
            Termination date
            <input type="date" name="terminationDate" defaultValue={d(ins?.terminationDate)} />
          </label>
          <label className="checkbox-inline">
            <input type="hidden" name="activeField" value="1" />
            <input type="checkbox" name="active" defaultChecked={ins?.active ?? true} /> Active coverage
          </label>
        </div>
        <details className="cl-subscriber" open={Boolean(ins && ins.relationshipToInsured !== "18")}>
          <summary>Insured / subscriber (when not the patient) — boxes 4, 7, 11a</summary>
          <div className="form-grid gw-grid-3">
            <label>
              Insured first name
              <input name="insuredFirstName" defaultValue={ins?.insuredFirstName ?? ""} />
            </label>
            <label>
              Insured last name
              <input name="insuredLastName" defaultValue={ins?.insuredLastName ?? ""} />
            </label>
            <label>
              Insured date of birth
              <input type="date" name="insuredDob" defaultValue={d(ins?.insuredDob)} />
            </label>
            <label>
              Insured sex
              <select name="insuredSex" defaultValue={ins?.insuredSex ?? ""}>
                <option value="">—</option>
                <option value="F">F</option>
                <option value="M">M</option>
                <option value="U">Unknown</option>
              </select>
            </label>
            <label className="gw-span-3">
              Insured address
              <input name="insuredAddressLine1" defaultValue={ins?.insuredAddressLine1 ?? ""} />
            </label>
            <label>
              City
              <input name="insuredCity" defaultValue={ins?.insuredCity ?? ""} />
            </label>
            <label>
              State
              <select name="insuredState" defaultValue={ins?.insuredState ?? ""}>
                <option value="">—</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ZIP
              <input name="insuredZip" defaultValue={ins?.insuredZip ?? ""} />
            </label>
          </div>
        </details>
        {!disabled && (
          <div className="form-actions">
            <button className="btn" type="submit">
              {ins ? "Save coverage" : "Add coverage"}
            </button>
          </div>
        )}
      </fieldset>
    </form>
  );
}

export default async function PatientInsurancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser([...PATIENT_VIEW_ROLES, "BILLER"]);
  const { id } = await params;
  const { error } = await searchParams;
  const patient = await prisma.patient.findFirst({
    where: { id, practiceId: user.practiceId },
    include: { insurances: { include: { payer: true }, orderBy: [{ active: "desc" }, { rank: "asc" }] } },
  });
  if (!patient) notFound();
  const payers = await prisma.payer.findMany({
    where: { practiceId: user.practiceId, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, payerCode: true },
  });
  const canEdit = [...PATIENT_EDIT_ROLES, "BILLER"].includes(user.role);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href={`/patients/${patient.id}`}>« {patientName(patient)}</Link> · {patient.mrn} · DOB {formatDate(patient.dob)}
          </p>
          <h1>Insurance coverage</h1>
        </div>
      </div>
      {error && (
        <p className="gw-error" role="alert">
          {error}
        </p>
      )}
      {patient.insurances.map((ins) => (
        <section key={ins.id} className="panel">
          <div className="gw-section-head">
            <h2>
              {payerRankLabel[ins.rank] ?? ins.rank}: {ins.payer.name}
            </h2>
            <span className={`gw-tag gw-tag-${ins.active ? "ok" : "muted"}`}>{ins.active ? "Active" : "Inactive"}</span>
          </div>
          <CoverageForm patientId={patient.id} ins={ins} payers={payers} disabled={!canEdit} />
        </section>
      ))}
      {canEdit && (
        <section className="panel">
          <h2>Add coverage</h2>
          <CoverageForm patientId={patient.id} ins={null} payers={payers} disabled={false} />
        </section>
      )}
    </div>
  );
}
