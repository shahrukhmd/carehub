import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatTime, patientName } from "@/lib/format";
import { FAX_PROVIDERS, FAX_RECIPIENTS, FAX_ROLES, FAX_STATUS, faxNumberOrNull } from "@/lib/fax";
import { ensureChartSetup } from "@/lib/chart-setup";
import { visitTypeNames } from "@/lib/scheduler-setup";
import { SIGNED_STATUSES, visitStatusLabel } from "@/lib/visit-workflow";
import { AutoRefresh } from "@/components/AutoRefresh";
import { deleteInboundFax, fileFaxToPatient, receiveFax, resendFax, saveFaxNote, sendFaxes } from "./actions";

type Search = {
  tab?: string;
  error?: string;
  sent?: string;
  failed?: string;
  viewId?: string;
  recipient?: string;
  from?: string;
  to?: string;
  finalized?: string;
  missed?: string;
  patient?: string;
  providerId?: string;
  locationId?: string;
  status?: string | string[];
};

const TABS: [string, string][] = [
  ["inbound", "Inbound faxing"],
  ["outbound", "Outbound faxing"],
  ["history", "Fax history report"],
];

const today = () => new Date().toISOString().slice(0, 10);

export default async function FaxingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(FAX_ROLES);
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "inbound";
  await ensureChartSetup(user.practiceId);
  const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId } });

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Practice management</p>
          <h1>Faxing</h1>
        </div>
        <p className="muted" style={{ margin: 0, textAlign: "right" }}>
          Electronic fax number: <strong>{settings?.faxNumber ?? "not set"}</strong>
          <br />
          {FAX_PROVIDERS[settings?.faxProvider ?? "MOCK"] ?? settings?.faxProvider}
          {user.role === "ADMIN" && (
            <>
              {" · "}
              <Link href="/settings/practice#fax">Fax settings</Link>
            </>
          )}
        </p>
      </div>
      <nav className="view-tabs" style={{ width: "fit-content" }}>
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/faxing?tab=${k}`} className={`view-tab${tab === k ? " active" : ""}`}>
            {l}
          </Link>
        ))}
      </nav>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.sent !== undefined && (
        <p className={Number(sp.failed) ? "gw-error" : "notice-ok"}>
          {sp.sent} fax{sp.sent === "1" ? "" : "es"} sent{Number(sp.failed) ? ` · ${sp.failed} not sent — see Fax history for the reason` : ""}.
        </p>
      )}
      {tab === "inbound" && <Inbound practiceId={user.practiceId} />}
      {tab === "outbound" && <Outbound practiceId={user.practiceId} sp={sp} />}
      {tab === "history" && <History practiceId={user.practiceId} sp={sp} />}
    </div>
  );
}

async function Inbound({ practiceId }: { practiceId: string }) {
  const [faxes, patients] = await Promise.all([
    prisma.fax.findMany({ where: { practiceId, direction: "INBOUND" }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.patient.findMany({ where: { practiceId }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 500 }),
  ]);
  const docs = new Map(
    (await prisma.patientDocument.findMany({ where: { id: { in: faxes.map((f) => f.documentId).filter((x): x is string => Boolean(x)) } }, include: { patient: true } })).map((d) => [
      d.id,
      d,
    ])
  );
  const reading = [...docs.values()].some((d) => d.status === "PROCESSING");

  return (
    <>
      {reading && <AutoRefresh seconds={4} />}
      <section className="panel">
        <h2>Receive a fax</h2>
        <p className="muted">
          Faxes to the practice line arrive here and in Patient documents, where they&apos;re read automatically so the data entry team can file them and fill
          in the patient&apos;s details. Until a fax service is connected, import a received fax file here.
        </p>
        <form action={receiveFax} className="form-grid gw-grid-3">
          <label>
            From (fax number)
            <input name="from" required placeholder="(480) 555-2513" />
          </label>
          <label>
            Fax file (PDF or image)
            <input type="file" name="files" multiple required accept=".pdf,.png,.jpg,.jpeg" />
          </label>
          <label>
            Notes
            <input name="notes" />
          </label>
          <button className="btn" type="submit">
            Add to inbound faxes
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>Inbound faxing</h2>
        <div className="table-scroll">
          <table className="fx-table">
            <thead>
              <tr>
                <th>Date received</th>
                <th>From</th>
                <th>Pages</th>
                <th>View</th>
                <th>Notes</th>
                <th>Save to patient record</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {faxes.map((f) => {
                const d = f.documentId ? docs.get(f.documentId) : null;
                return (
                  <tr key={f.id}>
                    <td>
                      {formatDate(f.createdAt)}
                      <div className="muted">{formatTime(f.createdAt)}</div>
                    </td>
                    <td>{f.faxNumber}</td>
                    <td>{f.pages ?? (d?.status === "PROCESSING" ? "…" : "—")}</td>
                    <td>
                      {d ? (
                        <>
                          <a href={`/api/files/patientdoc/${d.id}`} target="_blank" rel="noreferrer">
                            View
                          </a>
                          <div>
                            <Link className="muted" href={`/gateway/documents/${d.id}`}>
                              Review &amp; fill
                            </Link>
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <form action={saveFaxNote.bind(null, f.id)} className="vw-inline">
                        <input name="notes" defaultValue={f.notes ?? ""} aria-label="Fax notes" />
                        <button className="btn ghost gw-mini" type="submit">
                          Save
                        </button>
                      </form>
                    </td>
                    <td>
                      {f.status === "FILED" && d?.patient ? (
                        <span>
                          <span className="gw-tag gw-tag-ok">Saved</span> <Link href={`/patients/${d.patient.id}`}>{patientName(d.patient)}</Link>
                        </span>
                      ) : (
                        <form action={fileFaxToPatient.bind(null, f.id)} className="vw-inline">
                          <select name="patientId" required defaultValue="" aria-label="Find patient">
                            <option value="" disabled>
                              Find patient…
                            </option>
                            {patients.map((p) => (
                              <option key={p.id} value={p.id}>
                                {patientName(p)} · {p.mrn}
                              </option>
                            ))}
                          </select>
                          <button className="btn secondary gw-mini" type="submit">
                            Save
                          </button>
                        </form>
                      )}
                    </td>
                    <td>
                      <form action={deleteInboundFax.bind(null, f.id)}>
                        <button className="btn ghost gw-mini" type="submit" aria-label="Delete fax">
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {faxes.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No inbound faxes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

async function Outbound({ practiceId, sp }: { practiceId: string; sp: Search }) {
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : today();
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today();
  const finalized = sp.finalized ?? "yes";
  const missed = sp.missed ?? "no";
  const recipient = sp.recipient && sp.recipient in FAX_RECIPIENTS ? sp.recipient : "REFERRING";
  const [views, providers, locations, typeNames] = await Promise.all([
    prisma.documentationView.findMany({ where: { practiceId, active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { practiceId, role: "CLINICIAN" }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { practiceId }, orderBy: { name: "asc" } }),
    visitTypeNames(practiceId),
  ]);
  const viewId = views.some((v) => v.id === sp.viewId) ? sp.viewId! : views[0]?.id;

  const where: Prisma.EncounterWhereInput = {
    practiceId,
    date: { gte: new Date(`${from}T00:00:00`), lte: new Date(`${to}T23:59:59.999`) },
    ...(finalized === "yes" ? { status: { in: SIGNED_STATUSES } } : finalized === "no" ? { status: { notIn: SIGNED_STATUSES } } : {}),
    ...(sp.providerId ? { providerId: sp.providerId } : {}),
    ...(sp.locationId ? { appointment: { locationId: sp.locationId } } : {}),
    ...(sp.patient ? { patient: { OR: [{ lastName: { contains: sp.patient } }, { firstName: { contains: sp.patient } }, { mrn: { contains: sp.patient } }] } } : {}),
  };
  const encounters = await prisma.encounter.findMany({
    where,
    include: {
      patient: { include: { referringPhysician: true, intakeCases: { orderBy: { createdAt: "desc" }, take: 1 } } },
      provider: true,
      appointment: true,
    },
    orderBy: { date: "desc" },
    take: 200,
  });
  // Missed visits (no-shows) have no encounter; "missed = yes" shows none.
  const rows = missed === "yes" ? [] : encounters;
  const lastFax = new Map(
    (
      await prisma.fax.findMany({
        where: { practiceId, direction: "OUTBOUND", encounterId: { in: rows.map((e) => e.id) }, ...(viewId ? { viewId } : {}) },
        orderBy: { createdAt: "desc" },
      })
    ).map((f) => [f.encounterId!, f])
  );
  const recipientFor = (e: (typeof rows)[number]) => {
    const c = e.patient.intakeCases[0];
    if (recipient === "REFERRING") return { name: e.patient.referringPhysician?.name ?? null, number: faxNumberOrNull(e.patient.referringPhysician?.fax) };
    if (recipient === "PCP") return { name: c?.pcpName ?? null, number: faxNumberOrNull(c?.pcpFax) };
    if (recipient === "REFERRAL_SOURCE") return { name: c?.referralSourceName ?? null, number: faxNumberOrNull(c?.referralContactFax) };
    return { name: null, number: null };
  };
  const qs = new URLSearchParams(
    Object.entries({ tab: "outbound", viewId, recipient, from, to, finalized, missed, patient: sp.patient, providerId: sp.providerId, locationId: sp.locationId }).filter(
      ([, v]) => v
    ) as [string, string][]
  ).toString();

  return (
    <div className="fx-layout">
      <form className="panel fx-filters" method="get">
        <input type="hidden" name="tab" value="outbound" />
        <h3>Faxing information</h3>
        <label>
          Fax content type
          <select name="viewId" defaultValue={viewId}>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fax recipient
          <select name="recipient" defaultValue={recipient}>
            {Object.entries(FAX_RECIPIENTS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <h3>Visit information</h3>
        <label>
          From date
          <input type="date" name="from" defaultValue={from} />
        </label>
        <label>
          To date
          <input type="date" name="to" defaultValue={to} />
        </label>
        <fieldset className="gw-fieldset">
          <legend>Visit finalized</legend>
          {[
            ["yes", "Yes"],
            ["no", "No"],
            ["all", "Show all"],
          ].map(([v, l]) => (
            <label key={v} className="checkbox-inline">
              <input type="radio" name="finalized" value={v} defaultChecked={finalized === v} /> {l}
            </label>
          ))}
        </fieldset>
        <fieldset className="gw-fieldset">
          <legend>Missed visit</legend>
          {[
            ["yes", "Yes"],
            ["no", "No"],
            ["all", "Show all"],
          ].map(([v, l]) => (
            <label key={v} className="checkbox-inline">
              <input type="radio" name="missed" value={v} defaultChecked={missed === v} /> {l}
            </label>
          ))}
        </fieldset>
        <h3>Patient information</h3>
        <label>
          Patient
          <input name="patient" defaultValue={sp.patient ?? ""} placeholder="Name or MRN" />
        </label>
        <label>
          Physician
          <select name="providerId" defaultValue={sp.providerId ?? ""}>
            <option value="">All</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Site of service
          <select name="locationId" defaultValue={sp.locationId ?? ""}>
            <option value="">All</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit">
          Search
        </button>
      </form>

      <form className="panel stack" action={sendFaxes}>
        <div className="gw-section-head">
          <h2>Outbound faxing</h2>
          <Link href="/faxing?tab=history">Fax history report</Link>
        </div>
        <p className="gw-missing" style={{ margin: 0 }}>
          Faxes will not include prescriptions containing controlled substances due to DEA regulations.
        </p>
        <input type="hidden" name="back" value={`/faxing?${qs}`} />
        <input type="hidden" name="viewId" value={viewId ?? ""} />
        <input type="hidden" name="recipient" value={recipient} />
        {recipient === "OTHER" && (
          <div className="form-grid">
            <label>
              Recipient name
              <input name="otherName" />
            </label>
            <label>
              Fax number
              <input name="otherNumber" required placeholder="(203) 555-8334" />
            </label>
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th />
                <th>Visit</th>
                <th>Patient name</th>
                <th>Recipient</th>
                <th>Fax number</th>
                <th>Fax status</th>
                <th>Last fax info</th>
                <th>Visit finalized</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const r = recipientFor(e);
                const last = lastFax.get(e.id);
                const done = SIGNED_STATUSES.includes(e.status);
                return (
                  <tr key={e.id}>
                    <td>
                      <input
                        type="checkbox"
                        name="encounterIds"
                        value={e.id}
                        defaultChecked={Boolean(r.number || recipient === "OTHER") && !last}
                        aria-label={`Fax visit of ${patientName(e.patient)}`}
                      />
                    </td>
                    <td>
                      <Link href={`/encounters/${e.id}`}>{formatDate(e.date)}</Link>
                      <div className="muted">
                        {e.appointment ? (typeNames[e.appointment.visitType] ?? e.appointment.visitType) : e.type} · {e.provider.name}
                      </div>
                    </td>
                    <td>{patientName(e.patient)}</td>
                    <td>{recipient === "OTHER" ? <span className="muted">As entered above</span> : (r.name ?? <span className="muted">—</span>)}</td>
                    <td>{recipient === "OTHER" ? "—" : (r.number ?? <span className="gw-missing">No fax number</span>)}</td>
                    <td>{last ? <span className={`gw-tag gw-tag-${last.status === "SUCCESS" ? "ok" : "bad"}`}>{FAX_STATUS[last.status]}</span> : <span className="muted">Not sent</span>}</td>
                    <td className="muted">{last ? `${formatDate(last.createdAt)} ${formatTime(last.createdAt)} · ${last.faxNumber}${last.error ? ` · ${last.error}` : ""}` : "—"}</td>
                    <td>{done ? <span className="gw-tag gw-tag-ok">Yes</span> : <span className="muted">{visitStatusLabel[e.status] ?? e.status}</span>}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No visits match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="form-actions">
          <button className="btn" type="submit" disabled={rows.length === 0 || !viewId}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

async function History({ practiceId, sp }: { practiceId: string; sp: Search }) {
  const statuses = ([] as string[]).concat(sp.status ?? []).filter((s) => ["SUCCESS", "FAILURE", "NOT_SENT", "PROCESSING", "QUEUED"].includes(s));
  const faxes = await prisma.fax.findMany({
    where: { practiceId, direction: "OUTBOUND", ...(statuses.length ? { status: { in: statuses } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const patients = new Map(
    (await prisma.patient.findMany({ where: { id: { in: faxes.map((f) => f.patientId).filter((x): x is string => Boolean(x)) } } })).map((p) => [p.id, p])
  );
  const users = new Map(
    (await prisma.user.findMany({ where: { id: { in: faxes.map((f) => f.userId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((u) => [
      u.id,
      u.name,
    ])
  );
  return (
    <section className="panel stack">
      <form className="vw-inline" method="get">
        <input type="hidden" name="tab" value="history" />
        <span className="muted">Fax status:</span>
        {["SUCCESS", "FAILURE", "NOT_SENT"].map((s) => (
          <label key={s} className="checkbox-inline">
            <input type="checkbox" name="status" value={s} defaultChecked={statuses.length === 0 || statuses.includes(s)} /> {FAX_STATUS[s]}
          </label>
        ))}
        <button className="btn secondary gw-mini" type="submit">
          Filter
        </button>
      </form>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Sent</th>
              <th>Patient</th>
              <th>Content</th>
              <th>Recipient</th>
              <th>Fax number</th>
              <th>Pages</th>
              <th>Status</th>
              <th>By</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {faxes.map((f) => {
              const p = f.patientId ? patients.get(f.patientId) : null;
              return (
                <tr key={f.id}>
                  <td>
                    {formatDate(f.createdAt)}
                    <div className="muted">{formatTime(f.createdAt)}</div>
                  </td>
                  <td>{p ? <Link href={`/patients/${p.id}`}>{patientName(p)}</Link> : "—"}</td>
                  <td>
                    {f.encounterId && f.viewId ? <Link href={`/encounters/${f.encounterId}/print?view=${f.viewId}`}>{f.contentType}</Link> : f.contentType}
                  </td>
                  <td>{f.recipientName ?? "—"}</td>
                  <td>{f.faxNumber}</td>
                  <td>{f.pages ?? "—"}</td>
                  <td>
                    <span className={`gw-tag gw-tag-${f.status === "SUCCESS" ? "ok" : "bad"}`}>{FAX_STATUS[f.status] ?? f.status}</span>
                    {f.error && <div className="muted">{f.error}</div>}
                    {f.providerRef && <div className="muted">Ref {f.providerRef}</div>}
                  </td>
                  <td className="muted">{f.userId ? (users.get(f.userId) ?? "") : ""}</td>
                  <td>
                    {f.status !== "SUCCESS" && faxNumberOrNull(f.faxNumber) && (
                      <form action={resendFax.bind(null, f.id)}>
                        <button className="btn ghost gw-mini" type="submit">
                          Resend
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {faxes.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  No faxes sent yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
