import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { formatDate, patientName } from "@/lib/format";
import {
  OPEN_UM_STATUSES,
  PRIOR_AUTH_STATUSES,
  SERIES_PLANS,
  TERMINAL_UM_STATUSES,
  ULTRAMIST_ROLES,
  ULTRAMIST_VIEWS,
  UM_STATUSES,
  UM_VISIT_LIMIT,
  priorAuthTone,
  refreshUmCounts,
  umStatusTone,
  viewWhere,
} from "@/lib/ultramist";
import { InlineSelect } from "@/components/InlineSelect";
import { archiveUltramistOrder, assignUltramistOrder, createUltramistOrder, setUltramistPriorAuth, setUltramistStatus } from "./actions";

type Search = { view?: string; q?: string; patientId?: string; assignedToId?: string; providerId?: string; sort?: string; error?: string; saved?: string; refreshed?: string };

const SORTS: Record<string, Prisma.UltramistOrderOrderByWithRelationInput> = {
  next: { dateOfNextUm: { sort: "asc", nulls: "last" } },
  patient: { patient: { lastName: "asc" } },
  made: { numberOfMadeUmAppointments: "desc" },
  ordered: { dateOrdered: { sort: "desc", nulls: "last" } },
  updated: { updatedAt: "desc" },
};

