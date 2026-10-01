import Link from "next/link";
import type { EligibilityCheck, Insurance, InsuranceAuthorization, Payer } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { US_STATES, eligibilityStatusLabel, formatDate, formatMoney, formatTime } from "@/lib/format";
import { PATIENT_EDIT_ROLES, PATIENT_VIEW_ROLES } from "@/lib/gateway";
import { PAYER_RANKS, payerRankLabel, relationshipToInsuredLabel } from "@/lib/claim-format";
import { sexLabel, splitName, yesNoUnknownLabel } from "@/lib/patient-fields";
import { DOC_TYPES } from "@/lib/patient-docs";
import { PatientShell, loadPatientShell } from "../patient-shell";
import { checkCoverageEligibility, deleteAuthorization, deletePatientInsurance, saveAuthorization, savePatientInsurance, setInsuranceActive } from "./actions";

const day = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : "");
const dollars = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(2));
const money = (c: number | null | undefined) => (c === null || c === undefined ? "" : formatMoney(c));
const AUTH_REASONS = ["Initial evaluation", "Follow-up visits", "Wound care treatment", "Debridement", "Skin substitute application", "Home visit", "Telehealth", "Other"];

type Coverage = Insurance & { payer: Payer; authorizations: InsuranceAuthorization[] };
type Prefill = Partial<{ payerId: string; memberId: string; groupNumber: string; groupName: string; insuredFirstName: string; insuredLastName: string }>;
type Search = { tab?: string; add?: string; edit?: string; scan?: string; auth?: string; error?: string; ok?: string };

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === "" ? "" : value}</dd>
    </>
  );
}

