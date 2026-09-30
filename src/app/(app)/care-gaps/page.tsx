import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, patientName } from "@/lib/format";
import { careGapsFor, ensureCareRules } from "@/lib/care-rules";

type Search = { rule?: string };

export default async function CareGapReportPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE", "CDS", "SCHEDULER"]);
  const sp = await searchParams;
  await ensureCareRules(user.practiceId);
  const since = new Date(Date.now() - 2 * 365 * 86_400_000);
  const [patients, rules] = await Promise.all([
    prisma.patient.findMany({
      where: { practiceId: user.practiceId, status: "ACTIVE", OR: [{ encounters: { some: { date: { gte: since } } } }, { wounds: { some: { status: "ACTIVE" } } }] },
      include: { appointments: { where: { startsAt: { gte: new Date() }, status: { notIn: ["CANCELLED", "NO_SHOW"] } }, orderBy: { startsAt: "asc" }, take: 1 } },
      take: 1500,
    }),
    prisma.careRule.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { name: "asc" } }),
  ]);
  const gaps = await careGapsFor(user.practiceId, patients.map((p) => p.id));
  const rows = patients.flatMap((p) => (gaps.get(p.id) ?? []).filter((g) => g.status === "DUE" && (!sp.rule || g.ruleId === sp.rule)).map((g) => ({ p, g })));
  const byRule = new Map<string, number>();
  for (const p of patients) for (const g of gaps.get(p.id) ?? []) if (g.status === "DUE") byRule.set(g.ruleId, (byRule.get(g.ruleId) ?? 0) + 1);
  rows.sort((a, b) => (a.g.severity === b.g.severity ? patientName(a.p).localeCompare(patientName(b.p)) : a.g.severity === "ALERT" ? -1 : 1));

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Clinical decision support</p>
          <h1>Care gaps</h1>
          <p className="muted" style={{ margin: 0 }}>
            Active patients who are due for a screening, lab or assessment under the practice&apos;s care rules.
          </p>
        </div>
        {user.role === "ADMIN" && (
          <Link className="btn secondary" href="/settings/clinical-rules">
            Edit care rules
          </Link>
        )}
      </div>
      <nav className="cn-filters">
        <Link href="/care-gaps" className={!sp.rule ? "active" : ""}>
          All ({[...byRule.values()].reduce((a, b) => a + b, 0)})
        </Link>
        {rules
          .filter((r) => byRule.get(r.id))
          .map((r) => (
            <Link key={r.id} href={`/care-gaps?rule=${r.id}`} className={sp.rule === r.id ? "active" : ""}>
              {r.name} ({byRule.get(r.id)})
            </Link>
          ))}
      </nav>
      <section className="panel">
        {rows.length === 0 ? (
          <p className="muted">No open care gaps.</p>
        ) : (
          <div className="table-scroll">
            <table className="cn-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Due</th>
                  <th>Last done</th>
                  <th>Next visit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 1000).map(({ p, g }) => (
                  <tr key={`${p.id}-${g.ruleId}`}>
                    <td>
                      <Link href={`/patients/${p.id}`}>{patientName(p)}</Link>
                      <div className="muted cn-small">{p.mrn}</div>
                    </td>
                    <td>
                      <span className={g.severity === "ALERT" ? "gw-missing" : ""}>{g.name}</span>
                      <div className="muted cn-small">{g.message}</div>
                    </td>
                    <td>{g.lastDone ? formatDate(g.lastDone) : "Never"}</td>
                    <td>{p.appointments[0] ? formatDate(p.appointments[0].startsAt) : <span className="muted">None booked</span>}</td>
                    <td>
                      {!p.appointments[0] && (
                        <Link className="btn ghost gw-mini" href={`/recalls?view=open&patientId=${p.id}&reason=${encodeURIComponent(g.name)}#new`}>
                          Recall
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
