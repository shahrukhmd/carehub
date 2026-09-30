import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, patientName } from "@/lib/format";
import { CLOSE_REASONS, RECALL_REASONS, RECALL_ROLES, linkBookedRecalls } from "@/lib/recalls";
import { getVisitTypes } from "@/lib/scheduler-setup";
import { closeRecall, contactAllOverdue, contactRecall, createRecall, logRecallCall, reopenRecall } from "./actions";

type Search = { patientId?: string; reason?: string; view?: string; providerId?: string; error?: string; saved?: string; sent?: string; of?: string };

const VIEWS: [string, string][] = [
  ["due", "Overdue & due in 30 days"],
  ["open", "All open"],
  ["scheduled", "Booked"],
  ["closed", "Closed"],
];

export default async function RecallBoardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(RECALL_ROLES);
  const sp = await searchParams;
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : "due";
  await linkBookedRecalls(user.practiceId);
  const now = new Date();
  const where: Prisma.RecallWhereInput = {
    practiceId: user.practiceId,
    ...(sp.providerId ? { providerId: sp.providerId } : {}),
    ...(view === "due" ? { status: "OPEN", dueDate: { lte: new Date(now.getTime() + 30 * 86_400_000) } } : view === "open" ? { status: "OPEN" } : view === "scheduled" ? { status: "SCHEDULED" } : { status: "CLOSED" }),
  };
  const [recalls, patients, providers, locations, types, counts] = await Promise.all([
    prisma.recall.findMany({
      where,
      include: { patient: { include: { encounters: { orderBy: { date: "desc" }, take: 1, select: { date: true } } } }, appointment: true },
      orderBy: { dueDate: "asc" },
      take: 500,
    }),
    prisma.patient.findMany({ where: { practiceId: user.practiceId, status: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 2000 }),
    prisma.user.findMany({ where: { memberships: { some: { practiceId: user.practiceId, role: "CLINICIAN" } } }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } }),
    getVisitTypes(user.practiceId),
    prisma.recall.groupBy({ by: ["status"], where: { practiceId: user.practiceId }, _count: true }),
  ]);
  const provName = new Map(providers.map((p) => [p.id, p.name]));
  const overdue = await prisma.recall.count({ where: { practiceId: user.practiceId, status: "OPEN", dueDate: { lt: now } } });
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Front desk</p>
          <h1>Recall board</h1>
          <p className="muted" style={{ margin: 0 }}>
            Patients who are due back and don&apos;t have a visit booked yet.
          </p>
        </div>
        <div className="cn-actions">
          <Link className="btn ghost" href="/care-gaps">
            Care gaps
          </Link>
          <form action={contactAllOverdue}>
            <button className="btn secondary" type="submit">
              Text / email everyone due in 2 weeks
            </button>
          </form>
        </div>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.saved && <p className="notice-ok">Saved.</p>}
      {sp.sent && <p className="notice-ok">{sp.of ? `${sp.sent} of ${sp.of} patients contacted.` : "Recall message sent."} Messages are in Patient Connect → Messages.</p>}
      <section className="grid-stats">
        <div className="stat">
          <span>Overdue</span>
          <strong>{overdue}</strong>
        </div>
        <div className="stat">
          <span>Open recalls</span>
          <strong>{count("OPEN")}</strong>
        </div>
        <div className="stat">
          <span>Booked from recall</span>
          <strong>{count("SCHEDULED")}</strong>
        </div>
        <div className="stat">
          <span>Closed</span>
          <strong>{count("CLOSED")}</strong>
        </div>
      </section>
      <div className="cn-head">
        <nav className="cn-filters">
          {VIEWS.map(([k, l]) => (
            <Link key={k} href={`/recalls?view=${k}${sp.providerId ? `&providerId=${sp.providerId}` : ""}`} className={view === k ? "active" : ""}>
              {l}
            </Link>
          ))}
        </nav>
        <form method="get" className="cn-inline" style={{ margin: 0 }}>
          <input type="hidden" name="view" value={view} />
          <select name="providerId" defaultValue={sp.providerId ?? ""} aria-label="Provider">
            <option value="">All providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn ghost" type="submit">
            Filter
          </button>
        </form>
      </div>
      <section className="panel">
        {recalls.length === 0 ? (
          <p className="muted">No recalls here.</p>
        ) : (
          <div className="table-scroll">
            <table className="cn-table">
              <thead>
                <tr>
                  <th>Due</th>
                  <th>Patient</th>
                  <th>Reason</th>
                  <th>Last visit</th>
                  <th>Contact</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recalls.map((r) => {
                  const late = r.status === "OPEN" && r.dueDate < now;
                  const book = new URLSearchParams({
                    patientId: r.patientId,
                    date: (r.dueDate < now ? now : r.dueDate).toISOString().slice(0, 10),
                    ...(r.visitType ? { bookType: r.visitType } : {}),
                    ...(r.providerId ? { bookWith: r.providerId } : {}),
                    ...(r.locationId ? { bookLocation: r.locationId } : {}),
                  });
                  return (
                    <tr key={r.id}>
                      <td>
                        <span className={late ? "gw-missing" : ""}>{formatDate(r.dueDate)}</span>
                        {late && <div className="muted cn-small">{Math.floor((now.getTime() - r.dueDate.getTime()) / 86_400_000)} days overdue</div>}
                      </td>
                      <td>
                        <Link href={`/patients/${r.patientId}`}>{patientName(r.patient)}</Link>
                        <div className="muted cn-small">{r.patient.phone ?? "No phone"}</div>
                      </td>
                      <td>
                        {r.reason}
                        <div className="muted cn-small">{r.providerId ? provName.get(r.providerId) : "Any provider"}</div>
                        {r.notes && <div className="muted cn-small rc-notes">{r.notes}</div>}
                      </td>
                      <td>{r.patient.encounters[0] ? formatDate(r.patient.encounters[0].date) : "—"}</td>
                      <td className="cn-small">
                        {r.contactCount ? `${r.contactCount}× · last ${r.lastContactVia} ${r.lastContactAt ? formatDate(r.lastContactAt) : ""}` : "Not contacted"}
                        {r.appointment && <div>Booked {formatDate(r.appointment.startsAt)}</div>}
                        {r.closedReason && <div className="muted">{r.closedReason}</div>}
                      </td>
                      <td className="cn-actions">
                        {r.status === "OPEN" && (
                          <>
                            <Link className="btn secondary gw-mini" href={`/schedule?${book}#book`}>
                              Book
                            </Link>
                            <form action={contactRecall.bind(null, r.id)}>
                              <button className="btn ghost gw-mini" type="submit">
                                Text / email
                              </button>
                            </form>
                            <details className="rc-more">
                              <summary className="btn ghost gw-mini">More</summary>
                              <form action={logRecallCall.bind(null, r.id)} className="cn-inline">
                                <input name="note" placeholder="Call note (e.g. left voicemail)" />
                                <button className="btn ghost gw-mini" type="submit">
                                  Log call
                                </button>
                              </form>
                              <form action={closeRecall.bind(null, r.id)} className="cn-inline">
                                <select name="reason" aria-label="Close reason">
                                  {CLOSE_REASONS.map((c) => (
                                    <option key={c}>{c}</option>
                                  ))}
                                </select>
                                <button className="btn ghost gw-mini" type="submit">
                                  Close
                                </button>
                              </form>
                            </details>
                          </>
                        )}
                        {r.status === "CLOSED" && (
                          <form action={reopenRecall.bind(null, r.id)}>
                            <button className="btn ghost gw-mini" type="submit">
                              Reopen
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
      <section className="panel" id="new">
        <h2>New recall</h2>
        <RecallForm patients={patients} providers={providers} locations={locations} types={types} back="/recalls" patientId={sp.patientId} reason={sp.reason} />
      </section>
    </div>
  );
}

function RecallForm({
  patients,
  providers,
  locations,
  types,
  back,
  patientId,
  reason,
}: {
  patients: { id: string; firstName: string; lastName: string; mrn: string }[];
  providers: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  types: { code: string; name: string }[];
  back: string;
  patientId?: string;
  reason?: string;
}) {
  return (
    <form action={createRecall} className="form-grid gw-grid-3">
      <input type="hidden" name="back" value={back} />
      <label>
        Patient
        <select name="patientId" required defaultValue={patientId ?? ""}>
          <option value="">Choose…</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {patientName(p)} · {p.mrn}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due back in
        <select name="weeks" defaultValue="4">
          {[1, 2, 3, 4, 6, 8, 12, 26, 52].map((w) => (
            <option key={w} value={w}>
              {w < 26 ? `${w} week${w === 1 ? "" : "s"}` : w === 26 ? "6 months" : "1 year"}
            </option>
          ))}
        </select>
      </label>
      <label>
        …or on date
        <input type="date" name="dueDate" />
      </label>
      <label>
        Reason
        <input name="reason" list="recall-reasons" defaultValue={reason?.slice(0, 120) ?? "Wound re-check"} required />
        <datalist id="recall-reasons">
          {RECALL_REASONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </label>
      <label>
        Provider
        <select name="providerId" defaultValue="">
          <option value="">Any</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Visit type
        <select name="visitType" defaultValue="">
          <option value="">—</option>
          {types.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Location
        <select name="locationId" defaultValue="">
          <option value="">Any</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="gw-span-2">
        Notes
        <input name="notes" />
      </label>
      <button className="btn" type="submit">
        Add recall
      </button>
    </form>
  );
}
