import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { can, rolesFor } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { DAY_ABBR, toDateParam } from "@/lib/schedule";
import { BOARD_FILTER_KEYS, boardChoices, DEFAULT_EXPORT, EXPORT_COLUMNS, GIS_STATUSES, gisStatus, loadBoard, scheduleLabel, type BoardFilters } from "@/lib/gis/board";
import { FIELD_PROVIDER_WHERE, getGisSettings, gisTitleLabel } from "@/lib/gis/settings";
import { InlineSelect } from "@/components/InlineSelect";
import { SelectAll } from "@/components/SelectAll";
import { GisPage } from "../gis-shell";
import { bulkGisAssign, setGisAssignment, updateGisPatient } from "../actions";

type SearchParams = BoardFilters & { ok?: string; error?: string; page?: string };
const PAGE = 100;
const ROLES = [
  ["np", "Nurse Practitioner", "NP"],
  ["lpn", "Wound Nurse (LPN)", "LPN"],
  ["ma", "Wound Tech (MA)", "MA"],
] as const;

// The patients board: every active patient with field assignments, Gateway status, next visit, schedule and
// notes. Assignments decide which pins a clinician's map shows.
export default async function GisPatientsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser(rolesFor("gis.view"));
  const sp = await searchParams;
  const canEdit = can(user, "gis.edit");
  const page = Math.max(1, Number(sp.page) || 1);
  const filters: BoardFilters = {};
  for (const k of BOARD_FILTER_KEYS) if (sp[k]) filters[k] = sp[k];
  const [settings, clinicians, choices, lastRun] = await Promise.all([
    getGisSettings(user.practiceId),
    prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId, ...FIELD_PROVIDER_WHERE, gisActive: true, gisTitle: { not: null } }, select: { id: true, name: true, gisTitle: true }, orderBy: { name: "asc" } }),
    boardChoices(user.practiceId),
    prisma.jobRun.findFirst({ where: { job: "gis-geocode", status: "OK" }, orderBy: { startedAt: "desc" } }),
  ]);
  const board = await loadBoard(user.practiceId, filters, { page, pageSize: PAGE, nameFormat: settings.nameFormat });
  // Dropdown options per role: the matching title first, then the other field clinicians.
  const optionsFor = (title: string) => [
    { key: "", label: "—" },
    ...clinicians.filter((c) => c.gisTitle === title).map((c) => ({ key: c.id, label: c.name })),
    ...clinicians.filter((c) => c.gisTitle !== title).map((c) => ({ key: c.id, label: `${c.name} (${gisTitleLabel(c.gisTitle)})` })),
  ];
  const here = (o: Partial<SearchParams>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...o })) if (v && k !== "ok" && k !== "error") p.set(k, v as string);
    return `/gis/patients?${p.toString()}`;
  };
  const back = here({});
  const filterQuery = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <GisPage
      title="Patients"
      subtitle="Assign field clinicians, set the weekly schedule, next visit and notes. Status comes from the Patient Gateway care board."
      sp={sp}
      actions={
        <>
          <Link className="btn secondary" href="/gis/resolver">
            Resolver
          </Link>
        </>
      }
    >
      <form className="panel fr-filters" method="get">
        <label>
          Search
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Name, MRN, street or DOB (MM/DD/YYYY)" style={{ minWidth: "16rem" }} />
        </label>
        <label>
          Status
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {GIS_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {ROLES.map(([role, label, title]) => (
          <label key={role}>
            {label}
            <select name={role} defaultValue={sp[role] ?? ""}>
              <option value="">All</option>
              {clinicians
                .filter((c) => c.gisTitle === title)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              <option value="blank">Blank</option>
            </select>
          </label>
        ))}
        <label>
          ZIP
          <input name="zip" defaultValue={sp.zip ?? ""} size={6} />
        </label>
        <label>
          County
          <select name="county" defaultValue={sp.county ?? ""}>
            <option value="">All</option>
            {choices.counties.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="blank">Blank</option>
          </select>
        </label>
        <label>
          State
          <select name="state" defaultValue={sp.state ?? ""}>
            <option value="">All</option>
            {choices.states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="blank">Blank</option>
          </select>
        </label>
        <label>
          Home health
          <select name="hh" defaultValue={sp.hh ?? ""}>
            <option value="">All</option>
            {choices.homeHealth.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
            <option value="blank">Blank</option>
          </select>
        </label>
        <label>
          Referral source
          <select name="ref" defaultValue={sp.ref ?? ""}>
            <option value="">All</option>
            {choices.referrals.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="blank">Blank</option>
          </select>
        </label>
        <label>
          Next visit
          <select name="next" defaultValue={sp.next ?? ""}>
            <option value="">Any</option>
            <option value="range">In range</option>
            <option value="blank">Blank</option>
          </select>
        </label>
        <label>
          From
          <input name="nextFrom" type="date" defaultValue={sp.nextFrom ?? ""} />
        </label>
        <label>
          To
          <input name="nextTo" type="date" defaultValue={sp.nextTo ?? ""} />
        </label>
        <label>
          Scheduled on
          <select name="day" defaultValue={sp.day ?? ""}>
            <option value="">Any day</option>
            {DAY_ABBR.map((d, i) => (
              <option key={d} value={String(i)}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          Map pin
          <select name="pin" defaultValue={sp.pin ?? ""}>
            <option value="">All</option>
            <option value="yes">Has coordinates</option>
            <option value="no">No coordinates</option>
          </select>
        </label>
        <button className="btn" type="submit">
          Apply
        </button>
        <Link className="btn ghost" href="/gis/patients">
          Clear
        </Link>
      </form>

      <section className="panel">
        <div className="gw-section-head">
          <h2>Patients</h2>
          <span className="muted">
            {board.total} match{board.total === 1 ? "" : "es"} · page {page} of {board.pages}
          </span>
        </div>

        {canEdit && (
          <form id="bulk" action={bulkGisAssign} className="fr-bulk">
            <input type="hidden" name="back" value={back} />
            <SelectAll name="ids" noun="patient" />
            <select name="role" defaultValue="np" aria-label="Assignment to set">
              {ROLES.map(([role, label]) => (
                <option key={role} value={role}>
                  Set {label}
                </option>
              ))}
            </select>
            <select name="providerId" defaultValue="" aria-label="Clinician for the bulk assignment">
              <option value="">— clear —</option>
              {clinicians.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({gisTitleLabel(c.gisTitle)})
                </option>
              ))}
            </select>
            <button className="btn secondary" type="submit">
              Apply to ticked
            </button>
          </form>
        )}

        <details className="fr-export">
          <summary className="muted cn-small">Export to spreadsheet (choose columns)</summary>
          <form action="/api/gis/patients/export" method="get" className="stack">
            {Object.entries(filters).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
            <div className="fr-bulk">
              {EXPORT_COLUMNS.map((c) => (
                <label key={c.key} className="checkbox-inline cn-small">
                  <input type="checkbox" name="cols" value={c.key} defaultChecked={DEFAULT_EXPORT.includes(c.key)} /> {c.label}
                </label>
              ))}
            </div>
            <div className="fr-bulk">
              <button className="btn ghost" type="submit" name="format" value="xlsx">
                Export to Excel
              </button>
              <button className="btn ghost" type="submit" name="format" value="csv">
                Export as CSV
              </button>
              <span className="muted cn-small">Filtered rows, chosen columns. Every export is written to the audit log.</span>
            </div>
          </form>
        </details>

        <div className="table-scroll">
          <table className="fr-board">
            <thead>
              <tr>
                {canEdit && <th></th>}
                <th>Patient</th>
                <th>Notes</th>
                {ROLES.map(([role, label]) => (
                  <th key={role}>{label}</th>
                ))}
                <th>Home Healthcare Provider</th>
                <th>Status</th>
                <th>Next visit</th>
                <th>Schedule</th>
                <th>County</th>
                <th>ZIP</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((r) => {
                const st = gisStatus(r.statusKey);
                return (
                  <tr key={r.id}>
                    {canEdit && (
                      <td>
                        <input type="checkbox" name="ids" value={r.id} form="bulk" aria-label={`Select ${r.name}`} />
                      </td>
                    )}
                    <td>
                      <Link href={`/patients/${r.id}`}>{r.name}</Link>
                      <div className="muted cn-small">
                        {r.mrn} · {formatDate(r.dob)}
                      </div>
                      <div className="muted cn-small">
                        {r.address || "No street address"}
                        {r.latitude == null && r.address ? <span className="gw-missing"> · no pin</span> : ""}
                      </div>
                    </td>
                    <td>
                      {canEdit ? (
                        <details>
                          <summary className="cn-small">{r.note ? `${r.note.slice(0, 40)}${r.note.length > 40 ? "…" : ""}` : <span className="muted">Add note / schedule</span>}</summary>
                          <form action={updateGisPatient.bind(null, r.id)} className="fr-row-edit">
                            <input type="hidden" name="back" value={back} />
                            <textarea name="gisNote" defaultValue={r.note ?? ""} placeholder="Note (500 characters)" maxLength={500} rows={2} />
                            <label className="cn-small">
                              Next visit
                              <input name="gisNextVisit" type="date" defaultValue={r.nextVisit ? toDateParam(r.nextVisit) : ""} />
                            </label>
                            <div className="fr-days">
                              {DAY_ABBR.map((d, i) => (
                                <label key={d}>
                                  <input type="checkbox" name="days" value={i} defaultChecked={r.schedule.includes(i)} /> {d}
                                </label>
                              ))}
                            </div>
                            <button className="btn ghost" type="submit">
                              Save
                            </button>
                          </form>
                        </details>
                      ) : (
                        <span className="cn-small">{r.note ?? "—"}</span>
                      )}
                    </td>
                    {ROLES.map(([role, label, title]) => {
                      const current = r[role];
                      return (
                        <td key={role}>
                          <InlineSelect action={setGisAssignment.bind(null, r.id)} name="value" value={current?.id ?? ""} options={optionsFor(title)} hidden={{ role, back }} readOnly={!canEdit} placeholder={current?.name ?? "Not assigned"} ariaLabel={`${label} for ${r.name}`} />
                        </td>
                      );
                    })}
                    <td className="cn-small">{r.homeHealth ?? <span className="muted">Not specified</span>}</td>
                    <td>
                      <span className="sa-chip" style={{ background: st.tone, color: "#fff" }}>
                        {st.label}
                      </span>
                      {r.caseId && (
                        <div>
                          <Link className="muted cn-small" href={`/gateway/${r.caseId}`}>
                            Gateway case
                          </Link>
                        </div>
                      )}
                    </td>
                    <td className="cn-small">{r.nextVisit ? formatDate(r.nextVisit) : <span className="muted">—</span>}</td>
                    <td className="cn-small">{scheduleLabel(r.schedule) || <span className="muted">—</span>}</td>
                    <td className="cn-small">{r.county ?? ""}</td>
                    <td className="cn-small">{r.zip ?? ""}</td>
                  </tr>
                );
              })}
              {board.rows.length === 0 && (
                <tr>
                  <td colSpan={12}>No patients match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="fr-bulk">
          {board.pages > 1 && (
            <span className="muted">
              {page > 1 && <Link href={here({ page: String(page - 1) })}>← Previous</Link>} {page < board.pages && <Link href={here({ page: String(page + 1) })}>Next →</Link>}
            </span>
          )}
          <span className="muted cn-small">Last geocoding run: {lastRun ? `${formatDate(lastRun.startedAt)} · ${lastRun.summary ?? ""}` : "not yet"}</span>
          {filterQuery && <span className="muted cn-small">Filters: {decodeURIComponent(filterQuery).replace(/&/g, " · ")}</span>}
        </div>
      </section>
    </GisPage>
  );
}
