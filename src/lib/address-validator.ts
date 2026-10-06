import "server-only";

// Address validation behind one seam. USPS (Addresses 3.0, OAuth client credentials) when USPS_CLIENT_ID and
// USPS_CLIENT_SECRET are set; otherwise the US Census Bureau geocoder, which is public, needs no key, and returns
// the standardized address it matched. Both only standardize — they never invent an address.

export type AddressIn = { line1: string; line2?: string | null; city?: string | null; state?: string | null; zip?: string | null };
export type AddressOut = { line1: string; line2: string; city: string; state: string; zip: string; zip4?: string; county?: string };
export type ValidationResult = {
  status: "VALID" | "CORRECTED" | "NOT_FOUND" | "ERROR";
  provider: "USPS" | "CENSUS";
  address: AddressOut | null;
  // What changed between what was typed and what the provider returned.
  changes: string[];
  // USPS extras when available.
  deliverable?: boolean;
  vacant?: boolean;
  business?: boolean;
  message?: string;
};

export const addressProvider = () => (process.env.USPS_CLIENT_ID && process.env.USPS_CLIENT_SECRET ? "USPS" : "CENSUS") as "USPS" | "CENSUS";

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => a.replace(/[.,]/g, "").toUpperCase().replace(/\s+/g, " ").trim() === b.replace(/[.,]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

function diff(input: AddressIn, out: AddressOut): string[] {
  const c: string[] = [];
  if (!same(clean(input.line1), out.line1)) c.push(`Street: "${clean(input.line1)}" → "${out.line1}"`);
  if (clean(input.line2) && !same(clean(input.line2), out.line2)) c.push(`Unit: "${clean(input.line2)}" → "${out.line2 || "(none)"}"`);
  if (!same(clean(input.city), out.city)) c.push(`City: "${clean(input.city)}" → "${out.city}"`);
  if (!same(clean(input.state), out.state)) c.push(`State: "${clean(input.state)}" → "${out.state}"`);
  const zipIn = clean(input.zip).slice(0, 5);
  if (zipIn && zipIn !== out.zip) c.push(`ZIP: "${clean(input.zip)}" → "${out.zip}${out.zip4 ? `-${out.zip4}` : ""}"`);
  else if (!zipIn) c.push(`ZIP added: ${out.zip}${out.zip4 ? `-${out.zip4}` : ""}`);
  return c;
}

export async function validateAddress(input: AddressIn): Promise<ValidationResult> {
  const provider = addressProvider();
  try {
    const out = provider === "USPS" ? await usps(input) : await census(input);
    if (!out) return { status: "NOT_FOUND", provider, address: null, changes: [], message: "No matching address was found — check the street number and ZIP." };
    const changes = diff(input, out.address);
    return { status: changes.length ? "CORRECTED" : "VALID", provider, address: out.address, changes, deliverable: out.deliverable, vacant: out.vacant, business: out.business };
  } catch (err) {
    return { status: "ERROR", provider, address: null, changes: [], message: err instanceof Error ? err.message : "The address service did not answer" };
  }
}

// ---- US Census Bureau geocoder (public, no key). Returns the address as the Census matched it. ----
type ProviderHit = { address: AddressOut; deliverable?: boolean; vacant?: boolean; business?: boolean };
type CensusMatch = { matchedAddress: string; addressComponents: { city: string; state: string; zip: string }; geographies?: { Counties?: { BASENAME?: string; NAME?: string }[] } };
// The county the Census matched the address to ("Cook" rather than "Cook County").
const countyOf = (m: CensusMatch) => m.geographies?.Counties?.[0]?.BASENAME ?? m.geographies?.Counties?.[0]?.NAME?.replace(/ County$/i, "") ?? undefined;

// County for an address USPS already standardized (USPS does not return it): a quick Census lookup, best effort.
async function censusCounty(a: AddressOut): Promise<string | undefined> {
  try {
    const p = new URLSearchParams({ benchmark: "Public_AR_Current", vintage: "Current_Current", format: "json", street: a.line1, city: a.city, state: a.state, zip: a.zip });
    const r = await fetch(`https://geocoding.geo.census.gov/geocoder/geographies/address?${p}`, { signal: AbortSignal.timeout(6000), headers: { Accept: "application/json" } });
    if (!r.ok) return undefined;
    const data = (await r.json()) as { result?: { addressMatches?: CensusMatch[] } };
    const m = data.result?.addressMatches?.[0];
    return m ? countyOf(m) : undefined;
  } catch {
    return undefined;
  }
}

async function census(input: AddressIn): Promise<ProviderHit | null> {
  const p = new URLSearchParams({ benchmark: "Public_AR_Current", format: "json", street: clean(input.line1) + (clean(input.line2) ? ` ${clean(input.line2)}` : "") });
  if (clean(input.city)) p.set("city", clean(input.city));
  if (clean(input.state)) p.set("state", clean(input.state));
  if (clean(input.zip)) p.set("zip", clean(input.zip).slice(0, 5));
  p.set("vintage", "Current_Current");
  const r = await fetch(`https://geocoding.geo.census.gov/geocoder/geographies/address?${p}`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Census geocoder returned ${r.status}`);
  const data = (await r.json()) as { result?: { addressMatches?: CensusMatch[] } };
  const m = data.result?.addressMatches?.[0];
  if (!m) return null;
  // matchedAddress: "123 MAIN ST, SPRINGFIELD, IL, 62701"
  const parts = m.matchedAddress.split(",").map((s) => s.trim());
  const line1 = parts[0] ?? "";
  const unit = clean(input.line2).toUpperCase();
  return { address: { line1, line2: unit, city: m.addressComponents.city, state: m.addressComponents.state, zip: m.addressComponents.zip, county: countyOf(m) } };
}

// ---- USPS Addresses 3.0 (OAuth 2 client credentials; free with a USPS developer account). ----
let uspsToken: { value: string; expiresAt: number } | null = null;
async function uspsAccessToken() {
  if (uspsToken && uspsToken.expiresAt > Date.now() + 60_000) return uspsToken.value;
  const base = process.env.USPS_API_BASE ?? "https://apis.usps.com";
  const r = await fetch(`${base}/oauth2/v3/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: process.env.USPS_CLIENT_ID, client_secret: process.env.USPS_CLIENT_SECRET, scope: "addresses" }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`USPS sign-in failed (${r.status})`);
  const t = (await r.json()) as { access_token: string; expires_in?: number };
  uspsToken = { value: t.access_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
  return t.access_token;
}

async function usps(input: AddressIn): Promise<ProviderHit | null> {
  const base = process.env.USPS_API_BASE ?? "https://apis.usps.com";
  const token = await uspsAccessToken();
  const p = new URLSearchParams({ streetAddress: clean(input.line1) });
  if (clean(input.line2)) p.set("secondaryAddress", clean(input.line2));
  if (clean(input.city)) p.set("city", clean(input.city));
  if (clean(input.state)) p.set("state", clean(input.state));
  if (clean(input.zip)) p.set("ZIPCode", clean(input.zip).slice(0, 5));
  const r = await fetch(`${base}/addresses/v3/address?${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (r.status === 400 || r.status === 404) return null;
  if (!r.ok) throw new Error(`USPS returned ${r.status}`);
  const d = (await r.json()) as { address?: { streetAddress: string; secondaryAddress?: string; city: string; state: string; ZIPCode: string; ZIPPlus4?: string }; additionalInfo?: { DPVConfirmation?: string; vacant?: string; business?: string } };
  if (!d.address) return null;
  const address: AddressOut = { line1: d.address.streetAddress, line2: d.address.secondaryAddress ?? "", city: d.address.city, state: d.address.state, zip: d.address.ZIPCode, zip4: d.address.ZIPPlus4 };
  address.county = await censusCounty(address);
  return {
    address,
    // DPV "Y" = deliverable as given; "D"/"S" = missing or bad unit; "N" = not deliverable.
    deliverable: d.additionalInfo?.DPVConfirmation ? d.additionalInfo.DPVConfirmation === "Y" : undefined,
    vacant: d.additionalInfo?.vacant === "Y",
    business: d.additionalInfo?.business === "Y",
  };
}
