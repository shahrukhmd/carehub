import "server-only";
import { prisma } from "@/lib/prisma";

// Treatment-note product engine: the practice's dressing/product catalog (brand → product → type) and the steps a
// treatment is documented in. A treatment note picks a product for each step; billable products (HCPCS) can be
// pushed to the superbill. Admin under Settings → Wound products & treatment steps.

export const PRODUCT_TYPES: Record<string, string> = {
  CLEANSER: "Cleanser / irrigation",
  ANTIMICROBIAL: "Antimicrobial / antiseptic",
  ENZYMATIC: "Enzymatic debrider",
  PRIMARY: "Primary dressing (contact layer)",
  COLLAGEN: "Collagen",
  SECONDARY: "Secondary / absorbent dressing",
  CTP: "Skin substitute / CTP",
  NPWT: "Negative pressure (NPWT)",
  COMPRESSION: "Compression",
  OFFLOADING: "Offloading",
  SKIN_PROTECTANT: "Skin protectant / periwound",
  SECURE: "Securement / wrap",
  OTHER: "Other",
};

export const UNITS = ["each", "cm²", "in²", "mL", "g", "roll", "kit", "pair"];

// Starter catalog: generic products with the HCPCS supply codes practices usually bill. Brands are left blank —
// a practice adds the brands it stocks. (HCPCS is public; descriptions are CareHub's own wording.)
export const STANDARD_PRODUCTS: { name: string; productType: string; hcpcsCode?: string; unit?: string; size?: string; instructions?: string }[] = [
  { name: "Normal saline irrigation", productType: "CLEANSER", unit: "mL", instructions: "Irrigate with 4–15 psi; pat periwound dry." },
  { name: "Wound cleanser (surfactant)", productType: "CLEANSER", unit: "mL" },
  { name: "Hypochlorous acid solution", productType: "CLEANSER", unit: "mL", instructions: "Soak 5–10 minutes before dressing." },
  { name: "Cadexomer iodine", productType: "ANTIMICROBIAL", hcpcsCode: "A6250", unit: "g", instructions: "Change when it turns white, usually every 2–3 days." },
  { name: "Silver antimicrobial dressing", productType: "ANTIMICROBIAL", hcpcsCode: "A6209", unit: "each", size: "up to 16 in²", instructions: "May stay in place up to 7 days." },
  { name: "Honey (medical grade) gel", productType: "ANTIMICROBIAL", hcpcsCode: "A6248", unit: "g" },
  { name: "Collagenase ointment", productType: "ENZYMATIC", unit: "g", instructions: "Apply 2 mm layer daily; do not use with silver or iodine." },
  { name: "Calcium alginate", productType: "PRIMARY", hcpcsCode: "A6196", unit: "each", size: "up to 16 in²", instructions: "Moderate to heavy exudate; change every 1–3 days." },
  { name: "Calcium alginate rope", productType: "PRIMARY", hcpcsCode: "A6199", unit: "each", instructions: "Pack loosely; count pieces placed and removed." },
  { name: "Hydrogel (amorphous)", productType: "PRIMARY", hcpcsCode: "A6248", unit: "g", instructions: "Dry wounds; apply thin layer." },
  { name: "Hydrogel sheet", productType: "PRIMARY", hcpcsCode: "A6242", unit: "each" },
  { name: "Hydrocolloid", productType: "PRIMARY", hcpcsCode: "A6234", unit: "each", size: "up to 16 in²", instructions: "Light exudate; change every 3–7 days." },
  { name: "Non-adherent contact layer", productType: "PRIMARY", hcpcsCode: "A6222", unit: "each" },
  { name: "Petrolatum gauze", productType: "PRIMARY", hcpcsCode: "A6222", unit: "each" },
  { name: "Collagen dressing (sheet)", productType: "COLLAGEN", hcpcsCode: "A6021", unit: "each", size: "up to 16 in²", instructions: "Moisten with saline if the bed is dry; change every 1–3 days." },
  { name: "Collagen powder", productType: "COLLAGEN", hcpcsCode: "A6010", unit: "g" },
  { name: "Foam dressing", productType: "SECONDARY", hcpcsCode: "A6209", unit: "each", size: "up to 16 in²" },
  { name: "Foam dressing, large", productType: "SECONDARY", hcpcsCode: "A6210", unit: "each", size: "16–48 in²" },
  { name: "Foam dressing with border", productType: "SECONDARY", hcpcsCode: "A6212", unit: "each", size: "up to 16 in²" },
  { name: "Super-absorbent dressing", productType: "SECONDARY", hcpcsCode: "A6251", unit: "each" },
  { name: "Gauze, dry sterile", productType: "SECONDARY", hcpcsCode: "A6402", unit: "each" },
  { name: "ABD pad", productType: "SECONDARY", hcpcsCode: "A6252", unit: "each" },
  { name: "Transparent film", productType: "SECONDARY", hcpcsCode: "A6257", unit: "each" },
  { name: "Skin substitute / CTP (per cm²)", productType: "CTP", unit: "cm²", instructions: "Document product, size, wastage and lot; apply per IFU." },
  { name: "NPWT dressing kit", productType: "NPWT", hcpcsCode: "A6550", unit: "kit", instructions: "Change 2–3 times per week; document pressure setting." },
  { name: "NPWT canister", productType: "NPWT", hcpcsCode: "A7000", unit: "each" },
  { name: "Multi-layer compression system", productType: "COMPRESSION", hcpcsCode: "A6545", unit: "kit", instructions: "Apply toe to knee; confirm ABI ≥ 0.8 first." },
  { name: "Unna boot (zinc paste bandage)", productType: "COMPRESSION", hcpcsCode: "A6456", unit: "roll" },
  { name: "Compression stocking (knee, 30–40 mmHg)", productType: "COMPRESSION", hcpcsCode: "A6531", unit: "pair" },
  { name: "Tubular bandage", productType: "COMPRESSION", unit: "each" },
  { name: "Total contact cast", productType: "OFFLOADING", unit: "each", instructions: "Change weekly; check skin at each change." },
  { name: "Felted foam offloading pad", productType: "OFFLOADING", unit: "each" },
  { name: "CAM walker / removable boot", productType: "OFFLOADING", hcpcsCode: "L4361", unit: "each" },
  { name: "Heel protector boot", productType: "OFFLOADING", hcpcsCode: "L4397", unit: "each" },
  { name: "Skin barrier film / wipe", productType: "SKIN_PROTECTANT", hcpcsCode: "A6250", unit: "each" },
  { name: "Zinc oxide barrier", productType: "SKIN_PROTECTANT", unit: "g" },
  { name: "Conforming gauze roll", productType: "SECURE", hcpcsCode: "A6446", unit: "roll" },
  { name: "Self-adherent wrap", productType: "SECURE", hcpcsCode: "A6454", unit: "roll" },
  { name: "Paper tape", productType: "SECURE", unit: "roll" },
];