export default async function UltramistTrackerPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(ULTRAMIST_ROLES);
  const sp = await searchParams;
  const edit = can(user, "ultramist.edit");
  const view = ULTRAMIST_VIEWS.some(([k]) => k === sp.view) ? sp.view! : sp.patientId ? "all" : "open";
  const sort = SORTS[sp.sort ?? ""] ? sp.sort! : "next";
  // The counts come from the scheduler; bring every open order up to date before showing the board.
  await refreshUmCounts(user.practiceId);

  const q = sp.q?.trim();
  const where: Prisma.UltramistOrderWhereInput = {
    practiceId: user.practiceId,
    ...(view === "all" ? {} : viewWhere(view)),
    ...(sp.patientId ? { patientId: sp.patientId } : {}),
    ...(sp.assignedToId ? (sp.assignedToId === "none" ? { assignedToId: null } : { assignedToId: sp.assignedToId }) : {}),
    ...(sp.providerId ? { orderingProviderId: sp.providerId } : {}),
    ...(q
      ? {
          OR: [
            { patient: { lastName: { contains: q, mode: "insensitive" } } },
            { patient: { firstName: { contains: q, mode: "insensitive" } } },
            { patient: { mrn: { contains: q, mode: "insensitive" } } },
            { orderingPhysician: { contains: q, mode: "insensitive" } },
            { priorAuthNumber: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [orders, staff, providers, patients, stats] = await Promise.all([
    prisma.ultramistOrder.findMany({
      where,
      include: { patient: { select: { id: true, firstName: true, lastName: true, mrn: true, dob: true, state: true, status: true, insurances: { where: { isPrimary: true, active: true }, take: 1, select: { payer: { select: { name: true } } } } } }, assignedTo: { select: { id: true, name: true } } },
      orderBy: [SORTS[sort], { createdAt: "desc" }],
      take: 500,
    }),
    prisma.user.findMany({ where: { active: true, memberships: { some: { practiceId: user.practiceId } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { active: true, memberships: { some: { practiceId: user.practiceId, role: "CLINICIAN" } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    edit ? prisma.patient.findMany({ where: { practiceId: user.practiceId, status: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 2000, select: { id: true, firstName: true, lastName: true, mrn: true } }) : Promise.resolve([]),
    prisma.ultramistOrder.groupBy({ by: ["umStatus"], where: { practiceId: user.practiceId, isArchived: false }, _count: true }),
  ]);
  const [flagged, authPending, nextWeek] = await Promise.all([
    prisma.ultramistOrder.count({ where: { practiceId: user.practiceId, isArchived: false, greaterThan18VisitFlag: true, umStatus: { in: OPEN_UM_STATUSES } } }),
    prisma.ultramistOrder.count({ where: { practiceId: user.practiceId, isArchived: false, priorAuthStatus: "IN_PROCESS" } }),
    prisma.ultramistOrder.count({ where: { practiceId: user.practiceId, isArchived: false, dateOfNextUm: { gte: new Date(), lt: new Date(Date.now() + 7 * 86_400_000) } } }),
  ]);
  const count = (s: string) => stats.find((c) => c.umStatus === s)?._count ?? 0;
  const openCount = OPEN_UM_STATUSES.reduce((n, s) => n + count(s), 0);
  const patientFilter = sp.patientId ? orders[0]?.patient ?? (await prisma.patient.findFirst({ where: { id: sp.patientId, practiceId: user.practiceId }, select: { id: true, firstName: true, lastName: true, mrn: true } })) : null;
  const self = `/ultramist?${new URLSearchParams({ view, ...(sp.q ? { q: sp.q } : {}), ...(sp.patientId ? { patientId: sp.patientId } : {}), ...(sp.assignedToId ? { assignedToId: sp.assignedToId } : {}), ...(sp.providerId ? { providerId: sp.providerId } : {}), ...(sort !== "next" ? { sort } : {}) })}`;
  const link = (changes: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ view, ...(sp.q ? { q: sp.q } : {}), ...(sp.patientId ? { patientId: sp.patientId } : {}), ...(sp.assignedToId ? { assignedToId: sp.assignedToId } : {}), ...(sp.providerId ? { providerId: sp.providerId } : {}), ...(sort !== "next" ? { sort } : {}) });
    for (const [k, v] of Object.entries(changes)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `/ultramist?${p}`;
  };
  const now = new Date();
  const staffOptions = [{ key: "", label: "Unassigned" }, ...staff.map((s) => ({ key: s.id, label: s.name }))];

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Clinical</p>
          <h1>UltraMist tracker</h1>
          <p className="muted" style={{ margin: 0 }}>
            Ultrasound mist debridement orders: eligibility, prior authorization, treatments made and what is next. Counts come from the scheduler&apos;s MIST visits.
          </p>
        </div>
        <div className="cn-actions">
          {patientFilter && (
            <Link className="btn ghost" href={`/patients/${patientFilter.id}`}>
              ← {patientName(patientFilter)}
            </Link>
          )}
          {edit && (
            <a className="btn" href="#new">
              New order
            </a>
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
      <section className="grid-stats">
        <div className="stat">
          <span>Open orders</span>
          <strong>{openCount}</strong>
        </div>
        <div className="stat">
          <span>RCM check needed</span>
          <strong>{count("RCM_CHECK_NEEDED")}</strong>
        </div>
        <div className="stat">
          <span>Prior auth in process</span>
          <strong>{authPending}</strong>
        </div>
        <div className="stat">
          <span>Next UM in 7 days</span>
          <strong>{nextWeek}</strong>
        </div>
        <div className="stat">
          <span>Over {UM_VISIT_LIMIT} treatments</span>
          <strong className={flagged ? "gw-missing" : undefined}>{flagged}</strong>
        </div>
      </section>
      <div className="cn-head">
        <nav className="cn-filters">
          {ULTRAMIST_VIEWS.map(([k, l]) => (
            <Link key={k} href={link({ view: k })} className={view === k ? "active" : ""}>
              {l}
            </Link>
          ))}
          {sp.patientId && (
            <Link href={link({ view: "all" })} className={view === "all" ? "active" : ""}>
              Every order
            </Link>
          )}
        </nav>
        <form method="get" className="cn-inline" style={{ margin: 0 }}>
          <input type="hidden" name="view" value={view} />
          {sp.patientId && <input type="hidden" name="patientId" value={sp.patientId} />}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Patient, MRN, physician, auth #" aria-label="Search" />
          <select name="assignedToId" defaultValue={sp.assignedToId ?? ""} aria-label="Assigned to">
            <option value="">Anyone</option>
            <option value="none">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select name="providerId" defaultValue={sp.providerId ?? ""} aria-label="Ordering provider">
            <option value="">All providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select name="sort" defaultValue={sort} aria-label="Sort">
            <option value="next">Next UM first</option>
            <option value="patient">Patient A–Z</option>
            <option value="made">Most treatments</option>
            <option value="ordered">Recently ordered</option>
            <option value="updated">Recently updated</option>
          </select>
          <button className="btn ghost" type="submit">
            Filter
          </button>
        </form>
      </div>
      <section className="panel">
        {orders.length === 0 ? (
          <p className="muted">No UltraMist orders here.</p>
        ) : (
          <div className="table-scroll">
            <table className="cn-table um-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>UM status</th>
                  <th>Prior auth</th>
                  <th title="UM treatments made since the order / ordered">Made</th>
                  <th title="UM treatments since the provider last saw the patient">Since provider</th>
                  <th>Last seen by provider</th>
                  <th>Next UM</th>
                  <th>Ordered</th>
                  <th>Assigned</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const payer = o.patient.insurances[0]?.payer.name;
                  const overdueNext = o.dateOfNextUm === null && o.umStatus === "SCHEDULED";
                  const overPlan = o.plannedVisits ? o.numberOfMadeUmAppointments >= o.plannedVisits : false;
                  return (
                    <tr key={o.id} className={o.greaterThan18VisitFlag ? "um-flagged" : undefined}>
                      <td>
                        <Link href={`/ultramist/${o.id}`}>
                          <strong>{patientName(o.patient)}</strong>
                        </Link>
                        <div className="muted cn-small">
                          {o.patient.mrn} · {formatDate(o.patient.dob)}
                          {o.patient.state ? ` · ${o.patient.state}` : ""}
                        </div>
                        {payer && <div className="muted cn-small">{payer}</div>}
                        {o.unableToSeeReason && TERMINAL_UM_STATUSES.concat("HOLD").includes(o.umStatus) && <div className="cn-small um-reason">{o.unableToSeeReason}</div>}
                      </td>
                      <td>
                        <InlineSelect action={setUltramistStatus.bind(null, o.id)} name="umStatus" value={o.umStatus} options={UM_STATUSES} tone={umStatusTone[o.umStatus]} readOnly={!edit || o.isArchived} hidden={{ back: self }} ariaLabel={`UM status for ${patientName(o.patient)}`} />
                      </td>
                      <td>
                        <InlineSelect action={setUltramistPriorAuth.bind(null, o.id)} name="priorAuthStatus" value={o.priorAuthStatus ?? ""} options={[{ key: "", label: "Not checked" }, ...PRIOR_AUTH_STATUSES]} tone={o.priorAuthStatus ? priorAuthTone[o.priorAuthStatus] : null} readOnly={!edit || o.isArchived} placeholder="Not checked" hidden={{ back: self }} ariaLabel={`Prior authorization for ${patientName(o.patient)}`} />
                        {o.priorAuthNumber && <div className="muted cn-small">#{o.priorAuthNumber}</div>}
                      </td>
                      <td className={overPlan || o.greaterThan18VisitFlag ? "gw-missing" : undefined}>
                        <strong>{o.numberOfMadeUmAppointments}</strong>
                        {o.plannedVisits ? <span className="muted"> / {o.plannedVisits}</span> : null}
                        {o.greaterThan18VisitFlag && <div className="cn-small">&gt;{UM_VISIT_LIMIT} visits</div>}
                      </td>
                      <td>{o.umAppointmentsSinceLastProviderVisit}</td>
                      <td>{o.dateLastSeenByProvider ? formatDate(o.dateLastSeenByProvider) : <span className="muted">—</span>}</td>
                      <td>
                        {o.dateOfNextUm ? (
                          <>
                            {formatDate(o.dateOfNextUm)}
                            {o.dateOfNextUm.getTime() - now.getTime() < 86_400_000 && <div className="cn-small muted">today / tomorrow</div>}
                          </>
                        ) : (
                          <span className={overdueNext ? "gw-missing" : "muted"}>{overdueNext ? "Nothing booked" : "—"}</span>
                        )}
                      </td>
                      <td className="cn-small">
                        {o.dateOrdered ? formatDate(o.dateOrdered) : "—"}
                        {o.orderingPhysician && <div className="muted">{o.orderingPhysician}</div>}
                        {o.seriesPlan && <div className="muted um-plan">{o.seriesPlan}</div>}
                      </td>
                      <td>
                        <InlineSelect action={assignUltramistOrder.bind(null, o.id)} name="assignedToId" value={o.assignedToId ?? ""} options={staffOptions} readOnly={!edit || o.isArchived} placeholder="Unassigned" hidden={{ back: self }} ariaLabel={`Assignee for ${patientName(o.patient)}`} />
                      </td>
                      <td className="cn-actions">
                        <Link className="btn secondary gw-mini" href={`/ultramist/${o.id}`}>
                          Open
                        </Link>
                        {!o.isArchived && can(user, "schedule.view") && (
                          <Link className="btn ghost gw-mini" href={`/schedule?patientId=${o.patientId}&bookType=NON_PROVIDER${o.orderingProviderId ? `&bookWith=${o.orderingProviderId}` : ""}#book`}>
                            Book UM
                          </Link>
                        )}
                        {edit && (
                          <form action={archiveUltramistOrder.bind(null, o.id)}>
                            <input type="hidden" name="back" value={self} />
                            <input type="hidden" name="archive" value={o.isArchived ? "0" : "1"} />
                            <button className="btn ghost gw-mini" type="submit">
                              {o.isArchived ? "Unarchive" : "Archive"}
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {edit && (
        <section className="panel" id="new">
          <h2>New UltraMist order</h2>
          <p className="muted">Orders written on a visit&apos;s Physician Orders document open here on their own. Use this for orders that came in on paper or by fax.</p>
          <form action={createUltramistOrder} className="form-grid gw-grid-3">
            <input type="hidden" name="back" value={self} />
            <label>
              Patient
              <select name="patientId" required defaultValue={sp.patientId ?? ""}>
                <option value="">Choose…</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {patientName(p)} · {p.mrn}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ordering provider
              <select name="orderingProviderId" defaultValue="">
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
              <input name="orderingPhysician" placeholder="If not on staff" />
            </label>
            <label>
              Date ordered
              <input type="date" name="dateOrdered" defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
            <label>
              Order
              <select name="seriesPlan" defaultValue={SERIES_PLANS[0].label}>
                {SERIES_PLANS.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Treatments ordered
              <input type="number" name="plannedVisits" min={1} max={99} placeholder="From the order" />
            </label>
            <label className="gw-span-2">
              Medical necessity
              <input name="notesOnMedicalNecessity" placeholder="Failed conventional debridement, contraindication to sharp debridement, no improvement after 30 days…" />
            </label>
            <label>
              Notes
              <input name="notes" />
            </label>
            <button className="btn" type="submit">
              Add order
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
