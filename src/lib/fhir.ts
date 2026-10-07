import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

// FHIR R4 read-only API (US Core-shaped) for connected systems, authorised by practice API tokens.

export const FHIR_RESOURCES = ["Patient", "Condition", "AllergyIntolerance", "MedicationStatement", "Immunization", "Observation", "Encounter", "Coverage"] as const;

export const hashApiToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const newApiToken = () => `chk_${randomBytes(30).toString("base64url")}`;

export async function authorizeFhir(header: string | null) {
  const m = /^Bearer\s+(chk_[A-Za-z0-9_-]{30,80})$/.exec(header ?? "");
  if (!m) return null;
  const client = await prisma.apiClient.findUnique({ where: { tokenHash: hashApiToken(m[1]) } });
  if (!client || !client.active) return null;
  await prisma.apiClient.update({ where: { id: client.id }, data: { lastUsedAt: new Date() } });
  return client;
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : undefined);
const ref = (id: string) => ({ reference: `Patient/${id}` });

type P = Awaited<ReturnType<typeof prisma.patient.findFirstOrThrow>>;

export function patientResource(p: P) {
  return {
    resourceType: "Patient",
    id: p.id,
    meta: { profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient"], lastUpdated: p.updatedAt.toISOString() },
    identifier: [{ use: "usual", type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] }, system: "urn:carehub:mrn", value: p.mrn }],
    active: p.status === "ACTIVE",
    name: [{ use: "official", family: p.lastName, given: [p.firstName] }],
    telecom: [...(p.phone ? [{ system: "phone", value: p.phone, use: "home" }] : []), ...(p.email ? [{ system: "email", value: p.email }] : [])],
    gender: p.sex === "F" ? "female" : p.sex === "M" ? "male" : "unknown",
    birthDate: day(p.dob),
    deceasedBoolean: p.status === "DECEASED" || undefined,
    address: p.addressLine1 ? [{ use: "home", line: [p.addressLine1], city: p.city ?? undefined, state: p.state ?? undefined, postalCode: p.zip ?? undefined, country: "US" }] : undefined,
    communication: p.preferredLanguage ? [{ language: { text: p.preferredLanguage } }] : undefined,
  };
}

const bundle = (base: string, type: string, resources: Record<string, unknown>[]) => ({
  resourceType: "Bundle",
  type,
  total: resources.length,
  link: [{ relation: "self", url: base }],
  entry: resources.map((r) => ({ fullUrl: `${base.split("/fhir/")[0]}/fhir/${r.resourceType}/${r.id}`, resource: r, search: type === "searchset" ? { mode: "match" } : undefined })),
});

export const operationOutcome = (code: string, text: string) => ({ resourceType: "OperationOutcome", issue: [{ severity: "error", code, diagnostics: text }] });