export const STANDARD_STEPS: { name: string; productTypes: string[] }[] = [
  { name: "Cleanse", productTypes: ["CLEANSER", "ANTIMICROBIAL"] },
  { name: "Debride / prepare bed", productTypes: ["ENZYMATIC", "ANTIMICROBIAL"] },
  { name: "Treat (primary dressing)", productTypes: ["PRIMARY", "COLLAGEN", "ANTIMICROBIAL", "CTP", "NPWT"] },
  { name: "Cover (secondary dressing)", productTypes: ["SECONDARY"] },
  { name: "Protect periwound", productTypes: ["SKIN_PROTECTANT"] },
  { name: "Secure", productTypes: ["SECURE"] },
  { name: "Compress / offload", productTypes: ["COMPRESSION", "OFFLOADING"] },
  { name: "Educate / plan", productTypes: [] },
];

const setups = new Map<string, Promise<void>>();
export function ensureWoundProducts(practiceId: string) {
  let run = setups.get(practiceId);
  if (!run) {
    run = (async () => {
      if ((await prisma.woundProduct.count({ where: { practiceId } })) === 0) {
        await prisma.woundProduct.createMany({
          data: STANDARD_PRODUCTS.map((p, i) => ({ practiceId, name: p.name, productType: p.productType, hcpcsCode: p.hcpcsCode ?? null, unit: p.unit ?? "each", size: p.size ?? null, instructions: p.instructions ?? null, standard: true, sortOrder: (i + 1) * 10 })),
        });
      }
      if ((await prisma.treatmentStep.count({ where: { practiceId } })) === 0) {
        await prisma.treatmentStep.createMany({ data: STANDARD_STEPS.map((s, i) => ({ practiceId, name: s.name, productTypes: s.productTypes.join(","), standard: true, sortOrder: (i + 1) * 10 })) });
      }
    })().catch((err) => {
      setups.delete(practiceId);
      throw err;
    });
    setups.set(practiceId, run);
  }
  return run;
}

export async function loadTreatmentSetup(practiceId: string) {
  await ensureWoundProducts(practiceId);
  const [products, steps] = await Promise.all([
    prisma.woundProduct.findMany({ where: { practiceId, active: true }, orderBy: [{ productType: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
    prisma.treatmentStep.findMany({ where: { practiceId, active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  return { products, steps };
}

// The treatment note as one line of text per step, for the progress note and the visit report.
export function treatmentText(lines: { stepName: string; productName: string; quantity: number; unit: string; instructions: string | null }[]) {
  return lines.map((l) => `${l.stepName}: ${l.productName}${l.quantity !== 1 || l.unit !== "each" ? ` × ${l.quantity} ${l.unit}` : ""}${l.instructions ? ` — ${l.instructions}` : ""}`).join("\n");
}
