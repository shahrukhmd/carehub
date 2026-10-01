import { requireUser } from "@/lib/auth";
import { getPracticeSettings } from "@/lib/chart-setup";
import { CLEARINGHOUSES, MONTHS } from "@/lib/practice-settings";
import { SettingsNav } from "../settings-nav";
import { documentAiLabel, documentAiProvider } from "@/lib/document-reader";
import { FAX_PROVIDERS } from "@/lib/fax";
import { savePracticeSettings } from "./actions";

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
      </div>
    </fieldset>
  );
}

export default async function PracticeSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const s = await getPracticeSettings(user.practiceId);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Settings · Facility setup</p>
          <h1>General settings</h1>
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
          <h2>Patient document reading</h2>
          <p className="muted">
            Uploaded referrals, face sheets and insurance cards are read on this computer by default (PDF text, or OCR for scans and photos) — nothing
            leaves the practice. AI reading (Claude or OpenAI) handles handwriting, faxes and unusual layouts much better, but it sends each document to
            that company: only turn it on under a Business Associate Agreement (BAA) with them, with <code>ANTHROPIC_API_KEY</code> or{" "}
            <code>OPENAI_API_KEY</code> set on the server.
          </p>
          <label className="checkbox-inline">
            <input type="checkbox" name="documentAiEnabled" defaultChecked={s.documentAiEnabled} /> Read uploaded patient documents with AI
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
    </div>
  );
}