async function resourcesFor(practiceId: string, type: string, patientIds: string[]) {
  const where = { patientId: { in: patientIds }, patient: { practiceId } };
  switch (type) {
    case "Condition":
      return (await prisma.problem.findMany({ where })).map((c) => ({
        resourceType: "Condition",
        id: c.id,
        clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: c.status === "ACTIVE" ? "active" : "resolved" }] },
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "problem-list-item" }] }],
        code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code: c.icd10, display: c.description }], text: c.description },
        subject: ref(c.patientId),
        onsetDateTime: day(c.onsetDate),
      }));
    case "AllergyIntolerance":
      return (await prisma.allergy.findMany({ where })).map((a) => ({
        resourceType: "AllergyIntolerance",
        id: a.id,
        clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
        code: { text: a.allergen },
        patient: ref(a.patientId),
        reaction: a.reaction ? [{ manifestation: [{ text: a.reaction }], severity: /severe/i.test(a.severity) ? "severe" : /mod/i.test(a.severity) ? "moderate" : "mild" }] : undefined,
      }));
    case "MedicationStatement":
      return (await prisma.medication.findMany({ where })).map((m) => ({
        resourceType: "MedicationStatement",
        id: m.id,
        status: m.status === "ACTIVE" ? "active" : "stopped",
        medicationCodeableConcept: { text: m.name },
        subject: ref(m.patientId),
        effectivePeriod: { start: day(m.startDate), end: day(m.discontinuedAt) },
        dosage: [{ text: m.sig }],
      }));
    case "Immunization":
      return (await prisma.immunization.findMany({ where: { ...where, practiceId } })).map((i) => ({
        resourceType: "Immunization",
        id: i.id,
        status: i.source === "REFUSED" ? "not-done" : "completed",
        vaccineCode: { coding: i.cvxCode ? [{ system: "http://hl7.org/fhir/sid/cvx", code: i.cvxCode, display: i.vaccine }] : [], text: i.vaccine },
        patient: ref(i.patientId),
        occurrenceDateTime: day(i.administeredAt),
        primarySource: i.source === "ADMINISTERED",
        lotNumber: i.lotNumber ?? undefined,
        statusReason: i.refusalReason ? { text: i.refusalReason } : undefined,
      }));
    case "Encounter":
      return (await prisma.encounter.findMany({ where: { patientId: { in: patientIds }, practiceId }, include: { provider: true, diagnoses: true }, orderBy: { date: "desc" }, take: 200 })).map((e) => ({
        resourceType: "Encounter",
        id: e.id,
        status: ["BILLED", "READY_FOR_BILLING", "READY_FOR_SIGNATURE", "READY_FOR_CODING", "CODING_QUERY", "READY_FOR_CDS"].includes(e.status) ? "finished" : "in-progress",
        class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: e.type === "TELEHEALTH" ? "VR" : "AMB" },
        subject: ref(e.patientId),
        participant: [{ individual: { display: e.provider.name } }],
        period: { start: e.date.toISOString() },
        reasonCode: e.diagnoses.map((d) => ({ coding: [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code: d.icd10, display: d.description }] })),
      }));
    case "Observation": {
      const encs = await prisma.encounter.findMany({ where: { patientId: { in: patientIds }, practiceId, vitals: { isNot: null } }, include: { vitals: true }, orderBy: { date: "desc" }, take: 100 });
      const V: [string, string, string, string][] = [
        ["heartRate", "8867-4", "Heart rate", "/min"],
        ["respRate", "9279-1", "Respiratory rate", "/min"],
        ["tempC", "8310-5", "Body temperature", "Cel"],
        ["weightKg", "29463-7", "Body weight", "kg"],
        ["heightCm", "8302-2", "Body height", "cm"],
        ["spo2", "59408-5", "Oxygen saturation", "%"],
      ];
      const out: Record<string, unknown>[] = [];
      for (const e of encs) {
        const v = e.vitals as unknown as Record<string, number | null>;
        const base = { resourceType: "Observation", status: "final", category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }], subject: ref(e.patientId), effectiveDateTime: e.date.toISOString(), encounter: { reference: `Encounter/${e.id}` } };
        for (const [k, code, display, unit] of V)
          if (v[k] !== null && v[k] !== undefined) out.push({ ...base, id: `${e.id}-${code}`, code: { coding: [{ system: "http://loinc.org", code, display }] }, valueQuantity: { value: v[k], unit, system: "http://unitsofmeasure.org", code: unit } });
        if (v.bpSystolic)
          out.push({
            ...base,
            id: `${e.id}-85354-9`,
            code: { coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood pressure panel" }] },
            component: [
              { code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] }, valueQuantity: { value: v.bpSystolic, unit: "mm[Hg]" } },
              { code: { coding: [{ system: "http://loinc.org", code: "8462-4" }] }, valueQuantity: { value: v.bpDiastolic, unit: "mm[Hg]" } },
            ],
          });
      }
      const labs = await prisma.labOrder.findMany({ where: { patientId: { in: patientIds }, patient: { practiceId }, result: { isNot: null } }, include: { result: true } });
      for (const l of labs)
        out.push({
          resourceType: "Observation",
          id: l.id,
          status: "final",
          category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
          code: { text: l.testName },
          subject: ref(l.patientId),
          effectiveDateTime: l.result!.resultedAt.toISOString(),
          valueString: `${l.result!.value}${l.result!.unit ? ` ${l.result!.unit}` : ""}`,
          referenceRange: l.result!.referenceRange ? [{ text: l.result!.referenceRange }] : undefined,
          interpretation: l.result!.flag !== "NORMAL" ? [{ text: l.result!.flag.toLowerCase() }] : undefined,
        });
      return out;
    }
    case "Coverage":
      return (await prisma.insurance.findMany({ where, include: { payer: true } })).map((i) => ({
        resourceType: "Coverage",
        id: i.id,
        status: i.active ? "active" : "cancelled",
        subscriberId: i.memberId,
        beneficiary: ref(i.patientId),
        relationship: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/subscriber-relationship", code: i.relationshipToInsured === "18" ? "self" : i.relationshipToInsured === "01" ? "spouse" : i.relationshipToInsured === "19" ? "child" : "other" }] },
        payor: [{ display: i.payer.name }],
        order: i.rank === "PRIMARY" ? 1 : i.rank === "SECONDARY" ? 2 : 3,
        class: i.groupNumber ? [{ type: { coding: [{ code: "group" }] }, value: i.groupNumber, name: i.planName ?? undefined }] : undefined,
      }));
  }
  return [];
}

