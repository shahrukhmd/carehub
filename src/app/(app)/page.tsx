import { TeamWaiting } from "@/components/TeamWaiting";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CARE_BOARD, GATEWAY_ROLES, VOB_BOARD, canWorkTeam, gatewayTeamScope, teamLabel, type GatewayTeam } from "@/lib/gateway";
import { StatusBoard, TeamQueueTab, type GatewaySearch } from "./gateway/views";
import { allowed } from "@/lib/permissions";

// The gateway's three views, one per team: data entry (DSS) works its queue as a list; VOB and patient care (PCC)
// see their cases as a board of statuses.
const VIEWS: { key: string; team: GatewayTeam; hint: string }[] = [
  { key: "data-entry", team: "DATA_ENTRY", hint: "New referrals being registered" },
  { key: "vob", team: "VERIFICATION", hint: "Benefits, authorization and referral" },
  { key: "care", team: "SCHEDULING", hint: "Scheduling and ongoing care" },
];

export default async function PatientGatewayPage({ searchParams }: { searchParams: Promise<GatewaySearch> }) {
  const user = await requireUser();
  // Billing and credentialing staff work outside the gateway; send them to their own home.
  if (!allowed(user, GATEWAY_ROLES))
    redirect(
      user.role === "CREDENTIALING" ? "/credentialing" : user.role === "BD" ? "/dashboard" : ["CDS", "CODER"].includes(user.role) ? "/encounters" : "/billing"
    );

  const sp = await searchParams;
  // A team role (DSS, VOB, PCC) sees only its own card and view, whatever the URL asks for. Admins, front desk and
  // clinicians see all three.
  const ownTeam = gatewayTeamScope(user.role);
  const cards = ownTeam ? VIEWS.filter((v) => v.team === ownTeam) : VIEWS;
  const view = cards.find((v) => v.key === sp.view) ?? cards[0];
  // The VOB and Patient care boards open as Kanban; the switcher offers the table grouped by status.
  const layout = sp.layout === "table" ? "table" : "kanban";

  // Each card's count is the team's open work: data entry; VOB review, auth pending and referral; ready to schedule
  // and scheduled patients not yet discharged.
  const p = user.practiceId;
  const [dataEntry, vob, ready, inCare] = await Promise.all([
    prisma.intakeCase.count({ where: { practiceId: p, stage: "DATA_ENTRY" } }),
    prisma.intakeCase.count({ where: { practiceId: p, stage: { in: ["VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL"] } } }),
    prisma.intakeCase.count({ where: { practiceId: p, stage: "SCHEDULING" } }),
    prisma.intakeCase.count({ where: { practiceId: p, stage: "SCHEDULED", OR: [{ careStatus: null }, { careStatus: { not: "DISCHARGED" } }] } }),
  ]);
  const count: Record<string, number> = { "data-entry": dataEntry, vob, care: ready + inCare };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Pre-scheduling console · Data entry → VOB → Patient care</p>
          <h1>Patient Gateway</h1>
        </div>
        {canWorkTeam(user.role, "DATA_ENTRY") && (
          <div className="vw-view-links">
            <Link className="btn" href="/patients/new">
              + Register patient
            </Link>
          </div>
        )}
      </div>

      <nav className="gw-team-cards" aria-label="Gateway views">
        {cards.map((v) => (
          <Link key={v.key} href={`/?view=${v.key}${layout === "table" && v.key !== "data-entry" ? "&layout=table" : ""}`} className={`gw-team-card${v.key === view.key ? " active" : ""}`} aria-current={v.key === view.key ? "page" : undefined}>
            <span>
              <strong>{teamLabel[v.team]}</strong>
              <small>{v.hint}</small>
            </span>
            <em>{count[v.key]}</em>
          </Link>
        ))}
      </nav>

      <TeamWaiting user={user} />

      {view.key === "data-entry" && <TeamQueueTab team="DATA_ENTRY" tabKey="data-entry" user={user} sp={sp} />}
      {view.key === "vob" && <StatusBoard user={user} columns={VOB_BOARD} title="VOB board" layout={layout} viewHref="/?view=vob" />}
      {view.key === "care" && <StatusBoard user={user} columns={CARE_BOARD} title="Patient care board" layout={layout} viewHref="/?view=care" />}
    </>
  );
}
