import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { validateAddress } from "@/lib/address-validator";

// POST { line1, line2, city, state, zip } → the standardized address (USPS when configured, else the Census geocoder).
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const s = (k: string) => String(body[k] ?? "").slice(0, 120);
  if (!s("line1").trim()) return NextResponse.json({ status: "NOT_FOUND", address: null, changes: [], message: "Enter the street address first." });
  const result = await validateAddress({ line1: s("line1"), line2: s("line2"), city: s("city"), state: s("state"), zip: s("zip") });
  return NextResponse.json(result);
}
