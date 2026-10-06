import { requireUser } from "@/lib/auth";
import { getPracticeSettings } from "@/lib/chart-setup";
import { CLEARINGHOUSES, MONTHS } from "@/lib/practice-settings";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { PAYER_LIST_SOURCE } from "@/lib/payer-catalog";
import { importPayerList } from "../directories/payer-lookup-actions";
import { SettingsNav } from "../settings-nav";
import { documentAiLabel, documentAiProvider } from "@/lib/document-reader";
import { FAX_PROVIDERS } from "@/lib/fax";
import { savePracticeSettings } from "./actions";
import { SPECIALTIES, parseSpecialties } from "@/lib/specialties";
import { AddressValidator } from "@/components/AddressValidator";

type S = Awaited<ReturnType<typeof getPracticeSettings>>;

const BLOCKS: { key: "payTo" | "payee" | "remit" | "physical"; title: string; hint: string }[] = [
  { key: "payTo", title: "Claim pay-to address (HCFA 33)", hint: "Printed in box 33 of the CMS-1500 and sent as the pay-to address." },
  { key: "payee", title: "Patient statement payee", hint: "Who statements say to make checks payable to." },
  { key: "remit", title: "Patient statement remit to", hint: "Where patients mail payments." },
  { key: "physical", title: "Physical address", hint: "The practice's physical location." },
];

function AddressBlock({ s, block }: { s: S; block: (typeof BLOCKS)[number] }) {
  const v = (part: string) => String((s as unknown as Record<string, unknown>)[`${block.key}${part}`] ?? "");
  return (
    <fieldset className="gw-fieldset st-address">
      <legend>{block.title}</legend>
      <p className="muted">{block.hint}</p>
      <label>
        Name
        <input name={`${block.key}Name`} defaultValue={v("Name")} />
      </label>
      <label>
        Address 1
        <input name={`${block.key}Address1`} defaultValue={v("Address1")} />
      </label>
      <label>
        Address 2
        <input name={`${block.key}Address2`} defaultValue={v("Address2")} />
      </label>
      <div className="st-csz">
        <label>
          City
          <input name={`${block.key}City`} defaultValue={v("City")} />
        </label>
        <label>
          State
          <input name={`${block.key}State`} defaultValue={v("State")} maxLength={2} />
        </label>
        <label>
          ZIP
          <input name={`${block.key}Zip`} defaultValue={v("Zip")} />
        </label>
      <AddressValidator fields={{ line1: `${block.key}Address1`, line2: `${block.key}Address2`, city: `${block.key}City`, state: `${block.key}State`, zip: `${block.key}Zip` }} />
      </div>
    </fieldset>
  );
}

