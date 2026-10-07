import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { claimNumber } from "@/lib/claim-format";
import { BILL_UNDER, CROSSOVER, LOOP_RULES, PAPER_FORMS, PAY_TO, SUBMISSION_TYPES, TAX_ID_TYPES, overrideSentence, resolveBillingRules } from "@/lib/payer-rules";
import { build837ForClaim, loadClaimForEdi } from "@/lib/x12-837p";
import { deleteOverride, deleteRuleSet, saveOverride, saveRuleSet } from "./actions";

type Search = { set?: string; preview?: string; ok?: string; error?: string };
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

// The payer's billing rules: dated rule sets, overrides by site and provider in precedence order with a
// plain-language sentence each, and a preview that shows what a recent claim would send under them.
export default async function PayerRulesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("settings.insurance"));
  const { id } = await params;
  const sp = await searchParams;
  const payer = await prisma.payer.findFirst({ where: { id, practiceId: user.practiceId } });
  if (!payer) notFound();
  const [sets, locations, providers, recentClaims] = await Promise.all([
    prisma.payerRuleSet.findMany({ where: { practiceId: user.practiceId, payerId: id }, include: { overrides: true }, orderBy: { effectiveFrom: "desc" } }),
    prisma.location.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId, isRendering: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.claim.findMany({ where: { practiceId: user.practiceId, payerId: id, status: { not: "VOID" } }, orderBy: { createdAt: "desc" }, take: 8, include: { patient: { select: { firstName: true, lastName: true } } } }),
  ]);
  const current = sets.find((s) => s.id === sp.set) ?? sets.find((s) => s.effectiveFrom <= new Date() && (!s.effectiveTo || s.effectiveTo >= new Date())) ?? sets[0] ?? null;
  const locName = (lid: string | null) => locations.find((l) => l.id === lid)?.name ?? null;
  const provName = (pid: string | null) => providers.find((p) => p.id === pid)?.name ?? null;
  const previewClaim = sp.preview ? await loadClaimForEdi(sp.preview, user.practiceId) : null;
  const decision = previewClaim ? await resolveBillingRules(previewClaim) : null;
  const edi = previewClaim ? await build837ForClaim(previewClaim.id, user.practiceId).catch(() => null) : null;
  const ediLines = edi ? edi.text.split("~").map((s) => s.trim()).filter((s) => /^(NM1\*(85|87|82|77|PR)|REF\*(EI|SY|0B|G2)|PRV|CRC|N3|N4)/.test(s)).slice(0, 20) : [];

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link> · <Link href="/settings/directories?section=insurance">Directories</Link> · <Link href={`/settings/directories/insurance/${id}`}>{payer.name}</Link>
          </p>
          <h1>Billing rules · {payer.name}</h1>
        </div>
      </div>
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}

      <div className="two-col">
        <div className="stack">
          <section className="panel">
            <h2>Rule sets</h2>
            <p className="muted cn-small">The set effective on the claim&apos;s date of service applies. A future-dated set schedules a payer change.</p>
            <table>
              <tbody>
                {sets.map((s) => (
                  <tr key={s.id} className={current?.id === s.id ? "pm-changed" : undefined}>
                    <td>
                      <Link href={`/settings/directories/insurance/${id}/rules?set=${s.id}`}>
                        {formatDate(s.effectiveFrom)} → {s.effectiveTo ? formatDate(s.effectiveTo) : "open"}
                      </Link>
                    </td>
                    <td className="cn-small">
                      {SUBMISSION_TYPES[s.submissionType]} · rendering {LOOP_RULES[s.renderingRule]?.toLowerCase()} · site {LOOP_RULES[s.serviceLocationRule]?.toLowerCase()}
                      {s.hold ? <span className="gw-tag gw-tag-bad"> on hold</span> : ""}
                    </td>
                    <td>
                      <form action={deleteRuleSet.bind(null, id, s.id)}>
                        <button className="btn ghost gw-mini" type="submit">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {sets.length === 0 && (
                  <tr>
                    <td className="muted">No rules yet: claims use the practice defaults (electronic, report every loop, bill under the practice).</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <form className="panel stack" action={saveRuleSet.bind(null, id, current?.id ?? null)}>
            <h2>{current ? `Edit the set effective ${formatDate(current.effectiveFrom)}` : "Add a rule set"}</h2>
            <div className="form-grid gw-grid-3">
              <label>
                Effective from
                <input name="effectiveFrom" type="date" required defaultValue={iso(current?.effectiveFrom) || new Date().toISOString().slice(0, 10)} />
              </label>
              <label>
                Effective to (optional)
                <input name="effectiveTo" type="date" defaultValue={iso(current?.effectiveTo)} />
              </label>
              <label>
                Submission
                <select name="submissionType" defaultValue={current?.submissionType ?? "ELECTRONIC"}>
                  {Object.entries(SUBMISSION_TYPES).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Paper form
                <select name="paperForm" defaultValue={current?.paperForm ?? "CMS1500"}>
                  {Object.entries(PAPER_FORMS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Claims payer ID (overrides the directory)
                <input name="claimPayerId" defaultValue={current?.claimPayerId ?? ""} placeholder={payer.payerCode ?? ""} />
              </label>
              <label>
                Eligibility payer ID
                <input name="eligibilityPayerId" defaultValue={current?.eligibilityPayerId ?? ""} placeholder={payer.eligibilityPayerId ?? ""} />
              </label>
              <label>
                Claim status payer ID
                <input name="statusPayerId" defaultValue={current?.statusPayerId ?? ""} />
              </label>
              <label>
                Secondary crossover
                <select name="crossover" defaultValue={current?.crossover ?? "AUTO"}>
                  {Object.entries(CROSSOVER).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rendering provider loop (2310B / box 24J)
                <select name="renderingRule" defaultValue={current?.renderingRule ?? "ALWAYS"}>
                  {Object.entries(LOOP_RULES).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Service location loop (2310C / box 32)
                <select name="serviceLocationRule" defaultValue={current?.serviceLocationRule ?? "ALWAYS"}>
                  {Object.entries(LOOP_RULES).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="checkbox-inline">
              <input type="checkbox" name="homeBound" defaultChecked={current?.homeBound ?? false} /> Report the home-bound indicator (CRC*75)
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="hold" defaultChecked={current?.hold ?? false} /> Hold submissions to this payer
            </label>
            <div className="form-grid gw-grid-3">
              <label>
                Hold reason
                <input name="holdReason" defaultValue={current?.holdReason ?? ""} />
              </label>
              <label>
                Hold until
                <input name="holdUntil" type="date" defaultValue={iso(current?.holdUntil)} />
              </label>
            </div>
            <label>
              Notes
              <input name="notes" defaultValue={current?.notes ?? ""} maxLength={500} />
            </label>
            <div className="cn-inline">
              <button className="btn" type="submit">
                {current ? "Save rule set" : "Add rule set"}
              </button>
              {current && (
                <Link className="btn ghost" href={`/settings/directories/insurance/${id}/rules?set=new`}>
                  New set instead
                </Link>
              )}
            </div>
          </form>
        </div>

        <div className="stack">
          {current && (
            <section className="panel stack">
              <h2>Overrides (precedence order)</h2>
              <p className="muted cn-small">Site + provider wins over provider only, then site only, then the row for every site and provider, then the practice default.</p>
              <ol className="stack">
                {[...current.overrides]
                  .sort((a, b) => (b.locationId ? 1 : 0) + (b.renderingProviderId ? 2 : 0) - ((a.locationId ? 1 : 0) + (a.renderingProviderId ? 2 : 0)))
                  .map((o) => (
                    <li key={o.id} className="cn-inline">
                      <span>{overrideSentence(o, { location: locName(o.locationId), provider: provName(o.renderingProviderId) })}</span>
                      <form action={deleteOverride.bind(null, id, o.id)}>
                        <button className="btn ghost gw-mini" type="submit">
                          Remove
                        </button>
                      </form>
                    </li>
                  ))}
                {current.overrides.length === 0 && <li className="muted">None: every claim bills under the practice with the EIN and the practice pay-to address.</li>}
              </ol>
              <form className="stack" action={saveOverride.bind(null, id, current.id)}>
                <h3>Add or replace an override</h3>
                <div className="form-grid gw-grid-3">
                  <label>
                    Site (any if blank)
                    <select name="locationId" defaultValue="">
                      <option value="">Any site</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Rendering provider (any if blank)
                    <select name="renderingProviderId" defaultValue="">
                      <option value="">Any provider</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Bill under
                    <select name="billUnder" defaultValue="PRACTICE">
                      {Object.entries(BILL_UNDER).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tax identifier
                    <select name="taxIdType" defaultValue="EIN">
                      {Object.entries(TAX_ID_TYPES).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Pay to
                    <select name="payTo" defaultValue="PRACTICE">
                      {Object.entries(PAY_TO).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Taxonomy to report
                    <input name="taxonomy" maxLength={10} placeholder="10 characters" />
                  </label>
                  <label>
                    Legacy / provider ID
                    <input name="legacyId" maxLength={40} />
                  </label>
                </div>
                <details>
                  <summary className="muted cn-small">Custom pay-to address (only when Pay to = Custom)</summary>
                  <div className="form-grid gw-grid-3">
                    <label>
                      Name
                      <input name="payToName" />
                    </label>
                    <label>
                      Line 1
                      <input name="payToLine1" />
                    </label>
                    <label>
                      Line 2
                      <input name="payToLine2" />
                    </label>
                    <label>
                      City
                      <input name="payToCity" />
                    </label>
                    <label>
                      State
                      <input name="payToState" maxLength={2} />
                    </label>
                    <label>
                      ZIP
                      <input name="payToZip" maxLength={10} />
                    </label>
                  </div>
                </details>
                <button className="btn secondary" type="submit">
                  Save override
                </button>
              </form>
            </section>
          )}

          <section className="panel stack">
            <h2>Preview a claim</h2>
            <p className="muted cn-small">Nothing is released: pick a recent claim to this payer and see what the rules decide and the 837 segments they produce.</p>
            <form method="get" className="cn-inline">
              {current && <input type="hidden" name="set" value={current.id} />}
              <select name="preview" defaultValue={sp.preview ?? ""} aria-label="Claim">
                <option value="">Pick a claim…</option>
                {recentClaims.map((c) => (
                  <option key={c.id} value={c.id}>
                    {claimNumber(c)} · {c.patient.lastName}, {c.patient.firstName} · {formatDate(c.createdAt)}
                  </option>
                ))}
              </select>
              <button className="btn secondary gw-mini" type="submit">
                Preview
              </button>
            </form>
            {decision && previewClaim && (
              <>
                <table>
                  <tbody>
                    {(
                      [
                        ["Submission", `${SUBMISSION_TYPES[decision.submissionType]}${decision.submissionType === "PAPER" ? ` · ${PAPER_FORMS[decision.paperForm]}` : ""}`, decision.sources.submissionType],
                        ["Claims payer ID (NM1*PR)", decision.claimPayerId ?? "—", decision.sources.claimPayerId],
                        ["Bill under (2010AA / box 33)", BILL_UNDER[decision.billUnder], decision.sources.billUnder],
                        ["Tax identifier (REF / box 25)", TAX_ID_TYPES[decision.taxIdType], decision.sources.taxIdType],
                        ["Pay to (2010AB)", PAY_TO[decision.payTo], decision.sources.payTo],
                        ["Rendering loop (2310B / box 24J)", decision.renderingLoop ? "reported" : "omitted", decision.sources.renderingLoop],
                        ["Service location (2310C / box 32)", decision.serviceLocationLoop ? "reported" : "omitted", decision.sources.serviceLocationLoop],
                        ["Taxonomy", decision.taxonomy ?? "from the provider record", decision.sources.taxonomy],
                        ["Home-bound indicator", decision.homeBound ? "CRC*75*Y*IH" : "no", decision.sources.homeBound],
                        ["Hold", decision.hold ?? "no", decision.sources.submissionType],
                      ] as [string, string, string | undefined][]
                    ).map(([k, v, src]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td>
                          <strong>{v}</strong>
                        </td>
                        <td className="muted cn-small">{src ?? decision.sources.all ?? "practice default"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {edi && (
                  <details open>
                    <summary className="cn-small">837P provider and payer segments ({edi.segments} segments in all{edi.missing.length ? ` · missing: ${edi.missing.join(", ")}` : ""})</summary>
                    <pre className="cl-edi">{ediLines.join("~\n")}~</pre>
                  </details>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
