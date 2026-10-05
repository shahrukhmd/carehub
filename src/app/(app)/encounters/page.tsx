import { visitTypeLabel } from "@/lib/format";
import Link from "next/link";
import { visitTypeNames } from "@/lib/scheduler-setup";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { startEncounter } from "@/app/actions";
import { formatDate, formatTime, patientName } from "@/lib/format";
import { parsePointerIds } from "@/lib/superbill";
import { addDays, parseDateParam, startOfDay, toDateParam } from "@/lib/schedule";
import {
  HOLD_STATUSES,
  VISIT_VIEW_ROLES,
  appointmentVisitStatusLabel,
  visitStatusLabel,
  visitStatusTone,
} from "@/lib/visit-workflow";
import { setAppointmentStatus } from "./workflow-actions";

type Search = { queue?: string; q?: string; provider?: string; from?: string; to?: string; status?: string };

const QUEUES = [
  { key: "all", label: "All visits" },
  { key: "mine", label: "My charts" },
  { key: "cds", label: "CDS review" },
  { key: "coding", label: "Coding" },
  { key: "signature", label: "Awaiting signature" },
  { key: "billing", label: "Ready for billing" },
  { key: "holds", label: "Holds & queries" },
];

// Which encounter statuses each queue shows (null = no filter).
const QUEUE_STATUSES: Record<string, string[] | null> = {
  all: null,
  mine: ["IN_PROGRESS", "CDS_QUERY", "READY_FOR_SIGNATURE"],
  cds: ["READY_FOR_CDS", "CODING_QUERY"],
  coding: ["READY_FOR_CODING"],
  signature: ["READY_FOR_SIGNATURE"],
  billing: ["READY_FOR_BILLING"],
  holds: ["CDS_QUERY", "CODING_QUERY", ...HOLD_STATUSES],
};

function defaultQueue(role: string) {
  if (role === "CLINICIAN") return "mine";
  if (role === "CDS") return "cds";
  if (role === "CODER") return "coding";
  if (role === "BILLER") return "billing";
  return "all";
}

