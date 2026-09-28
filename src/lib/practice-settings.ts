// Facility setup → general settings: labels and address helpers (safe for client and server).

export const CLEARINGHOUSES: Record<string, string> = {
  MOCK: "Test clearinghouse (built-in)",
  OFFICE_ALLY: "Office Ally",
  CHANGE_HEALTHCARE: "Change Healthcare",
  AVAILITY: "Availity",
  WAYSTAR: "Waystar",
  TRIZETTO: "TriZetto",
};

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Settings = Record<string, unknown>;

export type Address = { name: string; line1: string; line2: string; city: string; state: string; zip: string };

export function settingsAddress(s: Settings | null | undefined, block: "payTo" | "payee" | "remit" | "physical"): Address | null {
  if (!s) return null;
  const get = (part: string) => String(s[`${block}${part}`] ?? "").trim();
  const a = { name: get("Name"), line1: get("Address1"), line2: get("Address2"), city: get("City"), state: get("State"), zip: get("Zip") };
  return a.line1 || a.name ? a : null;
}

export function addressLines(a: Address) {
  return [a.name, a.line1, a.line2, [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean);
}

// Printed in box 26 when the practice uses visit numbers instead of the patient account (MRN).
export function visitNumber(encounterId: string) {
  return `V${encounterId.slice(-8).toUpperCase()}`;
}
