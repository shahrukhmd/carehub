import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { DX_LETTERS, PAYER_RANKS, claimNumber, claimStatusLabel, payerRankLabel } from "@/lib/claim-format";
import { ageFromDob, formatDate, formatMoney, patientName, visitTypeLabel } from "@/lib/format";
import { placeOfServiceLabel } from "@/lib/superbill";
import { SIGNED_STATUSES } from "@/lib/visit-workflow";
import { BillingTabs, ClaimsMenu } from "../../tabs";
import { createClaimForVisit, createManualClaim } from "../batch-actions";

const ADJUDICATED = ["PAID", "PARTIAL", "DENIED", "TRANSFERRED", "WRITTEN_OFF"];
const MANUAL_DIAGNOSES = 4;
const MANUAL_LINES = 6;
type Search = { q?: string; patient?: string; error?: string };

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Create new claim: pick the patient, then either turn one of their signed visits into a claim (everything is
// copied from the chart) or key a claim by hand for a service that has no chart visit here.
export default async function NewClaimPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("billing.work"));
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";

  const patient = sp.patient
    ? await prisma.patient.findFirst({
        where: { id: sp.patient, practiceId: user.practiceId },
        include: { insurances: { where: { active: true }, include: { payer: true }, orderBy: { rank: "asc" } } },
      })
    : null;

  const matches =
    !patient && q.length >= 2
      ? await prisma.patient.findMany({
          where: { practiceId: user.practiceId, OR: [{ lastName: { contains: q } }, { firstName: { contains: q } }, { mrn: { startsWith: q } }] },
          include: { insurances: { where: { active: true, rank: "PRIMARY" }, include: { payer: true } } },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: 25,
        })
      : [];

  const [visits, providers, codes] = patient
    ? await Promise.all([
        prisma.encounter.findMany({
          where: { practiceId: user.practiceId, patientId: patient.id, status: { in: SIGNED_STATUSES } },
          include: { provider: { select: { name: true } }, charges: true, claims: { where: { status: { not: "VOID" } } }, appointment: { select: { startsAt: true } } },
          orderBy: { date: "desc" },
          take: 40,
        }),
        prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId, isRendering: true, status: "ACTIVE", userId: { not: null } }, orderBy: { name: "asc" }, select: { id: true, name: true, credential: true } }),
        prisma.practiceCode.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { code: "asc" } }),
      ])
    : [[], [], []];
  const ranks = patient ? patient.insurances.map((i) => i.rank).filter((r, i, a) => a.indexOf(r) === i) : [];

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/billing">Revenue cycle</Link>
          </p>
          <h1>Create new claim</h1>
        </div>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <BillingTabs active="claims" />
      <ClaimsMenu active="new" />

      {/* ---------------- Step 1: patient ---------------- */}
      {!patient && (
        <section className="panel">
          <div className="gw-section-head">
            <h2>1 · Find the patient</h2>
          </div>
          <form method="get" className="cm-bar cm-bar-plain">
            <label>
              Patient name or MRN
              <input name="q" defaultValue={q} placeholder="At least 2 characters" autoFocus required minLength={2} />
            </label>
            <button className="btn" type="submit">
              Search
            </button>
          </form>
          {q.length >= 2 && (
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>MRN</th>
                  <th>Date of birth</th>
                  <th>Primary insurance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {matches.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/billing/claims/new?patient=${p.id}`}>{patientName(p)}</Link>
                    </td>
                    <td>{p.mrn}</td>
                    <td>{formatDate(p.dob)}</td>
                    <td>{p.insurances[0]?.payer.name ?? <span className="muted">No insurance on file</span>}</td>
                    <td className="num">
                      <Link className="btn secondary gw-mini" href={`/billing/claims/new?patient=${p.id}`}>
                        Select
                      </Link>
                    </td>
                  </tr>
                ))}
                {matches.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No patient found for “{q}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </section>
      )}

      {patient && (
        <>
          <section className="panel cd-strip">
            <div>
              <span>Patient</span>
              <strong>
                <Link href={`/patients/${patient.id}`}>{patientName(patient)}</Link>
              </strong>
            </div>
            <div>
              <span>MRN</span>
              <strong>{patient.mrn}</strong>
            </div>
            <div>
              <span>Date of birth</span>
              <strong>
                {formatDate(patient.dob)} · {ageFromDob(patient.dob)} y
              </strong>
            </div>
            {patient.insurances.map((i) => (
              <div key={i.id}>
                <span>{payerRankLabel[i.rank] ?? i.rank} insurance</span>
                <strong>
                  {i.payer.name} · {i.memberId}
                </strong>
              </div>
            ))}
            {patient.insurances.length === 0 && (
              <div>
                <span>Insurance</span>
                <strong className="cd-bad">None on file</strong>
              </div>
            )}
            <nav className="cd-prevnext">
              <Link className="btn secondary gw-mini" href={`/patients/${patient.id}/claims`}>
                Patient account
              </Link>
              <Link className="btn ghost gw-mini" href="/billing/claims/new">
                Change patient
              </Link>
            </nav>
          </section>

          {patient.insurances.length === 0 && (
            <p className="gw-error">
              This patient has no active insurance, so there is no payer to bill. <Link href={`/patients/${patient.id}/insurance`}>Add the coverage</Link> first.
            </p>
          )}

          {/* ---------------- From a signed visit ---------------- */}
          <section className="panel">
            <div className="gw-section-head">
              <h2>From a signed visit</h2>
              <span className="muted">Diagnoses, charges, providers and authorization are copied from the chart.</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Date of service</th>
                  <th>Visit</th>
                  <th>Provider</th>
                  <th className="num">Charges</th>
                  <th>Claims so far</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => {
                  const total = v.charges.reduce((s, c) => s + c.amountCents, 0);
                  const has = (r: string) => v.claims.some((c) => c.payerRank === r && c.frequencyCode !== "8");
                  // The next payer can be billed once the one before it has answered.
                  const open = ranks.filter((r) => {
                    const before = PAYER_RANKS[PAYER_RANKS.indexOf(r) - 1];
                    return !has(r) && (!before || v.claims.some((c) => c.payerRank === before && ADJUDICATED.includes(c.status)));
                  });
                  return (
                    <tr key={v.id}>
                      <td>{formatDate(v.appointment?.startsAt ?? v.date)}</td>
                      <td>
                        <Link href={`/encounters/${v.id}`}>{visitTypeLabel[v.type] ?? v.type}</Link>
                      </td>
                      <td>{v.provider.name}</td>
                      <td className="num">{v.charges.length ? formatMoney(total) : <span className="muted">No charges</span>}</td>
                      <td>
                        {v.claims.map((c) => (
                          <Link key={c.id} className="gw-tag gw-tag-info" href={`/billing/claims/${c.id}`}>
                            {claimNumber(c)} · {payerRankLabel[c.payerRank]} · {claimStatusLabel[c.status] ?? c.status}
                          </Link>
                        ))}
                        {v.claims.length === 0 && <span className="muted">None</span>}
                      </td>
                      <td className="num cm-row-actions">
                        {v.charges.length > 0 &&
                          open.map((r) => (
                            <form key={r} action={createClaimForVisit.bind(null, patient.id, v.id, r)}>
                              <button className={`btn gw-mini${r === "PRIMARY" ? "" : " secondary"}`} type="submit">
                                Create {payerRankLabel[r]?.toLowerCase()} claim
                              </button>
                            </form>
                          ))}
                      </td>
                    </tr>
                  );
                })}
                {visits.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      This patient has no signed visits. A visit shows here once the provider signs it.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {/* ---------------- Keyed by billing ---------------- */}
          <details className="panel cm-manual" open={Boolean(sp.error) || visits.length === 0}>
            <summary>
              <strong>Claim without a chart visit</strong>
              <span className="muted"> — key the services yourself (a late charge, or a visit documented outside CareHub)</span>
            </summary>
            <form action={createManualClaim.bind(null, patient.id)} className="cm-form">
              <fieldset>
                <legend>Claim details</legend>
                <div className="cm-grid">
                  <label>
                    Bill to
                    <select name="rank" defaultValue="PRIMARY" required>
                      {patient.insurances.map((i) => (
                        <option key={i.id} value={i.rank}>
                          {payerRankLabel[i.rank] ?? i.rank} · {i.payer.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Date of service
                    <input type="date" name="dos" max={today()} required />
                  </label>
                  <label>
                    Rendering provider
                    <select name="provider" required defaultValue="">
                      <option value="" disabled>
                        Select…
                      </option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.credential ? `, ${p.credential}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Place of service
                    <select name="placeOfService" defaultValue="11">
                      {Object.entries(placeOfServiceLabel).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </fieldset>

              <fieldset>
                <legend>Claim diagnoses (ICD-10)</legend>
                <div className="cm-grid">
                  {Array.from({ length: MANUAL_DIAGNOSES }, (_, i) => (
                    <label key={i}>
                      Diagnosis {DX_LETTERS[i]}
                      <input name={`dx_${i}`} list="cm-dx" placeholder={i === 0 ? "e.g. L97.412" : "Optional"} required={i === 0} autoComplete="off" />
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend>Claim lines</legend>
                <table className="cm-lines">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>CPT / HCPCS</th>
                      <th>Modifiers</th>
                      <th>Units</th>
                      <th>Charge ($)</th>
                      <th>Dx pointers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: MANUAL_LINES }, (_, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>
                          <input name={`l_${i}_cpt`} list="cm-cpt" maxLength={5} required={i === 0} aria-label={`Line ${i + 1} code`} autoComplete="off" />
                        </td>
                        <td>
                          <input name={`l_${i}_mod`} placeholder="e.g. 25 59" aria-label={`Line ${i + 1} modifiers`} />
                        </td>
                        <td>
                          <input name={`l_${i}_units`} type="number" min="1" step="1" defaultValue={1} aria-label={`Line ${i + 1} units`} />
                        </td>
                        <td>
                          <input name={`l_${i}_charge`} inputMode="decimal" placeholder="Fee schedule" aria-label={`Line ${i + 1} charge`} />
                        </td>
                        <td>
                          <input name={`l_${i}_ptr`} defaultValue="A" placeholder="A,B" aria-label={`Line ${i + 1} diagnosis pointers`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted">Leave the charge empty to use the practice fee schedule (fee × units). Referring provider, authorization, dates and notes are filled in on the claim after it is created.</p>
              </fieldset>

              <datalist id="cm-dx">
                {codes
                  .filter((c) => c.type === "ICD10")
                  .map((c) => (
                    <option key={c.id} value={c.code}>
                      {c.description}
                    </option>
                  ))}
              </datalist>
              <datalist id="cm-cpt">
                {codes
                  .filter((c) => c.type === "CPT")
                  .map((c) => (
                    <option key={c.id} value={c.code}>
                      {c.description}
                      {c.feeCents ? ` · ${formatMoney(c.feeCents)}` : ""}
                    </option>
                  ))}
              </datalist>

              <div className="gw-actions">
                <button className="btn" type="submit" disabled={patient.insurances.length === 0}>
                  Create claim and open it
                </button>
                <span className="muted">Saved as a draft claim on a billing-only visit; nothing is sent until you submit it.</span>
              </div>
            </form>
          </details>
        </>
      )}
    </>
  );
}
