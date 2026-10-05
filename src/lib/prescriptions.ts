import "server-only";
import { prisma } from "@/lib/prisma";
import { settingsAddress } from "@/lib/practice-settings";
import { Flow, INK, MUTED, letterhead, newPdf } from "@/lib/pdf-kit";

export const RX_WRITE_ROLES = ["ADMIN", "CLINICIAN"];
export const RX_VIEW_ROLES = ["ADMIN", "CLINICIAN", "FRONT_DESK", "CDS", "CODER", "INTAKE"];

// Common wound-care prescriptions (drug, strength, form, sig, qty) to speed up writing.
export const RX_FAVORITES: { drug: string; strength: string; form: string; route: string; sig: string; quantity: string; unit: string; days: number }[] = [
  { drug: "Cephalexin", strength: "500 mg", form: "capsule", route: "oral", sig: "Take 1 capsule by mouth four times daily for 10 days", quantity: "40", unit: "capsules", days: 10 },
  { drug: "Doxycycline hyclate", strength: "100 mg", form: "tablet", route: "oral", sig: "Take 1 tablet by mouth twice daily for 10 days", quantity: "20", unit: "tablets", days: 10 },
  { drug: "Sulfamethoxazole-trimethoprim DS", strength: "800-160 mg", form: "tablet", route: "oral", sig: "Take 1 tablet by mouth twice daily for 10 days", quantity: "20", unit: "tablets", days: 10 },
  { drug: "Amoxicillin-clavulanate", strength: "875-125 mg", form: "tablet", route: "oral", sig: "Take 1 tablet by mouth twice daily with food for 10 days", quantity: "20", unit: "tablets", days: 10 },
  { drug: "Clindamycin", strength: "300 mg", form: "capsule", route: "oral", sig: "Take 1 capsule by mouth three times daily for 10 days", quantity: "30", unit: "capsules", days: 10 },
  { drug: "Collagenase (Santyl)", strength: "250 units/g", form: "ointment", route: "topical", sig: "Apply nickel-thick layer to wound bed once daily with dressing change", quantity: "30", unit: "g tube", days: 30 },
  { drug: "Mupirocin", strength: "2%", form: "ointment", route: "topical", sig: "Apply to affected area three times daily for 10 days", quantity: "22", unit: "g tube", days: 10 },
  { drug: "Silver sulfadiazine", strength: "1%", form: "cream", route: "topical", sig: "Apply thin layer to wound once or twice daily with dressing change", quantity: "50", unit: "g jar", days: 30 },
  { drug: "Gentamicin", strength: "0.1%", form: "cream", route: "topical", sig: "Apply to wound twice daily", quantity: "30", unit: "g tube", days: 15 },
  { drug: "Lidocaine", strength: "5%", form: "ointment", route: "topical", sig: "Apply to wound 15 minutes before dressing change as needed for pain", quantity: "35", unit: "g tube", days: 30 },
  { drug: "Pentoxifylline ER", strength: "400 mg", form: "tablet", route: "oral", sig: "Take 1 tablet by mouth three times daily with meals", quantity: "90", unit: "tablets", days: 30 },
  { drug: "Cadexomer iodine (Iodosorb)", strength: "0.9%", form: "gel", route: "topical", sig: "Apply 1/8 inch layer to wound bed with dressing change up to three times weekly", quantity: "40", unit: "g tube", days: 30 },
];

// Class words that also match an allergy (e.g. a penicillin allergy vs. amoxicillin).
const CROSS: Record<string, string[]> = {
  penicillin: ["amoxicillin", "ampicillin", "penicillin", "piperacillin", "dicloxacillin", "augmentin", "amoxicillin-clavulanate"],
  sulfa: ["sulfamethoxazole", "silver sulfadiazine", "sulfadiazine", "bactrim", "sulfasalazine"],
  cephalosporin: ["cephalexin", "cefazolin", "cefdinir", "cefuroxime", "ceftriaxone", "cefadroxil"],
  tetracycline: ["doxycycline", "minocycline", "tetracycline"],
  iodine: ["iodine", "povidone", "cadexomer"],
  lidocaine: ["lidocaine", "prilocaine"],
  macrolide: ["azithromycin", "clarithromycin", "erythromycin"],
  quinolone: ["ciprofloxacin", "levofloxacin", "moxifloxacin"],
};

export function allergyConflicts(drug: string, allergies: { allergen: string; reaction: string; severity: string }[]) {
  const d = drug.toLowerCase();
  return allergies.filter((a) => {
    const al = a.allergen.toLowerCase().trim();
    if (!al) return false;
    if (d.includes(al) || al.includes(d.split(" ")[0])) return true;
    return Object.entries(CROSS).some(([cls, members]) => (al.includes(cls) || members.some((m) => al.includes(m))) && members.some((m) => d.includes(m)));
  });
}

