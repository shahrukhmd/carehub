import { rolesFor } from "@/lib/permissions";
import { requireEncounterAccess } from "@/lib/privacy";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ensureChartSetup } from "@/lib/chart-setup";
import { formatDate, patientName } from "@/lib/format";

const PATIENT_REPORTS: [string, string, string][] = [
  ["summary", "Patient Summary", "Face sheet: demographics, insurance, contacts"],
  ["clinical", "Clinical Summary", "Problems, allergies, medications, open wounds, recent visits"],
  ["visits", "All Visits", "Every visit with provider, diagnoses and status"],
  ["commlog", "Communication Log History", "Patient communication log entries across visits"],
  ["cds", "Clinical Decision Support Interventions", "CDS queries, returns and coding hand-offs"],
  ["treatment", "Treatment Notes Summary", "Treatment notes across visits, by wound"],
];

export default async function VisitReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(rolesFor("chart.view"));
  const { id } = await params;
  await requireEncounterAccess(user, id);
  await ensureChartSetup(user.practiceId);
  const encounter = await prisma.encounter.findFirst({ where: { id, practiceId: user.practiceId }, include: { patient: true } });
  if (!encounter) notFound();
  const views = await prisma.documentationView.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { sortOrder: "asc" } });

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            {patientName(encounter.patient)} · visit {formatDate(encounter.date)}
          </p>
          <h1>Patient reports &amp; documentation views</h1>
        </div>
        <Link className="btn secondary" href={`/encounters/${encounter.id}`}>
          Back to chart
        </Link>
      </div>
      <div className="two-col">
        <section className="panel">
          <h2>Patient reports</h2>
          <ul className="rp-list">
            {PATIENT_REPORTS.map(([key, name, desc]) => (
              <li key={key}>
                <Link href={key === "summary" ? `/patients/${encounter.patientId}/face-sheet` : `/encounters/${encounter.id}/print?view=${key}`}>{name}</Link>
                <span className="muted">{desc}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <div className="gw-section-head">
            <h2>Documentation views</h2>
            {user.role === "ADMIN" && (
              <Link className="muted" href="/settings/documentation?tab=views">
                Manage views
              </Link>
            )}
          </div>
          <ul className="rp-list">
            {views.map((v) => (
              <li key={v.id}>
                <Link href={`/encounters/${encounter.id}/print?view=${v.id}`}>{v.name}</Link>
                {v.description && <span className="muted">{v.description}</span>}
              </li>
            ))}
            {views.length === 0 && <li className="muted">No documentation views set up.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
