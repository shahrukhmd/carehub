import { NextResponse, type NextRequest } from "next/server";
import { authorizeFhir } from "@/lib/fhir";
import { RESULTS_SCOPE, buildAck, parseHl7Header, receiveInterfaceMessage } from "@/lib/interfaces";

// Inbound HL7 v2 results (ORU^R01) over HTTPS. The lab's connected system posts the message body with its
// API token; the reply is an HL7 ACK. Messages are kept whatever happens, so nothing is lost on a mismatch.
const hl7 = (status: number, body: string) => new NextResponse(body, { status, headers: { "Content-Type": "x-application/hl7-v2+er7; charset=utf-8", "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const client = await authorizeFhir(req.headers.get("authorization"));
  if (!client) return hl7(401, buildAck(parseHl7Header(""), "AR", "Missing or invalid bearer token"));
  if (!client.scopes.split(/\s+/).includes(RESULTS_SCOPE)) return hl7(403, buildAck(parseHl7Header(""), "AR", "This token may not send results"));
  const raw = (await req.text()).trim();
  if (raw.length > 5_000_000) return hl7(413, buildAck(parseHl7Header(""), "AR", "Message larger than 5 MB"));
  if (!raw.startsWith("MSH")) return hl7(400, buildAck(parseHl7Header(raw), "AR", "Not an HL7 v2 message (no MSH segment)"));
  try {
    const r = await receiveInterfaceMessage(client.practiceId, raw, { channel: "HL7", apiClientId: client.id });
    return hl7(r.status === "FAILED" ? 400 : 200, r.ack);
  } catch (err) {
    console.error("[interfaces/hl7]", err);
    return hl7(500, buildAck(parseHl7Header(raw), "AE", "Server error; please resend"));
  }
}

export async function GET() {
  return hl7(405, buildAck(parseHl7Header(""), "AR", "POST an ORU^R01 message to this endpoint"));
}
