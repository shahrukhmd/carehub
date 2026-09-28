import type { Payer } from "@prisma/client";
import { US_STATES, insuranceTypeLabel, timelyFilingUnitLabel } from "@/lib/format";

type Props = {
  action: (formData: FormData) => Promise<void>;
  payer?: Payer | null;
  otherPayers: { id: string; name: string }[];
  submitLabel: string;
};

export function InsuranceForm({ action, payer, otherPayers, submitLabel }: Props) {
  const v = (k: keyof Payer) => {
    const value = payer?.[k];
    return value === null || value === undefined ? "" : String(value);
  };

  return (
    <form action={action} className="panel provider-form">
      <div className="provider-columns">
        <section>
          <h3>Payer identifiers</h3>
          <div className="form-grid">
            <label>
              EDI payer ID (claims)
              <input name="payerCode" defaultValue={v("payerCode")} placeholder="60054" />
            </label>
            <label>
              ERA payer ID
              <input name="eraPayerId" defaultValue={v("eraPayerId")} />
            </label>
            <label>
              Eligibility payer ID
              <input name="eligibilityPayerId" defaultValue={v("eligibilityPayerId")} />
            </label>
            <label>
              Alternate payer
              <select name="alternatePayerId" defaultValue={v("alternatePayerId")}>
                <option value="">—</option>
                {otherPayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h3>Insurance details</h3>
          <div className="form-grid">
            <label style={{ gridColumn: "1 / -1" }}>
              <span>Insurance name <span className="req">*</span></span>
              <input name="name" defaultValue={v("name")} required placeholder="Aetna Medicare Advantage" />
            </label>
            <label>
              Insurance type
              <select name="insuranceType" defaultValue={v("insuranceType")}>
                <option value="">—</option>
                {Object.entries(insuranceTypeLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Credentialing follows
              <select name="parentPayerId" defaultValue={v("parentPayerId")}>
                <option value="">— Credentialed independently —</option>
                {otherPayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Address 1
              <input name="addressLine1" defaultValue={v("addressLine1")} />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Address 2
              <input name="addressLine2" defaultValue={v("addressLine2")} />
            </label>
            <label>
              City
              <input name="city" defaultValue={v("city")} />
            </label>
            <span className="form-grid" style={{ gap: "0.5rem" }}>
              <label>
                State
                <select name="state" defaultValue={v("state")}>
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
                <input name="zip" defaultValue={v("zip")} inputMode="numeric" />
              </label>
            </span>
          </div>

          <h3>Billing rules</h3>
          <div className="form-grid">
            <label className="checkbox-inline">
              <input type="checkbox" name="facilityBilling" defaultChecked={payer?.facilityBilling ?? false} />
              Facility billing
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="useGroupNpi" defaultChecked={payer?.useGroupNpi ?? false} />
              Use group NPI
            </label>
            <label className="checkbox-inline" style={{ gridColumn: "1 / -1" }}>
              <input type="checkbox" name="requiresVisitReview" defaultChecked={payer?.requiresVisitReview ?? false} />
              Requires visits to be reviewed before claim creation
            </label>
            <label>
              Timely filing limit
              <span className="npi-row">
                <input name="timelyFilingLimit" type="number" min="0" defaultValue={v("timelyFilingLimit")} />
                <select name="timelyFilingUnit" defaultValue={payer?.timelyFilingUnit ?? "DAYS"}>
                  {Object.entries(timelyFilingUnitLabel).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label>
              Alert before timely filing (days)
              <input name="timelyFilingAlertDays" type="number" min="0" defaultValue={v("timelyFilingAlertDays")} />
            </label>
          </div>
        </section>

        <section>
          <h3>Contact</h3>
          <div className="form-grid">
            <label>
              Phone
              <input name="phone" type="tel" defaultValue={v("phone")} />
            </label>
            <label>
              Fax
              <input name="fax" type="tel" defaultValue={v("fax")} />
            </label>
            <label>
              Contact first name
              <input name="contactFirstName" defaultValue={v("contactFirstName")} />
            </label>
            <label>
              Contact last name
              <input name="contactLastName" defaultValue={v("contactLastName")} />
            </label>
            <label>
              Contact phone
              <input name="contactPhone" type="tel" defaultValue={v("contactPhone")} />
            </label>
            <label>
              Contact email
              <input name="contactEmail" type="email" defaultValue={v("contactEmail")} />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Enrollment portal
              <input name="portalName" defaultValue={v("portalName")} placeholder="Availity, UHC Onboard Pro, PECOS…" />
            </label>
          </div>

          <h3>Financial &amp; reference</h3>
          <div className="form-grid">
            <label>
              Reimbursement rate (% of billed)
              <input name="reimbursementRate" type="number" step="0.01" min="0" defaultValue={v("reimbursementRate")} />
            </label>
            <span />
            <label style={{ gridColumn: "1 / -1" }}>
              Notes
              <textarea name="notes" defaultValue={v("notes")} style={{ minHeight: "5rem" }} />
            </label>
          </div>
        </section>
      </div>

      <div className="form-actions">
        <a className="btn secondary" href="/directories?section=insurance">
          Cancel
        </a>
        <button className="btn" type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
