import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, patientName } from "@/lib/format";
import { REFERRAL_ROLES, REFERRAL_STATUS } from "@/lib/referrals";

const VIEWS: [string, string][] = [
  ["open", "Open"],
  ["overdue", "Overdue — no consult"],
  ["received", "Consult received"],
  ["drafts", "Drafts"],
  ["closed", "Closed"],
];

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const user = await requireUser(REFERRAL_ROLES);
  const sp = await searchParams;
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : "open";
  const where: Prisma.OutgoingReferralWhereInput =
    view === "open" || view === "overdue"
      ? { status: { in: ["SENT", "SCHEDULED"] } }
      : view === "received"
        ? { status: "CONSULT_RECEIVED" }
        : view === "drafts"
          ? { status: "DRAFT" }
          : { status: { in: ["CLOSED", "CANCELLED"] } };
  const now = Date.now();
  const q = sp.q?.trim();
  const patientWhere: Prisma.OutgoingReferralWhereInput = q ? { OR: [{ patient: { lastName: { contains: q } } }, { patient: { firstName: { contains: q } } }, { patient: { mrn: { contains: q } } }, { toName: { contains: q } }] } : {};
  let refs = await prisma.outgoingReferral.findMany({ where: { practiceId: user.practiceId, ...where, ...patientWhere }, include: { patient: true }, orderBy: { createdAt: "desc" }, take: 300 });
  const overdue = (r: (typeof refs)[number]) => Boolean(r.sentAt && ["SENT", "SCHEDULED"].includes(r.status) && now - r.sentAt.getTime() > r.followUpDays * 86_400_000);
  if (view === "overdue") refs = refs.filter(overdue);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Care coordination</p>
          <h1>Outgoing referrals</h1>
        </div>
        <Link className="btn" href="/referrals/new">
          New referral
        </Link>
      </div>
      <nav className="view-tabs" style={{ width: "fit-content", flexWrap: "wrap" }}>
        {VIEWS.map(([k, l]) => (
          <Link key={k} href={`/referrals?view=${k}`} className={`view-tab${view === k ? " active" : ""}`}>
            {l}
          </Link>
        ))}
      </nav>
      <form method="get" className="cn-inline" style={{ margin: "0.4rem 0" }}>
        <input type="hidden" name="view" value={view} />
        <input name="q" defaultValue={q ?? ""} placeholder="Patient, MRN or specialist" aria-label="Search" />
        <button className="btn secondary gw-mini" type="submit">
          Search
        </button>
        {q && (
          <Link className="btn ghost gw-mini" href={`/referrals?view=${view}`}>
            Clear
          </Link>
        )}
      </form>
      <section className="panel">
        {refs.length === 0 ? (
          <p className="muted">No referrals here.</p>
        ) : (
          <table className="cn-table">
            <thead>
              <tr>
                <th>Referred</th>
                <th>Patient</th>
                <th>To</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {refs.map((r) => {
                const [label, tone] = REFERRAL_STATUS[r.status] ?? [r.status, "info"];
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/referrals/${r.id}`}>{formatDate(r.sentAt ?? r.createdAt)}</Link>
                      {r.urgency === "URGENT" && <span className="cn-tag">urgent</span>}
                    </td>
                    <td>{patientName(r.patient)}</td>
                    <td>
                      {r.toName}
                      <div className="muted cn-small">{r.toSpecialty}</div>
                    </td>
                    <td className="cn-small">{r.reason}</td>
                    <td>
                      <span className={`gw-tag gw-tag-${tone}`}>{label}</span>
                      {r.appointmentAt && <div className="muted cn-small">Appt {formatDate(r.appointmentAt)}</div>}
                      {overdue(r) && <div className="gw-missing cn-small">{Math.floor((now - r.sentAt!.getTime()) / 86_400_000)} days, no consult</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
