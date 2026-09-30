import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDate, formatTime } from "@/lib/format";
import { PortalShell } from "../../portal-shell";
import { respondToReminder } from "./actions";

// Reminder link: confirm or cancel. Shows only first name, time and place.
export default async function ConfirmPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const a = await prisma.appointment.findUnique({
    where: { confirmToken: token },
    include: { patient: true, location: true, practice: { include: { connectSettings: true } } },
  });
  if (!a) notFound();
  const past = a.startsAt < new Date();
  return (
    <PortalShell brand={a.practice.connectSettings} fallbackName={a.practice.name}>
      <div className="pp-card pp-center">
        <h1>Hi {a.patient.firstName}</h1>
        <p className="pp-appt">
          <strong>
            {formatDate(a.startsAt)} at {formatTime(a.startsAt)}
          </strong>
          <br />
          {a.location.name}
          {a.location.addressLine1 ? `, ${a.location.addressLine1}` : ""}
        </p>
        {a.status === "CANCELLED" ? (
          <p className="pp-error">This appointment is cancelled. Please call the office to reschedule.</p>
        ) : past ? (
          <p className="pp-muted">This appointment has already passed.</p>
        ) : a.confirmedAt && done !== "cancel" ? (
          <p className="pp-ok">✓ Confirmed — see you then!</p>
        ) : (
          <form action={respondToReminder.bind(null, token)} className="pp-choice">
            <button className="pp-btn" type="submit" name="answer" value="confirm">
              Confirm appointment
            </button>
            <details>
              <summary>I need to cancel</summary>
              <label className="pp-label">
                Reason (optional)
                <select name="reason" className="pp-input" defaultValue="Patient Request">
                  <option>Patient Request</option>
                  <option>Sick</option>
                  <option>Transportation</option>
                  <option>Weather</option>
                  <option>Other</option>
                </select>
              </label>
              <button className="pp-btn pp-btn-ghost" type="submit" name="answer" value="cancel">
                Cancel appointment
              </button>
            </details>
          </form>
        )}
      </div>
    </PortalShell>
  );
}