export default async function VisitWorklistPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(VISIT_VIEW_ROLES);
  const vtNames = await visitTypeNames(user.practiceId);
  const sp = await searchParams;
  const queue = sp.queue && sp.queue in QUEUE_STATUSES ? sp.queue : defaultQueue(user.role);
  const from = sp.from ? parseDateParam(sp.from) : addDays(startOfDay(new Date()), -30);
  const to = addDays(sp.to ? parseDateParam(sp.to) : addDays(startOfDay(new Date()), 7), 1);
  const q = sp.q?.trim();
  const queueStatuses = QUEUE_STATUSES[queue];
  // Work queues show everything outstanding regardless of date; "All visits" is a dated schedule view.
  const dated = queue === "all";

  const patientFilter: Prisma.PatientWhereInput | undefined = q
    ? { OR: [{ lastName: { contains: q } }, { firstName: { contains: q } }, { mrn: { contains: q } }] }
    : undefined;
  const encounterWhere: Prisma.EncounterWhereInput = {
    practiceId: user.practiceId,
    ...(dated ? { date: { gte: from, lt: to } } : {}),
    ...(queueStatuses ? { status: { in: queueStatuses } } : {}),
    ...(sp.status && sp.status in visitStatusLabel ? { status: sp.status } : {}),
    ...(sp.provider ? { providerId: sp.provider } : {}),
    ...(patientFilter ? { patient: patientFilter } : {}),
    ...(queue === "mine"
      ? { OR: [{ providerId: user.id }, { supervisingProvider: { userId: user.id }, status: "READY_FOR_SIGNATURE" }] }
      : {}),
  };

  const [encounters, appointments, providers] = await Promise.all([
    prisma.encounter.findMany({
      where: encounterWhere,
      include: {
        patient: true,
        provider: true,
        supervisingProvider: true,
        appointment: { include: { location: true } },
        charges: true,
        signatures: true,
      },
      orderBy: { date: "desc" },
      take: 300,
    }),
    // Booked visits whose chart hasn't been started yet.
    dated && !(sp.status && sp.status in visitStatusLabel)
      ? prisma.appointment.findMany({
          where: {
            practiceId: user.practiceId,
            encounter: null,
            startsAt: { gte: from, lt: to },
            ...(sp.status && sp.status in appointmentVisitStatusLabel ? { status: sp.status } : {}),
            ...(sp.provider ? { providerId: sp.provider } : {}),
            ...(patientFilter ? { patient: patientFilter } : {}),
          },
          include: { patient: true, provider: true, location: true },
          orderBy: { startsAt: "desc" },
          take: 300,
        })
      : Promise.resolve([]),
    prisma.user.findMany({
      where: { memberships: { some: { practiceId: user.practiceId, role: "CLINICIAN" } } },
      orderBy: { name: "asc" },
    }),
  ]);

  type Row =
    | { kind: "appt"; at: Date; appt: (typeof appointments)[number] }
    | { kind: "enc"; at: Date; enc: (typeof encounters)[number] };
  const rows: Row[] = [
    ...appointments.map((appt) => ({ kind: "appt" as const, at: appt.startsAt, appt })),
    ...encounters.map((enc) => ({ kind: "enc" as const, at: enc.appointment?.startsAt ?? enc.date, enc })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const canStart = ["ADMIN", "FRONT_DESK", "CLINICIAN"].includes(user.role);
  const canSetPreVisit = ["ADMIN", "FRONT_DESK", "SCHEDULER", "CLINICIAN"].includes(user.role);
  const counts = await prisma.encounter.groupBy({
    by: ["status"],
    where: { practiceId: user.practiceId },
    _count: { _all: true },
  });
  const countOf = (statuses: string[] | null) =>
    statuses ? counts.filter((c) => statuses.includes(c.status)).reduce((n, c) => n + c._count._all, 0) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Scheduler → Provider &amp; clinical team → CDS → Signatures → Billing</p>
          <h1>Visit worklist</h1>
        </div>
        {["ADMIN", "FRONT_DESK", "SCHEDULER", "CLINICIAN"].includes(user.role) && (
          <Link className="btn" href="/schedule">
            Schedule a visit
          </Link>
        )}
      </div>

      <nav className="view-tabs" style={{ marginBottom: "0.8rem", width: "fit-content", flexWrap: "wrap" }}>
        {QUEUES.map((t) => {
          const n = t.key === "mine" ? null : countOf(QUEUE_STATUSES[t.key]);
          return (
            <Link key={t.key} href={`/encounters?queue=${t.key}`} className={`view-tab${t.key === queue ? " active" : ""}`}>
              {t.label}
              {n ? ` (${n})` : ""}
            </Link>
          );
        })}
      </nav>

      <form method="get" className="panel gw-filters">
        <input type="hidden" name="queue" value={queue} />
        <input name="q" defaultValue={q} placeholder="Patient name or MRN" aria-label="Patient" />
        <select name="provider" defaultValue={sp.provider ?? ""} aria-label="Physician">
          <option value="">All physicians</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {dated && (
          <>
            <label className="vw-date">
              From
              <input type="date" name="from" defaultValue={toDateParam(from)} />
            </label>
            <label className="vw-date">
              To
              <input type="date" name="to" defaultValue={toDateParam(addDays(to, -1))} />
            </label>
          </>
        )}
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Visit status">
          <option value="">Any visit status</option>
          {dated && (
            <optgroup label="Before the chart">
              {Object.entries(appointmentVisitStatusLabel)
                .filter(([k]) => !["IN_ROOM", "COMPLETED"].includes(k))
                .map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
            </optgroup>
          )}
          <optgroup label="Chart workflow">
            {Object.entries(visitStatusLabel).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </optgroup>
        </select>
        <button className="btn secondary" type="submit">
          Filter
        </button>
        <Link className="btn ghost" href={`/encounters?queue=${queue}`}>
          Clear all filters
        </Link>
      </form>

      <section className="panel gw-table vw-worklist">
        <table>
          <thead>
            <tr>
              <th>Visit</th>
              <th>Patient</th>
              <th>Physician</th>
              <th>Status date</th>
              <th>Visit status</th>
              <th>Site of service</th>
              <th>Progress note</th>
              <th>Signatures needed</th>
              <th>Superbill</th>
              <th>Visit finalized</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.kind === "appt") {
                const a = row.appt;
                return (
                  <tr key={`a-${a.id}`}>
                    <td>
                      {formatDate(a.startsAt)} {formatTime(a.startsAt)}
                      <div className="muted">{vtNames[a.visitType] ?? a.visitType}</div>
                    </td>
                    <td>
                      <Link href={`/patients/${a.patientId}`}>{patientName(a.patient)}</Link>
                      <div className="muted">{a.patient.mrn}</div>
                    </td>
                    <td>{a.provider.name}</td>
                    <td className="muted">—</td>
                    <td>
                      {canSetPreVisit ? (
                        <form action={setAppointmentStatus.bind(null, a.id)} className="vw-status-form">
                          <select name="status" defaultValue={a.status} aria-label="Visit status">
                            {Object.entries(appointmentVisitStatusLabel)
                              .filter(([k]) => !["IN_ROOM", "COMPLETED"].includes(k) || k === a.status)
                              .map(([k, l]) => (
                                <option key={k} value={k}>
                                  {l}
                                </option>
                              ))}
                          </select>
                          <button className="btn ghost gw-mini" type="submit">
                            Update
                          </button>
                        </form>
                      ) : (
                        <span className="gw-tag gw-tag-info">{appointmentVisitStatusLabel[a.status] ?? a.status}</span>
                      )}
                    </td>
                    <td>{a.location.name}</td>
                    <td>
                      {canStart && !["CANCELLED", "NO_SHOW"].includes(a.status) ? (
                        <form action={startEncounter.bind(null, a.id)}>
                          <button className="btn secondary gw-mini" type="submit">
                            Start chart
                          </button>
                        </form>
                      ) : (
                        <span className="muted">Missing</span>
                      )}
                    </td>
                    <td className="muted">—</td>
                    <td className="muted">—</td>
                    <td className="muted">—</td>
                  </tr>
                );
              }
              const e = row.enc;
              const required = e.supervisingProviderId ? 2 : 1;
              const noteDone = Boolean(e.chiefComplaint && e.subjective && e.objective && e.assessment && e.plan);
              const pointersOk = e.charges.every((c) => parsePointerIds(c.diagnosisPointers).length > 0);
              return (
                <tr key={`e-${e.id}`} className={e.status === "CDS_QUERY" || e.status === "CODING_QUERY" || HOLD_STATUSES.includes(e.status) ? "gw-row-urgent" : undefined}>
                  <td>
                    <Link href={`/encounters/${e.id}`}>
                      {formatDate(row.at)} {e.appointment ? formatTime(row.at) : ""}
                    </Link>
                    <div className="muted">
                      {e.appointment ? (vtNames[e.appointment.visitType] ?? e.appointment.visitType) : (visitTypeLabel[e.type] ?? e.type)}
                    </div>
                  </td>
                  <td>
                    <Link href={`/patients/${e.patientId}`}>{patientName(e.patient)}</Link>
                    <div className="muted">{e.patient.mrn}</div>
                  </td>
                  <td>
                    {e.provider.name}
                    {e.supervisingProvider && <div className="muted">Sup: {e.supervisingProvider.name}</div>}
                  </td>
                  <td>{formatDate(e.statusChangedAt)}</td>
                  <td>
                    <Link href={`/encounters/${e.id}`} className={`gw-tag gw-tag-${visitStatusTone(e.status)}`}>
                      {visitStatusLabel[e.status] ?? e.status}
                    </Link>
                  </td>
                  <td>{e.placeOfService ? `POS ${e.placeOfService}` : (e.appointment?.location.name ?? "—")}</td>
                  <td>{noteDone ? <span className="gw-tag gw-tag-ok">Complete</span> : <span className="gw-tag gw-tag-warn">In progress</span>}</td>
                  <td>
                    {e.signatures.length >= required ? (
                      <span className="gw-tag gw-tag-ok">Signed</span>
                    ) : e.status === "READY_FOR_SIGNATURE" ? (
                      <Link href={`/encounters/${e.id}#signatures`} className="gw-tag gw-tag-warn">
                        {required - e.signatures.length} needed
                      </Link>
                    ) : (
                      <span className="muted">
                        {e.signatures.length}/{required}
                      </span>
                    )}
                  </td>
                  <td>
                    {e.charges.length ? (
                      <>
                        {e.charges.map((c) => c.cptCode).join(", ")}
                        {!pointersOk && <div className="gw-missing">Dx pointer missing</div>}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{e.finalizedAt ? formatDate(e.finalizedAt) : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  Nothing in this queue.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
