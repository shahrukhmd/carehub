"use client";

import { useRef, useState, useTransition } from "react";
import { US_STATES, providerCredentialLabel, providerRoleLabel, providerTitleLabel } from "@/lib/format";

type Role = keyof typeof providerRoleLabel;

export type ProviderFormValues = {
  isReferring: boolean;
  isClinician: boolean;
  isRendering: boolean;
  isSupervising: boolean;
  title: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  suffix: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  npi: string | null;
  tin: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  fax: string | null;
  pager: string | null;
  email: string | null;
  credential: string | null;
  signatureOnFile: boolean;
  userId: string | null;
  primarySupervising: boolean;
  groupName: string | null;
  specialty: string | null;
  taxonomy: string | null;
  caqhId: string | null;
  acceptsAssignment: boolean;
  requiresSupervision: boolean;
  supervisingProviderId: string | null;
  deaNumber: string | null;
  ePrescribe: boolean;
  interfaceId: string | null;
};

type LookupResult = {
  match?: { npi: string; name: string; credential: string | null; taxonomy: string | null; address: string | null };
  error?: string;
};

type Props = {
  action: (formData: FormData) => Promise<void>;
  lookupNpi: (npi: string) => Promise<LookupResult>;
  initial?: Partial<ProviderFormValues>;
  users: { id: string; name: string }[];
  supervisors: { id: string; name: string }[];
  groupNames: string[];
  submitLabel: string;
  cancelHref: string;
  // Where the add was started ("credentialing"); saving goes back there.
  from?: string;
};

const ROLES = Object.entries(providerRoleLabel) as [Role, string][];

const ROLE_HINTS: Record<Role, string> = {
  isReferring: "Sends patients to you — no billing fields",
  isClinician: "Sees patients here; can link a login",
  isRendering: "Bills under a group — credentialed with payers",
  isSupervising: "Supervises NPs / PAs",
};

function YesNo({ name, defaultChecked }: { name: string; defaultChecked: boolean }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <span className="yesno">
      <label>
        <input type="radio" checked={on} onChange={() => setOn(true)} /> Yes
      </label>
      <label>
        <input type="radio" checked={!on} onChange={() => setOn(false)} /> No
      </label>
      {on && <input type="hidden" name={name} value="on" />}
    </span>
  );
}

