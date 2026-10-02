import { scheduleForEncounter } from "@/lib/charge-schedules";
import { requireEncounterAccess } from "@/lib/privacy";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney, patientName } from "@/lib/format";
import {
  addChargesBulk,
  addDiagnosesBulk,
  addDiagnosis,
  moveDiagnosis,
  removeCharge,
  removeDiagnosis,
  updateCharge,
  updateEncounterBilling,
} from "@/app/actions";
import { ENCOUNTER_VIEW_ROLES, canEditCoding, visitStatusLabel, visitStatusTone } from "@/lib/visit-workflow";
import { diagnosisPointerLetter, mdmLevelLabel, parsePointerIds, patientStatusLabel, placeOfServiceLabel } from "@/lib/superbill";
import { CPT_CATALOG, CPT_CATEGORIES, ICD10_CATALOG, ICD10_CATEGORIES, searchCatalog, type CatalogCode } from "@/lib/code-catalog";

type Search = { dq?: string; cq?: string; warn?: string };

export default async function SuperbillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const user = await requireUser(ENCOUNTER_VIEW_ROLES);
  const { id } = await params;
  await requireEncounterAccess(user, id);
  const sp = await searchParams;
  const encounter = await prisma.encounter.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      patient: true,
      provider: true,
      diagnoses: { orderBy: [{ priority: "asc" }, { id: "asc" }] },
      charges: { include: { claimLines: { select: { id: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!encounter) notFound();

  const [practiceCodes, templates, billingProviders] = await Promise.all([
    prisma.practiceCode.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: [{ type: "asc" }, { code: "asc" }] }),
    prisma.superbillTemplate.findMany({
      where: { practiceId: user.practiceId, active: true },
      include: { items: { orderBy: { order: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.billingProvider.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { name: "asc" } }),
  ]);

  const editable = canEditCoding(encounter.status, user.role);
  const onVisit = new Set(encounter.diagnoses.map((d) => d.icd10));
  const dxFavorites: CatalogCode[] = practiceCodes
    .filter((c) => c.type === "ICD10")
    .map((c) => ({ code: c.code, description: c.description, category: c.category ?? "Practice favorites" }));
  const dq = sp.dq?.trim() ?? "";
  const dxResults = dq ? searchCatalog([...dxFavorites, ...ICD10_CATALOG], dq).slice(0, 150) : [];

  // Fee schedule: practice CPT list first, then superbill template fees, then the catalog (no fee).
  const fees = new Map<string, { fee: number; modifiers: string | null; description: string }>();
  for (const t of templates) {
    for (const i of t.items) fees.set(i.cptCode, { fee: i.amountCents, modifiers: i.modifiers, description: i.description });
  }
  for (const c of practiceCodes.filter((c) => c.type === "CPT")) {
    fees.set(c.code, { fee: c.feeCents ?? fees.get(c.code)?.fee ?? 0, modifiers: c.modifiers, description: c.description });
  }
  // A charge schedule covering this visit (site, provider, insurance, date) sets the fee for the codes it prices.
  const schedule = await scheduleForEncounter(user.practiceId, encounter.id);
  if (schedule) {
    for (const [code, item] of schedule.fees) fees.set(code, { fee: item.feeCents, modifiers: fees.get(code)?.modifiers ?? null, description: fees.get(code)?.description ?? item.description });
  }
  const cptFavorites: CatalogCode[] = [
    ...practiceCodes.filter((c) => c.type === "CPT").map((c) => ({ code: c.code, description: c.description, category: "Practice fee schedule" })),
    ...templates.flatMap((t) => t.items.map((i) => ({ code: i.cptCode, description: i.description, category: t.name }))),
  ].filter((c, i, arr) => arr.findIndex((x) => x.code === c.code) === i);
  const cq = sp.cq?.trim() ?? "";
  const cptResults = cq ? searchCatalog([...cptFavorites, ...CPT_CATALOG], cq).slice(0, 100) : [];
  const letters = encounter.diagnoses.map((_, i) => diagnosisPointerLetter(i));
  const total = encounter.charges.reduce((s, c) => s + c.amountCents, 0);

  const DxRow = ({ c }: { c: CatalogCode }) => (
    <label className={`sb-row${onVisit.has(c.code) ? " sb-on" : ""}`}>
      <input type="checkbox" name="dx" value={`${c.code}|${c.description}`} disabled={onVisit.has(c.code)} />
      <span className="cl-code">{c.code}</span>
      <span>{c.description}</span>
    </label>
  );

  const CptRow = ({ c }: { c: CatalogCode }) => {
    const f = fees.get(c.code);
    return (
      <div className="sb-cpt">
        <label className="sb-row">
          <input type="checkbox" name="cpt" value={c.code} />
          <span className="cl-code">{c.code}</span>
          <span>{f?.description ?? c.description}</span>
        </label>
        <input type="hidden" name={`desc_${c.code}`} value={f?.description ?? c.description} />
        <input name={`fee_${c.code}`} defaultValue={f ? (f.fee / 100).toFixed(2) : ""} placeholder="Fee $" className="cl-money" aria-label={`${c.code} fee`} />
        <input name={`units_${c.code}`} defaultValue="1" className="cl-units" aria-label={`${c.code} units`} />
        <input name={`mod_${c.code}`} defaultValue={f?.modifiers ?? ""} placeholder="Mod" className="cl-ptr" aria-label={`${c.code} modifiers`} />
        <input name={`ptr_${c.code}`} defaultValue={letters[0] ?? ""} placeholder="Dx" className="cl-ptr" aria-label={`${c.code} pointers`} />
      </div>
    );
  };

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href={`/encounters/${encounter.id}?step=superbill`}>« Back to chart</Link> · {formatDate(encounter.date)} ·{" "}
            {encounter.provider.name}
          </p>
          <h1>
            Superbill · {patientName(encounter.patient)}{" "}
            <span className={`gw-tag gw-tag-${visitStatusTone(encounter.status)}`}>{visitStatusLabel[encounter.status] ?? encounter.status}</span>
          </h1>
          <p className="chart-meta">
            <span>{encounter.patient.mrn}</span>
            <span>DOB {formatDate(encounter.patient.dob)}</span>
            <span>
              {encounter.diagnoses.length}/12 diagnoses · {encounter.charges.length} procedure(s) · {formatMoney(total)}
            </span>
          </p>
        </div>
      </div>
      {!editable && (
        <p className="muted">
          Coding is read-only at this stage ({visitStatusLabel[encounter.status] ?? encounter.status}).
        </p>
      )}
      {sp.warn === "dx12" && (
        <p className="gw-error" role="alert">
          A claim carries at most 12 diagnoses (A–L) — the extra codes weren&apos;t added.
        </p>
      )}

      <fieldset className="stack gw-fieldset" disabled={!editable}>
        {/* ---------------- Selected diagnoses ---------------- */}
        <section className="panel" id="dx">
          <h2>Visit diagnoses (A–L)</h2>
          <table>
            <thead>
              <tr>
                <th>Ptr</th>
                <th>ICD-10</th>
                <th>Description</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {encounter.diagnoses.map((d, i) => (
                <tr key={d.id}>
                  <td>
                    <strong>{diagnosisPointerLetter(i)}</strong>
                  </td>
                  <td className="cl-code">{d.icd10}</td>
                  <td>{d.description}</td>
                  <td className="gw-actions">
                    {i > 0 && (
                      <form action={moveDiagnosis.bind(null, d.id, encounter.id, "up")}>
                        <button className="btn ghost gw-mini" type="submit" aria-label="Move up">
                          ↑
                        </button>
                      </form>
                    )}
                    {i < encounter.diagnoses.length - 1 && (
                      <form action={moveDiagnosis.bind(null, d.id, encounter.id, "down")}>
                        <button className="btn ghost gw-mini" type="submit" aria-label="Move down">
                          ↓
                        </button>
                      </form>
                    )}
                    <form action={removeDiagnosis.bind(null, d.id, encounter.id)}>
                      <button className="btn ghost gw-mini" type="submit">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {encounter.diagnoses.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No diagnoses yet — select them below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ---------------- Diagnosis picker ---------------- */}
        <section className="panel">
          <div className="gw-section-head">
            <h2>Diagnosis codes</h2>
            <form method="get" className="sb-search">
              {cq && <input type="hidden" name="cq" value={cq} />}
              <input name="dq" defaultValue={dq} placeholder="Search ICD-10 code or words (e.g. left heel stage 3)" aria-label="Search diagnoses" />
              <button className="btn secondary gw-mini" type="submit">
                Search
              </button>
            </form>
          </div>
          <form action={addDiagnosesBulk.bind(null, encounter.id)}>
            {dq && (
              <div className="sb-group">
                <strong>
                  {dxResults.length} match(es) for “{dq}”
                </strong>
                {dxResults.map((c) => (
                  <DxRow key={`s-${c.code}`} c={c} />
                ))}
              </div>
            )}
            {dxFavorites.length > 0 && (
              <details className="sb-cat" open={!dq}>
                <summary>Practice favorites ({dxFavorites.length})</summary>
                {dxFavorites.map((c) => (
                  <DxRow key={`f-${c.code}`} c={c} />
                ))}
              </details>
            )}
            <p className="muted sb-hint">Quick reference — open a category and tick the codes documented in the note:</p>
            {ICD10_CATEGORIES.map((cat) => {
              const codes = ICD10_CATALOG.filter((c) => c.category === cat);
              return (
                <details key={cat} className="sb-cat">
                  <summary>
                    {cat} <span className="muted">({codes.length})</span>
                  </summary>
                  {codes.map((c) => (
                    <DxRow key={c.code} c={c} />
                  ))}
                </details>
              );
            })}
            {editable && (
              <div className="form-actions sb-sticky">
                <button className="btn" type="submit">
                  Add selected diagnoses
                </button>
              </div>
            )}
          </form>
          {editable && (
            <details className="gw-inline-form">
              <summary>Add a code that isn&apos;t listed</summary>
              <form action={addDiagnosis.bind(null, encounter.id)}>
                <input name="icd10" placeholder="ICD-10" required className="cl-code" />
                <input name="description" placeholder="Description" required />
                <button className="btn secondary" type="submit">
                  Add
                </button>
              </form>
            </details>
          )}
        </section>

        {/* ---------------- Procedures on the visit ---------------- */}
        <section className="panel" id="charges">
          <h2>Procedures (CPT / HCPCS)</h2>
          <table className="sb-charges">
            <thead>
              <tr>
                <th>CPT</th>
                <th>Description</th>
                <th>Dx pointers</th>
                <th>Modifiers</th>
                <th>POS</th>
                <th>Units</th>
                <th>Fee / unit</th>
                <th>Line total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {encounter.charges.map((c) => {
                const ptrIds = parsePointerIds(c.diagnosisPointers);
                const onClaim = c.claimLines.length > 0;
                const mods = (c.modifiers ?? "").split(",");
                const formId = `charge-${c.id}`;
                return (
                  <tr key={c.id}>
                    <td className="cl-code">{c.cptCode}</td>
                    <td>
                      {c.description}
                      {onClaim && <div className="muted">On a claim — edit it there</div>}
                    </td>
                    <td>
                      <span className="sb-ptrs">
                        {encounter.diagnoses.map((d, i) => (
                          <label key={d.id} title={`${d.icd10} ${d.description}`}>
                            <input type="checkbox" form={formId} name="ptr" value={diagnosisPointerLetter(i)} defaultChecked={ptrIds.includes(d.id)} disabled={onClaim} />
                            {diagnosisPointerLetter(i)}
                          </label>
                        ))}
                      </span>
                    </td>
                    <td>
                      <span className="sb-mods">
                        {[0, 1, 2, 3].map((m) => (
                          <input key={m} form={formId} name="modifiers" defaultValue={mods[m] ?? ""} className="cl-mod" maxLength={2} disabled={onClaim} />
                        ))}
                      </span>
                    </td>
                    <td>
                      <select form={formId} name="placeOfService" defaultValue={c.placeOfService} className="cl-pos" disabled={onClaim}>
                        {Object.keys(placeOfServiceLabel).map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input form={formId} name="units" defaultValue={c.units} className="cl-units" disabled={onClaim} />
                    </td>
                    <td>
                      <input form={formId} name="fee" defaultValue={(c.amountCents / 100 / c.units).toFixed(2)} className="cl-money" disabled={onClaim} />
                    </td>
                    <td>{formatMoney(c.amountCents)}</td>
                    <td className="gw-actions">
                      {!onClaim && editable && (
                        <>
                          <form id={formId} action={updateCharge.bind(null, c.id, encounter.id)}>
                            <button className="btn secondary gw-mini" type="submit">
                              Save
                            </button>
                          </form>
                          <form action={removeCharge.bind(null, c.id, encounter.id)}>
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
              {encounter.charges.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    No procedures yet — select them below.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7} style={{ textAlign: "right" }}>
                  <strong>Total</strong>
                </td>
                <td colSpan={2}>
                  <strong>{formatMoney(total)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        {/* ---------------- CPT picker ---------------- */}
        <section className="panel">
          <div className="gw-section-head">
            <h2>
              CPT / HCPCS codes
              {schedule && (
                <span className="gw-tag gw-tag-info" title="Fees for the codes this schedule prices come from it; other codes use the practice code list">
                  Fees: {schedule.name}
                </span>
              )}
            </h2>
            <form method="get" className="sb-search">
              {dq && <input type="hidden" name="dq" value={dq} />}
              <input name="cq" defaultValue={cq} placeholder="Search CPT code or words (e.g. debridement)" aria-label="Search procedures" />
              <button className="btn secondary gw-mini" type="submit">
                Search
              </button>
            </form>
          </div>
          <p className="muted sb-hint">
            Tick the services performed; fee, units, modifiers and diagnosis pointer letters (A–{letters[letters.length - 1] ?? "L"}) are per code.
          </p>
          <form action={addChargesBulk.bind(null, encounter.id)}>
            {cq && (
              <div className="sb-group">
                <strong>
                  {cptResults.length} match(es) for “{cq}”
                </strong>
                {cptResults.map((c) => (
                  <CptRow key={`s-${c.code}`} c={c} />
                ))}
              </div>
            )}
            {cptFavorites.length > 0 && (
              <details className="sb-cat" open={!cq}>
                <summary>Practice fee schedule &amp; superbill templates ({cptFavorites.length})</summary>
                {cptFavorites.map((c) => (
                  <CptRow key={`f-${c.code}`} c={c} />
                ))}
              </details>
            )}
            {CPT_CATEGORIES.map((cat) => {
              const codes = CPT_CATALOG.filter((c) => c.category === cat && !cptFavorites.some((f) => f.code === c.code));
              if (!codes.length) return null;
              return (
                <details key={cat} className="sb-cat">
                  <summary>
                    {cat} <span className="muted">({codes.length})</span>
                  </summary>
                  {codes.map((c) => (
                    <CptRow key={c.code} c={c} />
                  ))}
                </details>
              );
            })}
            {editable && (
              <div className="form-actions sb-sticky">
                <button className="btn" type="submit">
                  Add selected procedures
                </button>
              </div>
            )}
          </form>
        </section>

        {/* ---------------- Billing details ---------------- */}
        <section className="panel">
          <h2>Billing details</h2>
          <form className="form-grid gw-grid-3" action={updateEncounterBilling.bind(null, encounter.id)}>
            <label>
              New or established patient
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
              Medical decision making (E/M level)
              <select name="mdmLevel" defaultValue={encounter.mdmLevel ?? ""}>
                <option value="">—</option>
                {Object.entries(mdmLevelLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
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
            <label className="checkbox-inline">
              <input name="hospice" type="checkbox" defaultChecked={encounter.hospice} /> Hospice patient
            </label>
            {editable && (
              <button className="btn secondary" type="submit">
                Save billing details
              </button>
            )}
          </form>
        </section>
      </fieldset>
    </div>
  );
}