function YesNo({ name, value }: { name: string; value: string | null | undefined }) {
  return (
    <select name={name} defaultValue={value ?? ""}>
      <option value="" />
      {Object.entries(yesNoUnknownLabel).map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </select>
  );
}

function CoverageForm({ patientId, ins, payers, prefill, taken }: { patientId: string; ins: Coverage | null; payers: Pick<Payer, "id" | "name">[]; prefill: Prefill; taken: Record<string, string> }) {
  const holder = ins ? ins.relationshipToInsured === "18" : !prefill.insuredFirstName;
  return (
    <form action={savePatientInsurance.bind(null, patientId, ins?.id ?? null)} className="ins-form">
      <div className="ins-cols">
        <div className="ins-fields">
          <label>
            Insurance payer
            <select name="payerId" defaultValue={ins?.payerId ?? prefill.payerId ?? ""} required>
              <option value="" />
              {payers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="reg-radio">
            <legend>Insurance classification</legend>
            {PAYER_RANKS.map((r) => (
              <label key={r} className="checkbox-inline">
                <input type="radio" name="rank" value={r} defaultChecked={ins ? ins.rank === r : !taken[r] && PAYER_RANKS.find((x) => !taken[x]) === r} required /> {payerRankLabel[r]}
              </label>
            ))}
          </fieldset>
          {!ins && Object.keys(taken).length > 0 && (
            <p className="ins-warn">
              {Object.entries(taken)
                .map(([r, name]) => `Patient currently has ${name} as ${payerRankLabel[r].toLowerCase()} insurance`)
                .join(". ")}
              . Saving another coverage with the same classification sets the current one inactive.
            </p>
          )}
          <label>
            Copay
            <input name="copay" defaultValue={dollars(ins?.copayCents)} inputMode="decimal" />
          </label>
          <label>
            Deductible amount
            <input name="deductible" defaultValue={dollars(ins?.deductibleCents)} inputMode="decimal" />
          </label>
          <label>
            Deductible met
            <input name="deductibleMet" defaultValue={dollars(ins?.deductibleMetCents)} inputMode="decimal" />
          </label>
          <label>
            Percent coverage
            <input name="coveragePercent" defaultValue={ins?.coveragePercent ?? ""} inputMode="numeric" />
          </label>
          <label>
            Verification date
            <input type="date" name="verifiedAt" defaultValue={day(ins?.verifiedAt)} />
          </label>
          <label>
            Verified with
            <input name="verifiedWith" defaultValue={ins?.verifiedWith ?? ""} />
          </label>
          <fieldset className="reg-radio">
            <legend>Is the patient the policy holder?</legend>
            <label className="checkbox-inline">
              <input type="radio" name="holder" value="yes" defaultChecked={holder} /> Yes
            </label>
            <label className="checkbox-inline">
              <input type="radio" name="holder" value="no" defaultChecked={!holder} /> No
            </label>
          </fieldset>
        </div>
        <div className="ins-fields">
          <label>
            Policy number
            <input name="memberId" defaultValue={ins ? (ins.memberId === "PENDING" ? "" : ins.memberId) : (prefill.memberId ?? "")} />
          </label>
          <label>
            Group name
            <input name="groupName" defaultValue={ins?.groupName ?? prefill.groupName ?? ""} />
          </label>
          <label>
            Group number
            <input name="groupNumber" defaultValue={ins?.groupNumber ?? prefill.groupNumber ?? ""} />
          </label>
          <label>
            Effective date
            <input type="date" name="effectiveDate" defaultValue={day(ins?.effectiveDate)} />
          </label>
          <label>
            Termination date
            <input type="date" name="terminationDate" defaultValue={day(ins?.terminationDate)} />
          </label>
          <label>
            Authorization required
            <YesNo name="authRequired" value={ins?.authRequired} />
          </label>
          <label>
            Prior authorization required
            <YesNo name="priorAuthRequired" value={ins?.priorAuthRequired} />
          </label>
        </div>
      </div>

      <div className="ins-holder">
        <h4>Policy holder information</h4>
        <div className="ins-cols">
          <div className="ins-fields">
            <label>
              First name
              <input name="insuredFirstName" defaultValue={ins?.insuredFirstName ?? prefill.insuredFirstName ?? ""} />
            </label>
            <label>
              Middle name
              <input name="insuredMiddleName" defaultValue={ins?.insuredMiddleName ?? ""} />
            </label>
            <label>
              Last name
              <input name="insuredLastName" defaultValue={ins?.insuredLastName ?? prefill.insuredLastName ?? ""} />
            </label>
            <label>
              DOB of insured
              <input type="date" name="insuredDob" defaultValue={day(ins?.insuredDob)} />
            </label>
            <label>
              Telephone
              <input name="insuredPhone" defaultValue={ins?.insuredPhone ?? ""} inputMode="tel" />
            </label>
            <label>
              Sex
              <select name="insuredSex" defaultValue={ins?.insuredSex ?? ""}>
                <option value="" />
                {Object.entries(sexLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Patient relationship to insured
              <select name="relationship" defaultValue={ins && ins.relationshipToInsured !== "18" ? ins.relationshipToInsured : ""}>
                <option value="" />
                {Object.entries(relationshipToInsuredLabel)
                  .filter(([k]) => k !== "18")
                  .map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="ins-fields">
            <label>
              Address line 1
              <input name="insuredAddress1" defaultValue={ins?.insuredAddressLine1 ?? ""} />
            </label>
            <label>
              Address line 2
              <input name="insuredAddress2" />
            </label>
            <label>
              City
              <input name="insuredCity" defaultValue={ins?.insuredCity ?? ""} />
            </label>
            <label>
              State
              <select name="insuredState" defaultValue={ins?.insuredState ?? ""}>
                <option value="" />
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Zip code
              <input name="insuredZip" defaultValue={ins?.insuredZip ?? ""} maxLength={10} />
            </label>
          </div>
        </div>
      </div>

      <label className="ins-notes">
        Notes
        <textarea name="notes" defaultValue={ins?.notes ?? ""} rows={2} maxLength={2000} />
      </label>
      <div className="form-actions">
        <Link className="btn ghost" href={`/patients/${patientId}/insurance`}>
          Cancel
        </Link>
        <button className="btn" type="submit">
          Submit
        </button>
      </div>
    </form>
  );
}

function AuthForm({ patientId, insuranceId, kind, auth, staff }: { patientId: string; insuranceId: string; kind: "ENCOUNTER" | "PROCEDURE"; auth: InsuranceAuthorization | null; staff: string[] }) {
  return (
    <form action={saveAuthorization.bind(null, patientId, insuranceId, kind, auth?.id ?? null)} className="ins-form ins-auth-form">
      <div className="ins-cols">
        <div className="ins-fields">
          {kind === "PROCEDURE" && (
            <label>
              Procedure code (CPT / HCPCS)
              <input name="procedureCode" defaultValue={auth?.procedureCode ?? ""} maxLength={10} required />
            </label>
          )}
          <label>
            Authorization reason
            <select name="reason" defaultValue={auth?.reason ?? ""}>
              <option value="" />
              {(auth?.reason && !AUTH_REASONS.includes(auth.reason) ? [...AUTH_REASONS, auth.reason] : AUTH_REASONS).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Number of authorizations
            <input name="authorizedCount" defaultValue={auth?.authorizedCount ?? ""} inputMode="numeric" />
          </label>
          <label>
            Start date
            <input type="date" name="startDate" defaultValue={day(auth?.startDate)} />
          </label>
          <label>
            End date
            <input type="date" name="endDate" defaultValue={day(auth?.endDate)} />
          </label>
        </div>
        <div className="ins-fields">
          <label>
            Authorization number
            <input name="authNumber" defaultValue={auth?.authNumber ?? ""} />
          </label>
          <label>
            Insurance contact
            <input name="insuranceContact" defaultValue={auth?.insuranceContact ?? ""} />
          </label>
          <label>
            Verification date
            <input type="date" name="verifiedAt" defaultValue={day(auth?.verifiedAt)} />
          </label>
          <label>
            Verified by
            <select name="verifiedBy" defaultValue={auth?.verifiedBy ?? ""}>
              <option value="" />
              {(auth?.verifiedBy && !staff.includes(auth.verifiedBy) ? [...staff, auth.verifiedBy] : staff).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <label className="ins-notes">
        Notes
        <textarea name="notes" defaultValue={auth?.notes ?? ""} rows={2} maxLength={1000} />
      </label>
      <div className="form-actions">
        <Link className="btn ghost" href={`/patients/${patientId}/insurance`}>
          Cancel
        </Link>
        <button className="btn" type="submit">
          Save
        </button>
      </div>
    </form>
  );
}

function AuthSchedules({ patientId, ins, kind, sp, canEdit, staff, used }: { patientId: string; ins: Coverage; kind: "ENCOUNTER" | "PROCEDURE"; sp: Search; canEdit: boolean; staff: string[]; used: Map<string, number> }) {
  const label = kind === "ENCOUNTER" ? "Encounter" : "Procedure";
  const rows = ins.authorizations.filter((a) => a.kind === kind);
  const key = `${ins.id}.${kind}`;
  const editing = rows.find((a) => sp.auth === a.id);
  return (
    <div className="ins-sub">
      <div className="gw-section-head">
        <h4>
          {label} authorization schedule(s) for {ins.payer.name}
        </h4>
        {canEdit && sp.auth !== key && !editing && <Link href={`/patients/${patientId}/insurance?auth=${key}#ins-${ins.id}`}>+ Add {label.toLowerCase()} authorization schedule</Link>}
      </div>
      {sp.auth === key && <AuthForm patientId={patientId} insuranceId={ins.id} kind={kind} auth={null} staff={staff} />}
      {editing && <AuthForm patientId={patientId} insuranceId={ins.id} kind={kind} auth={editing} staff={staff} />}
      {rows.length > 0 && (
        <table className="cn-table">
          <thead>
            <tr>
              {kind === "PROCEDURE" && <th>Procedure</th>}
              <th>Reason</th>
              <th>Authorization #</th>
              <th>Authorized</th>
              {kind === "ENCOUNTER" && <th>Used</th>}
              <th>Start – end</th>
              <th>Verified</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const expired = a.endDate && a.endDate.getTime() < Date.now();
              const usedCount = used.get(a.id) ?? 0;
              return (
                <tr key={a.id}>
                  {kind === "PROCEDURE" && <td>{a.procedureCode}</td>}
                  <td>
                    {a.reason}
                    {a.notes && <div className="muted cn-small">{a.notes}</div>}
                  </td>
                  <td>{a.authNumber}</td>
                  <td>{a.authorizedCount ?? ""}</td>
                  {kind === "ENCOUNTER" && (
                    <td>
                      {usedCount}
                      {a.authorizedCount !== null && usedCount >= a.authorizedCount && <span className="gw-tag gw-tag-bad"> used up</span>}
                    </td>
                  )}
                  <td>
                    {a.startDate ? formatDate(a.startDate) : ""} – {a.endDate ? formatDate(a.endDate) : ""}
                    {expired && <span className="gw-tag gw-tag-bad"> expired</span>}
                  </td>
                  <td>
                    {a.verifiedAt ? formatDate(a.verifiedAt) : ""}
                    {a.verifiedBy ? ` · ${a.verifiedBy}` : ""}
                    {a.insuranceContact && <div className="muted cn-small">Contact {a.insuranceContact}</div>}
                  </td>
                  <td className="gw-actions">
                    {canEdit && (
                      <>
                        <Link className="btn ghost gw-mini" href={`/patients/${patientId}/insurance?auth=${a.id}#ins-${ins.id}`}>
                          Edit
                        </Link>
                        <form action={deleteAuthorization.bind(null, patientId, a.id)}>
                          <button className="btn ghost gw-mini" type="submit">
                            Remove
                          </button>
                        </form>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Eligibility({ patientId, ins, checks, nameOf }: { patientId: string; ins: Coverage; checks: EligibilityCheck[]; nameOf: (id: string | null) => string }) {
  const latest = checks[0];
  return (
    <div className="ins-sub">
      <h4>Eligibility inquiry and results</h4>
      <div className="ins-elig">
        <h5>Latest eligibility</h5>
        {latest ? (
          <dl className="ins-facts">
            <Fact label="Eligibility status" value={latest.status === "ACTIVE" ? "Active coverage" : (eligibilityStatusLabel[latest.status] ?? latest.status)} />
            <Fact label="Plan" value={latest.planName} />
            <Fact label="Insurance effective date" value={ins.effectiveDate ? formatDate(ins.effectiveDate) : "-"} />
            <Fact label="Insurance term date" value={ins.terminationDate ? formatDate(ins.terminationDate) : "-"} />
            <Fact label="Copay" value={money(latest.copayCents)} />
            <Fact label="Coinsurance" value={latest.coinsurancePercent !== null ? `${latest.coinsurancePercent}%` : ""} />
            <Fact label="Deductible remaining" value={money(latest.deductibleRemainingCents)} />
            <Fact label="Out-of-pocket remaining" value={money(latest.outOfPocketRemainingCents)} />
            <Fact label="Verified on" value={`${formatDate(latest.checkedAt)} ${formatTime(latest.checkedAt)}`} />
            <Fact label="Verified by" value={nameOf(latest.checkedById)} />
            {latest.payerMessage && <Fact label="Payer message" value={latest.payerMessage} />}
          </dl>
        ) : (
          <p className="muted">No eligibility check has been run for this coverage.</p>
        )}
        <div className="gw-actions">
          <form action={checkCoverageEligibility.bind(null, patientId, ins.id, "insurance")}>
            <button className="btn secondary" type="submit">
              Check eligibility
            </button>
          </form>
          {latest?.benefits && (
            <Link className="btn secondary" href={`/patients/${patientId}/insurance/benefits/${latest.id}`}>
              View / print benefits
            </Link>
          )}
        </div>
      </div>
      {checks.length > 1 && (
        <details>
          <summary className="muted">Past eligibility checks ({checks.length - 1})</summary>
          <table className="cn-table">
            <thead>
              <tr>
                <th>Checked</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Copay</th>
                <th>Deductible remaining</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {checks.slice(1).map((c) => (
                <tr key={c.id}>
                  <td>
                    {formatDate(c.checkedAt)} {formatTime(c.checkedAt)}
                  </td>
                  <td>{eligibilityStatusLabel[c.status] ?? c.status}</td>
                  <td>{c.planName}</td>
                  <td>{money(c.copayCents)}</td>
                  <td>{money(c.deductibleRemainingCents)}</td>
                  <td>{nameOf(c.checkedById)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

export default async function PatientInsurancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const user = await requireUser([...PATIENT_VIEW_ROLES, "BILLER"]);
  const { id } = await params;
  const sp = await searchParams;
  const shell = await loadPatientShell(id, user);
  const canEdit = [...PATIENT_EDIT_ROLES, "BILLER"].includes(user.role);
  const tab = sp.tab === "inactive" ? "inactive" : "active";

  const [coverages, payers, checks, members, scans, appts] = await Promise.all([
    prisma.insurance.findMany({ where: { patientId: id }, include: { payer: true, authorizations: { orderBy: { createdAt: "desc" } } }, orderBy: [{ rank: "asc" }, { id: "desc" }] }),
    prisma.payer.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.eligibilityCheck.findMany({ where: { patientId: id, practiceId: user.practiceId }, orderBy: { checkedAt: "desc" }, take: 60 }),
    prisma.membership.findMany({ where: { practiceId: user.practiceId, user: { active: true } }, include: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } }),
    prisma.patientDocument.findMany({ where: { patientId: id, practiceId: user.practiceId, extraction: { not: null } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, name: true, docType: true, extraction: true } }),
    prisma.appointment.findMany({ where: { patientId: id, practiceId: user.practiceId, status: { notIn: ["CANCELLED", "NO_SHOW"] } }, select: { startsAt: true } }),
  ]);
  const shown = coverages.filter((c) => (tab === "active" ? c.active : !c.active));
  const audits = shown.length
    ? await prisma.auditLog.findMany({ where: { practiceId: user.practiceId, entityType: "Insurance", entityId: { in: shown.map((c) => c.id) } }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 200 })
    : [];
  const nameOf = (uid: string | null) => members.find((m) => m.user.id === uid)?.user.name ?? "";
  const staff = members.map((m) => m.user.name);
  const taken = Object.fromEntries(coverages.filter((c) => c.active).map((c) => [c.rank, c.payer.name]));

  // Visits that fall inside each encounter authorization count against it.
  const used = new Map<string, number>();
  for (const c of coverages)
    for (const a of c.authorizations)
      if (a.kind === "ENCOUNTER")
        used.set(a.id, appts.filter((v) => (!a.startDate || v.startsAt >= a.startDate) && (!a.endDate || v.startsAt.getTime() <= a.endDate.getTime() + 43_200_000) && (a.startDate || a.endDate)).length);

  // "Add insurance from scan": documents the reader pulled insurance details out of.
  const insuranceScans = scans
    .map((s) => {
      try {
        const f = (JSON.parse(s.extraction ?? "{}").fields ?? {}) as Record<string, { value?: string }>;
        const get = (k: string) => String(f[k]?.value ?? "").trim();
        return { id: s.id, name: s.name, docType: s.docType, payerName: get("insurance.payerName"), memberId: get("insurance.memberId"), groupNumber: get("insurance.groupNumber"), planName: get("insurance.groupName") || get("insurance.planName"), subscriber: get("insurance.subscriberName") };
      } catch {
        return null;
      }
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s && (s.payerName || s.memberId)));
  const scan = sp.scan ? insuranceScans.find((s) => s.id === sp.scan) : undefined;
  const prefill: Prefill = {};
  if (scan) {
    const wanted = scan.payerName.toLowerCase();
    const match = wanted ? payers.find((p) => p.name.toLowerCase() === wanted) ?? payers.find((p) => p.name.toLowerCase().includes(wanted) || wanted.includes(p.name.toLowerCase())) : undefined;
    if (match) prefill.payerId = match.id;
    if (scan.memberId) prefill.memberId = scan.memberId;
    if (scan.groupNumber) prefill.groupNumber = scan.groupNumber;
    if (scan.planName) prefill.groupName = scan.planName;
    if (scan.subscriber) [prefill.insuredFirstName, prefill.insuredLastName] = splitName(scan.subscriber);
  }
  const adding = canEdit && (sp.add === "1" || Boolean(scan));

  return (
    <PatientShell data={shell}>
      <p className="pd-back">
        <Link href={`/patients/${id}`}>« Back to dashboard</Link>
      </p>
      <div className="pd-head">
        <h1>Insurance</h1>
        <div className="gw-actions">
          <Link href={`/patients/${id}/insurance/report`}>Insurance authorization report</Link>
          {canEdit && (
            <>
              <Link className="btn" href={`/patients/${id}/insurance?add=1`}>
                Add insurance payer
              </Link>
              <details className="quick-actions">
                <summary>Add insurance from scan</summary>
                <ul>
                  {insuranceScans.map((s) => (
                    <li key={s.id}>
                      <Link href={`/patients/${id}/insurance?scan=${s.id}`}>
                        {s.name}
                        <span className="muted"> · {[s.payerName, s.memberId].filter(Boolean).join(" · ")}</span>
                      </Link>
                    </li>
                  ))}
                  {insuranceScans.length === 0 && (
                    <li>
                      <Link href={`/patients/${id}/scans`}>No scan with insurance details yet — add one under Scans ({DOC_TYPES.INSURANCE_CARD.toLowerCase()})</Link>
                    </li>
                  )}
                </ul>
              </details>
            </>
          )}
        </div>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}

      <nav className="cn-filters">
        <Link href={`/patients/${id}/insurance`} className={tab === "active" ? "active" : ""}>
          Active ({coverages.filter((c) => c.active).length})
        </Link>
        <Link href={`/patients/${id}/insurance?tab=inactive`} className={tab === "inactive" ? "active" : ""}>
          Inactive ({coverages.filter((c) => !c.active).length})
        </Link>
      </nav>

      {adding && (
        <section className="panel">
          <h2>Add insurance payer</h2>
          {scan && (
            <p className="muted">
              Filled in from the scan “{scan.name}”
              {scan.payerName && !prefill.payerId ? ` — the payer “${scan.payerName}” isn't in the insurance directory, so choose it by hand` : ""}. Check every field before saving.
            </p>
          )}
          <CoverageForm patientId={id} ins={null} payers={payers} prefill={prefill} taken={taken} />
        </section>
      )}

      {shown.length === 0 && !adding && (
        <section className="panel">
          <p className="muted">{tab === "active" ? "No active insurance — the patient is self-pay." : "No inactive coverages."}</p>
        </section>
      )}

      {shown.map((ins) => {
        const mine = checks.filter((c) => c.insuranceId === ins.id || (!c.insuranceId && c.payerId === ins.payerId));
        const log = audits.filter((a) => a.entityId === ins.id);
        const holder = ins.relationshipToInsured === "18";
        return (
          <section key={ins.id} className="panel ins-card" id={`ins-${ins.id}`}>
            <div className="gw-section-head">
              <h2>{ins.payer.name}</h2>
              {canEdit && sp.edit !== ins.id && (
                <div className="gw-actions">
                  <form action={setInsuranceActive.bind(null, id, ins.id, !ins.active)}>
                    <button className="btn secondary gw-mini" type="submit">
                      {ins.active ? "Set inactive" : "Set active"}
                    </button>
                  </form>
                  <form action={deletePatientInsurance.bind(null, id, ins.id)}>
                    <button className="btn secondary gw-mini" type="submit">
                      Delete
                    </button>
                  </form>
                  <Link className="btn gw-mini" href={`/patients/${id}/insurance?edit=${ins.id}${ins.active ? "" : "&tab=inactive"}#ins-${ins.id}`}>
                    Edit
                  </Link>
                </div>
              )}
            </div>

            {sp.edit === ins.id && canEdit ? (
              <CoverageForm patientId={id} ins={ins} payers={payers.some((p) => p.id === ins.payerId) ? payers : [...payers, ins.payer]} prefill={{}} taken={{}} />
            ) : (
              <div className="ins-cols">
                <dl className="ins-facts">
                  <Fact label="Insurance classification" value={payerRankLabel[ins.rank] ?? ins.rank} />
                  <Fact label="Copay" value={money(ins.copayCents)} />
                  <Fact label="Deductible amount" value={money(ins.deductibleCents)} />
                  <Fact label="Deductible met" value={money(ins.deductibleMetCents)} />
                  <Fact label="Percent coverage" value={ins.coveragePercent !== null ? `${ins.coveragePercent}%` : ""} />
                  <Fact label="Verification date" value={ins.verifiedAt ? formatDate(ins.verifiedAt) : ""} />
                  <Fact label="Verified with" value={ins.verifiedWith} />
                  <Fact label="Is the patient the policy holder?" value={holder ? "Yes" : "No"} />
                  {!holder && (
                    <Fact
                      label="Policy holder"
                      value={[
                        [ins.insuredFirstName, ins.insuredMiddleName, ins.insuredLastName].filter(Boolean).join(" "),
                        relationshipToInsuredLabel[ins.relationshipToInsured] ? `patient is ${relationshipToInsuredLabel[ins.relationshipToInsured].toLowerCase()}` : "",
                        ins.insuredDob ? `DOB ${formatDate(ins.insuredDob)}` : "",
                        ins.insuredPhone ?? "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  )}
                  <Fact label="Notes" value={ins.notes} />
                </dl>
                <dl className="ins-facts">
                  <Fact label="Policy number" value={ins.memberId === "PENDING" ? "" : ins.memberId} />
                  <Fact label="Group name" value={ins.groupName ?? ins.planName} />
                  <Fact label="Group number" value={ins.groupNumber} />
                  <Fact label="Effective date" value={ins.effectiveDate ? formatDate(ins.effectiveDate) : ""} />
                  <Fact label="Termination date" value={ins.terminationDate ? formatDate(ins.terminationDate) : ""} />
                  <Fact label="Authorization required" value={yesNoUnknownLabel[ins.authRequired ?? ""]} />
                  <Fact label="Prior authorization required" value={yesNoUnknownLabel[ins.priorAuthRequired ?? ""]} />
                </dl>
              </div>
            )}

            <AuthSchedules patientId={id} ins={ins} kind="ENCOUNTER" sp={sp} canEdit={canEdit} staff={staff} used={used} />
            <AuthSchedules patientId={id} ins={ins} kind="PROCEDURE" sp={sp} canEdit={canEdit} staff={staff} used={used} />
            <Eligibility patientId={id} ins={ins} checks={mine} nameOf={nameOf} />

            <details className="ins-sub">
              <summary>Patient insurance audit ({log.length})</summary>
              {log.length === 0 ? (
                <p className="muted">No changes recorded for this coverage.</p>
              ) : (
                <table className="cn-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>What</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((a) => (
                      <tr key={a.id}>
                        <td>
                          {formatDate(a.createdAt)} {formatTime(a.createdAt)}
                        </td>
                        <td>{a.user?.name ?? "System"}</td>
                        <td>{a.action.replaceAll("_", " ").toLowerCase()}</td>
                        <td>{a.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </details>
          </section>
        );
      })}
    </PatientShell>
  );
}
