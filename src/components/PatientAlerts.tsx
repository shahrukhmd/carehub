import Link from "next/link";
import { alertsFor, type Placement } from "@/lib/patient-alerts";
import { acknowledgeAlert } from "@/app/(app)/patients/[id]/alerts/actions";

// The patient's active alerts for one place in CareHub, as banners. STOP alerts carry an Acknowledge button
// that records who saw them; booking and check-in refuse until that is done.
export async function PatientAlerts({ practiceId, patientId, placement, userId, manageLink = true }: { practiceId: string; patientId: string; placement: Placement; userId?: string | null; manageLink?: boolean }) {
  const alerts = await alertsFor(practiceId, patientId, placement, userId);
  if (alerts.length === 0) return null;
  return (
    <div className="pa-list no-print" role="region" aria-label="Patient alerts">
      {alerts.map((a, i) => (
        <div key={a.id ?? `rule-${i}`} className={`pa-banner pa-${a.severity.toLowerCase()}`}>
          <span className="pa-mark" aria-hidden="true">
            {a.severity === "STOP" ? "⛔" : a.severity === "WARNING" ? "⚠" : "ℹ"}
          </span>
          <div className="pa-body">
            <strong>{a.message}</strong>
            <div className="muted cn-small">
              {a.computed ? "From the record" : `${a.createdBy ?? "Staff"}${a.createdAt ? ` · ${a.createdAt.toLocaleDateString("en-US")}` : ""}`}
              {a.assignedTo ? ` · for ${a.assignedTo}` : ""}
              {a.activeTo ? ` · until ${a.activeTo.toISOString().slice(0, 10)}` : ""}
              {a.severity === "STOP" && a.acknowledged ? " · acknowledged" : ""}
            </div>
          </div>
          {a.id && a.severity === "STOP" && !a.acknowledged && (
            <form action={acknowledgeAlert.bind(null, patientId, a.id, placement)}>
              <button className="btn secondary" type="submit">
                Acknowledge
              </button>
            </form>
          )}
          {manageLink && i === 0 && (
            <Link className="btn ghost pa-manage" href={`/patients/${patientId}/alerts`}>
              Alerts
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
