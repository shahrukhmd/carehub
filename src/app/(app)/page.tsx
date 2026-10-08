import { TeamWaiting } from "@/components/TeamWaiting";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  GATEWAY_ROLES,
  OPEN_INTAKE_STAGES,
  canWorkTeam,
  gatewayTeamScope,
  intakeStageLabel,
  teamLabel,
  teamStages,
  type GatewayTeam,
} from "@/lib/gateway";
import { BoardTab, RegistryTab, TeamQueueTab, TodayTab, VobLearningTab, type GatewaySearch } from "./gateway/views";
import { allowed } from "@/lib/permissions";

const TEAM_TABS: { key: string; team: GatewayTeam }[] = [
  { key: "data-entry", team: "DATA_ENTRY" },
  { key: "verification", team: "VERIFICATION" },
  { key: "scheduling", team: "SCHEDULING" },
];

export default async function PatientGatewayPage({ searchParams }: { searchParams: Promise<GatewaySearch> }) {
  const user = await requireUser();
  // Billing and credentialing staff work outside the gateway; send them to their own home.
  if (!allowed(user, GATEWAY_ROLES))
    redirect(
      user.role === "CREDENTIALING" ? "/credentialing" : user.role === "BD" ? "/dashboard" : ["CDS", "CODER"].includes(user.role) ? "/encounters" : "/billing"
    );

  const sp = await searchParams;
  // A team role (data entry, verification, scheduling) sees only its own team: one tab, its own stages, nothing
  // else — whatever tab the URL asks for. Admins, front desk and clinicians see every team.
  const ownTeam = gatewayTeamScope(user.role);
  const ownTab = ownTeam ? TEAM_TABS.find((t) => t.team === ownTeam)! : null;
  const defaultTab = ownTab ? ownTab.key : user.role === "CLINICIAN" ? "today" : "board";
  const tab = ownTab ? ownTab.key : (sp.tab ?? defaultTab);

  const counts = await prisma.intakeCase.groupBy({
    by: ["stage"],
    where: { practiceId: user.practiceId, ...(ownTeam ? { stage: { in: teamStages[ownTeam] } } : {}) },
    _count: { _all: true },
  });
  const countFor = (stage: string) => counts.find((c) => c.stage === stage)?._count._all ?? 0;
  const teamCount = (team: GatewayTeam) =>
    teamStages[team].filter((s) => s !== "SCHEDULED").reduce((n, s) => n + countFor(s), 0);

  const tabs = ownTab
    ? [{ key: ownTab.key, label: `${teamLabel[ownTab.team]} (${teamCount(ownTab.team)})` }]
    : [
        ...TEAM_TABS.map((t) => ({ key: t.key, label: `${teamLabel[t.team]} (${teamCount(t.team)})` })),
        { key: "board", label: "Pipeline board" },
        { key: "vob-learning", label: "VOB learning" },
        { key: "registry", label: "All patients" },
        { key: "today", label: "Today" },
      ];
  // The stage strip: every stage, or only the team's own (numbered as in the full pipeline).
  const strip = [...OPEN_INTAKE_STAGES, "SCHEDULED"]
    .map((stage, i) => ({ stage, n: i + 1 }))
    .filter(({ stage }) => !ownTeam || teamStages[ownTeam].includes(stage));

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Pre-scheduling console · Data entry → VOB → Scheduling</p>
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

      <section className="gw-pipeline" aria-label="Cases by stage">
        {strip.map(({ stage, n }) => (
          <Link
            key={stage}
            href={ownTab ? `/?tab=${ownTab.key}&stage=${stage}` : `/?tab=registry&stage=${stage}`}
            className={`gw-pipe-step gw-stage-${stage.toLowerCase()}`}
          >
            <span className="gw-pipe-num">{n}</span>
            <span>{intakeStageLabel[stage]}</span>
            <strong>{countFor(stage)}</strong>
          </Link>
        ))}
      </section>

      <TeamWaiting user={user} />

      <nav className="view-tabs" style={{ margin: "0.9rem 0", width: "fit-content", flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <Link key={t.key} href={`/?tab=${t.key}`} className={`view-tab${t.key === tab ? " active" : ""}`}>
            {t.label}
          </Link>
        ))}
      </nav>

      {TEAM_TABS.filter((t) => t.key === tab).map((t) => (
        <TeamQueueTab key={t.key} team={t.team} tabKey={t.key} user={user} sp={sp} />
      ))}
      {!ownTeam && tab === "board" && <BoardTab user={user} />}
      {!ownTeam && tab === "vob-learning" && <VobLearningTab user={user} />}
      {!ownTeam && tab === "registry" && <RegistryTab user={user} sp={sp} />}
      {!ownTeam && tab === "today" && <TodayTab user={user} />}
    </>
  );
}
