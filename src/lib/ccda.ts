import "server-only";
import { randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { prisma } from "@/lib/prisma";
import { etiologyLabel } from "@/lib/wound";

// HL7 C-CDA R2.1 Continuity of Care Document (CCD): export a patient summary, and read one in.

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const ts = (d: Date) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
const day = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const OID = {
  ICD10: "2.16.840.1.113883.6.90",
  LOINC: "2.16.840.1.113883.6.1",
  CVX: "2.16.840.1.113883.12.292",
  CPT: "2.16.840.1.113883.6.12",
};

function section(templateId: string, code: string, title: string, headers: string[], rows: string[][], entries: string[]) {
  const table = rows.length
    ? `<table border="1" width="100%"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : `<paragraph>None recorded</paragraph>`;
  return `<component><section><templateId root="${templateId}" extension="2015-08-01"/><code code="${code}" codeSystem="${OID.LOINC}" codeSystemName="LOINC"/><title>${esc(title)}</title><text>${table}</text>${entries.join("")}</section></component>`;
}

export async function buildCcd(practiceId: string, patientId: string, authorId: string) {
  const [p, practice, author] = await Promise.all([
    prisma.patient.findFirstOrThrow({
      where: { id: patientId, practiceId },
      include: {
        allergies: true,
        problems: true,
        medications: { where: { status: "ACTIVE" } },
        immunizations: { orderBy: { administeredAt: "desc" } },
        wounds: true,
        insurances: { where: { active: true }, include: { payer: true } },
        labOrders: { include: { result: true }, orderBy: { orderedAt: "desc" }, take: 50 },
        encounters: { orderBy: { date: "desc" }, take: 20, include: { provider: true, vitals: true, diagnoses: true } },
      },
    }),
    prisma.practice.findUniqueOrThrow({ where: { id: practiceId }, include: { locations: { take: 1 } } }),
    prisma.user.findUniqueOrThrow({ where: { id: authorId } }),
  ]);
  const loc = practice.locations[0];
  const sections: string[] = [];

  sections.push(
    section("2.16.840.1.113883.10.20.22.2.6.1", "48765-2", "Allergies and Intolerances", ["Allergen", "Reaction", "Severity"], p.allergies.map((a) => [a.allergen, a.reaction, a.severity]), p.allergies.map(
      (a) => `<entry typeCode="DRIV"><act classCode="ACT" moodCode="EVN"><templateId root="2.16.840.1.113883.10.20.22.4.30" extension="2015-08-01"/><id root="${randomUUID()}"/><code code="CONC" codeSystem="2.16.840.1.113883.5.6"/><statusCode code="active"/><entryRelationship typeCode="SUBJ"><observation classCode="OBS" moodCode="EVN"><templateId root="2.16.840.1.113883.10.20.22.4.7" extension="2014-06-09"/><id root="${randomUUID()}"/><code code="ASSERTION" codeSystem="2.16.840.1.113883.5.4"/><statusCode code="completed"/><value xsi:type="CD" code="419199007" codeSystem="2.16.840.1.113883.6.96" displayName="Allergy to substance"/><participant typeCode="CSM"><participantRole classCode="MANU"><playingEntity classCode="MMAT"><code nullFlavor="OTH"><originalText>${esc(a.allergen)}</originalText></code></playingEntity></participantRole></participant></observation></entryRelationship></act></entry>`
    ))
  );
  sections.push(
    section("2.16.840.1.113883.10.20.22.2.1.1", "10160-0", "Medications", ["Medication", "Directions", "Start"], p.medications.map((m) => [m.name, m.sig, m.startDate.toISOString().slice(0, 10)]), p.medications.map(
      (m) => `<entry typeCode="DRIV"><substanceAdministration classCode="SBADM" moodCode="EVN"><templateId root="2.16.840.1.113883.10.20.22.4.16" extension="2014-06-09"/><id root="${randomUUID()}"/><text>${esc(m.sig)}</text><statusCode code="active"/><effectiveTime xsi:type="IVL_TS"><low value="${day(m.startDate)}"/></effectiveTime><consumable><manufacturedProduct classCode="MANU"><templateId root="2.16.840.1.113883.10.20.22.4.23" extension="2014-06-09"/><manufacturedMaterial><code nullFlavor="OTH"><originalText>${esc(m.name)}</originalText></code></manufacturedMaterial></manufacturedProduct></consumable></substanceAdministration></entry>`
    ))
  );
  const probRows = [
    ...p.problems.map((x) => [x.icd10, x.description, x.status.toLowerCase(), x.onsetDate ? x.onsetDate.toISOString().slice(0, 10) : ""]),
    ...p.wounds.map((w) => ["", `${w.label} — ${etiologyLabel[w.etiology] ?? w.etiology} wound, ${w.location}`, w.status.toLowerCase(), w.onsetDate ? w.onsetDate.toISOString().slice(0, 10) : ""]),
  ];
  sections.push(
    section("2.16.840.1.113883.10.20.22.2.5.1", "11450-4", "Problems", ["ICD-10", "Problem", "Status", "Onset"], probRows, p.problems.map(
      (x) => `<entry typeCode="DRIV"><act classCode="ACT" moodCode="EVN"><templateId root="2.16.840.1.113883.10.20.22.4.3" extension="2015-08-01"/><id root="${randomUUID()}"/><code code="CONC" codeSystem="2.16.840.1.113883.5.6"/><statusCode code="${x.status === "ACTIVE" ? "active" : "completed"}"/><entryRelationship typeCode="SUBJ"><observation classCode="OBS" moodCode="EVN"><templateId root="2.16.840.1.113883.10.20.22.4.4" extension="2015-08-01"/><id root="${randomUUID()}"/><code code="55607006" codeSystem="2.16.840.1.113883.6.96" displayName="Problem"/><statusCode code="completed"/>${x.onsetDate ? `<effectiveTime><low value="${day(x.onsetDate)}"/></effectiveTime>` : ""}<value xsi:type="CD" code="${esc(x.icd10)}" codeSystem="${OID.ICD10}" codeSystemName="ICD-10-CM" displayName="${esc(x.description)}"/></observation></entryRelationship></act></entry>`
    ))
  );
  sections.push(
    section("2.16.840.1.113883.10.20.22.2.2.1", "11369-6", "Immunizations", ["Vaccine", "CVX", "Date", "Status"], p.immunizations.map((i) => [i.vaccine, i.cvxCode ?? "", i.administeredAt.toISOString().slice(0, 10), i.source === "REFUSED" ? "refused" : "completed"]), p.immunizations.map(
      (i) => `<entry typeCode="DRIV"><substanceAdministration classCode="SBADM" moodCode="EVN" negationInd="${i.source === "REFUSED"}"><templateId root="2.16.840.1.113883.10.20.22.4.52" extension="2015-08-01"/><id root="${randomUUID()}"/><statusCode code="completed"/><effectiveTime value="${day(i.administeredAt)}"/><consumable><manufacturedProduct classCode="MANU"><templateId root="2.16.840.1.113883.10.20.22.4.54" extension="2014-06-09"/><manufacturedMaterial><code code="${esc(i.cvxCode ?? "")}" codeSystem="${OID.CVX}" displayName="${esc(i.vaccine)}"/>${i.lotNumber ? `<lotNumberText>${esc(i.lotNumber)}</lotNumberText>` : ""}</manufacturedMaterial></manufacturedProduct></consumable></substanceAdministration></entry>`
    ))
  );
  const vitals = p.encounters.filter((e) => e.vitals).map((e) => ({ date: e.date, v: e.vitals! }));
  const V: [keyof NonNullable<(typeof vitals)[number]["v"]>, string, string, string][] = [
    ["bpSystolic", "8480-6", "Systolic BP", "mm[Hg]"],
    ["bpDiastolic", "8462-4", "Diastolic BP", "mm[Hg]"],
    ["heartRate", "8867-4", "Heart rate", "/min"],
    ["respRate", "9279-1", "Respiratory rate", "/min"],
    ["tempC", "8310-5", "Body temperature", "Cel"],
    ["weightKg", "29463-7", "Body weight", "kg"],
    ["heightCm", "8302-2", "Body height", "cm"],
    ["spo2", "59408-5", "Oxygen saturation", "%"],
  ];
  sections.push(
    section("2.16.840.1.113883.10.20.22.2.4.1", "8716-3", "Vital Signs", ["Date", "BP", "HR", "Temp °C", "Weight kg", "SpO2"], vitals.map(({ date, v }) => [date.toISOString().slice(0, 10), v.bpSystolic ? `${v.bpSystolic}/${v.bpDiastolic ?? ""}` : "", String(v.heartRate ?? ""), String(v.tempC ?? ""), String(v.weightKg ?? ""), String(v.spo2 ?? "")]), vitals.slice(0, 5).map(
      ({ date, v }) => `<entry typeCode="DRIV"><organizer classCode="CLUSTER" moodCode="EVN"><templateId root="2.16.840.1.113883.10.20.22.4.26" extension="2015-08-01"/><id root="${randomUUID()}"/><code code="46680005" codeSystem="2.16.840.1.113883.6.96" displayName="Vital signs"/><statusCode code="completed"/><effectiveTime value="${ts(date)}"/>${V.filter(([k]) => v[k] !== null && v[k] !== undefined).map(([k, code, name, unit]) => `<component><observation classCode="OBS" moodCode="EVN"><templateId root="2.16.840.1.113883.10.20.22.4.27" extension="2014-06-09"/><id root="${randomUUID()}"/><code code="${code}" codeSystem="${OID.LOINC}" displayName="${name}"/><statusCode code="completed"/><effectiveTime value="${ts(date)}"/><value xsi:type="PQ" value="${esc(v[k])}" unit="${unit}"/></observation></component>`).join("")}</organizer></entry>`
    ))
  );
  const results = p.labOrders.filter((l) => l.result);
  sections.push(section("2.16.840.1.113883.10.20.22.2.3.1", "30954-2", "Results", ["Test", "Result", "Range", "Flag", "Date"], results.map((l) => [l.testName, `${l.result!.value} ${l.result!.unit ?? ""}`.trim(), l.result!.referenceRange ?? "", l.result!.flag.toLowerCase(), l.result!.resultedAt.toISOString().slice(0, 10)]), []));
  sections.push(section("2.16.840.1.113883.10.20.22.2.22.1", "46240-8", "Encounters", ["Date", "Type", "Provider", "Diagnoses"], p.encounters.map((e) => [e.date.toISOString().slice(0, 10), e.type.toLowerCase(), e.provider.name, e.diagnoses.map((d) => `${d.icd10} ${d.description}`).join("; ")]), []));
  sections.push(section("2.16.840.1.113883.10.20.22.2.18", "48768-6", "Payers", ["Payer", "Member ID", "Rank"], p.insurances.map((i) => [i.payer.name, i.memberId, i.rank.toLowerCase()]), []));

  const gender = p.sex === "F" ? "F" : p.sex === "M" ? "M" : "UN";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:sdtc="urn:hl7-org:sdtc">
<realmCode code="US"/><typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
<templateId root="2.16.840.1.113883.10.20.22.1.1" extension="2015-08-01"/><templateId root="2.16.840.1.113883.10.20.22.1.2" extension="2015-08-01"/>
<id root="${randomUUID()}"/><code code="34133-9" codeSystem="${OID.LOINC}" displayName="Summarization of Episode Note"/>
<title>${esc(practice.name)} — Continuity of Care Document</title><effectiveTime value="${ts(new Date())}"/>
<confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/><languageCode code="en-US"/>
<recordTarget><patientRole><id extension="${esc(p.mrn)}" root="2.16.840.1.113883.19.5"/>
<addr use="HP"><streetAddressLine>${esc(p.addressLine1)}</streetAddressLine><city>${esc(p.city)}</city><state>${esc(p.state)}</state><postalCode>${esc(p.zip)}</postalCode><country>US</country></addr>
${p.phone ? `<telecom use="HP" value="tel:${esc(p.phone)}"/>` : ""}${p.email ? `<telecom value="mailto:${esc(p.email)}"/>` : ""}
<patient><name use="L"><given>${esc(p.firstName)}</given><family>${esc(p.lastName)}</family></name><administrativeGenderCode code="${gender}" codeSystem="2.16.840.1.113883.5.1"/><birthTime value="${day(p.dob)}"/>${p.preferredLanguage ? `<languageCommunication><languageCode code="${esc(p.preferredLanguage.slice(0, 2).toLowerCase())}"/></languageCommunication>` : ""}</patient>
</patientRole></recordTarget>
<author><time value="${ts(new Date())}"/><assignedAuthor><id root="2.16.840.1.113883.4.6" extension="${esc(author.npi ?? "")}"/><assignedPerson><name>${esc(author.name)}</name></assignedPerson></assignedAuthor></author>
<custodian><assignedCustodian><representedCustodianOrganization><id root="2.16.840.1.113883.4.6" extension="${esc(loc?.npi ?? "")}"/><name>${esc(practice.name)}</name>${loc ? `<telecom value="tel:${esc(loc.phone ?? "")}"/><addr><streetAddressLine>${esc(loc.addressLine1)}</streetAddressLine><city>${esc(loc.city)}</city><state>${esc(loc.state)}</state><postalCode>${esc(loc.zip)}</postalCode></addr>` : ""}</representedCustodianOrganization></assignedCustodian></custodian>
<component><structuredBody>${sections.join("\n")}</structuredBody></component>
</ClinicalDocument>`;
}

// ---- Import ----

export type CcdImport = {
  patient: { firstName: string; lastName: string; dob: string | null; sex: string | null; mrn: string | null };
  problems: { code: string; description: string }[];
  medications: { name: string; sig: string }[];
  allergies: { allergen: string; reaction: string }[];
  immunizations: { vaccine: string; cvx: string | null; date: string | null }[];
};

const arr = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
type Node = Record<string, unknown>;
const txt = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).trim();
  if (Array.isArray(v)) return v.map(txt).filter(Boolean).join(" ");
  const n = v as Node;
  return txt(n["#text"] ?? n.originalText ?? "");
};
const find = (node: unknown, key: string, out: Node[] = []): Node[] => {
  if (!node || typeof node !== "object") return out;
  for (const [k, v] of Object.entries(node as Node)) {
    if (k === key) for (const x of arr(v as Node | Node[])) out.push(x);
    if (typeof v === "object") find(v, key, out);
  }
  return out;
};
const d8 = (v: unknown) => {
  const s = String(v ?? "");
  return /^\d{8}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
};

