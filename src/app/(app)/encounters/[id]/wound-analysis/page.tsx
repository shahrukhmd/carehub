import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ENCOUNTER_VIEW_ROLES } from "@/lib/visit-workflow";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, patientName } from "@/lib/format";
import { etiologyLabel } from "@/lib/wound";

type Point = { date: Date; area: number };

// Area over time; the dashed line is a 40% reduction in 4 weeks, the usual "healing on track" benchmark.
function AreaChart({ points }: { points: Point[] }) {
  const W = 520;
  const H = 150;
  const pad = { l: 40, r: 12, t: 12, b: 26 };
  if (points.length === 0) return <p className="muted">No measurements yet.</p>;
  const t0 = points[0].date.getTime();
  const t1 = Math.max(points[points.length - 1].date.getTime(), t0 + 7 * 86400000);
  const maxA = Math.max(...points.map((p) => p.area), 0.1) * 1.1;
  const x = (d: Date) => pad.l + ((d.getTime() - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (a: number) => pad.t + (1 - a / maxA) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.area).toFixed(1)}`).join(" ");
  const target = points[0].area * 0.6;
  const fourWeeks = new Date(t0 + 28 * 86400000);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="wa-chart" role="img" aria-label="Wound area over time">
      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} className="wa-axis" />
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} className="wa-axis" />
      <text x={pad.l - 6} y={y(maxA / 1.1) + 4} className="wa-label" textAnchor="end">
        {(maxA / 1.1).toFixed(1)}
      </text>
      <text x={pad.l - 6} y={H - pad.b} className="wa-label" textAnchor="end">
        0
      </text>
      {fourWeeks.getTime() <= t1 && (
        <line x1={x(new Date(t0))} y1={y(points[0].area)} x2={x(fourWeeks)} y2={y(target)} className="wa-target" />
      )}
      <path d={path} className="wa-line" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(p.date)} cy={y(p.area)} r={3.5} className="wa-dot" />
          <text x={x(p.date)} y={H - 8} className="wa-label" textAnchor="middle">
            {`${p.date.getUTCMonth() + 1}/${p.date.getUTCDate()}`}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default async function WoundAnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(ENCOUNTER_VIEW_ROLES);
  const { id } = await params;
  const encounter = await prisma.encounter.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      patient: {
        include: {
          wounds: {
            include: { assessments: { include: { encounter: { select: { id: true, date: true } } }, orderBy: { assessedAt: "asc" } } },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (!encounter) notFound();
  const wounds = encounter.patient.wounds;

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">{patientName(encounter.patient)}</p>
          <h1>Wound analysis</h1>
        </div>
        <Link className="btn secondary" href={`/encounters/${encounter.id}`}>
          Back to chart
        </Link>
      </div>
      {wounds.length === 0 && <p className="panel muted">No wounds on file.</p>}
      {wounds.map((w, i) => {
        const pts: Point[] = w.assessments.filter((a) => a.areaCm2 !== null).map((a) => ({ date: a.assessedAt, area: a.areaCm2! }));
        const first = pts[0];
        const last = pts[pts.length - 1];
        const change = first && last && first.area > 0 ? Math.round(((last.area - first.area) / first.area) * 100) : null;
        const weeks = first && last ? Math.max(0, Math.round((last.date.getTime() - first.date.getTime()) / (7 * 86400000))) : 0;
        const onTrack = change !== null && weeks >= 4 ? change <= -40 : null;
        return (
          <section key={w.id} className="panel stack">
            <div className="gw-section-head">
              <h2>
                #{i + 1} {w.label} <StatusBadge value={w.status} />
              </h2>
              <span className="muted">
                {w.location} · {etiologyLabel[w.etiology] ?? w.etiology}
                {w.onsetDate ? ` · onset ${formatDate(w.onsetDate)}` : ""}
              </span>
            </div>
            <div className="wa-stats">
              <div>
                <span className="muted">Baseline area</span>
                <strong>{first ? `${first.area.toFixed(1)} cm²` : "—"}</strong>
              </div>
              <div>
                <span className="muted">Latest area</span>
                <strong>{last ? `${last.area.toFixed(1)} cm²` : "—"}</strong>
              </div>
              <div>
                <span className="muted">Change</span>
                <strong className={change !== null && change <= 0 ? "vw-good" : change !== null ? "gw-missing" : undefined}>
                  {change === null ? "—" : `${change > 0 ? "+" : ""}${change}%`}
                </strong>
              </div>
              <div>
                <span className="muted">Weeks in treatment</span>
                <strong>{weeks}</strong>
              </div>
              <div>
                <span className="muted">4-week benchmark (≥40% smaller)</span>
                <strong>{onTrack === null ? "Not yet" : onTrack ? "On track" : "Not on track"}</strong>
              </div>
            </div>
            <AreaChart points={pts} />
            {w.assessments.length > 0 && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Assessed</th>
                      <th>L × W × D (cm)</th>
                      <th>Area</th>
                      <th>Stage</th>
                      <th>Granulation / slough / eschar</th>
                      <th>Exudate</th>
                      <th>PUSH</th>
                      <th>Pain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.assessments.map((a) => (
                      <tr key={a.id} className={a.encounterId === encounter.id ? "wa-current" : undefined}>
                        <td>
                          <Link href={`/encounters/${a.encounter.id}`}>{formatDate(a.assessedAt)}</Link>
                        </td>
                        <td>
                          {a.lengthCm ?? "—"} × {a.widthCm ?? "—"} × {a.depthCm ?? "—"}
                        </td>
                        <td>{a.areaCm2 ? a.areaCm2.toFixed(1) : "—"}</td>
                        <td>{a.stage ?? "—"}</td>
                        <td>
                          {a.granulationPct ?? 0}% / {a.sloughPct ?? 0}% / {a.escharPct ?? 0}%
                        </td>
                        <td>{[a.exudateAmount, a.exudateType].filter(Boolean).join(" ") || "—"}</td>
                        <td>{a.pushTotal ?? "—"}</td>
                        <td>{a.painLevel ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
