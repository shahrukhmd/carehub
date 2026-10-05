import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { patientName } from "@/lib/format";
import { PATIENT_VIEW_ROLES } from "@/lib/gateway";
import { EMERGENCY_ACCESS_HOURS, chartAccess, emergencyReasonLabel } from "@/lib/privacy";
import { breakGlass } from "../privacy/actions";

type Search = { next?: string; error?: string };

// Shown instead of a restricted chart to someone outside the patient's care team.
export default async function BreakGlassPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const user = await requireUser([...new Set([...PATIENT_VIEW_ROLES, "BILLER", "CDS", "CODER"])]);
  const { id } = await params;
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : `/patients/${id}`;
  const patient = await prisma.patient.findFirst({ where: { id, practiceId: user.practiceId }, select: { id: true, firstName: true, lastName: true, mrn: true } });
  if (!patient) notFound();
  if ((await chartAccess(user, id)) !== "BLOCKED") redirect(next);

  return (
    <div className="pv-glass">
      <section className="panel">
        <p className="gw-tag gw-tag-bad">Restricted chart</p>
        <h1>
          {patientName(patient)} · {patient.mrn}
        </h1>
        <p>
          This chart is restricted to the patient&apos;s care team. If you need it to do your job you can open it for {EMERGENCY_ACCESS_HOURS} hours, but you must say why. Your name, the time and
          the reason are recorded and reviewed by the practice administrator.
        </p>
        {sp.error && (
          <p className="gw-error" role="alert">
            {sp.error}
          </p>
        )}
        <form action={breakGlass.bind(null, id)} className="stack">
          <input type="hidden" name="next" value={next} />
          <label>
            Why do you need this chart?
            <select name="reason" required defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              {Object.entries(emergencyReasonLabel).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Details
            <textarea name="note" rows={2} maxLength={500} placeholder="Required when the reason is Other" />
          </label>
          <label className="cm-check">
            <input type="checkbox" name="confirm" required />I understand this access is recorded and will be reviewed.
          </label>
          <div className="pv-actions">
            <button className="btn" type="submit">
              Open the chart
            </button>
            <Link className="btn ghost" href="/patients">
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}