export default async function PracticeSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; listOk?: string; listError?: string }> }) {
  const user = await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const s = await getPracticeSettings(user.practiceId);
  // The payer list held for the practice's clearinghouse (shared by every practice on that clearinghouse).
  const [listCount, listNewest] = await Promise.all([
    prisma.payerCatalogEntry.count({ where: { clearinghouse: s.clearinghouse } }),
    prisma.payerCatalogEntry.findFirst({ where: { clearinghouse: s.clearinghouse }, orderBy: { loadedAt: "desc" }, select: { loadedAt: true } }),
  ]);
  const listSource = PAYER_LIST_SOURCE[s.clearinghouse];

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Settings · Facility setup</p>
          <h1>Practice setup</h1>
        </div>
      </div>
      <SettingsNav current="practice" />
      {sp.saved && <p className="notice-ok">Settings saved.</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <form action={savePracticeSettings} className="stack">
        <section className="panel" id="specialties">
          <h2>Specialties</h2>
          <p className="muted">
            The specialty packs this practice uses. Each pack brings its own visit types, chart documents, workflows, orders and care-gap rules; a pack
            that is off is hidden from the scheduler, the chart and the order pickers (its content stays in Settings, tagged with the pack). General
            content is always on.
          </p>
          <div className="st-checks">
            {Object.entries(SPECIALTIES).map(([k, sp]) => (
              <label key={k} className="checkbox-inline" title={sp.description}>
                <input type="checkbox" name="specialties" value={k} defaultChecked={parseSpecialties(s.specialties).includes(k)} /> {sp.label}
                <span className="muted"> — {sp.description}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Addresses</h2>
          <div className="st-addresses">
            {BLOCKS.map((b) => (
              <AddressBlock key={b.key} s={s} block={b} />
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Accounting &amp; claims</h2>
          <div className="form-grid gw-grid-3">
            <label title="Period close: deposits can no longer be posted with a date on or before this day, so closed months stay as reported.">
              Accounting closed through
              <input type="date" name="closedThrough" defaultValue={s.closedThrough ? s.closedThrough.toISOString().slice(0, 10) : ""} />
            </label>
            <label>
              Practice year end month
              <select name="yearEndMonth" defaultValue={s.yearEndMonth}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Use tax ID from
              <select name="taxIdSource" defaultValue={s.taxIdSource}>
                <option value="ACCOUNT">The account (billing provider on the claim)</option>
                <option value="PRACTICE">The practice tax ID below</option>
              </select>
            </label>
            <label>
              Practice tax ID
              <input name="practiceTaxId" defaultValue={s.practiceTaxId ?? ""} placeholder="93-4206673" />
            </label>
            <label>
              Accounting period cutoff — day
              <input name="cutoffDay" type="number" min={1} max={28} defaultValue={s.cutoffDay ?? ""} />
            </label>
            <label>
              Of the
              <select name="cutoffMonth" defaultValue={s.cutoffMonth}>
                <option value="FOLLOWING">Following month</option>
                <option value="SAME">Same month</option>
              </select>
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="cutoffLastDay" defaultChecked={s.cutoffLastDay} /> Or the last day of the month
            </label>
            <label>
              Billing inquiries phone #
              <input name="billingPhone" defaultValue={s.billingPhone ?? ""} placeholder="(855) 479-4217" />
            </label>
            <label>
              Clearinghouse
              <select name="clearinghouse" defaultValue={s.clearinghouse}>
                {Object.entries(CLEARINGHOUSES).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="st-checks st-rules">
            <label className="checkbox-inline">
              <input type="checkbox" name="useVisitNumbers" defaultChecked={s.useVisitNumbers} /> Use visit numbers (box 26 patient account)
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="allowZeroChargeClaims" defaultChecked={s.allowZeroChargeClaims} /> Allow EDI submission of $0 charge claims
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="includeEmergencyFlag" defaultChecked={s.includeEmergencyFlag} /> Include flag for emergency services (box 24C)
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="allowEdiVoid" defaultChecked={s.allowEdiVoid} /> Allow sending EDI claims as voided (frequency 8)
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="enableClaimRules" defaultChecked={s.enableClaimRules} /> Enable claim rules (claim edits block submission)
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="suppressSecondaryEraAdjustments" defaultChecked={s.suppressSecondaryEraAdjustments} /> Suppress adjustments on
              non-primary ERAs
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="holdClaimsForCredentialing" defaultChecked={s.holdClaimsForCredentialing} /> Hold claims for provider
              credentialing
            </label>
          </div>
        </section>

        <section className="panel" id="workflow">
          <h2>Workflow rules</h2>
          <p className="muted">
            Make each team&apos;s step depend on the one before it. Off, the step is advisory (the hand-off header still shows the state); on, it blocks
            with a message saying what has to happen first.
          </p>
          <div className="st-checks">
            <label className="checkbox-inline">
              <input type="checkbox" name="bookingRequiresGateway" defaultChecked={s.bookingRequiresGateway} /> Booking needs the Gateway case at scheduling
              <span className="muted"> — no visit while the case is with data entry, VOB, authorization or PCC referral, or after a VOB denial</span>
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="bookingChecksCredentialing" defaultChecked={s.bookingChecksCredentialing} /> Booking needs an in-network provider
              <span className="muted"> — the provider must be credentialed with the patient&apos;s primary payer</span>
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="chartRequiresCheckIn" defaultChecked={s.chartRequiresCheckIn} /> Chart opens after check-in
              <span className="muted"> — the front desk checks the patient in on the flow board before a chart can be started</span>
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="enforceVobScope" defaultChecked={s.enforceVobScope} /> Enforce a limited VOB on the claim
              <span className="muted"> — when the VOB approved E&amp;M and debridement only, other services are a claim error</span>
            </label>
            <p className="muted">
              Payers that require CDS review before billing are set per insurance plan (Directories → insurance → &ldquo;Requires visit review&rdquo;); that rule is
              always on and also stops billing-only claims to those payers.
            </p>
          </div>
        </section>

        <section className="panel" id="fax">
          <h2>Fax line</h2>
          <div className="form-grid gw-grid-3">
            <label>
              Electronic fax number
              <input name="faxNumber" defaultValue={s.faxNumber ?? ""} placeholder="(475) 555-7454" />
            </label>
            <label>
              Fax service
              <select name="faxProvider" defaultValue={s.faxProvider}>
                {Object.entries(FAX_PROVIDERS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">
            Only the built-in test line works today; SRFax, Phaxio, eFax and Documo need their API credentials connected before they can send and receive.
          </p>
        </section>

        <section className="panel">
          <h2>AI assistance &amp; document reading</h2>
          <p className="muted">
            Uploaded referrals, face sheets and insurance cards are read on this computer by default (PDF text, or OCR for scans and photos) — nothing
            leaves the practice. AI reading (Claude or OpenAI) handles handwriting, faxes and unusual layouts much better, but it sends each document to
            that company: only turn it on under a Business Associate Agreement (BAA) with them, with <code>ANTHROPIC_API_KEY</code> or{" "}
            <code>OPENAI_API_KEY</code> set on the server.
          </p>
          <label className="checkbox-inline">
            <input type="checkbox" name="documentAiEnabled" defaultChecked={s.documentAiEnabled} /> Use AI assistance: read uploaded documents, draft appeal letters, suggest a plan of care
          </label>
          <p className={documentAiProvider() ? "muted" : "gw-missing"} style={{ margin: "0.4rem 0 0" }}>
            {documentAiProvider()
              ? `${documentAiLabel[documentAiProvider()!]} is configured on this server and will read the documents.`
              : "No AI key is configured on this server, so documents are read on this computer even when this is ticked."}
          </p>
        </section>

        <div className="form-actions">
          <button className="btn" type="submit">
            Update
          </button>
        </div>
      </form>

      <section className="panel" id="payer-list">
        <div className="gw-section-head">
          <h2>Clearinghouse payer list</h2>
          <span className="muted">
            {CLEARINGHOUSES[s.clearinghouse] ?? s.clearinghouse} ·{" "}
            {listCount ? `${listCount.toLocaleString("en-US")} payers loaded${listNewest ? ` on ${formatDate(listNewest.loadedAt)}` : ""}` : "no list loaded"}
          </span>
        </div>
        <p className="muted">
          Add insurance looks payers up in this list by payer ID or name and fills in the claims, ERA and eligibility IDs. Each clearinghouse uses its own payer IDs, so the list follows the clearinghouse
          chosen above: change the clearinghouse, save, then load that clearinghouse&apos;s list here.
        </p>
        {sp.listOk && <p className="notice-ok">{sp.listOk}</p>}
        {sp.listError && (
          <p className="gw-error" role="alert">
            {sp.listError}
          </p>
        )}
        {s.clearinghouse === "MOCK" ? (
          <p className="muted">The test clearinghouse has no published list; a few well-known payers are built in so the lookup can be tried.</p>
        ) : (
          <>
            {listSource && (
              <p>
                1.{" "}
                <a href={listSource.url} target="_blank" rel="noreferrer">
                  Open the {CLEARINGHOUSES[s.clearinghouse]} payer list
                </a>{" "}
                — {listSource.how}
              </p>
            )}
            <form action={importPayerList} className="gw-inline-form" style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
              <span>{listSource ? "2." : ""} Load the downloaded file:</span>
              <input type="file" name="file" accept=".xlsx,.csv,.txt,.tsv" required />
              {listCount > 0 && (
                <select name="mode" defaultValue="add" aria-label="How to load">
                  <option value="add">Add to the list held</option>
                  <option value="replace">Replace the list held</option>
                </select>
              )}
              <button className="btn secondary" type="submit">
                Load the payer list
              </button>
            </form>
            <p className="muted">
              Excel (.xlsx) or CSV. A second file is joined onto the first, so a claims list and an eligibility list make one entry per payer. Insurances already saved keep the payer IDs they
              have.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