export async function practiceLetterhead(practiceId: string, locationId?: string | null) {
  const [practice, settings, loc] = await Promise.all([
    prisma.practice.findUniqueOrThrow({ where: { id: practiceId } }),
    prisma.practiceSettings.findUnique({ where: { practiceId } }),
    locationId ? prisma.location.findUnique({ where: { id: locationId } }) : prisma.location.findFirst({ where: { practiceId }, orderBy: { name: "asc" } }),
  ]);
  const phys = settingsAddress(settings, "physical");
  const line1 = loc?.addressLine1 ?? phys?.line1 ?? null;
  const line2 = loc ? [loc.city, [loc.state, loc.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : phys ? `${phys.city}, ${phys.state} ${phys.zip}` : null;
  return { name: practice.name, line1, line2, phone: loc?.phone ?? null, fax: settings?.faxNumber ?? null };
}

export async function prescriptionPdf(rxId: string, practiceId: string) {
  const rx = await prisma.prescription.findFirstOrThrow({ where: { id: rxId, practiceId }, include: { patient: { include: { allergies: true } } } });
  const prescriber = await prisma.user.findUniqueOrThrow({ where: { id: rx.prescriberId }, include: { renderingProvider: true } });
  const { pdf, font, bold } = await newPdf(`Prescription ${rx.drug}`);
  const f = new Flow(pdf, font, bold);
  letterhead(f, await practiceLetterhead(practiceId));
  const p = rx.patient;
  f.text(`Patient: ${p.lastName}, ${p.firstName}    DOB: ${p.dob.toISOString().slice(0, 10)}    MRN: ${p.mrn}`, { bold: true });
  const addr = [p.addressLine1, [p.city, p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (addr) f.text(addr, { size: 9.5, color: MUTED });
  f.text(`Allergies: ${p.allergies.length ? p.allergies.map((a) => a.allergen).join(", ") : "NKDA"}`, { size: 9.5, color: MUTED });
  f.text(`Date written: ${(rx.signedAt ?? rx.createdAt).toISOString().slice(0, 10)}`, { size: 9.5, color: MUTED });
  f.gap(10);
  f.text("Rx", { size: 26, bold: true, color: INK });
  f.gap(2);
  f.text(`${rx.drug}${rx.strength ? ` ${rx.strength}` : ""}${rx.form ? ` ${rx.form}` : ""}`, { size: 14, bold: true });
  f.text(`Sig: ${rx.sig}`, { size: 12 });
  f.text(`Dispense: ${rx.quantity}${rx.quantityUnit ? ` ${rx.quantityUnit}` : ""} (${numberWords(rx.quantity)})${rx.daysSupply ? `    Days supply: ${rx.daysSupply}` : ""}`, { size: 12 });
  f.text(`Refills: ${rx.refills}    ${rx.dispenseAsWritten ? "DISPENSE AS WRITTEN — no substitution" : "Substitution permitted"}`, { size: 12 });
  if (rx.route) f.text(`Route: ${rx.route}`, { size: 10.5, color: MUTED });
  if (rx.diagnosisCode) f.text(`Diagnosis: ${rx.diagnosisCode}`, { size: 10.5, color: MUTED });
  if (rx.notes) f.text(`Note to pharmacist: ${rx.notes}`, { size: 10.5 });
  if (rx.pharmacyName) f.text(`Pharmacy: ${rx.pharmacyName}${rx.pharmacyPhone ? ` · ${rx.pharmacyPhone}` : ""}${rx.pharmacyFax ? ` · fax ${rx.pharmacyFax}` : ""}`, { size: 10.5, color: MUTED });
  f.gap(22);
  if (rx.status !== "DRAFT" && rx.status !== "CANCELLED") {
    const drew = await f.signature(prescriber.signatureImage);
    if (!drew) f.gap(30);
  } else {
    f.text(rx.status === "CANCELLED" ? "CANCELLED — NOT VALID" : "DRAFT — NOT SIGNED — NOT VALID FOR DISPENSING", { size: 14, bold: true, color: MUTED });
    f.gap(10);
  }
  f.rule();
  const rp = prescriber.renderingProvider;
  f.text(`${rx.signedName ?? prescriber.name}${rp?.credential ? `, ${rp.credential}` : ""}`, { bold: true });
  f.text([prescriber.npi || rp?.npi ? `NPI ${prescriber.npi ?? rp?.npi}` : "", rx.controlled && rp?.deaNumber ? `DEA ${rp.deaNumber}` : ""].filter(Boolean).join("    "), { size: 9.5, color: MUTED });
  if (rx.signedAt) f.text(`Electronically signed ${rx.signedAt.toLocaleString("en-US")}`, { size: 9, color: MUTED });
  return Buffer.from(await pdf.save());
}

function numberWords(q: string) {
  const n = Number(q);
  if (!Number.isInteger(n) || n < 0 || n > 999) return q;
  const ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? `-${ones[x % 10]}` : ""}`);
  return n < 100 ? two(n) : `${ones[Math.floor(n / 100)]} hundred${n % 100 ? ` ${two(n % 100)}` : ""}`;
}