export function ProviderForm({ action, lookupNpi, initial = {}, users, supervisors, groupNames, submitLabel, cancelHref, from }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [roles, setRoles] = useState<Record<Role, boolean>>({
    isReferring: initial.isReferring ?? false,
    isClinician: initial.isClinician ?? false,
    isRendering: initial.isRendering ?? true,
    isSupervising: initial.isSupervising ?? false,
  });
  const [lookupMsg, setLookupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [looking, startLookup] = useTransition();

  const anyRole = Object.values(roles).some(Boolean);
  const prescribes = roles.isClinician || roles.isRendering || roles.isSupervising;
  const v = (k: keyof ProviderFormValues) => (initial[k] as string | null | undefined) ?? "";

  function runLookup() {
    const form = formRef.current;
    if (!form) return;
    const npi = (form.elements.namedItem("npi") as HTMLInputElement).value.trim();
    startLookup(async () => {
      const res = await lookupNpi(npi);
      if (!res.match) {
        setLookupMsg({ ok: false, text: res.error ?? "Not found" });
        return;
      }
      const m = res.match;
      const set = (name: string, value: string | null | undefined, onlyIfEmpty = true) => {
        const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
        if (el && value && (!onlyIfEmpty || !el.value)) el.value = value;
      };
      const parts = m.name.split(/\s+/).map((w) => w.charAt(0) + w.slice(1).toLowerCase());
      if (parts.length > 1) {
        set("firstName", parts[0]);
        set("lastName", parts[parts.length - 1]);
        if (parts.length > 2) set("middleName", parts.slice(1, -1).join(" "));
      }
      const cred = (m.credential ?? "").toUpperCase().replace(/[^A-Z]/g, "");
      set("credential", Object.keys(providerCredentialLabel).find((k) => cred.startsWith(k)) ?? null);
      set("taxonomy", m.taxonomy);
      set("specialty", m.taxonomy);
      const [addr, city, st, zip] = (m.address ?? "").split(", ");
      set("addressLine1", addr);
      set("city", city);
      set("state", st);
      set("zip", zip);
      setLookupMsg({
        ok: true,
        text: `Found on NPPES: ${m.name}${m.credential ? `, ${m.credential}` : ""} · ${m.taxonomy ?? "no taxonomy"}. Empty fields were filled in.`,
      });
    });
  }

  return (
    <form ref={formRef} action={action} className="panel provider-form">
      {from && <input type="hidden" name="from" value={from} />}
      <section className="provider-types">
        <h2>
          <span>Provider type <span className="req">*</span></span>
        </h2>
        <p className="muted">Pick every role this person holds — the form shows only the fields those roles need.</p>
        <div className="provider-type-grid">
          {ROLES.map(([key, label]) => (
            <label key={key} className={`provider-type${roles[key] ? " on" : ""}`}>
              <input
                type="checkbox"
                name={key}
                checked={roles[key]}
                onChange={(e) => setRoles((r) => ({ ...r, [key]: e.target.checked }))}
              />
              <span>
                <strong>{label}</strong>
                <small>{ROLE_HINTS[key]}</small>
              </span>
            </label>
          ))}
        </div>
        {!anyRole && <p className="login-error">Choose at least one provider type.</p>}
      </section>

      <div className="provider-columns">
        <section>
          <h3>Identity</h3>
          <div className="form-grid">
            <label>
              Title
              <select name="title" defaultValue={v("title")}>
                <option value="">—</option>
                {Object.entries(providerTitleLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Suffix
              <input name="suffix" defaultValue={v("suffix")} placeholder="Jr., III" />
            </label>
            <label>
              <span>First name <span className="req">*</span></span>
              <input name="firstName" defaultValue={v("firstName")} required />
            </label>
            <label>
              Middle name
              <input name="middleName" defaultValue={v("middleName")} />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              <span>Last name <span className="req">*</span></span>
              <input name="lastName" defaultValue={v("lastName")} required />
            </label>
            <label>
              Credentials
              <select name="credential" defaultValue={v("credential")}>
                <option value="">—</option>
                {Object.entries(providerCredentialLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Specialty
              <input name="specialty" defaultValue={v("specialty")} placeholder="Wound care, Podiatry" />
            </label>
            <label className="checkbox-inline" style={{ gridColumn: "1 / -1" }}>
              <input type="checkbox" name="signatureOnFile" defaultChecked={initial.signatureOnFile ?? false} />
              Signature on file
            </label>
          </div>

          <h3>Identifiers</h3>
          <div className="form-grid">
            <label>
              National Provider Identifier (NPI)
              <span className="npi-row">
                <input name="npi" defaultValue={v("npi")} inputMode="numeric" pattern="\d{10}" />
                <button className="btn secondary" type="button" onClick={runLookup} disabled={looking}>
                  {looking ? "Checking…" : "NPI Registry"}
                </button>
              </span>
            </label>
            <label>
              Tax Identification Number (TIN)
              <input name="tin" defaultValue={v("tin")} />
            </label>
            <label>
              License number
              <input name="licenseNumber" defaultValue={v("licenseNumber")} />
            </label>
            <label>
              License state
              <select name="licenseState" defaultValue={v("licenseState")}>
                <option value="">—</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {lookupMsg && <p className={lookupMsg.ok ? "notice-ok" : "login-error"}>{lookupMsg.text}</p>}
        </section>

        <section>
          <h3>Contact</h3>
          <div className="form-grid">
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
            <label>
              Phone
              <input name="phone" type="tel" defaultValue={v("phone")} />
            </label>
            <label>
              Fax
              <input name="fax" type="tel" defaultValue={v("fax")} />
            </label>
            <label>
              Pager
              <input name="pager" type="tel" defaultValue={v("pager")} />
            </label>
            <label>
              Email
              <input name="email" type="email" defaultValue={v("email")} />
            </label>
          </div>
        </section>
      </div>

      {(roles.isClinician || roles.isSupervising || roles.isRendering || prescribes) && (
        <div className="provider-columns role-sections">
          {roles.isRendering && (
            <section className="role-section">
              <h3>Rendering &amp; billing</h3>
              <div className="form-grid">
                <label style={{ gridColumn: "1 / -1" }}>
                  Group name
                  <input name="groupName" defaultValue={v("groupName")} list="provider-groups" />
                  <datalist id="provider-groups">
                    {groupNames.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Taxonomy
                  <input name="taxonomy" defaultValue={v("taxonomy")} />
                </label>
                <label>
                  CAQH ID
                  <input name="caqhId" defaultValue={v("caqhId")} />
                </label>
                <label>
                  Supervising physician
                  <select name="supervisingProviderId" defaultValue={v("supervisingProviderId")}>
                    <option value="">—</option>
                    {supervisors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox-inline">
                  <input type="checkbox" name="acceptsAssignment" defaultChecked={initial.acceptsAssignment ?? false} />
                  Accepts assignment
                </label>
                <label className="checkbox-inline">
                  <input type="checkbox" name="requiresSupervision" defaultChecked={initial.requiresSupervision ?? false} />
                  Requires supervision
                </label>
              </div>
            </section>
          )}

          <section className="role-section">
            {roles.isClinician && (
              <>
                <h3>Clinician</h3>
                <label>
                  User (CareHub login)
                  <select name="userId" defaultValue={v("userId")}>
                    <option value="">No login</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {roles.isSupervising && (
              <>
                <h3>Supervising</h3>
                <div className="yesno-field">
                  Associate primary supervising physician
                  <YesNo name="primarySupervising" defaultChecked={initial.primarySupervising ?? false} />
                </div>
              </>
            )}
            {prescribes && (
              <>
                <h3>Prescribing</h3>
                <div className="form-grid">
                  <label>
                    DEA number
                    <input name="deaNumber" defaultValue={v("deaNumber")} />
                  </label>
                  <label>
                    Interface ID
                    <input name="interfaceId" defaultValue={v("interfaceId")} />
                  </label>
                  <div className="yesno-field">
                    E-Prescribe
                    <YesNo name="ePrescribe" defaultChecked={initial.ePrescribe ?? false} />
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {!roles.isRendering && roles.isReferring && !roles.isClinician && !roles.isSupervising && (
        <p className="muted" style={{ marginTop: "0.8rem" }}>
          Referring-only providers don&apos;t bill here, so billing and credentialing fields are hidden.
        </p>
      )}

      <div className="form-actions">
        <a className="btn secondary" href={cancelHref}>
          Cancel
        </a>
        <button className="btn" type="submit" disabled={!anyRole}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
