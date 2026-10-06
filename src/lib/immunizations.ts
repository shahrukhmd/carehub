import "server-only";
import { prisma } from "@/lib/prisma";
import { rolesFor } from "@/lib/permissions";

export const IMMUNIZATION_ROLES = rolesFor("immunizations.record");

// Adult vaccines most relevant to a wound-care practice (CDC CVX codes, MVX manufacturer codes).
export const VACCINES: { cvx: string; name: string; mfr?: string; route?: string; dose?: number }[] = [
  { cvx: "115", name: "Tdap (tetanus, diphtheria, acellular pertussis)", route: "IM", dose: 0.5 },
  { cvx: "113", name: "Td (tetanus, diphtheria) adult, preservative free", route: "IM", dose: 0.5 },
  { cvx: "139", name: "Td (tetanus, diphtheria) adult, unspecified", route: "IM", dose: 0.5 },
  { cvx: "112", name: "Tetanus toxoid, unspecified", route: "IM", dose: 0.5 },
  { cvx: "13", name: "Tetanus immune globulin (TIG)", route: "IM", dose: 1 },
  { cvx: "150", name: "Influenza, injectable, quadrivalent, preservative free", route: "IM", dose: 0.5 },
  { cvx: "197", name: "Influenza, high-dose, quadrivalent (65+)", route: "IM", dose: 0.7 },
  { cvx: "88", name: "Influenza, unspecified formulation" },
  { cvx: "216", name: "Pneumococcal conjugate PCV20", mfr: "PFR", route: "IM", dose: 0.5 },
  { cvx: "215", name: "Pneumococcal conjugate PCV15", mfr: "MSD", route: "IM", dose: 0.5 },
  { cvx: "33", name: "Pneumococcal polysaccharide PPSV23", mfr: "MSD", route: "IM", dose: 0.5 },
  { cvx: "187", name: "Zoster recombinant (Shingrix)", mfr: "SKB", route: "IM", dose: 0.5 },
  { cvx: "213", name: "COVID-19, unspecified", route: "IM" },
  { cvx: "43", name: "Hepatitis B, adult", route: "IM", dose: 1 },
  { cvx: "45", name: "Hepatitis B, unspecified" },
  { cvx: "303", name: "RSV, adult (Arexvy / Abrysvo)", route: "IM", dose: 0.5 },
  // Childhood / adolescent schedule
  { cvx: "08", name: "Hepatitis B, pediatric/adolescent", route: "IM", dose: 0.5 },
  { cvx: "116", name: "Rotavirus, pentavalent (RotaTeq)", route: "PO" },
  { cvx: "119", name: "Rotavirus, monovalent (Rotarix)", route: "PO" },
  { cvx: "20", name: "DTaP", route: "IM", dose: 0.5 },
  { cvx: "120", name: "DTaP-IPV-Hib (Pentacel)", route: "IM", dose: 0.5 },
  { cvx: "110", name: "DTaP-HepB-IPV (Pediarix)", route: "IM", dose: 0.5 },
  { cvx: "146", name: "DTaP-IPV-Hib-HepB (Vaxelis)", route: "IM", dose: 0.5 },
  { cvx: "130", name: "DTaP-IPV (Kinrix / Quadracel)", route: "IM", dose: 0.5 },
  { cvx: "48", name: "Hib (PRP-T)", route: "IM", dose: 0.5 },
  { cvx: "133", name: "Pneumococcal conjugate PCV13", route: "IM", dose: 0.5 },
  { cvx: "10", name: "IPV (polio)", route: "IM", dose: 0.5 },
  { cvx: "03", name: "MMR", route: "SC", dose: 0.5 },
  { cvx: "94", name: "MMRV (ProQuad)", route: "SC", dose: 0.5 },
  { cvx: "21", name: "Varicella", route: "SC", dose: 0.5 },
  { cvx: "83", name: "Hepatitis A, pediatric/adolescent", route: "IM", dose: 0.5 },
  { cvx: "165", name: "HPV 9-valent (Gardasil 9)", route: "IM", dose: 0.5 },
  { cvx: "147", name: "Meningococcal ACWY (MenACWY)", route: "IM", dose: 0.5 },
  { cvx: "163", name: "Meningococcal B (MenB)", route: "IM", dose: 0.5 },
  { cvx: "307", name: "RSV monoclonal, infant (nirsevimab)", route: "IM" },
];

