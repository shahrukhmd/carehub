import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { CREDENTIALING_ROLES, credentialingPracticeIds } from "@/lib/scope";
import { StatusBadge } from "@/components/StatusBadge";
import {
  activityChannelLabel,
  credentialingPriorityLabel,
  enrollmentStatusLabel,
  formatDate,
  formatTime,
} from "@/lib/format";
import { daysBetween } from "@/lib/credentialing";
import { logEnrollmentActivity, updateProviderEnrollment } from "../../actions";

function dateInputValue(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

export default async function EnrollmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(rolesFor("credentialing.work"));
  const { id } = await params;

  const enrollment = await prisma.providerEnrollment.findFirst({
    where: { id, renderingProvider: { practiceId: { in: credentialingPracticeIds(user) } } },
    include: {
      renderingProvider: { include: { supervisingProvider: true } },
      assignedTo: true,
      groupPayerEnrollment: { include: { payer: { include: { parentPayer: true } }, billingProvider: true } },
      activities: { include: { loggedBy: true }, orderBy: { occurredAt: "desc" } },
    },
  });
  if (!enrollment) notFound();

  // Owners come from the staff of the practice that owns this record.
  const staff = await prisma.user.findMany({
    where: {
      active: true,
      memberships: {
        some: { practiceId: enrollment.renderingProvider.practiceId, role: { in: CREDENTIALING_ROLES } },
      },
    },
    orderBy: { name: "asc" },
  });

  const { renderingProvider: provider, groupPayerEnrollment: line } = enrollment;
  const daysInStatus = daysBetween(enrollment.statusChangedAt, new Date());

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Enrollment record</p>
          <h1>
            {provider.name} · {line.payer.name}
          </h1>
          <p className="chart-meta">
            <span>{line.billingProvider.name}</span>
            <span>{enrollment.state ?? "No state"}</span>
            <span>Payer ID {line.payer.payerCode ?? "—"}</span>
            <StatusBadge value={enrollment.status} />
            <span>{daysInStatus} days in status</span>
          </p>
        </div>
        <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
          <Link className="btn secondary" href={`/credentialing/providers/${provider.id}`}>
            Provider file
          </Link>
          <Link className="btn secondary" href="/credentialing?tab=board">
            Back to board
          </Link>
        </div>
      </div>

      <div className="two-col">
        <form className="panel" action={updateProviderEnrollment.bind(null, enrollment.id)}>
          <h2>Enrollment details</h2>
          <div className="panel-section">
            <h3>Status &amp; ownership</h3>
            <div className="form-grid">
              <label>
                Status
                <select name="status" defaultValue={enrollment.status}>
                  {Object.entries(enrollmentStatusLabel).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select name="priority" defaultValue={enrollment.priority}>
                  {Object.entries(credentialingPriorityLabel).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Owner
                <select name="assignedToId" defaultValue={enrollment.assignedToId ?? ""}>
                  <option value="">Unassigned</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Next follow-up
                <input name="followUpDate" type="date" defaultValue={dateInputValue(enrollment.followUpDate)} />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Blocking reason
                <input
                  name="blockingReason"
                  defaultValue={enrollment.blockingReason ?? ""}
                  placeholder="DEA certificate required, supervising physician not on license, COI required…"
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Next action
                <input name="nextAction" defaultValue={enrollment.nextAction ?? ""} />
              </label>
            </div>
          </div>

          <div className="panel-section">
            <h3>Application &amp; approval</h3>
            <div className="form-grid">
              <label>
                State
                <input name="state" defaultValue={enrollment.state ?? ""} maxLength={2} />
              </label>
              <label>
                Plan type(s) / lines of business
                <input name="planTypes" defaultValue={enrollment.planTypes ?? ""} />
              </label>
              <label>
                Submitted
                <input name="submittedDate" type="date" defaultValue={dateInputValue(enrollment.submittedDate)} />
              </label>
              <label>
                Effective
                <input name="effectiveDate" type="date" defaultValue={dateInputValue(enrollment.effectiveDate)} />
              </label>
              <label>
                Term date
                <input name="termDate" type="date" defaultValue={dateInputValue(enrollment.termDate)} />
              </label>
              <label>
                Revalidation / recred due
                <input name="revalidationDate" type="date" defaultValue={dateInputValue(enrollment.revalidationDate)} />
              </label>
              <label>
                Payer-assigned provider # (PTAN, ID)
                <input name="payerProviderId" defaultValue={enrollment.payerProviderId ?? ""} />
              </label>
              <label>
                Approval / welcome letter
                <input name="approvalLetter" type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" />
              </label>
              {enrollment.approvalLetterPath && (
                <p style={{ gridColumn: "1 / -1" }}>
                  On file:{" "}
                  <a href={`/api/files/approval/${enrollment.id}`} target="_blank" rel="noreferrer">
                    {enrollment.approvalLetterName}
                  </a>{" "}
                  <span className="muted">(uploading a new one replaces it)</span>
                </p>
              )}
              <label style={{ gridColumn: "1 / -1" }}>
                Notes
                <textarea name="notes" defaultValue={enrollment.notes ?? ""} style={{ minHeight: "4rem" }} />
              </label>
            </div>
          </div>
          <button className="btn" type="submit" style={{ marginTop: "0.9rem" }}>
            Save enrollment
          </button>
        </form>

        <div className="stack">
          <section className="panel">
            <h2>Log a follow-up</h2>
            <form className="form-grid" action={logEnrollmentActivity.bind(null, enrollment.id)}>
              <label>
                Channel
                <select name="channel" defaultValue="PHONE">
                  {Object.entries(activityChannelLabel).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Date
                <input name="occurredAt" type="date" defaultValue={dateInputValue(new Date())} />
              </label>
              <label>
                Reference #
                <input name="referenceNumber" placeholder="PR-8243200" />
              </label>
              <label>
                Payer rep
                <input name="repName" />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Outcome / note
                <textarea name="note" required style={{ minHeight: "4rem" }} />
              </label>
              <label>
                Next check-in
                <input name="nextFollowUpDate" type="date" />
              </label>
              <button className="btn secondary" type="submit" style={{ alignSelf: "end" }}>
                Add to log
              </button>
            </form>
          </section>

          <section className="panel">
            <h2>Activity log</h2>
            {enrollment.activities.length === 0 && <p className="muted">No activity logged yet.</p>}
            {enrollment.activities.map((a) => (
              <div key={a.id} className="panel-section">
                <p>
                  <strong>{activityChannelLabel[a.channel] ?? a.channel}</strong> · {formatDate(a.occurredAt)}
                  {a.channel === "INTERNAL" ? ` ${formatTime(a.createdAt)}` : ""}
                  {a.referenceNumber ? ` · Ref ${a.referenceNumber}` : ""}
                  {a.repName ? ` · Rep ${a.repName}` : ""}
                </p>
                <p style={{ whiteSpace: "pre-wrap" }}>{a.note}</p>
                <p className="muted">Logged by {a.loggedBy?.name ?? "system"}</p>
              </div>
            ))}
          </section>

          <section className="panel">
            <h2>Provider &amp; payer</h2>
            <p>
              {provider.name}
              {provider.credential ? `, ${provider.credential}` : ""} · NPI {provider.npi ?? "—"}
            </p>
            {provider.supervisingProvider && (
              <p className="muted">Supervising physician: {provider.supervisingProvider.name}</p>
            )}
            <p className="muted">
              {line.payer.name}
              {line.payer.parentPayer ? ` (follows ${line.payer.parentPayer.name})` : ""}
              {line.payer.portalName ? ` · Portal: ${line.payer.portalName}` : ""}
            </p>
            <p className="muted">
              Group status with this payer: {line.groupStatus.replaceAll("_", " ").toLowerCase()}
              {line.payerGroupId ? ` · Group ID ${line.payerGroupId}` : ""}
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
