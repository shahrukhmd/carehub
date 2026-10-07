import { NextResponse, type NextRequest } from "next/server";
import { authorizeFhir, operationOutcome } from "@/lib/fhir";
import { RESULTS_SCOPE, fhirToHl7, receiveInterfaceMessage } from "@/lib/interfaces";

// Inbound FHIR R4 results: a DiagnosticReport (with contained Observations) or a Bundle of DiagnosticReport +
// Observation resources. basedOn.identifier carries the CareHub requisition number.
const json = (status: number, body: unknown) => new NextResponse(JSON.stringify(body), { status, headers: { "Content-Type": "application/fhir+json; charset=utf-8", "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const client = await authorizeFhir(req.headers.get("authorization"));
  if (!client) return json(401, operationOutcome("login", "Missing or invalid bearer token"));
  if (!client.scopes.split(/\s+/).includes(RESULTS_SCOPE)) return json(403, operationOutcome("forbidden", "This token may not send results"));
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, operationOutcome("structure", "Body must be FHIR JSON"));
  }
  try {
    const hl7 = fhirToHl7(body);
    const r = await receiveInterfaceMessage(client.practiceId, hl7, { channel: "FHIR", apiClientId: client.id });
    const outcome = operationOutcome(r.status === "FILED" ? "informational" : r.status === "FAILED" ? "exception" : "not-found", r.message.detail ?? r.status);
    if (r.status === "FILED") outcome.issue[0].severity = "information";
    return json(r.status === "FAILED" ? 400 : r.status === "FILED" ? 200 : 202, { ...outcome, id: r.message.id });
  } catch (err) {
    return json(400, operationOutcome("invalid", (err as Error).message));
  }
}

export async function GET() {
  return json(405, operationOutcome("not-supported", "POST a DiagnosticReport or Bundle to this endpoint"));
}
