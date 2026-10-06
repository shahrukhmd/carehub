import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/format";
import { authStatusLabel, careStatusLabel, eligibilityStatusLabel, vobDecisionLabel } from "@/lib/gateway";
import { networkStatusForPayer } from "@/lib/credentialing";

// What the earlier teams decided about this patient, shown where the next team works: the data-entry brief, the
// VOB decision and its scope, the authorization and how much of it is used, the latest eligibility answer, whether
// the provider is credentialed with the payer, the CDS note for coding, and unanswered team messages.
//   audience: which screen this sits on (what is emphasised; nothing is hidden)
//   encounterId: the visit (CDS note, provider for the network check, holds)
//   providerId: the rendering provider to check against the payer when there is no visit yet (booking)
export async function HandoffHeader({
  practiceId,
  patientId,
  encounterId,
  providerId,
  audience,
}: {
  practiceId: string;
  patientId: string;
  encounterId?: string | null;
  providerId?: string | null;
  audience: "chart" | "coding" | "booking" | "claim";
}) {
  const [intake, eligibility, encounter, waiting, auths] = await Promise.all([
    prisma.intakeCase.findFirst({
      where: { patientId, practiceId },
      orderBy: { createdAt: "desc" },
      include: { payer: { select: { id: true, name: true, requiresVisitReview: true } }, assignedProvider: { select: { id: true, name: true } } },
    }),
    prisma.eligibilityCheck.findFirst({ where: { patientId, practiceId }, orderBy: { checkedAt: "desc" }, select: { status: true, checkedAt: true, copayCents: true, planName: true, payerMessage: true } }),
    encounterId
      ? prisma.encounter.findFirst({
          where: { id: encounterId, practiceId },
          select: {
            providerId: true,
            status: true,
            holdReason: true,
            cdsQueryNote: true,
            codingQueryNote: true,
            events: { where: { toStatus: "READY_FOR_CODING", note: { not: null } }, orderBy: { createdAt: "desc" }, take: 1, select: { note: true, createdAt: true, user: { select: { name: true } } } },
          },
        })
      : null,
    prisma.patientMessage.count({ where: { patientId, practiceId, needsReply: true, answeredAt: null } }),
    prisma.insuranceAuthorization.findMany({ where: { patientId, practiceId, endDate: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { endDate: "desc" }, take: 2, select: { kind: true, authNumber: true, authorizedCount: true, startDate: true, endDate: true, procedureCode: true } }),
  ]);
  if (!intake && !eligibility && !encounter && !waiting && auths.length === 0) return null;

  // Visits used against the case authorization: signed or open visits inside the auth window.
  let visitsUsed: number | null = null;
  if (intake?.authNumber && intake.authStartDate) {
    visitsUsed = await prisma.encounter.count({
      where: { patientId, practiceId, status: { notIn: ["CANCELLED", "NO_SHOW"] }, date: { gte: intake.authStartDate, ...(intake.authEndDate ? { lte: intake.authEndDate } : {}) }, type: { not: "BILLING_ONLY" } },
    });
  }

  // Is the provider who sees (or saw) the patient credentialed with the case payer?
  let network: { name: string; status: "IN_NETWORK" | "PENDING" | "NOT_ENROLLED" } | null = null;
  const payerId = intake?.payerId ?? null;
  if (payerId) {
    const rendering = providerId
      ? await prisma.renderingProvider.findFirst({ where: { id: providerId, practiceId }, select: { id: true, name: true } })
      : encounter?.providerId
        ? await prisma.renderingProvider.findFirst({ where: { userId: encounter.providerId, practiceId }, select: { id: true, name: true } })
        : intake?.assignedProvider
          ? { id: intake.assignedProvider.id, name: intake.assignedProvider.name }
          : null;
    if (rendering) {
      const rows = await networkStatusForPayer(practiceId, payerId, intake?.planSegment ?? null);
      const row = rows.find((r) => r.providerId === rendering.id);
      network = { name: rendering.name, status: row?.network ?? "NOT_ENROLLED" };
    }
  }

  const cdsNote = encounter?.events[0] ?? null;
  const limited = intake?.vobDecision === "APPROVED_LIMITED";
  const authExpired = intake?.authEndDate ? intake.authEndDate < new Date() : false;
  const authExhausted = intake?.authVisitsApproved != null && visitsUsed != null && visitsUsed >= intake.authVisitsApproved;
  const tone = (ok: boolean, warn = false) => (ok ? "ok" : warn ? "warn" : "bad");

  return (
    <section className={`panel hh hh-${audience}`} aria-label="Hand-off from the other teams">
      <div className="hh-row">
        {intake && (
          <div className="hh-item">
            <span>Gateway</span>
            <strong>
              <Link href={`/gateway/${intake.id}`}>{intake.stage.replaceAll("_", " ").toLowerCase()}</Link>
              {intake.payer ? ` · ${intake.payer.name}` : ""}
            </strong>
            {intake.payer?.requiresVisitReview && <em className="gw-tag gw-tag-warn">Payer requires visit review before billing</em>}
          </div>
        )}
        {intake?.vobDecision && (
          <div className="hh-item">
            <span>VOB decision</span>
            <strong className={`gw-tag gw-tag-${intake.vobDecision === "DENIED" ? "bad" : limited ? "warn" : "ok"}`}>{vobDecisionLabel[intake.vobDecision] ?? intake.vobDecision}</strong>
            {intake.careStatus && <em className="muted">{careStatusLabel[intake.careStatus] ?? intake.careStatus}</em>}
            {intake.networkOverrideNote && <em className="muted">Network override: {intake.networkOverrideNote}</em>}
            {intake.vobDecisionNote && <em className="muted">{intake.vobDecisionNote}</em>}
          </div>
        )}
        {intake && intake.authStatus !== "NOT_REQUIRED" && (
          <div className="hh-item">
            <span>Authorization</span>
            <strong className={`gw-tag gw-tag-${tone(intake.authStatus === "APPROVED" && !authExpired && !authExhausted, intake.authStatus === "PENDING" || intake.authStatus === "SUBMITTED")}`}>
              {authStatusLabel[intake.authStatus] ?? intake.authStatus}
              {intake.authNumber ? ` · #${intake.authNumber}` : ""}
            </strong>
            <em className="muted">
              {intake.authStartDate || intake.authEndDate ? `${intake.authStartDate ? formatDate(intake.authStartDate) : "…"} – ${intake.authEndDate ? formatDate(intake.authEndDate) : "open"}` : ""}
              {intake.authVisitsApproved != null ? ` · ${visitsUsed ?? 0} of ${intake.authVisitsApproved} visits used` : ""}
              {authExpired ? " · expired" : authExhausted ? " · all visits used" : ""}
            </em>
          </div>
        )}
        {auths.map((a, i) => (
          <div className="hh-item" key={i}>
            <span>{a.kind === "PROCEDURE" ? `Procedure auth${a.procedureCode ? ` ${a.procedureCode}` : ""}` : "Visit auth"}</span>
            <strong>
              #{a.authNumber}
              {a.authorizedCount != null ? ` · ${a.authorizedCount} authorized` : ""}
            </strong>
            <em className="muted">
              {a.startDate ? formatDate(a.startDate) : "…"} – {a.endDate ? formatDate(a.endDate) : "open"}
            </em>
          </div>
        ))}
        {eligibility && (
          <div className="hh-item">
            <span>Eligibility</span>
            <strong className={`gw-tag gw-tag-${eligibility.status === "ACTIVE" ? "ok" : eligibility.status === "INACTIVE" ? "bad" : "warn"}`}>
              {eligibilityStatusLabel[eligibility.status] ?? eligibility.status}
            </strong>
            <em className="muted">
              {formatDate(eligibility.checkedAt)}
              {eligibility.planName ? ` · ${eligibility.planName}` : ""}
              {eligibility.copayCents != null ? ` · copay ${formatMoney(eligibility.copayCents)}` : ""}
            </em>
          </div>
        )}
        {network && (
          <div className="hh-item">
            <span>Credentialing</span>
            <strong className={`gw-tag gw-tag-${network.status === "IN_NETWORK" ? "ok" : network.status === "PENDING" ? "warn" : "bad"}`}>
              {network.name}: {network.status === "IN_NETWORK" ? "in network" : network.status === "PENDING" ? "enrollment pending" : "not credentialed with this payer"}
            </strong>
          </div>
        )}
        {encounter?.holdReason && (
          <div className="hh-item">
            <span>Hold</span>
            <strong className="gw-tag gw-tag-bad">{encounter.holdReason}</strong>
          </div>
        )}
        {waiting > 0 && (
          <div className="hh-item">
            <span>Team messages</span>
            <strong>
              <Link href={`/patients/${patientId}/thread?show=open`}>
                {waiting} waiting for a reply
              </Link>
            </strong>
          </div>
        )}
      </div>
      {intake?.providerBrief && (audience === "chart" || audience === "booking") && (
        <p className="hh-note">
          <strong>Intake brief:</strong> {intake.providerBrief}
        </p>
      )}
      {limited && (audience === "coding" || audience === "claim") && (
        <p className="hh-note gw-missing">VOB approved E&amp;M and debridement only — other services on this superbill will not be covered.</p>
      )}
      {cdsNote && (audience === "coding" || audience === "claim") && (
        <p className="hh-note">
          <strong>CDS to coding ({cdsNote.user?.name ?? "CDS"}, {formatDate(cdsNote.createdAt)}):</strong> {cdsNote.note}
        </p>
      )}
      {encounter?.codingQueryNote && audience === "coding" && (
        <p className="hh-note">
          <strong>Open coding query:</strong> {encounter.codingQueryNote}
        </p>
      )}
    </section>
  );
}