export const MANUFACTURERS: Record<string, string> = {
  SKB: "GlaxoSmithKline",
  PMC: "Sanofi Pasteur",
  MSD: "Merck",
  PFR: "Pfizer",
  SEQ: "Seqirus",
  MOD: "Moderna",
  OTH: "Other",
};
export const SITES: Record<string, string> = { LD: "Left deltoid", RD: "Right deltoid", LT: "Left thigh", RT: "Right thigh", LG: "Left gluteus", RG: "Right gluteus" };
export const ROUTES: Record<string, string> = { IM: "Intramuscular", SC: "Subcutaneous", ID: "Intradermal", IN: "Intranasal", PO: "Oral" };

const hl7 = (v: string | null | undefined) => (v ?? "").replace(/[|^~\\&\r\n]/g, " ").trim();
const ts = (d: Date) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
const dt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

// HL7 v2.5.1 VXU^V04 messages (CDC implementation guide) for the state immunization registry.
export async function buildVxuBatch(practiceId: string, from: Date, to: Date, onlyUnreported: boolean) {
  const [practice, imms] = await Promise.all([
    prisma.practice.findUniqueOrThrow({ where: { id: practiceId } }),
    prisma.immunization.findMany({
      where: { practiceId, administeredAt: { gte: from, lte: to }, ...(onlyUnreported ? { reportedAt: null } : {}) },
      include: { patient: true },
      orderBy: { administeredAt: "asc" },
    }),
  ]);
  const facility = hl7(practice.name).slice(0, 40);
  const now = new Date();
  const messages = imms.map((i, n) => {
    const p = i.patient;
    const id = `CH${ts(now)}${String(n + 1).padStart(4, "0")}`;
    const refused = i.source === "REFUSED";
    const segs = [
      `MSH|^~\\&|CAREHUB|${facility}|IIS|IIS|${ts(now)}||VXU^V04^VXU_V04|${id}|P|2.5.1|||ER|AL|||||Z22^CDCPHINVS`,
      `PID|1||${hl7(p.mrn)}^^^CAREHUB^MR||${hl7(p.lastName)}^${hl7(p.firstName)}^^^^^L||${dt(p.dob)}|${p.sex === "F" ? "F" : p.sex === "M" ? "M" : "U"}|||${hl7(p.addressLine1)}^^${hl7(p.city)}^${hl7(p.state)}^${hl7(p.zip)}^USA^L||${hl7(p.phone).replace(/\D/g, "") ? `^PRN^PH^^^${hl7(p.phone).replace(/\D/g, "").slice(0, 3)}^${hl7(p.phone).replace(/\D/g, "").slice(3, 10)}` : ""}`,
      `ORC|RE||${hl7(i.id)}^CAREHUB`,
      `RXA|0|1|${dt(i.administeredAt)}||${hl7(i.cvxCode ?? "999")}^${hl7(i.vaccine)}^CVX|${refused ? "999" : (i.doseMl ?? 999)}|${refused || i.doseMl === null ? "" : "mL^mL^UCUM"}||${i.source === "HISTORICAL" ? "01^Historical information - source unspecified^NIP001" : "00^New immunization record^NIP001"}||||||${hl7(i.lotNumber)}|${i.expirationDate ? dt(i.expirationDate) : ""}|${i.manufacturer && MANUFACTURERS[i.manufacturer] ? `${i.manufacturer}^${MANUFACTURERS[i.manufacturer]}^MVX` : ""}|${refused ? "00^Parental decision^NIP002" : ""}||${refused ? "RE" : "CP"}|A`,
    ];
    if (!refused && i.route) segs.push(`RXR|${hl7(i.route) === "IM" ? "C28161^Intramuscular^NCIT" : `${hl7(i.route)}^${ROUTES[i.route] ?? i.route}^HL70162`}|${i.site ? `${i.site}^${SITES[i.site] ?? i.site}^HL70163` : ""}`);
    if (i.visDate) segs.push(`OBX|1|DT|29769-7^Date vaccine information statement presented^LN|1|${dt(i.visDate)}||||||F`);
    return segs.join("\r");
  });
  const body = [`FHS|^~\\&|CAREHUB|${facility}|IIS|IIS|${ts(now)}`, `BHS|^~\\&|CAREHUB|${facility}|IIS|IIS|${ts(now)}`, ...messages, `BTS|${messages.length}`, `FTS|1`].join("\r");
  return { body, count: messages.length, ids: imms.map((i) => i.id) };
}
