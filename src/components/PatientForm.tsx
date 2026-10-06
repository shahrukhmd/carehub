import { customOptions, parseCustomValues, type CustomFieldDef } from "@/lib/custom-fields";
import Link from "next/link";
import type { Location, Payer, RenderingProvider } from "@prisma/client";
import {
  US_STATES,
  employmentStatusLabel,
  ethnicityLabel,
  maritalStatusLabel,
  raceLabel,
  smokingStatusLabel,
} from "@/lib/format";
import { PAYER_RANKS, payerRankLabel } from "@/lib/claim-format";
import { OpenOnInvalid } from "@/components/OpenOnInvalid";
import { DOC_TYPES, READ_METHODS } from "@/lib/patient-docs";
import type { FieldConflict, FilledField, InsuranceDraft, PatientDraft } from "@/lib/registration-prefill";
import { ReadDocumentsButton } from "@/components/ReadDocumentsButton";
import { MarkPrefilled } from "@/components/MarkPrefilled";
import { readRegistrationDocuments, removeRegistrationDocument } from "@/app/(app)/patients/new/actions";
import { AddressValidator } from "@/components/AddressValidator";
import {
  HOW_HEARD,
  LANGUAGES,
  RELIGIONS,
  communicationLabel,
  genderIdentityLabel,
  guarantorRelationshipLabel,
  medicareAdmissionLabel,
  parseAddress,
  parseRepresentatives,
  phoneTypeLabel,
  pronounLabel,
  sexLabel,
  sexualOrientationLabel,
  splitName,
  yesNoUnknownLabel,
  type PatientAddress,
} from "@/lib/patient-fields";

type Provider = Pick<RenderingProvider, "id" | "name" | "isReferring" | "isRendering" | "isSupervising">;

type Props = {
  action: (formData: FormData) => Promise<void>;
  // A saved patient when editing; when adding, a draft built from the documents that were read (or nothing).
  patient?: PatientDraft | null;
  // Add Patient only: the documents read so far and what they filled in.
  documents?: ReadDocument[];
  review?: { filled: FilledField[]; names: string[]; notes: string[]; conflicts: FieldConflict[] };
  locations: Pick<Location, "id" | "name">[];
  providers: Provider[];
  payers: Pick<Payer, "id" | "name">[];
  // Offered as guarantor accounts when registering a new patient.
  accounts?: { id: string; firstName: string; lastName: string; mrn: string }[];
  // The practice's own extra fields (Settings → Custom patient fields).
  customFields?: CustomFieldDef[];
  cancelHref: string;
  error?: string;
};

export type ReadDocument = { id: string; name: string; originalName: string; docType: string; status: string; readMethod: string | null; pageCount: number | null; error: string | null; found: number; summary: string | null };

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const dollars = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(2));