export function parseCcd(xml: string): CcdImport {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, processEntities: true }).parse(xml) as Node;
  const cd = doc.ClinicalDocument as Node | undefined;
  if (!cd) throw new Error("This isn't a C-CDA document (no ClinicalDocument).");
  const pr = find(cd.recordTarget, "patient")[0] ?? {};
  const name = arr(pr.name as Node | Node[])[0] ?? {};
  const role = find(cd.recordTarget, "patientRole")[0] ?? {};
  const out: CcdImport = {
    patient: {
      firstName: txt(arr(name.given as unknown[])[0]),
      lastName: txt(name.family),
      dob: d8((pr.birthTime as Node | undefined)?.["@value"]),
      sex: ((pr.administrativeGenderCode as Node | undefined)?.["@code"] as string) ?? null,
      mrn: (arr(role.id as Node | Node[])[0]?.["@extension"] as string) ?? null,
    },
    problems: [],
    medications: [],
    allergies: [],
    immunizations: [],
  };
  for (const sec of find(cd, "section")) {
    const code = (sec.code as Node | undefined)?.["@code"];
    const entries = arr(sec.entry as Node | Node[]);
    if (code === "11450-4") {
      for (const e of entries)
        for (const obs of find(e, "observation")) {
          const v = obs.value as Node | undefined;
          if (v?.["@code"] || v?.["@displayName"]) out.problems.push({ code: String(v["@code"] ?? ""), description: String(v["@displayName"] ?? txt(v.originalText) ?? "") });
        }
    } else if (code === "10160-0") {
      for (const e of entries) {
        const mat = find(e, "manufacturedMaterial")[0];
        const c = mat?.code as Node | undefined;
        const nm = String(c?.["@displayName"] ?? txt(c?.originalText) ?? txt(mat?.name));
        if (nm) out.medications.push({ name: nm, sig: txt(find(e, "substanceAdministration")[0]?.text) });
      }
    } else if (code === "48765-2") {
      for (const e of entries) {
        const ent = find(e, "playingEntity")[0];
        const c = ent?.code as Node | undefined;
        const nm = String(c?.["@displayName"] ?? txt(c?.originalText) ?? txt(ent?.name));
        const reaction = find(e, "observation")
          .map((o) => (o.value as Node | undefined)?.["@displayName"])
          .filter((x) => x && x !== "Allergy to substance")
          .join(", ");
        if (nm) out.allergies.push({ allergen: nm, reaction: String(reaction || "") });
      }
    } else if (code === "11369-6") {
      for (const e of entries) {
        const c = find(e, "manufacturedMaterial")[0]?.code as Node | undefined;
        const sa = find(e, "substanceAdministration")[0];
        const et = sa?.effectiveTime as Node | undefined;
        if (c) out.immunizations.push({ vaccine: String(c["@displayName"] ?? txt(c.originalText)), cvx: (c["@code"] as string) ?? null, date: d8(et?.["@value"] ?? (et?.low as Node | undefined)?.["@value"]) });
      }
    }
  }
  return out;
}
