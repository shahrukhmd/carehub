// On-device extraction: finds labelled values ("DOB: 03/14/1952", "Member ID ...") in document text.
// Pure and synchronous so it can be unit-tested; OCR'd text gets lower confidence than a PDF text layer.
import {
  normalizeDate,
  normalizePhone,
  normalizeSex,
  titleCase,
  type Confidence,
  type Extraction,
  type ExtractedField,
} from "@/lib/patient-docs";

type Section = "patient" | "insurance" | "secondary" | "referral" | "emergency" | "pcp" | "pharmacy";

// Label → what it means. Order matters: longer / more specific labels first.
const LABELS: { re: RegExp; field: string }[] = [
  { re: /patient'?s?\s+first\s+name|first\s+name/i, field: "firstName" },
  { re: /patient'?s?\s+last\s+name|last\s+name|surname/i, field: "lastName" },
  { re: /middle\s+(?:name|initial)/i, field: "middle" },
  { re: /social\s+security(?:\s+(?:number|no\.?|#))?|ssn|ss\s?#/i, field: "ssn" },
  { re: /(?:subscriber|insured|policy\s*holder)(?:'s)?\s+(?:date\s+of\s+birth|dob)/i, field: "subscriberDob" },
  { re: /(?:date\s+of\s+onset|onset\s+date|onset(?:\s+of\s+(?:symptoms|illness|wound))?)/i, field: "onset" },
  { re: /date\s+of\s+birth|birth\s*date|d\.?\s?o\.?\s?b\.?/i, field: "dob" },
  { re: /sex|gender/i, field: "sex" },
  { re: /secondary\s+(?:insurance|payer|carrier|plan)/i, field: "secondaryPayer" },
  { re: /primary\s+(?:insurance|payer|carrier)|insurance\s+(?:company|carrier|name|plan)|insurance|payer|carrier|health\s+plan/i, field: "payer" },
  { re: /group\s+name|employer\s+group/i, field: "groupName" },
  { re: /co-?pay(?:ment)?(?:\s+amount)?|office\s+visit\s+co-?pay/i, field: "copay" },
  { re: /(?:coverage\s+)?effective\s+date|eff\.?\s+date/i, field: "effective" },
  { re: /plan\s+name|plan\s+type|plan/i, field: "plan" },
  { re: /(?:member|subscriber|policy|insured)\s*(?:id|i\.d\.|#|number|no\.?)|id\s*(?:#|number)|identification\s+number/i, field: "memberId" },
  { re: /group\s*(?:#|number|no\.?)?|grp\s*#?/i, field: "group" },
  { re: /subscriber(?:\s+name)?|insured(?:'s)?\s+name|policy\s*holder/i, field: "subscriber" },
  { re: /referral\s+date|date\s+of\s+referral|date\s+referred|referred\s+on/i, field: "referralDate" },
  { re: /referring\s+(?:facility|practice|office|agency|organization|hospital)|referral\s+source|referred\s+from|facility(?:\s+name)?/i, field: "sourceName" },
  { re: /referring\s+(?:physician|provider|doctor|md|clinician)|ordering\s+(?:physician|provider)|referred\s+by|physician(?:\s+name)?/i, field: "physician" },
  { re: /npi\s*(?:#|number|no\.?)?/i, field: "npi" },
  { re: /case\s+manager|discharge\s+planner|contact\s+(?:person|name)|contact/i, field: "contact" },
  { re: /services?\s+requested|reason\s+for\s+(?:referral|visit|consult)|requested\s+services?|referral\s+for|order(?:ed)?\s+services?/i, field: "services" },
  { re: /diagnos[ie]s(?:\s+codes?)?|dx(?:\s+codes?)?|icd[-\s]?10(?:\s+codes?)?/i, field: "diagnoses" },
  { re: /emergency\s+contact(?:\s+name)?|next\s+of\s+kin|nok/i, field: "emergencyName" },
  { re: /relationship(?:\s+to\s+(?:patient|insured|subscriber))?/i, field: "relationship" },
  { re: /(?:preferred\s+)?pharmacy(?:\s+name)?/i, field: "pharmacy" },
  { re: /home\s+health(?:\s+(?:agency|company|care|provider))?/i, field: "homeHealth" },
  { re: /(?:home\s+health\s+)?nurse(?:\s+name)?/i, field: "nurse" },
  { re: /county/i, field: "county" },
  { re: /race/i, field: "race" },
  { re: /ethnicity/i, field: "ethnicity" },
  { re: /occupation/i, field: "occupation" },
  { re: /address\s+(?:line\s*)?2|apt\.?|apartment|unit|suite/i, field: "address2" },
  { re: /pcp(?:\s+name)?|primary\s+care\s+(?:physician|provider|doctor)(?:\s+name)?/i, field: "pcp" },
  { re: /(?:street\s+|home\s+|mailing\s+)?address(?:\s+line\s*1)?/i, field: "address" },
  { re: /city/i, field: "city" },
  { re: /state/i, field: "state" },
  { re: /zip(?:\s+code)?|postal\s+code/i, field: "zip" },
  { re: /e-?mail(?:\s+address)?/i, field: "email" },
  { re: /fax(?:\s*(?:#|number|no\.?))?/i, field: "fax" },
  { re: /(?:home|cell|mobile|office|work|patient|contact)?\s*(?:ph[aoe0]ne|tel(?:ephone)?|ph)(?:\s*(?:#|number|no\.?))?/i, field: "phone" },
  { re: /preferred\s+language|primary\s+language|language/i, field: "language" },
  { re: /marital\s+status/i, field: "marital" },
  { re: /(?:patient|resident|member)'?s?\s+name|name\s+of\s+patient|patient|resident|name/i, field: "name" },
];

// A label only counts when followed by ":" / "#" or two spaces, or when it ends the line (value on the next line).
const LABEL_RE = new RegExp(`(?:^|\\s|\\|)(${LABELS.map((l) => l.re.source).join("|")})\\s*(?::|#(?!\\d)|-\\s|\\s{2,}|(?=\\s*$))`, "gi");

const STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" ")
);
const ICD10 = /\b([A-TV-Z][0-9][0-9AB])(?:\.([0-9A-TV-Z]{1,4}))?\b/g;
const CITY_STATE_ZIP = /([A-Za-z][A-Za-z .'-]{1,40}),?\s+([A-Z]{2})\.?\s+(\d{5}(?:-\d{4})?)\b/;

function classify(text: string) {
  const t = text.toLowerCase();
  const score: Record<string, number> = {
    REFERRAL: (t.match(/referr/g)?.length ?? 0) * 2 + (/reason for referral|referring physician/.test(t) ? 4 : 0),
    FACE_SHEET: (/face\s?sheet|admission record|demographic|registration/.test(t) ? 5 : 0) + (/emergency contact|next of kin/.test(t) ? 1 : 0),
    INSURANCE_CARD: (/member id|subscriber id/.test(t) ? 2 : 0) + (/copay|rx ?bin|rxpcn|pcn|customer service/.test(t) ? 3 : 0) + (t.length < 900 ? 1 : 0),
    PHOTO_ID: /driver'?s? licen[cs]e|identification card|dl\s?#|state id/.test(t) ? 5 : 0,
    H_AND_P: /history (and|&) physical|h&p|history of present illness|review of systems/.test(t) ? 5 : 0,
    ORDERS: /physician orders?|order(s)? for|wound care orders|home health orders/.test(t) ? 4 : 0,
    MEDICATION_LIST: /medication (list|reconciliation)|current medications/.test(t) ? 4 : 0,
    LAB_RESULTS: /lab(oratory)? results?|reference range|specimen|collected/.test(t) ? 4 : 0,
    CONSENT: /consent|i authorize|i hereby/.test(t) ? 3 : 0,
  };
  const [best, n] = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return n >= 2 ? best : "OTHER";
}

function sectionOf(line: string, current: Section): Section {
  const l = line.toLowerCase();
  // Section headers are short lines that name the section.
  if (l.length > 60) return current;
  if (/secondary\s+(insurance|coverage|payer)/.test(l)) return "secondary";
  if (/insurance|coverage|payer information|billing information/.test(l) && !/:/.test(l.replace(/\s+$/, "").slice(-1))) return "insurance";
  if (/referr(al|ing) (information|source|physician|provider)|referred by|ordering physician/.test(l) && !/\d/.test(l)) return "referral";
  if (/emergency contact|next of kin/.test(l) && !/\d/.test(l)) return "emergency";
  if (/primary care|pcp/.test(l) && !/\d/.test(l)) return "pcp";
  if (/pharmacy/.test(l) && !/\d/.test(l)) return "pharmacy";
  if (/patient (information|demographics)|demographics|resident information/.test(l)) return "patient";
  return current;
}

type Hit = { field: string; value: string; section: Section; line: string };

function labelHits(lines: string[]) {
  const hits: Hit[] = [];
  let section: Section = "patient";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    section = sectionOf(line, section);
    const matches = [...line.matchAll(LABEL_RE)];
    matches.forEach((m, k) => {
      const labelText = m[1];
      const def = LABELS.find((l) => new RegExp(`^(?:${l.re.source})$`, "i").test(labelText.trim()));
      if (!def) return;
      const start = (m.index ?? 0) + m[0].length;
      const end = k + 1 < matches.length ? (matches[k + 1].index ?? line.length) : line.length;
      let value = line.slice(start, end).trim().replace(/^[:#\s-]+/, "").replace(/[\s|,;]+$/, "");
      // Label alone on its line: the value is on the next line (typical of forms).
      if (!value && k === matches.length - 1 && lines[i + 1] && !lines[i + 1].match(LABEL_RE)) value = lines[i + 1].trim();
      if (!value) return;
      // Contextual labels: a phone inside the referral block is the referral phone, etc.
      let sec: Section = section;
      if (/referring|ordering|referred|case manager|discharge planner/i.test(labelText)) sec = "referral";
      if (/office|work/i.test(labelText) && def.field === "phone" && section === "patient") sec = "referral";
      if (/emergency|next of kin|nok/i.test(labelText)) sec = "emergency";
      if (/pcp|primary care/i.test(labelText)) sec = "pcp";
      if (/secondary/i.test(labelText)) sec = "secondary";
      if (/pharmacy/i.test(labelText)) sec = "pharmacy";
      hits.push({ field: def.field, value, section: sec, line });
    });
  }
  return hits;
}

function splitName(raw: string): { first?: string; last?: string } {
  const v = raw.replace(/\b(mr|mrs|ms|miss|dr)\.?\s+/i, "").replace(/\s+(jr|sr|ii|iii)\.?$/i, "").trim();
  if (!/^[A-Za-z][A-Za-z ,.'-]{1,60}$/.test(v)) return {};
  // "DOE, JANE M" — OCR often reads the comma as a period ("DOE. JANE M").
  const commaForm = v.includes(",") ? v : /^[A-Z'-]+\.\s+[A-Z]/.test(v) ? v.replace(".", ",") : null;
  if (commaForm) {
    const [last, rest] = commaForm.split(",", 2).map((s) => s.trim());
    const first = rest?.split(/\s+/)[0];
    return first && last ? { first: titleCase(first), last: titleCase(last) } : {};
  }
  const parts = v.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return {};
  return { first: titleCase(parts[0]), last: titleCase(parts[parts.length - 1]) };
}

function cleanPersonName(raw: string) {
  const v = raw.replace(/\bNPI\b.*$/i, "").replace(/[,;|]+$/, "").trim();
  return /[A-Za-z]{2}/.test(v) && v.length <= 80 ? v : null;
}

export function extractFromText(text: string, opts: { ocr: boolean; knownPayers?: string[] }): Extraction {
  const fields: Record<string, ExtractedField> = {};
  const base: Confidence = opts.ocr ? "medium" : "high";
  const lower = (c: Confidence): Confidence => (c === "high" ? "medium" : "low");
  const put = (key: string, value: string | null | undefined, confidence: Confidence, source?: string) => {
    if (!value || (fields[key] && fields[key].value)) return;
    fields[key] = { value: value.trim().slice(0, 300), confidence, source: source?.trim().slice(0, 160) };
  };
  // Found a label but the value didn't validate (e.g. an OCR'd "03/14/1852"): show it to the reviewer, blank.
  const flag = (key: string, source: string) => {
    if (!fields[key]) fields[key] = { value: "", confidence: "low", source: source.trim().slice(0, 160) };
  };

  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, (s) => (s.length > 1 ? "   " : " ")).trim())
    .filter(Boolean);
  const hits = labelHits(lines);
  const first = (field: string, sections?: Section[]) => hits.find((h) => h.field === field && (!sections || sections.includes(h.section)));

  // ---- Patient ----
  const fn = first("firstName", ["patient"]);
  const ln = first("lastName", ["patient"]);
  if (fn) put("patient.firstName", titleCase(fn.value.split(/\s+/)[0]), base, fn.line);
  if (ln) put("patient.lastName", titleCase(ln.value.split(/\s{2,}/)[0]), base, ln.line);
  const nameHit = first("name", ["patient"]);
  if (nameHit && (!fn || !ln)) {
    const { first: f, last: l } = splitName(nameHit.value);
    put("patient.firstName", f, base, nameHit.line);
    put("patient.lastName", l, base, nameHit.line);
    // "DOE, JANE M" / "Jane M. Doe": the middle name or initial.
    const m = nameHit.value.includes(",") ? nameHit.value.split(",")[1]?.trim().split(/\s+/)[1] : nameHit.value.trim().split(/\s+/).length === 3 ? nameHit.value.trim().split(/\s+/)[1] : undefined;
    if (f && l && m && /^[A-Za-z]{1,20}\.?$/.test(m)) put("patient.middleName", titleCase(m.replace(/\.$/, "")), lower(base), nameHit.line);
  }
  const dob = first("dob");
  if (dob) {
    put("patient.dob", normalizeDate(dob.value.match(/[\d/.-]{6,10}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}/)?.[0] ?? ""), base, dob.line);
    flag("patient.dob", dob.line);
  }
  const sex = first("sex");
  if (sex) put("patient.sex", normalizeSex(sex.value.split(/\s+/)[0]), base, sex.line);

  const patientPhone = hits.find((h) => h.field === "phone" && h.section === "patient" && normalizePhone(h.value));
  if (patientPhone) put("patient.phone", normalizePhone(patientPhone.value), base, patientPhone.line);
  else {
    const raw = hits.find((h) => h.field === "phone" && h.section === "patient");
    if (raw) flag("patient.phone", raw.line);
  }
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (email) put("patient.email", email[0].toLowerCase(), lower(base), email[0]);

  const addr = first("address", ["patient"]);
  if (addr) {
    const csz = addr.value.match(CITY_STATE_ZIP);
    const street = csz ? addr.value.slice(0, csz.index).replace(/[,\s]+$/, "") : addr.value;
    if (/\d/.test(street)) put("patient.addressLine1", titleCase(street), base, addr.line);
    const idx = lines.indexOf(addr.line);
    const cszMatch = csz ?? lines.slice(idx + 1, idx + 3).map((l) => l.match(CITY_STATE_ZIP)).find(Boolean);
    if (cszMatch && STATES.has(cszMatch[2])) {
      put("patient.city", titleCase(cszMatch[1].trim()), base, cszMatch[0]);
      put("patient.state", cszMatch[2], base, cszMatch[0]);
      put("patient.zip", cszMatch[3], base, cszMatch[0]);
    }
  }
  const city = first("city", ["patient"]);
  if (city) put("patient.city", titleCase(city.value.split(/\s{2,}/)[0]), base, city.line);
  const state = first("state", ["patient"]);
  if (state && STATES.has(state.value.slice(0, 2).toUpperCase())) put("patient.state", state.value.slice(0, 2).toUpperCase(), base, state.line);
  const zip = first("zip", ["patient"]);
  if (zip) put("patient.zip", zip.value.match(/\d{5}(?:-\d{4})?/)?.[0], base, zip.line);
  const middle = first("middle", ["patient"]);
  if (middle && /^[A-Za-z.' -]{1,30}$/.test(middle.value.split(/\s{2,}/)[0])) put("patient.middleName", titleCase(middle.value.split(/\s{2,}/)[0].replace(/\.$/, "")), base, middle.line);
  // Only the last four digits are ever kept.
  const ssn = first("ssn");
  const ssnDigits = ssn?.value.match(/(?:\d{3}|[X*x]{3})[- ]?(?:\d{2}|[X*x]{2})[- ]?(\d{4})\b/)?.[1];
  if (ssn && ssnDigits) put("patient.ssnLast4", ssnDigits, base, "SSN on file in the document");
  const phone2 = hits.find((h) => h.field === "phone" && h.section === "patient" && normalizePhone(h.value) && h !== patientPhone && normalizePhone(h.value) !== normalizePhone(patientPhone?.value ?? ""));
  if (phone2) put("patient.phone2", normalizePhone(phone2.value), base, phone2.line);
  const addr2 = first("address2", ["patient"]);
  if (addr2 && addr2.value.length <= 30) put("patient.addressLine2", addr2.line.match(/(?:apt\.?|apartment|unit|suite)\s*#?\s*[A-Za-z0-9-]+/i)?.[0] ?? addr2.value.split(/\s{2,}/)[0], lower(base), addr2.line);
  const county = first("county", ["patient"]);
  if (county) put("patient.county", titleCase(county.value.split(/\s{2,}/)[0]), base, county.line);
  const race = first("race");
  if (race) put("patient.race", titleCase(race.value.split(/\s{2,}/)[0]), base, race.line);
  const ethnicity = first("ethnicity");
  if (ethnicity) put("patient.ethnicity", titleCase(ethnicity.value.split(/\s{2,}/)[0]), base, ethnicity.line);
  const occupation = first("occupation");
  if (occupation) put("patient.occupation", titleCase(occupation.value.split(/\s{2,}/)[0]), base, occupation.line);
  const lang = first("language");
  if (lang) put("patient.preferredLanguage", titleCase(lang.value.split(/\s{2,}/)[0]), base, lang.line);
  const marital = first("marital");
  if (marital) put("patient.maritalStatus", titleCase(marital.value.split(/\s{2,}/)[0]), base, marital.line);

  const em = first("emergencyName") ?? first("name", ["emergency"]);
  if (em) put("patient.emergencyContactName", cleanPersonName(em.value.split(/\s{2,}/)[0]), base, em.line);
  const emPhone = hits.find((h) => h.field === "phone" && h.section === "emergency" && normalizePhone(h.value));
  if (emPhone) put("patient.emergencyContactPhone", normalizePhone(emPhone.value), base, emPhone.line);
  const rel = first("relationship", ["emergency"]);
  if (rel) put("patient.emergencyContactRelationship", titleCase(rel.value.split(/\s{2,}/)[0]), base, rel.line);

  // ---- Insurance ----
  const payer = first("payer", ["patient", "insurance", "referral"]);
  if (payer) put("insurance.payerName", payer.value.split(/\s{2,}/)[0].replace(/\b(member|id|group)\b.*$/i, "").trim(), base, payer.line);
  const member = first("memberId", ["patient", "insurance", "referral"]);
  if (member) put("insurance.memberId", member.value.match(/[A-Z0-9][A-Z0-9-]{3,24}/i)?.[0]?.toUpperCase(), base, member.line);
  const group = first("group", ["patient", "insurance", "referral"]);
  if (group) put("insurance.groupNumber", group.value.match(/[A-Z0-9][A-Z0-9-]{1,24}/i)?.[0]?.toUpperCase(), base, group.line);
  const plan = first("plan", ["patient", "insurance"]);
  if (plan) put("insurance.planName", plan.value.split(/\s{2,}/)[0], base, plan.line);
  const groupName = first("groupName", ["patient", "insurance"]);
  if (groupName) put("insurance.groupName", groupName.value.split(/\s{2,}/)[0], base, groupName.line);
  const copay = first("copay", ["patient", "insurance"]);
  if (copay) put("insurance.copay", copay.value.match(/\$?\s?(\d{1,4}(?:\.\d{2})?)/)?.[1], base, copay.line);
  const effective = first("effective", ["patient", "insurance"]);
  if (effective) put("insurance.effectiveDate", normalizeDate(effective.value.match(/[\d/.-]{6,10}/)?.[0] ?? ""), base, effective.line);
  const subDob = first("subscriberDob");
  if (subDob) put("insurance.subscriberDob", normalizeDate(subDob.value.match(/[\d/.-]{6,10}/)?.[0] ?? ""), base, subDob.line);
  const subRel = first("relationship", ["insurance"]);
  if (subRel) put("insurance.subscriberRelationship", titleCase(subRel.value.split(/\s{2,}/)[0]), lower(base), subRel.line);
  const sub = first("subscriber", ["insurance"]);
  if (sub && !/\d{4,}/.test(sub.value)) put("insurance.subscriberName", cleanPersonName(sub.value.split(/\s{2,}/)[0]), lower(base), sub.line);
  if (!fields["insurance.payerName"] && opts.knownPayers?.length) {
    const found = opts.knownPayers.find((p) => p.length > 3 && text.toLowerCase().includes(p.toLowerCase()));
    if (found) put("insurance.payerName", found, "medium", found);
  }
  const sPayer = first("secondaryPayer") ?? first("payer", ["secondary"]);
  if (sPayer) put("secondary.payerName", sPayer.value.split(/\s{2,}/)[0].replace(/\b(member|id|group)\b.*$/i, "").trim(), base, sPayer.line);
  const sMember = first("memberId", ["secondary"]);
  if (sMember) put("secondary.memberId", sMember.value.match(/[A-Z0-9][A-Z0-9-]{3,24}/i)?.[0]?.toUpperCase(), base, sMember.line);
  const sGroup = first("group", ["secondary"]);
  if (sGroup) put("secondary.groupNumber", sGroup.value.match(/[A-Z0-9][A-Z0-9-]{1,24}/i)?.[0]?.toUpperCase(), base, sGroup.line);

  // ---- Referral ----
  const rDate = first("referralDate");
  if (rDate) put("referral.referralDate", normalizeDate(rDate.value.match(/[\d/.-]{6,10}/)?.[0] ?? ""), base, rDate.line);
  const src = first("sourceName");
  if (src) put("referral.sourceName", src.value.split(/\s{2,}/)[0], base, src.line);
  const phys = first("physician");
  if (phys) put("referral.physicianName", cleanPersonName(phys.value.split(/\s{2,}/)[0]), base, phys.line);
  const npiHit = hits.find((h) => h.field === "npi" && /\b\d{10}\b/.test(h.value) && h.section !== "pcp");
  if (npiHit) put("referral.physicianNpi", npiHit.value.match(/\b\d{10}\b/)![0], base, npiHit.line);
  const contact = first("contact", ["referral", "patient"]);
  if (contact && !normalizePhone(contact.value)) put("referral.contactName", cleanPersonName(contact.value.split(/\s{2,}/)[0]), lower(base), contact.line);
  const refPhone = hits.find((h) => h.field === "phone" && h.section === "referral" && normalizePhone(h.value));
  if (refPhone) put("referral.contactPhone", normalizePhone(refPhone.value), base, refPhone.line);
  const refFax = hits.find((h) => h.field === "fax" && h.section !== "pcp" && h.section !== "pharmacy" && normalizePhone(h.value));
  if (refFax) put("referral.contactFax", normalizePhone(refFax.value), base, refFax.line);
  const services = first("services");
  if (services) put("referral.servicesRequested", services.value, base, services.line);
  const dxCodes = new Set<string>();
  for (const m of text.matchAll(ICD10)) {
    // Needs a decimal part, or a diagnosis label on the same line, to avoid matching random tokens.
    const line = lines.find((l) => l.includes(m[0])) ?? "";
    if (m[2] || /diagnos|dx|icd/i.test(line)) dxCodes.add(m[2] ? `${m[1]}.${m[2]}` : m[1]);
  }
  if (dxCodes.size) put("referral.diagnoses", [...dxCodes].slice(0, 12).join(", "), lower(base), first("diagnoses")?.line);

  const onset = first("onset");
  if (onset) put("referral.onsetDate", normalizeDate(onset.value.match(/[\d/.-]{6,10}/)?.[0] ?? ""), base, onset.line);

  // ---- Pharmacy and home health ----
  const pharmacy = first("pharmacy");
  if (pharmacy && /[A-Za-z]{3}/.test(pharmacy.value)) put("pharmacy.name", pharmacy.value.split(/\s{2,}/)[0].slice(0, 100), base, pharmacy.line);
  const pharmPhone = hits.find((h) => h.field === "phone" && h.section === "pharmacy" && normalizePhone(h.value));
  if (pharmPhone) put("pharmacy.phone", normalizePhone(pharmPhone.value), base, pharmPhone.line);
  const pharmFax = hits.find((h) => h.field === "fax" && h.section === "pharmacy" && normalizePhone(h.value));
  if (pharmFax) put("pharmacy.fax", normalizePhone(pharmFax.value), base, pharmFax.line);
  const pharmAddr = first("address", ["pharmacy"]);
  if (pharmAddr) put("pharmacy.address", pharmAddr.value.slice(0, 160), base, pharmAddr.line);
  const homeHealth = first("homeHealth");
  if (homeHealth && /[A-Za-z]{3}/.test(homeHealth.value) && !/^(yes|no|n\/a|none)$/i.test(homeHealth.value.trim())) put("homeHealth.company", homeHealth.value.split(/\s{2,}/)[0].slice(0, 100), base, homeHealth.line);
  const nurse = first("nurse");
  if (nurse) put("homeHealth.nurse", cleanPersonName(nurse.value.split(/\s{2,}/)[0]), lower(base), nurse.line);

  // ---- PCP ----
  const pcp = first("pcp");
  if (pcp) put("pcp.name", cleanPersonName(pcp.value.split(/\s{2,}/)[0]), base, pcp.line);
  const pcpPhone = hits.find((h) => h.field === "phone" && h.section === "pcp" && normalizePhone(h.value));
  if (pcpPhone) put("pcp.phone", normalizePhone(pcpPhone.value), base, pcpPhone.line);
  const pcpFax = hits.find((h) => h.field === "fax" && h.section === "pcp" && normalizePhone(h.value));
  if (pcpFax) put("pcp.fax", normalizePhone(pcpFax.value), base, pcpFax.line);

  return { docType: classify(text), fields };
}
