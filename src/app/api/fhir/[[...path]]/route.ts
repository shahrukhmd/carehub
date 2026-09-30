import { NextResponse, type NextRequest } from "next/server";
import { authorizeFhir, handleFhir, operationOutcome } from "@/lib/fhir";

const json = (status: number, body: unknown) =>
  new NextResponse(JSON.stringify(body), { status, headers: { "Content-Type": "application/fhir+json; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  if (path[0] === "metadata" || path.length === 0) {
    const r = await handleFhir({ id: "", practiceId: "", name: "anonymous" }, ["metadata"], req.nextUrl.searchParams, "");
    return json(r.status, r.body);
  }
  const client = await authorizeFhir(req.headers.get("authorization"));
  if (!client) return json(401, operationOutcome("login", "Missing or invalid bearer token"));
  const base = `${req.nextUrl.origin}/api/fhir`;
  try {
    const r = await handleFhir(client, path, req.nextUrl.searchParams, base);
    return json(r.status, r.body);
  } catch (err) {
    console.error("[fhir]", err);
    return json(500, operationOutcome("exception", "Server error"));
  }
}

export async function POST() {
  return json(405, operationOutcome("not-supported", "This FHIR endpoint is read-only"));
}
export const PUT = POST;
export const DELETE = POST;