export async function handleFhir(client: { id: string; practiceId: string; name: string }, path: string[], params: URLSearchParams, base: string) {
  const practiceId = client.practiceId;
  const [type, id, op] = path;
  if (!type || type === "metadata")
    return {
      status: 200,
      body: {
        resourceType: "CapabilityStatement",
        status: "active",
        date: new Date().toISOString(),
        kind: "instance",
        software: { name: "CareHub" },
        fhirVersion: "4.0.1",
        format: ["json"],
        rest: [{ mode: "server", security: { description: "Bearer token issued in CareHub Settings > Interoperability" }, resource: FHIR_RESOURCES.map((t) => ({ type: t, interaction: [{ code: "read" }, { code: "search-type" }], searchParam: t === "Patient" ? [{ name: "family" }, { name: "given" }, { name: "birthdate" }, { name: "identifier" }, { name: "name" }] : [{ name: "patient" }] })) }],
      },
    };
  if (!(FHIR_RESOURCES as readonly string[]).includes(type)) return { status: 404, body: operationOutcome("not-supported", `Resource type ${type} is not supported`) };
  const log = (detail: string) => logAudit(practiceId, null, "FHIR_READ", type, id ?? "search", `${client.name}: ${detail}`);

  if (type === "Patient") {
    if (id && op === "$everything") {
      const p = await prisma.patient.findFirst({ where: { id, practiceId, restricted: false } });
      if (!p) return { status: 404, body: operationOutcome("not-found", "Patient not found") };
      const all: Record<string, unknown>[] = [patientResource(p)];
      for (const t of FHIR_RESOURCES.filter((x) => x !== "Patient")) all.push(...(await resourcesFor(practiceId, t, [p.id])));
      await log(`$everything (${all.length} resources)`);
      return { status: 200, body: bundle(`${base}/Patient/${id}/$everything`, "searchset", all) };
    }
    if (id) {
      const p = await prisma.patient.findFirst({ where: { id, practiceId, restricted: false } });
      if (!p) return { status: 404, body: operationOutcome("not-found", "Patient not found") };
      await log("read");
      return { status: 200, body: patientResource(p) };
    }
    const family = params.get("family") ?? undefined;
    const given = params.get("given") ?? undefined;
    const nameQ = params.get("name") ?? undefined;
    const birth = params.get("birthdate");
    const ident = params.get("identifier")?.split("|").pop();
    if (!family && !given && !nameQ && !birth && !ident) return { status: 400, body: operationOutcome("required", "Search Patient by family, given, name, birthdate or identifier") };
    const patients = await prisma.patient.findMany({
      where: {
        practiceId,
        // Restricted charts stay out of the API: a client token has no break-the-glass.
        restricted: false,
        ...(family ? { lastName: { startsWith: family, mode: "insensitive" } } : {}),
        ...(given ? { firstName: { startsWith: given, mode: "insensitive" } } : {}),
        ...(nameQ ? { OR: [{ lastName: { startsWith: nameQ, mode: "insensitive" } }, { firstName: { startsWith: nameQ, mode: "insensitive" } }] } : {}),
        ...(birth && /^\d{4}-\d{2}-\d{2}$/.test(birth) ? { dob: { gte: new Date(`${birth}T00:00:00Z`), lt: new Date(new Date(`${birth}T00:00:00Z`).getTime() + 86_400_000) } } : {}),
        ...(ident ? { mrn: ident } : {}),
      },
      take: 50,
    });
    await log(`search (${patients.length})`);
    return { status: 200, body: bundle(`${base}/Patient?${params}`, "searchset", patients.map(patientResource)) };
  }
  // Clinical resources require a patient (read by id is supported via the patient's data).
  const patientParam = (params.get("patient") ?? params.get("subject") ?? params.get("beneficiary") ?? "").replace(/^Patient\//, "");
  if (id) {
    const owners = await prisma.patient.findMany({ where: { practiceId, restricted: false }, select: { id: true } });
    const found = (await resourcesFor(practiceId, type, owners.map((o) => o.id))).find((r) => r.id === id);
    if (!found) return { status: 404, body: operationOutcome("not-found", `${type}/${id} not found`) };
    await log("read");
    return { status: 200, body: found };
  }
  if (!patientParam) return { status: 400, body: operationOutcome("required", `Search ${type} with ?patient=<id>`) };
  const p = await prisma.patient.findFirst({ where: { id: patientParam, practiceId, restricted: false } });
  if (!p) return { status: 404, body: operationOutcome("not-found", "Patient not found") };
  const list = await resourcesFor(practiceId, type, [p.id]);
  const category = params.get("category");
  const filtered = category ? list.filter((r) => JSON.stringify((r as { category?: unknown }).category ?? "").includes(`"${category}"`)) : list;
  await log(`search patient=${p.id} (${filtered.length})`);
  return { status: 200, body: bundle(`${base}/${type}?${params}`, "searchset", filtered) };
}
