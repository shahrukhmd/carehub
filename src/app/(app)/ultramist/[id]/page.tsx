import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { appointmentStatusLabel, formatDate, formatTime, patientName, visitTypeLabel } from "@/lib/format";
import { visitStatusLabel } from "@/lib/visit-workflow";
import {
  MIST_VISIT_TYPES,
  PRIOR_AUTH_STATUSES,
  SERIES_PLANS,
  TERMINAL_UM_STATUSES,
  ULTRAMIST_ROLES,
  UM_STATUSES,
  UM_VISIT_LIMIT,
  priorAuthLabel,
  priorAuthTone,
  refreshUmCounts,
  umStatusLabel,
  umStatusNeedsReason,
  umStatusTone,
} from "@/lib/ultramist";
import { StatusBadge } from "@/components/StatusBadge";
import { archiveUltramistOrder, assignUltramistOrder, changeUltramistStatus, refreshUltramistCounts, updateUltramistOrder } from "../actions";

type Search = { error?: string; saved?: string; refreshed?: string; needReason?: string };

const dateInput = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function UltramistOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const user = await requireUser(ULTRAMIST_ROLES);
  const { id } = await params;
  const sp = await searchParams;
  const edit = can(user, "ultramist.edit");
  await refreshUmCounts(user.practiceId, [id]);
  const o = await prisma.ultramistOrder.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, mrn: true, dob: true, phone: true, status: true, insurances: { where: { active: true }, orderBy: { rank: "asc" }, select: { payer: { select: { name: true } }, memberId: true, isPrimary: true } } } },
      assignedTo: { select: { id: true, name: true } },
      orderingProvider: { select: { id: true, name: true } },
      encounter: { select: { id: true, date: true, status: true } },
    },
  });
  if (!o) notFound();
  const [staff, providers, visits, audit] = await Promise.all([
    prisma.user.findMany({ where: { active: true, memberships: { some: { practiceId: user.practiceId } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { active: true, memberships: { some: { practiceId: user.practiceId, role: "CLINICIAN" } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.appointment.findMany({
      where: { practiceId: user.practiceId, patientId: o.patientId, status: { notIn: ["REQUESTED"] }, ...(o.dateOrdered ? { startsAt: { gte: new Date(o.dateOrdered.getTime() - 30 * 86_400_000) } } : {}) },
      orderBy: { startsAt: "desc" },
      take: 40,
      include: { provider: { select: { name: true } }, encounter: { select: { id: true, status: true } } },
    }),
    prisma.auditLog.findMany({ where: { practiceId: user.practiceId, entityType: "UltramistOrder", entityId: o.id }, orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { name: true } } } }),
  ]);
  const terminal = TERMINAL_UM_STATUSES.includes(o.umStatus);
  const needReason = sp.needReason && umStatusNeedsReason(sp.needReason) ? sp.needReason : null;
  const self = `/ultramist/${o.id}`;
  const primary = o.patient.insurances.find((i) => i.isPrimary) ?? o.patient.insurances[0];

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/ultramist">UltraMist tracker</Link> · <Link href={`/patients/${o.patient.id}`}>{patientName(o.patient)}</Link>
          </p>
          <h1>
            UltraMist order · {patientName(o.patient)}
            {o.isArchived && <StatusBadge value="archived" label="Archived" />}
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            {o.patient.mrn} · DOB {formatDate(o.patient.dob)}
            {o.patient.phone ? ` · ${o.patient.phone}` : ""}
            {primary ? ` · ${primary.payer.name}${primary.memberId ? ` #${primary.memberId}` : ""}` : " · No active coverage"}
          </p>
        </div>
        <div className="cn-actions">
          {can(user, "schedule.view") && !o.isArchived && (
            <Link className="btn" href={`/schedule?patientId=${o.patientId}&bookType=NON_PROVIDER${o.orderingProviderId ? `&bookWith=${o.orderingProviderId}` : ""}#book`}>
              Book UM visit
            </Link>
          )}
          {o.encounter && (
            <Link className="btn ghost" href={`/encounters/${o.encounter.id}?step=physician_orders`}>
              Ordering visit
            </Link>
          )}
          {edit && (
            <form action={archiveUltramistOrder.bind(null, o.id)}>
              <input type="hidden" name="back" value={o.isArchived ? self : "/ultramist"} />
              <input type="hidden" name="archive" value={o.isArchived ? "0" : "1"} />
              <button className="btn ghost" type="submit">
                {o.isArchived ? "Unarchive" : "Archive"}
              </button>
            </form>
          )}
        </div>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.saved && <p className="notice-ok">Saved.</p>}
      {sp.refreshed && <p className="notice-ok">Counts refreshed from the scheduler.</p>}
      {needReason && (
        <p className="gw-error" role="alert">
          &quot;{umStatusLabel[needReason]}&quot; needs a reason — give it below.
        </p>
      )}

      <div className="panel-columns">
        <section className="panel">
          <h2>UM status</h2>
          <p>
            <span className="um-pill" style={{ background: umStatusTone[o.umStatus] }}>
              {umStatusLabel[o.umStatus] ?? o.umStatus}
            </span>{" "}
            {o.priorAuthStatus && (
              <span className="um-pill" style={{ background: priorAuthTone[o.priorAuthStatus] }}>
                {priorAuthLabel[o.priorAuthStatus]}
              </span>
            )}
            {o.dateCompleted && <span className="muted cn-small"> · completed {formatDate(o.dateCompleted)}</span>}
          </p>
          {o.unableToSeeReason && (
            <p className="um-reason">
              <strong>Reason:</strong> {o.unableToSeeReason}
            </p>
          )}
          {edit && !o.isArchived && (
            <form action={changeUltramistStatus.bind(null, o.id)} className="form-grid">
              <label>
                Change status to
                <select name="umStatus" defaultValue={needReason ?? o.umStatus}>
                  {UM_STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                      {s.needsReason ? " (reason)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reason
                <input name="reason" placeholder="Needed for hold, not eligible, cancelled and denied" autoFocus={Boolean(needReason)} />
              </label>
              <button className="btn" type="submit">
                Update status
              </button>
              <p className="muted cn-small" style={{ margin: 0 }}>
                A closing status (not eligible, cancelled, denied, completed) stamps the completion date and archives the order after a week.
              </p>
            </form>
          )}
          <h3>Assigned to</h3>
          {edit && !o.isArchived ? (
            <form action={assignUltramistOrder.bind(null, o.id)} className="cn-inline">
              <input type="hidden" name="back" value={self} />
              <select name="assignedToId" defaultValue={o.assignedToId ?? ""} aria-label="Assigned to">
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button className="btn ghost gw-mini" type="submit">
                Assign
              </button>
            </form>
          ) : (
            <p>{o.assignedTo?.name ?? "Unassigned"}</p>
          )}
        </section>

        <section className="panel">
          <h2>Treatments</h2>
          <div className="grid-stats">
            <div className="stat">
              <span>UM treatments made</span>
              <strong className={o.greaterThan18VisitFlag || (o.plannedVisits && o.numberOfMadeUmAppointments >= o.plannedVisits) ? "gw-missing" : undefined}>
                {o.numberOfMadeUmAppointments}
                {o.plannedVisits ? <span className="muted"> / {o.plannedVisits}</span> : null}
              </strong>
            </div>
            <div className="stat">
              <span>Since last provider visit</span>
              <strong>{o.umAppointmentsSinceLastProviderVisit}</strong>
            </div>
            <div className="stat">
              <span>Last seen by provider</span>
              <strong>{o.dateLastSeenByProvider ? formatDate(o.dateLastSeenByProvider) : "—"}</strong>
            </div>
            <div className="stat">
              <span>Next UM</span>
              <strong>{o.dateOfNextUm ? formatDate(o.dateOfNextUm) : "Not booked"}</strong>
            </div>
          </div>
          {o.greaterThan18VisitFlag && (
            <p className="gw-error" role="status">
              More than {UM_VISIT_LIMIT} treatments on this course — review medical necessity and the authorization.
            </p>
          )}
          <p className="muted cn-small">
            Counted from completed MIST visits (Provider, NP/WCN and Non-Provider Ultrasound Mist Therapy) on or after the order date. Provider visits are any completed billable visit other than Non-Provider mist.
            {o.countsRefreshedAt ? ` Refreshed ${formatDate(o.countsRefreshedAt)} ${formatTime(o.countsRefreshedAt)}.` : ""}
          </p>
          {edit && (
            <form action={refreshUltramistCounts.bind(null, o.id)}>
              <input type="hidden" name="back" value={self} />
              <button className="btn ghost gw-mini" type="submit">
                Refresh counts
              </button>
            </form>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Order details</h2>
        {edit && !o.isArchived ? (
          <form action={updateUltramistOrder.bind(null, o.id)} className="form-grid gw-grid-3">
            <label>
              Ordering provider
              <select name="orderingProviderId" defaultValue={o.orderingProviderId ?? ""}>
                <option value="">Outside physician…</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Outside physician name
              <input name="orderingPhysician" defaultValue={o.orderingProviderId ? "" : (o.orderingPhysician ?? "")} />
            </label>
            <label>
              Date ordered
              <input type="date" name="dateOrdered" defaultValue={dateInput(o.dateOrdered)} />
            </label>
            <label className="gw-span-2">
              Order
              <input name="seriesPlan" list="um-plans" defaultValue={o.seriesPlan ?? ""} />
              <datalist id="um-plans">
                {SERIES_PLANS.map((p) => (
                  <option key={p.label} value={p.label} />
                ))}
              </datalist>
            </label>
            <label>
              Treatments ordered
              <input type="number" name="plannedVisits" min={1} max={99} defaultValue={o.plannedVisits ?? ""} />
            </label>
            <label>
              Prior authorization
              <select name="priorAuthStatus" defaultValue={o.priorAuthStatus ?? ""}>
                <option value="">Not checked</option>
                {PRIOR_AUTH_STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Auth number
              <input name="priorAuthNumber" defaultValue={o.priorAuthNumber ?? ""} />
            </label>
            <label>
              Auth notes
              <input name="priorAuthNotes" defaultValue={o.priorAuthNotes ?? ""} placeholder="Visits approved, dates, reference" />
            </label>
            <label className="gw-span-3">
              Medical necessity
              <textarea name="notesOnMedicalNecessity" rows={3} defaultValue={o.notesOnMedicalNecessity ?? ""} />
            </label>
            <label className="gw-span-3">
              Notes
              <textarea name="notes" rows={3} defaultValue={o.notes ?? ""} />
            </label>
            <button className="btn" type="submit">
              Save order
            </button>
          </form>
        ) : (
          <dl className="um-facts">
            <dt>Ordering provider</dt>
            <dd>{o.orderingProvider?.name ?? o.orderingPhysician ?? "—"}</dd>
            <dt>Date ordered</dt>
            <dd>{o.dateOrdered ? formatDate(o.dateOrdered) : "—"}</dd>
            <dt>Order</dt>
            <dd>
              {o.seriesPlan ?? "—"}
              {o.plannedVisits ? ` (${o.plannedVisits} treatments)` : ""}
            </dd>
            <dt>Prior authorization</dt>
            <dd>
              {o.priorAuthStatus ? priorAuthLabel[o.priorAuthStatus] : "Not checked"}
              {o.priorAuthNumber ? ` · #${o.priorAuthNumber}` : ""}
              {o.priorAuthNotes ? ` · ${o.priorAuthNotes}` : ""}
            </dd>
            <dt>Medical necessity</dt>
            <dd>{o.notesOnMedicalNecessity ?? "—"}</dd>
            <dt>Notes</dt>
            <dd>{o.notes ?? "—"}</dd>
          </dl>
        )}
      </section>

      <div className="panel-columns">
        <section className="panel">
          <h2>Visits</h2>
          {visits.length === 0 ? (
            <p className="muted">No visits on the scheduler since the order.</p>
          ) : (
            <table className="cn-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Visit</th>
                  <th>Provider</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => {
                  const mist = MIST_VISIT_TYPES.includes(v.visitType);
                  return (
                    <tr key={v.id} className={mist ? "um-mist-row" : undefined}>
                      <td className="cn-small">
                        {formatDate(v.startsAt)} {formatTime(v.startsAt)}
                      </td>
                      <td>
                        {mist ? <strong>{visitTypeLabel[v.visitType] ?? v.visitType}</strong> : (visitTypeLabel[v.visitType] ?? v.visitType)}
                        {mist && <span className="muted cn-small"> · UM</span>}
                      </td>
                      <td className="cn-small">{v.provider.name}</td>
                      <td className="cn-small">
                        {v.encounter ? (
                          <Link href={`/encounters/${v.encounter.id}`}>{visitStatusLabel[v.encounter.status] ?? v.encounter.status}</Link>
                        ) : (
                          (appointmentStatusLabel[v.status] ?? v.status)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <section className="panel">
          <h2>History</h2>
          {audit.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <ul>
              {audit.map((a) => (
                <li key={a.id}>
                  <span className="cn-small muted">
                    {formatDate(a.createdAt)} {formatTime(a.createdAt)} · {a.user?.name ?? "System"}
                  </span>
                  <div>
                    {a.action.replace("ULTRAMIST_", "").replaceAll("_", " ").toLowerCase()}
                    {a.detail ? `: ${a.detail}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {terminal && !o.isArchived && <p className="muted cn-small">Closed orders are archived automatically {7} days after completion. Archived orders stay on the patient&apos;s UltraMist tab.</p>}
    </div>
  );
}
