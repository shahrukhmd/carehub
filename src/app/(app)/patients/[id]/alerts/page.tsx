import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { ALERT_PLACEMENTS, ALERT_SEVERITIES, ALERT_TYPES, computedAlerts, parseShowOn } from "@/lib/patient-alerts";
import { PatientShell, loadPatientShell } from "../patient-shell";
import { createAlert, resolveAlert } from "./actions";

// Manage a patient's alerts: the active ones, the ones computed from the record, add one, resolve with a comment.
export default async function PatientAlertsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string; show?: string }> }) {
  const user = await requireUser(rolesFor("patients.alerts"));
  const { id } = await params;
  const sp = await searchParams;
  const shell = await loadPatientShell(id, user);
  const [alerts, computed, staff] = await Promise.all([
    prisma.patientAlert.findMany({
      where: { patientId: id, practiceId: user.practiceId, ...(sp.show === "all" ? {} : { status: "ACTIVE" }) },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { createdBy: { select: { name: true } }, resolvedBy: { select: { name: true } }, assignedTo: { select: { name: true } }, _count: { select: { acknowledgements: true } } },
    }),
    computedAlerts(user.practiceId, id),
    prisma.membership.findMany({ where: { practiceId: user.practiceId, user: { active: true } }, include: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } }),
  ]);
  const placementLabel = Object.fromEntries(ALERT_PLACEMENTS);

  return (
    <PatientShell data={shell}>
      <div className="stack">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1>Patient alerts</h1>
            <p className="muted">Short notes that pop up wherever this patient is opened. Stop alerts must be acknowledged before booking or check-in.</p>
          </div>
          <a className="btn ghost" href={`/patients/${id}/alerts${sp.show === "all" ? "" : "?show=all"}`}>
            {sp.show === "all" ? "Active only" : "Show resolved"}
          </a>
        </div>
        {sp.ok && <p className="notice-ok">{sp.ok}</p>}
        {sp.error && (
          <p className="gw-error" role="alert">
            {sp.error}
          </p>
        )}

        <section className="panel">
          <h2>Alerts</h2>
          {alerts.length === 0 && computed.length === 0 && <p className="muted">No alerts.</p>}
          <table>
            <thead>
              <tr>
                <th>Severity</th>
                <th>Alert</th>
                <th>Shows on</th>
                <th>Active</th>
                <th>By / for</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {computed.map((a, i) => (
                <tr key={`rule-${i}`}>
                  <td>
                    <span className={`gw-tag gw-tag-${a.severity === "STOP" ? "bad" : a.severity === "WARNING" ? "warn" : "info"}`}>{ALERT_SEVERITIES[a.severity].split(" ")[0]}</span>
                  </td>
                  <td>
                    {a.message}
                    <div className="muted cn-small">{ALERT_TYPES[a.type]?.label} · computed from the record, clears by itself</div>
                  </td>
                  <td className="cn-small">{a.showOn.map((k) => placementLabel[k]).join(", ")}</td>
                  <td className="cn-small">{a.activeTo ? `until ${a.activeTo.toISOString().slice(0, 10)}` : "while true"}</td>
                  <td className="cn-small muted">Rule</td>
                  <td></td>
                </tr>
              ))}
              {alerts.map((a) => (
                <tr key={a.id} className={a.status !== "ACTIVE" ? "muted" : undefined}>
                  <td>
                    <span className={`gw-tag gw-tag-${a.severity === "STOP" ? "bad" : a.severity === "WARNING" ? "warn" : "info"}`}>{ALERT_SEVERITIES[a.severity]?.split(" ")[0] ?? a.severity}</span>
                  </td>
                  <td>
                    {a.message}
                    <div className="muted cn-small">
                      {ALERT_TYPES[a.type]?.label ?? a.type}
                      {a.status !== "ACTIVE" ? ` · ${a.status.toLowerCase()}${a.resolvedBy ? ` by ${a.resolvedBy.name}` : ""}${a.resolvedAt ? ` ${a.resolvedAt.toLocaleDateString("en-US")}` : ""}${a.resolveComment ? `: ${a.resolveComment}` : ""}` : ""}
                      {a.severity === "STOP" && a._count.acknowledgements ? ` · acknowledged ${a._count.acknowledgements}×` : ""}
                    </div>
                  </td>
                  <td className="cn-small">{parseShowOn(a.showOn).map((k) => placementLabel[k]).join(", ")}</td>
                  <td className="cn-small">
                    {a.activeFrom.toISOString().slice(0, 10)}
                    {a.activeTo ? ` → ${a.activeTo.toISOString().slice(0, 10)}` : " → open"}
                  </td>
                  <td className="cn-small">
                    {a.createdBy?.name ?? "—"}
                    {a.assignedTo ? <div className="muted">for {a.assignedTo.name}</div> : null}
                  </td>
                  <td>
                    {a.status === "ACTIVE" && (
                      <form action={resolveAlert.bind(null, id, a.id)} className="cn-inline">
                        <input name="comment" placeholder="How was it resolved?" required aria-label="Resolution" />
                        <button className="btn ghost" type="submit">
                          Resolve
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <form className="panel stack" action={createAlert.bind(null, id)}>
          <h2>Add an alert</h2>
          <div className="form-grid gw-grid-3">
            <label>
              Type
              <select name="type" defaultValue="OTHER">
                {Object.entries(ALERT_TYPES).map(([k, t]) => (
                  <option key={k} value={k}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Severity
              <select name="severity" defaultValue="WARNING">
                {Object.entries(ALERT_SEVERITIES).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              For (optional)
              <select name="assignedToId" defaultValue="">
                <option value="">Anyone</option>
                {staff.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Message
            <input name="message" maxLength={300} required placeholder="e.g. Collect the $120 balance before the visit" />
          </label>
          <div className="st-checks">
            <span className="muted cn-small">Show on:</span>
            {ALERT_PLACEMENTS.map(([k, l]) => (
              <label key={k} className="checkbox-inline">
                <input type="checkbox" name={`on:${k}`} defaultChecked={k !== "billing"} /> {l}
              </label>
            ))}
          </div>
          <div className="form-grid gw-grid-3">
            <label>
              Active from
              <input name="activeFrom" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
            <label>
              Until (optional)
              <input name="activeTo" type="date" />
            </label>
          </div>
          <button className="btn" type="submit">
            Add alert
          </button>
        </form>
      </div>
    </PatientShell>
  );
}