function Options({ labels, blank = "" }: { labels: Record<string, string> | readonly string[]; blank?: string | null }) {
  const entries = Array.isArray(labels) ? (labels as readonly string[]).map((v) => [v, v] as const) : Object.entries(labels as Record<string, string>);
  return (
    <>
      {blank !== null && <option value="">{blank}</option>}
      {entries.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </>
  );
}

function AddressFields({ prefix, value, county = true }: { prefix: string; value: PatientAddress; county?: boolean }) {
  return (
    <>
      <label>
        Address 1
        <input name={`${prefix}Line1`} defaultValue={value.line1 ?? ""} />
      </label>
      <label>
        Address 2
        <input name={`${prefix}Line2`} defaultValue={value.line2 ?? ""} />
      </label>
      <label>
        City
        <input name={`${prefix}City`} defaultValue={value.city ?? ""} />
      </label>
      <label>
        State
        <select name={`${prefix}State`} defaultValue={value.state ?? ""}>
          <Options labels={US_STATES} />
        </select>
      </label>
      <label>
        Zip code
        <input name={`${prefix}Zip`} defaultValue={value.zip ?? ""} maxLength={10} inputMode="numeric" />
      </label>
      <AddressValidator fields={{ line1: `${prefix}Line1`, line2: `${prefix}Line2`, city: `${prefix}City`, state: `${prefix}State`, zip: `${prefix}Zip`, county: county ? `${prefix}County` : undefined }} />
      {county && (
        <label>
          County
          <input name={`${prefix}County`} defaultValue={value.county ?? ""} />
        </label>
      )}
    </>
  );
}

function InsuranceBlock({ rank, ins, payers, open }: { rank: string; ins?: InsuranceDraft; payers: Pick<Payer, "id" | "name">[]; open: boolean }) {
  const p = `ins_${rank}_`;
  const holder = !ins || (ins.relationshipToInsured ?? "18") === "18";
  return (
    <details className="reg-ins" open={open}>
      <summary>
        {payerRankLabel[rank]} insurance{ins ? "" : " — add"}
      </summary>
      <input type="hidden" name={`${p}present`} value="1" />
      <div className="reg-two">
        <div className="form-grid">
          <label className="reg-wide">
            Insurance payer
            <select name={`${p}payerId`} defaultValue={ins?.payerId ?? ""}>
              <option value="">{rank === "PRIMARY" ? "Self-pay / none" : "None"}</option>
              {payers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Copay ($)
            <input name={`${p}copay`} defaultValue={dollars(ins?.copayCents)} inputMode="decimal" />
          </label>
          <fieldset className="reg-radio">
            <legend>Is the patient the policy holder?</legend>
            <label className="checkbox-inline">
              <input type="radio" name={`${p}holder`} value="yes" defaultChecked={holder} /> Yes
            </label>
            <label className="checkbox-inline">
              <input type="radio" name={`${p}holder`} value="no" defaultChecked={!holder} /> No
            </label>
          </fieldset>
          <div className="reg-insured form-grid reg-wide">
            <label>
              DOB of insured
              <input type="date" name={`${p}insuredDob`} defaultValue={day(ins?.insuredDob)} />
            </label>
            <label>
              Patient relationship to insured
              <select name={`${p}relationship`} defaultValue={!holder ? (ins?.relationshipToInsured ?? "") : ""}>
                <option value="">—</option>
                <option value="01">Spouse</option>
                <option value="19">Child</option>
                <option value="G8">Other</option>
              </select>
            </label>
            <label>
              First name
              <input name={`${p}insuredFirstName`} defaultValue={ins?.insuredFirstName ?? ""} />
            </label>
            <label>
              Middle name
              <input name={`${p}insuredMiddleName`} defaultValue={ins?.insuredMiddleName ?? ""} />
            </label>
            <label>
              Last name
              <input name={`${p}insuredLastName`} defaultValue={ins?.insuredLastName ?? ""} />
            </label>
            <label>
              Address
              <input name={`${p}insuredAddress`} defaultValue={ins?.insuredAddressLine1 ?? ""} />
            </label>
            <label>
              City
              <input name={`${p}insuredCity`} defaultValue={ins?.insuredCity ?? ""} />
            </label>
            <label>
              State
              <select name={`${p}insuredState`} defaultValue={ins?.insuredState ?? ""}>
                <Options labels={US_STATES} />
              </select>
            </label>
            <label>
              Zip code
              <input name={`${p}insuredZip`} defaultValue={ins?.insuredZip ?? ""} maxLength={10} />
            </label>
      <AddressValidator fields={{ line1: `${p}insuredAddress`, city: `${p}insuredCity`, state: `${p}insuredState`, zip: `${p}insuredZip` }} />
            <label>
              Insured phone number
              <input name={`${p}insuredPhone`} defaultValue={ins?.insuredPhone ?? ""} />
            </label>
            <label>
              Sex
              <select name={`${p}insuredSex`} defaultValue={ins?.insuredSex ?? ""}>
                <Options labels={sexLabel} />
              </select>
            </label>
          </div>
        </div>
        <div className="form-grid">
          <label>
            Policy number
            <input name={`${p}memberId`} defaultValue={ins?.memberId && ins.memberId !== "PENDING" ? ins.memberId : ""} />
          </label>
          <label>
            Group name
            <input name={`${p}groupName`} defaultValue={ins?.groupName ?? ""} />
          </label>
          <label>
            Group number
            <input name={`${p}groupNumber`} defaultValue={ins?.groupNumber ?? ""} />
          </label>
          <label>
            Effective date
            <input type="date" name={`${p}effectiveDate`} defaultValue={day(ins?.effectiveDate)} />
          </label>
          <label>
            Termination date
            <input type="date" name={`${p}terminationDate`} defaultValue={day(ins?.terminationDate)} />
          </label>
          <label>
            Deductible amount ($)
            <input name={`${p}deductible`} defaultValue={dollars(ins?.deductibleCents)} inputMode="decimal" />
          </label>
          <label>
            Percent coverage
            <input name={`${p}coveragePercent`} defaultValue={ins?.coveragePercent ?? ""} inputMode="numeric" placeholder="80" />
          </label>
          <label>
            Deductible met ($)
            <input name={`${p}deductibleMet`} defaultValue={dollars(ins?.deductibleMetCents)} inputMode="decimal" />
          </label>
          <label>
            Verification date
            <input type="date" name={`${p}verifiedAt`} defaultValue={day(ins?.verifiedAt)} />
          </label>
          <label>
            Verified with
            <input name={`${p}verifiedWith`} defaultValue={ins?.verifiedWith ?? ""} placeholder="Rep name / portal" />
          </label>
          <label>
            Authorization required
            <select name={`${p}authRequired`} defaultValue={ins?.authRequired ?? ""}>
              <Options labels={yesNoUnknownLabel} />
            </select>
          </label>
          <label>
            Prior authorization required
            <select name={`${p}priorAuthRequired`} defaultValue={ins?.priorAuthRequired ?? ""}>
              <Options labels={yesNoUnknownLabel} />
            </select>
          </label>
        </div>
      </div>
      {ins?.id && <p className="muted reg-hint">To remove this coverage, set the payer to “None” and save.</p>}
    </details>
  );
}

// Add / Edit Patient: identification, contact, admission, care providers, insurance, billing, notes and photo.
export function PatientForm({ action, patient, documents = [], review, locations, providers, payers, accounts, customFields = [], cancelHref, error }: Props) {
  const customValues = parseCustomValues(patient?.customFields);
  const p = patient;
  // A draft has no id yet.
  const isNew = !p?.id;
  const races = (p?.races ?? p?.race ?? "").split(",").filter(Boolean);
  const secondary = parseAddress(p?.secondaryAddress);
  const previous = parseAddress(p?.previousAddress);
  const emergency = parseAddress(p?.emergencyContactAddress);
  const [emergencyFirst, emergencyLast] = splitName(p?.emergencyContactName);
  const reps = parseRepresentatives(p?.portalRepresentatives);
  const coverage = (rank: string) => p?.insurances?.find((i) => i.rank === rank && i.active !== false);
  // Older charts stored the relationship as free text ("Parent", "self").
  const savedRelationship = p?.guarantorRelationship?.trim().toUpperCase() ?? "";
  const guarantor = savedRelationship in guarantorRelationshipLabel ? savedRelationship : p?.guarantorName ? "OTHER" : "SELF";
  // Admission details are required when registering; charts created before this form may not have them.
  const needAdmission = isNew && locations.length > 0;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const referrers = providers.filter((x) => x.isReferring);
  const renderers = providers.filter((x) => x.isRendering);
  const supervisors = providers.filter((x) => x.isSupervising);
  const providerSelect = (name: string, list: Provider[], value: string | null | undefined) => (
    <select name={name} defaultValue={value ?? ""}>
      <option value="">—</option>
      {/* Keep a saved provider selectable even if their directory role changed. */}
      {(value && !list.some((x) => x.id === value) ? [...list, ...providers.filter((x) => x.id === value)] : list).map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </select>
  );

  return (
    <form action={action} className="reg-form">
      <OpenOnInvalid />
      {error && (
        <p className="gw-error" role="alert">
          {error}
        </p>
      )}

      {isNew && (
        <section className="panel reg-upload">
          <h2>Upload documents</h2>
          <p className="muted">
            Upload everything the referral source sent — referral, face sheet, insurance card, ID, orders. CareHub reads each document, works out what it is, fills
            in the form below, and saves the documents under the patient&apos;s Scans with a proper name.
          </p>
          <input type="hidden" name="docs" value={documents.map((d) => d.id).join(",")} />
          {documents.length > 0 && (
            <table className="cn-table reg-docs">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Recognized as</th>
                  <th>Read with</th>
                  <th>Details found</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <a href={`/api/files/patientdoc/${d.id}`} target="_blank" rel="noopener">
                        {d.name}
                      </a>
                      {d.name !== d.originalName && <div className="muted cn-small">uploaded as {d.originalName}</div>}
                      {d.summary && <div className="muted cn-small">{d.summary}</div>}
                    </td>
                    <td>{d.docType === "OTHER" ? "Not recognized" : (DOC_TYPES[d.docType] ?? d.docType)}</td>
                    <td>
                      {d.status === "FAILED" ? <span className="gw-tag gw-tag-bad">Couldn&apos;t read</span> : (READ_METHODS[d.readMethod ?? ""] ?? "—")}
                      {d.pageCount ? <div className="muted cn-small">{d.pageCount} page{d.pageCount === 1 ? "" : "s"}</div> : null}
                    </td>
                    <td>{d.status === "FAILED" ? <span className="muted">{d.error}</span> : d.found}</td>
                    <td>
                      <button className="btn ghost gw-mini" type="submit" formAction={removeRegistrationDocument.bind(null, d.id)} formNoValidate>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="reg-upload-row">
            <label>
              {documents.length ? "Add more documents" : "Documents"} — PDF, PNG or JPG are read; DOC and DOCX are stored but not read. Up to 10 MB each.
              <input type="file" name="documents" multiple accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" />
            </label>
            <ReadDocumentsButton action={readRegistrationDocuments} label={documents.length ? "Read the added documents" : "Read documents & fill the form"} />
          </div>
          {review && documents.length > 0 && (
            <div className="reg-review">
              <p>
                <strong>
                  {review.filled.length} detail{review.filled.length === 1 ? "" : "s"} filled in
                </strong>{" "}
                from {documents.length} document{documents.length === 1 ? "" : "s"}. Filled fields are outlined in green below — check them against the documents before saving.
              </p>
              {review.notes.map((n, i) => (
                <p key={i} className="reg-note">
                  {n}
                </p>
              ))}
              {review.conflicts.length > 0 && (
                <div className="reg-note">
                  The documents disagree on:
                  <ul>
                    {review.conflicts.map((c, i) => (
                      <li key={i}>
                        <strong>{c.label}:</strong> used “{c.used}”; also found {c.others.map((o) => `“${o.value}” (${o.from})`).join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {review.filled.length > 0 && (
                <details>
                  <summary className="muted">What was filled in, and from which document</summary>
                  <table className="cn-table">
                    <tbody>
                      {review.filled.map((f, i) => (
                        <tr key={i}>
                          <td>{f.label}</td>
                          <td>{f.value.length > 120 ? `${f.value.slice(0, 120)}…` : f.value}</td>
                          <td className="muted">{f.from}</td>
                          <td>{f.confidence === "high" ? "" : <span className="gw-tag gw-tag-warn">{f.confidence === "medium" ? "check" : "unsure"}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
              <MarkPrefilled names={review.names} />
            </div>
          )}
        </section>
      )}

      <details className="panel reg-section" open>
        <summary>Identification information</summary>
        <div className="reg-two">
          <div className="form-grid">
            <label>
              Patient number
              <input value={p?.mrn ?? "Assigned when saved"} readOnly disabled />
            </label>
            <label>
              First name *
              <input name="firstName" defaultValue={p?.firstName ?? ""} required />
            </label>
            <label>
              Preferred name
              <input name="preferredName" defaultValue={p?.preferredName ?? ""} />
            </label>
            <label>
              Middle name
              <input name="middleName" defaultValue={p?.middleName ?? ""} />
            </label>
            <label>
              Last name *
              <input name="lastName" defaultValue={p?.lastName ?? ""} required />
            </label>
            <label>
              Suffix
              <input name="suffix" defaultValue={p?.suffix ?? ""} placeholder="Jr., Sr., III" />
            </label>
            <label>
              Social Security Number
              <input name="ssn" autoComplete="off" inputMode="numeric" defaultValue={isNew ? (p?.ssnLast4 ?? "") : ""} placeholder={!isNew && p?.ssnLast4 ? `On file: •••-••-${p.ssnLast4}` : "Only the last 4 digits are kept"} />
            </label>
            <label>
              Date of birth *
              <input name="dob" type="date" defaultValue={day(p?.dob)} required />
            </label>
            <label>
              Gender identification
              <select name="genderIdentity" defaultValue={p?.genderIdentity ?? ""}>
                <Options labels={genderIdentityLabel} />
              </select>
            </label>
            <label>
              Sex *
              <select name="sex" defaultValue={p?.sex ?? ""} required>
                <Options labels={sexLabel} />
              </select>
            </label>
            <label>
              Sexual orientation
              <select name="sexualOrientation" defaultValue={p?.sexualOrientation ?? ""}>
                <Options labels={sexualOrientationLabel} />
              </select>
            </label>
            <label>
              Pronoun
              <select name="pronoun" defaultValue={p?.pronoun ?? ""}>
                <Options labels={pronounLabel} />
              </select>
            </label>
            <fieldset className="reg-checks reg-wide">
              <legend>Primary race(s)</legend>
              {Object.entries(raceLabel).map(([value, label]) => (
                <label key={value} className="checkbox-inline">
                  <input type="checkbox" name="races" value={value} defaultChecked={races.includes(value)} /> {label}
                </label>
              ))}
            </fieldset>
            <label>
              Primary ethnicity
              <select name="ethnicity" defaultValue={p?.ethnicity ?? ""}>
                <Options labels={ethnicityLabel} />
              </select>
            </label>
            <label>
              Religion
              <select name="religion" defaultValue={p?.religion ?? ""}>
                <Options labels={p?.religion && !RELIGIONS.includes(p.religion) ? [...RELIGIONS, p.religion] : RELIGIONS} />
              </select>
            </label>
            <label className="reg-wide">
              Tribal affiliation
              <input name="tribalAffiliation" defaultValue={p?.tribalAffiliation ?? ""} placeholder="Federally recognized tribe, if any" />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Preferred language
              <select name="preferredLanguage" defaultValue={p?.preferredLanguage ?? ""}>
                <Options labels={p?.preferredLanguage && !LANGUAGES.includes(p.preferredLanguage) ? [...LANGUAGES, p.preferredLanguage] : LANGUAGES} />
              </select>
            </label>
            <label className="checkbox-inline reg-check-cell">
              <input type="checkbox" name="interpreterNeeded" defaultChecked={p?.interpreterNeeded ?? false} /> Interpreter needed
            </label>
            <label>
              Preferred confidential communication
              <select name="preferredCommunication" defaultValue={p?.preferredCommunication ?? ""}>
                <Options labels={communicationLabel} />
              </select>
            </label>
            <label>
              Care center
              <select name="careCenterId" defaultValue={p?.careCenterId ?? ""}>
                <option value="">—</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Previous first name
              <input name="previousFirstName" defaultValue={p?.previousFirstName ?? ""} />
            </label>
            <label>
              Previous middle name
              <input name="previousMiddleName" defaultValue={p?.previousMiddleName ?? ""} />
            </label>
            <label>
              Previous last name
              <input name="previousLastName" defaultValue={p?.previousLastName ?? ""} />
            </label>
            <label>
              Date name was changed
              <input type="date" name="nameChangedAt" defaultValue={day(p?.nameChangedAt)} />
            </label>
            <label>
              Occupation
              <input name="occupation" defaultValue={p?.occupation ?? ""} />
            </label>
            <label>
              Occupation industry
              <input name="occupationIndustry" defaultValue={p?.occupationIndustry ?? ""} />
            </label>
            <label>
              Marital status
              <select name="maritalStatus" defaultValue={p?.maritalStatus ?? ""}>
                <Options labels={maritalStatusLabel} />
              </select>
            </label>
            <label>
              Employment status
              <select name="employmentStatus" defaultValue={p?.employmentStatus ?? ""}>
                <Options labels={employmentStatusLabel} />
              </select>
            </label>
            <label>
              Smoking status
              <select name="smokingStatus" defaultValue={p?.smokingStatus ?? ""}>
                <Options labels={smokingStatusLabel} />
              </select>
            </label>
          </div>
        </div>
      </details>

      <details className="panel reg-section" open={Boolean(p)}>
        <summary>Contact information</summary>
        <div className="form-grid reg-narrow">
          <label>
            Primary phone number
            <span className="npi-row">
              <input name="phone" defaultValue={p?.phone ?? ""} inputMode="tel" />
              <select name="phoneType" defaultValue={p?.phoneType ?? ""} aria-label="Primary phone type">
                <Options labels={phoneTypeLabel} blank="Type" />
              </select>
            </span>
          </label>
          <label>
            Secondary phone number
            <span className="npi-row">
              <input name="phone2" defaultValue={p?.phone2 ?? ""} inputMode="tel" />
              <select name="phone2Type" defaultValue={p?.phone2Type ?? ""} aria-label="Secondary phone type">
                <Options labels={phoneTypeLabel} blank="Type" />
              </select>
            </span>
          </label>
          <label>
            Email
            <input name="email" type="email" defaultValue={p?.email ?? ""} />
          </label>
          <label className="checkbox-inline reg-check-cell">
            <input type="checkbox" name="noEmail" defaultChecked={p?.noEmail ?? false} /> No email
          </label>
        </div>
        <h3>Primary address</h3>
        <div className="form-grid reg-narrow">
          <label className="reg-wide">
            Set as current address
            <select name="currentAddress" defaultValue={p?.currentAddress ?? "PRIMARY"}>
              <option value="PRIMARY">Primary address</option>
              <option value="SECONDARY">Secondary address</option>
            </select>
          </label>
          <label>
            Address 1
            <input name="addressLine1" defaultValue={p?.addressLine1 ?? ""} />
          </label>
          <label>
            Address 2
            <input name="addressLine2" defaultValue={p?.addressLine2 ?? ""} />
          </label>
          <label>
            City
            <input name="city" defaultValue={p?.city ?? ""} />
          </label>
          <label>
            State
            <select name="state" defaultValue={p?.state ?? ""}>
              <Options labels={US_STATES} />
            </select>
          </label>
          <label>
            Zip code
            <input name="zip" defaultValue={p?.zip ?? ""} maxLength={10} inputMode="numeric" />
          </label>
              <AddressValidator fields={{ line1: "addressLine1", line2: "addressLine2", city: "city", state: "state", zip: "zip", county: "county" }} />
          <label>
            County
            <input name="county" defaultValue={p?.county ?? ""} />
          </label>
        </div>
        <h3>Secondary address</h3>
        <div className="form-grid reg-narrow">
          <AddressFields prefix="secondary" value={secondary} />
        </div>
        <h3>Previous address</h3>
        <div className="form-grid reg-narrow">
          <AddressFields prefix="previous" value={previous} />
        </div>
      </details>

      <details className="panel reg-section" open>
        <summary>Admission information</summary>
        <div className="reg-two">
          <div className="form-grid">
            <label>
              Site of service {needAdmission ? "*" : ""}
              <select name="siteOfServiceId" defaultValue={p?.siteOfServiceId ?? (isNew && locations.length === 1 ? locations[0].id : "")} required={needAdmission}>
                <option value="">—</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Admission date {isNew ? "*" : ""}
              <input type="date" name="admissionDate" defaultValue={day(p?.admissionDate) || (isNew ? today : "")} required={isNew} />
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="consult" defaultChecked={p?.consult ?? false} /> Consult
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="palliativeCare" defaultChecked={p?.palliativeCare ?? false} /> Palliative care
            </label>
            <label>
              Medicare admission
              <select name="medicareAdmission" defaultValue={p?.medicareAdmission ?? ""}>
                <Options labels={medicareAdmissionLabel} />
              </select>
            </label>
            <label className="checkbox-inline reg-check-cell">
              <input type="checkbox" name="nonWoundDiagnosis" defaultChecked={p?.nonWoundDiagnosis ?? false} /> Non wound diagnosis
            </label>
          </div>
          <div className="form-grid">
            <label>
              How heard
              <select name="howHeard" defaultValue={p?.howHeard ?? ""}>
                <Options labels={p?.howHeard && !HOW_HEARD.includes(p.howHeard) ? [...HOW_HEARD, p.howHeard] : HOW_HEARD} />
              </select>
            </label>
            <label>
              Onset of symptoms / illness
              <input type="date" name="onsetDate" defaultValue={day(p?.onsetDate)} />
            </label>
          </div>
        </div>
        <h3>Auto accident information</h3>
        <div className="reg-accident">
          <label className="checkbox-inline">
            <input type="checkbox" name="autoAccident" defaultChecked={p?.autoAccident ?? false} /> Auto accident
          </label>
          <div className="form-grid reg-narrow reg-accident-detail">
            <label>
              Accident state
              <select name="autoAccidentState" defaultValue={p?.autoAccidentState ?? ""}>
                <Options labels={US_STATES} />
              </select>
            </label>
            <label>
              Accident date
              <input type="date" name="autoAccidentDate" defaultValue={day(p?.autoAccidentDate)} />
            </label>
          </div>
        </div>
      </details>

      <details className="panel reg-section" open={Boolean(p)}>
        <summary>Care providers and instructions</summary>
        <div className="reg-two">
          <div className="form-grid">
            <label>
              Wound care physician
              {providerSelect("woundCarePhysicianId", renderers, p?.woundCarePhysicianId)}
            </label>
            <label>
              Primary care physician
              {providerSelect("primaryCarePhysicianId", providers, p?.primaryCarePhysicianId)}
            </label>
            <label>
              Supervising physician
              {providerSelect("supervisingPhysicianId", supervisors, p?.supervisingPhysicianId)}
            </label>
            <label>
              Referring physician
              {providerSelect("referringPhysicianId", referrers, p?.referringPhysicianId)}
            </label>
            <label>
              Referral date
              <input type="date" name="referralDate" defaultValue={day(p?.referralDate)} />
            </label>
            <label className="reg-wide">
              External provider(s)
              <textarea name="externalProviders" defaultValue={p?.externalProviders ?? ""} rows={2} placeholder="One per line: name, specialty, phone" />
            </label>
          </div>
          <div className="form-grid">
            <label className="reg-wide">
              Pharmacy
              <input name="pharmacyName" defaultValue={p?.pharmacyName ?? ""} placeholder="Pharmacy name" />
            </label>
            <label>
              Pharmacy phone
              <input name="pharmacyPhone" defaultValue={p?.pharmacyPhone ?? ""} inputMode="tel" />
            </label>
            <label>
              Pharmacy fax
              <input name="pharmacyFax" defaultValue={p?.pharmacyFax ?? ""} inputMode="tel" />
            </label>
            <label className="reg-wide">
              Pharmacy address
              <input name="pharmacyAddress" defaultValue={p?.pharmacyAddress ?? ""} placeholder="Street, city, state, zip" />
            </label>
          </div>
        </div>
        <p className="muted reg-hint">
          Physician missing from a list? <Link href="/settings/directories">Add them to Directories</Link> first.
        </p>

        <h3>Emergency / family contact information</h3>
        <div className="reg-two">
          <div className="form-grid">
            <label>
              First name
              <input name="emergencyFirstName" defaultValue={emergencyFirst} />
            </label>
            <label>
              Last name
              <input name="emergencyLastName" defaultValue={emergencyLast} />
            </label>
            <label className="reg-wide">
              Relationship
              <input name="emergencyContactRelationship" defaultValue={p?.emergencyContactRelationship ?? ""} placeholder="Spouse, daughter, friend…" />
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="emergencyContactGuardian" defaultChecked={p?.emergencyContactGuardian ?? false} /> Patient guardian
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="emergencyContactGuardianAdLitem" defaultChecked={p?.emergencyContactGuardianAdLitem ?? false} /> Patient guardian ad litem
            </label>
            <label>
              Email
              <input name="emergencyContactEmail" type="email" defaultValue={p?.emergencyContactEmail ?? ""} />
            </label>
            <label>
              Emergency contact phone number
              <input name="emergencyContactPhone" defaultValue={p?.emergencyContactPhone ?? ""} inputMode="tel" />
            </label>
            <AddressFields prefix="emergency" value={emergency} county={false} />
          </div>
          <div className="form-grid">
            <label>
              Mother&apos;s first name
              <input name="motherFirstName" defaultValue={p?.motherFirstName ?? ""} />
            </label>
            <label>
              Mother&apos;s maiden name
              <input name="motherMaidenName" defaultValue={p?.motherMaidenName ?? ""} />
            </label>
          </div>
        </div>

        <h3>Home health information</h3>
        <div className="form-grid reg-narrow">
          <label>
            Home health nurse
            <input name="homeHealthNurse" defaultValue={p?.homeHealthNurse ?? ""} />
          </label>
          <label>
            Home health company
            <input name="homeHealthCompany" defaultValue={p?.homeHealthCompany ?? ""} />
          </label>
        </div>

        <h3>Patient portal authorized representatives</h3>
        <div className="form-grid reg-narrow">
          {[0, 1, 2].map((i) => (
            <span key={i} className="npi-row reg-wide">
              <input name={`rep_${i}_first`} defaultValue={reps[i]?.firstName ?? ""} placeholder="First name" aria-label={`Representative ${i + 1} first name`} />
              <input name={`rep_${i}_last`} defaultValue={reps[i]?.lastName ?? ""} placeholder="Last name" aria-label={`Representative ${i + 1} last name`} />
            </span>
          ))}
        </div>
      </details>

      <details className="panel reg-section" open={Boolean(p)}>
        <summary>Insurance information</summary>
        {PAYER_RANKS.map((rank) => (
          <InsuranceBlock key={rank} rank={rank} ins={coverage(rank)} payers={payers} open={rank === "PRIMARY" || Boolean(coverage(rank))} />
        ))}
        <p className="muted reg-hint">
          Payer missing? <Link href="/settings/directories?section=insurance">Add it to Directories</Link> first.
        </p>
      </details>

      <details className="panel reg-section" open={Boolean(p)}>
        <summary>Billing</summary>
        <h3>Guarantor information</h3>
        <div className="reg-guarantor">
          <div className="form-grid reg-narrow">
            <label>
              Relationship
              <select name="guarantorRelationship" defaultValue={guarantor}>
                <Options labels={guarantorRelationshipLabel} blank={null} />
              </select>
            </label>
          </div>
          <div className="form-grid reg-narrow reg-guarantor-detail">
            <label>
              Guarantor name
              <input name="guarantorName" defaultValue={p?.guarantorName ?? ""} />
            </label>
            <label>
              Guarantor phone
              <input name="guarantorPhone" defaultValue={p?.guarantorPhone ?? ""} inputMode="tel" />
            </label>
            <label className="reg-wide">
              Guarantor address
              <input name="guarantorAddress" defaultValue={p?.guarantorAddress ?? ""} placeholder="Street, city, state, zip" />
            </label>
            {accounts && (
              <label className="reg-wide">
                Or bill under an existing patient&apos;s account
                <select name="guarantorPatientId" defaultValue="">
                  <option value="">— None —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.lastName}, {a.firstName} ({a.mrn})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </details>

      {customFields.length > 0 && (
        <details className="panel reg-section" open>
          <summary>Additional information</summary>
          <div className="form-grid gw-grid-3">
            {customFields.map((f) => {
              const name = `cf_${f.key}`;
              const value = customValues[f.key] ?? "";
              if (f.type === "CHECKBOX") {
                return (
                  <label key={f.id} className="checkbox-inline">
                    <input type="checkbox" name={name} defaultChecked={value === "true"} /> {f.label}
                    {f.helpText ? <span className="muted"> — {f.helpText}</span> : null}
                  </label>
                );
              }
              return (
                <label key={f.id}>
                  {f.label}
                  {f.required ? " *" : ""}
                  {f.type === "SELECT" ? (
                    <select name={name} defaultValue={value} required={f.required}>
                      <option value="" />
                      {customOptions(f.options).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input name={name} type={f.type === "NUMBER" ? "number" : f.type === "DATE" ? "date" : "text"} step={f.type === "NUMBER" ? "any" : undefined} defaultValue={value} required={f.required} maxLength={300} />
                  )}
                  {f.helpText ? <span className="muted">{f.helpText}</span> : null}
                </label>
              );
            })}
          </div>
        </details>
      )}

      <details className="panel reg-section" open={Boolean(p?.registrationNotes)}>
        <summary>Notes</summary>
        <label>
          Registration notes
          <textarea name="registrationNotes" defaultValue={p?.registrationNotes ?? ""} rows={4} maxLength={4000} />
        </label>
      </details>

      <details className="panel reg-section" open={Boolean(p?.photoPath)}>
        <summary>Photo</summary>
        <div className="reg-photo">
          {p?.photoPath && p.id && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/patientphoto/${p.id}`} alt="Patient" />
          )}
          <div className="stack">
            <label>
              {p?.photoPath ? "Replace photo" : "Patient photo"} (PNG or JPG, up to 10 MB)
              <input type="file" name="photo" accept="image/png,image/jpeg" />
            </label>
            {p?.photoPath && (
              <label className="checkbox-inline">
                <input type="checkbox" name="photoRemove" /> Remove the photo
              </label>
            )}
          </div>
        </div>
      </details>

      <div className="reg-actions">
        <Link className="btn ghost" href={cancelHref}>
          Cancel
        </Link>
        <button className="btn secondary" type="submit" name="intent" value="schedule">
          Save &amp; schedule visit
        </button>
        <button className="btn" type="submit" name="intent" value="save">
          Save
        </button>
      </div>
    </form>
  );
}
