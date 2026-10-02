import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { PrintButton } from "@/components/PrintButton";
import { SDOH_QUESTIONS, careTeamRoleLabel, concernCategoryLabel, goalKindLabel, goalStatusLabel, goalStatusTone, parseSdohAnswers, sdohDomainLabel } from "@/lib/care-plan";
import { formatDate } from "@/lib/format";
import { PATIENT_VIEW_ROLES } from "@/lib/gateway";
import { PatientShell, loadPatientShell } from "../patient-shell";
import { addConcern, addDevice, addGoal, addTeamMember, endTeamMember, removeDevice, saveSdohScreening, setConcernStatus, updateGoal } from "./actions";

const TEAM_ROLES = ["ADMIN", "CLINICIAN", "CDS", "FRONT_DESK", "INTAKE"];
const CLINICAL_ROLES = ["ADMIN", "CLINICIAN", "CDS"];
type Search = { error?: string; ok?: string; screen?: string };

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// The patient-level care plan: who is involved in the patient's care, what the team is worried about, what they
// are working towards, devices the patient carries, and social needs that get in the way of healing.
export default async function CarePlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const user = await requireUser([...new Set([...PATIENT_VIEW_ROLES, "CDS"])]);
  const { id } = await params;
  const sp = await searchParams;
  const shell = await loadPatientShell(id, user);
  const canTeam = TEAM_ROLES.includes(user.role);
  const canClinical = CLINICAL_ROLES.includes(user.role);

  const [team, concerns, goals, devices, screenings, staff, visits] = await Promise.all([
    prisma.careTeamMember.findMany({ where: { patientId: id, practiceId: user.practiceId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] }),
    prisma.healthConcern.findMany({ where: { patientId: id, practiceId: user.practiceId }, orderBy: [{ status: "asc" }, { notedAt: "desc" }] }),
    prisma.patientGoal.findMany({ where: { patientId: id, practiceId: user.practiceId }, include: { concern: { select: { concern: true } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
    prisma.implantableDevice.findMany({ where: { patientId: id, practiceId: user.practiceId }, orderBy: [{ status: "asc" }, { implantedAt: "desc" }] }),
    prisma.sdohScreening.findMany({ where: { patientId: id, practiceId: user.practiceId }, orderBy: { screenedAt: "desc" }, take: 10 }),
    prisma.membership.findMany({ where: { practiceId: user.practiceId, user: { active: true } }, include: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } }),
    prisma.encounter.findMany({ where: { patientId: id, practiceId: user.practiceId }, orderBy: { date: "desc" }, take: 20, select: { id: true, date: true } }),
  ]);
  const screeners = new Map(staff.map((m) => [m.user.id, m.user.name]));
  const latest = screenings[0];
  const latestNeeds = latest && !latest.declined ? latest.needs.split(",").filter(Boolean) : [];
  const activeConcerns = concerns.filter((c) => c.status === "ACTIVE");

  return (
    <PatientShell data={shell}>
      <p className="pd-back no-print">
        <Link href={`/patients/${id}`}>« Back to dashboard</Link>
      </p>
      <div className="pd-head">
        <h1>Care team, goals &amp; care plan</h1>
        <PrintButton label="Print care plan" className="btn secondary no-print" />
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}

      {/* ---------------- Care team ---------------- */}
      <section className="panel">
        <div className="gw-section-head">
          <h2>Care team</h2>
          <span className="muted">Everyone involved in this patient&apos;s care, inside and outside the practice</span>
        </div>
        {canTeam && (
          <details className="pv-add no-print">
            <summary className="btn secondary gw-mini">+ Add a care team member</summary>
            <form action={addTeamMember.bind(null, id)} className="form-grid gw-grid-3">
              <label>
                Role
                <select name="role" required defaultValue="">
                  <option value="" disabled>
                    Select…
                  </option>
                  {Object.entries(careTeamRoleLabel).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Staff member here (optional)
                <select name="userId" defaultValue="">
                  <option value="">Not a CareHub user</option>
                  {staff.map((m) => (
                    <option key={m.user.id} value={m.user.id}>
                      {m.user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Name (if not staff)
                <input name="name" maxLength={120} />
              </label>
              <label>
                Specialty
                <input name="specialty" maxLength={120} placeholder="e.g. Vascular surgery" />
              </label>
              <label>
                Organization
                <input name="organization" maxLength={160} />
              </label>
              <label>
                Phone
                <input name="phone" maxLength={40} />
              </label>
              <label>
                Fax
                <input name="fax" maxLength={40} />
              </label>
              <label>
                Email
                <input name="email" type="email" maxLength={160} />
              </label>
              <label>
                On the team since
                <input type="date" name="startDate" max={today()} />
              </label>
              <label className="pv-wide">
                Notes
                <input name="notes" maxLength={500} />
              </label>
              <div className="pv-actions">
                <button className="btn" type="submit">
                  Add to care team
                </button>
                <span className="muted">A staff member on the care team can open this chart even when it is restricted.</span>
              </div>
            </form>
          </details>
        )}
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Organization</th>
              <th>Contact</th>
              <th>Since</th>
              <th className="no-print" />
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.id} className={m.active ? undefined : "cm-blocked"}>
                <td>
                  {m.name}
                  {m.userId && <span className="gw-tag gw-tag-info">Staff</span>}
                  {m.notes ? <div className="muted">{m.notes}</div> : null}
                </td>
                <td>
                  {careTeamRoleLabel[m.role] ?? m.role}
                  {m.specialty ? <span className="muted"> · {m.specialty}</span> : null}
                </td>
                <td>{m.organization ?? "—"}</td>
                <td>{[m.phone, m.fax ? `Fax ${m.fax}` : null, m.email].filter(Boolean).join(" · ") || "—"}</td>
                <td>
                  {m.startDate ? formatDate(m.startDate) : formatDate(m.createdAt)}
                  {!m.active && m.endDate ? ` – ${formatDate(m.endDate)}` : ""}
                </td>
                <td className="num no-print">
                  {m.active && canTeam && (
                    <form action={endTeamMember.bind(null, id, m.id)}>
                      <button className="btn ghost gw-mini" type="submit">
                        Remove
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {team.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No care team members added. The wound care, primary care and referring physicians on the registration form show in the summary on the left.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="pv-two">
        {/* ---------------- Health concerns ---------------- */}
        <section className="panel">
          <div className="gw-section-head">
            <h2>Health concerns</h2>
          </div>
          {canClinical && (
            <details className="pv-add no-print">
              <summary className="btn secondary gw-mini">+ Add a concern</summary>
              <form action={addConcern.bind(null, id)} className="form-grid">
                <label className="pv-wide">
                  Concern
                  <input name="concern" required maxLength={300} placeholder="e.g. Poor glycemic control slowing healing" />
                </label>
                <label>
                  Type
                  <select name="category" defaultValue="CLINICAL">
                    {Object.entries(concernCategoryLabel).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Noted on
                  <input type="date" name="notedAt" defaultValue={today()} max={today()} />
                </label>
                <label className="pv-wide">
                  Notes
                  <input name="notes" maxLength={600} />
                </label>
                <div className="pv-actions">
                  <button className="btn" type="submit">
                    Add concern
                  </button>
                </div>
              </form>
            </details>
          )}
          <ul className="pv-items">
            {concerns.map((c) => (
              <li key={c.id}>
                <div className="pv-item-head">
                  <strong>{c.concern}</strong>
                  <span className={`gw-tag gw-tag-${c.status === "ACTIVE" ? "warn" : "muted"}`}>{c.status === "ACTIVE" ? "Active" : "Resolved"}</span>
                  <span className="muted">
                    {concernCategoryLabel[c.category] ?? c.category} · noted {formatDate(c.notedAt)}
                    {c.resolvedAt ? ` · resolved ${formatDate(c.resolvedAt)}` : ""}
                  </span>
                  {canClinical && (
                    <form action={setConcernStatus.bind(null, id, c.id, c.status === "ACTIVE" ? "RESOLVED" : "ACTIVE")} className="no-print">
                      <button className="btn ghost gw-mini" type="submit">
                        {c.status === "ACTIVE" ? "Mark resolved" : "Reopen"}
                      </button>
                    </form>
                  )}
                </div>
                {c.notes && <p className="muted">{c.notes}</p>}
              </li>
            ))}
            {concerns.length === 0 && <li className="muted">No health concerns recorded.</li>}
          </ul>
        </section>

        {/* ---------------- Implantable devices ---------------- */}
        <section className="panel">
          <div className="gw-section-head">
            <h2>Implantable devices</h2>
          </div>
          {canClinical && (
            <details className="pv-add no-print">
              <summary className="btn secondary gw-mini">+ Add a device</summary>
              <form action={addDevice.bind(null, id)} className="form-grid">
                <label className="pv-wide">
                  Device
                  <input name="deviceName" required maxLength={200} placeholder="e.g. Left total knee prosthesis, pacemaker" />
                </label>
                <label className="pv-wide">
                  Unique device identifier (UDI) from the implant card
                  <input name="udi" maxLength={200} />
                </label>
                <label>
                  Manufacturer
                  <input name="manufacturer" maxLength={160} />
                </label>
                <label>
                  Model
                  <input name="model" maxLength={120} />
                </label>
                <label>
                  Lot number
                  <input name="lotNumber" maxLength={80} />
                </label>
                <label>
                  Serial number
                  <input name="serialNumber" maxLength={80} />
                </label>
                <label>
                  Body site
                  <input name="site" maxLength={120} />
                </label>
                <label>
                  Implanted on
                  <input type="date" name="implantedAt" max={today()} />
                </label>
                <label className="pv-wide">
                  Notes (for example MRI safety)
                  <input name="notes" maxLength={500} />
                </label>
                <div className="pv-actions">
                  <button className="btn" type="submit">
                    Add device
                  </button>
                </div>
              </form>
            </details>
          )}
          <ul className="pv-items">
            {devices.map((d) => (
              <li key={d.id}>
                <div className="pv-item-head">
                  <strong>{d.deviceName}</strong>
                  <span className={`gw-tag gw-tag-${d.status === "ACTIVE" ? "info" : "muted"}`}>{d.status === "ACTIVE" ? "In place" : "Removed"}</span>
                  <span className="muted">
                    {[d.site, d.implantedAt ? `implanted ${formatDate(d.implantedAt)}` : null, d.removedAt ? `removed ${formatDate(d.removedAt)}` : null].filter(Boolean).join(" · ")}
                  </span>
                  {d.status === "ACTIVE" && canClinical && (
                    <form action={removeDevice.bind(null, id, d.id)} className="no-print">
                      <button className="btn ghost gw-mini" type="submit">
                        Mark removed
                      </button>
                    </form>
                  )}
                </div>
                <p className="muted">
                  {[d.manufacturer, d.model ? `Model ${d.model}` : null, d.lotNumber ? `Lot ${d.lotNumber}` : null, d.serialNumber ? `Serial ${d.serialNumber}` : null, d.udi ? `UDI ${d.udi}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {d.notes && <p>{d.notes}</p>}
              </li>
            ))}
            {devices.length === 0 && <li className="muted">No implantable devices recorded.</li>}
          </ul>
        </section>
      </div>

      {/* ---------------- Goals ---------------- */}
      <section className="panel">
        <div className="gw-section-head">
          <h2>Goals and what we are doing to reach them</h2>
        </div>
        {canClinical && (
          <details className="pv-add no-print">
            <summary className="btn secondary gw-mini">+ Add a goal</summary>
            <form action={addGoal.bind(null, id)} className="form-grid gw-grid-3">
              <label className="pv-wide">
                Goal
                <input name="goal" required maxLength={400} placeholder="e.g. Wound area reduced by 50% in 4 weeks" />
              </label>
              <label>
                Whose goal
                <select name="kind" defaultValue="PROVIDER">
                  {Object.entries(goalKindLabel).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                For health concern
                <select name="concernId" defaultValue="">
                  <option value="">—</option>
                  {activeConcerns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.concern.slice(0, 70)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Target date
                <input type="date" name="targetDate" />
              </label>
              <label className="pv-wide">
                Interventions (what the team and the patient will do)
                <textarea name="interventions" rows={2} maxLength={1000} placeholder="e.g. Weekly debridement, offloading boot, dietitian referral" />
              </label>
              <div className="pv-actions">
                <button className="btn" type="submit">
                  Add goal
                </button>
              </div>
            </form>
          </details>
        )}
        <ul className="pv-items">
          {goals.map((g) => {
            const overdue = g.status === "ACTIVE" && g.targetDate && g.targetDate.getTime() < Date.now();
            return (
              <li key={g.id}>
                <div className="pv-item-head">
                  <strong>{g.goal}</strong>
                  <span className={`gw-tag gw-tag-${goalStatusTone[g.status] ?? "muted"}`}>{goalStatusLabel[g.status] ?? g.status}</span>
                  {g.kind === "PATIENT" && <span className="gw-tag gw-tag-muted">Patient&apos;s own goal</span>}
                  {g.targetDate && <span className={`gw-tag gw-tag-${overdue ? "bad" : "muted"}`}>{overdue ? `Target passed ${formatDate(g.targetDate)}` : `Target ${formatDate(g.targetDate)}`}</span>}
                </div>
                {g.concern && <p className="muted">For: {g.concern.concern}</p>}
                {g.interventions && <p>Interventions: {g.interventions}</p>}
                {g.progressNote && <p className="pv-quote">Progress: {g.progressNote}</p>}
                {canClinical && (
                  <form action={updateGoal.bind(null, id, g.id)} className="pv-inline no-print">
                    <select name="status" defaultValue={g.status} aria-label="Goal status">
                      {Object.entries(goalStatusLabel).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <input name="progressNote" placeholder="Progress note" maxLength={1000} aria-label="Progress note" />
                    <button className="btn secondary gw-mini" type="submit">
                      Update
                    </button>
                  </form>
                )}
              </li>
            );
          })}
          {goals.length === 0 && <li className="muted">No goals set.</li>}
        </ul>
      </section>

      {/* ---------------- Social needs screening ---------------- */}
      <section className="panel">
        <div className="gw-section-head">
          <h2>Social needs screening</h2>
          <span className="muted">
            {latest ? `Last screened ${formatDate(latest.screenedAt)}${latest.screenedById ? ` by ${screeners.get(latest.screenedById) ?? "staff"}` : ""}` : "Never screened"}
          </span>
        </div>
        {latest && (
          <p>
            {latest.declined ? (
              <span className="gw-tag gw-tag-muted">Patient declined</span>
            ) : latestNeeds.length ? (
              latestNeeds.map((n) => (
                <span key={n} className="gw-tag gw-tag-warn">
                  {sdohDomainLabel[n] ?? n}
                </span>
              ))
            ) : (
              <span className="gw-tag gw-tag-ok">No needs found</span>
            )}
            {latest.notes ? <span className="muted"> {latest.notes}</span> : null}
          </p>
        )}
        {canTeam && (
          <details className="pv-add no-print" open={sp.screen === "1"}>
            <summary className="btn secondary gw-mini">+ New screening</summary>
            <form action={saveSdohScreening.bind(null, id)} className="sd-form">
              {SDOH_QUESTIONS.map((q, i) => (
                <fieldset key={q.key}>
                  <legend>
                    {i + 1}. {q.text}
                  </legend>
                  {q.options.map((o) => (
                    <label key={o.code} className="cm-check">
                      <input type="radio" name={`q_${q.key}`} value={o.code} />
                      {o.label}
                    </label>
                  ))}
                </fieldset>
              ))}
              <div className="form-grid">
                <label>
                  At visit (optional)
                  <select name="encounterId" defaultValue="">
                    <option value="">—</option>
                    {visits.map((v) => (
                      <option key={v.id} value={v.id}>
                        {formatDate(v.date)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Notes / referrals made
                  <input name="notes" maxLength={800} placeholder="e.g. Referred to social worker for transport" />
                </label>
              </div>
              <div className="pv-actions">
                <label className="cm-check">
                  <input type="checkbox" name="declined" />
                  Patient declined to answer
                </label>
                <button className="btn" type="submit">
                  Save screening
                </button>
              </div>
            </form>
          </details>
        )}
        {screenings.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Needs found</th>
                <th>Answers</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {screenings.map((s) => {
                const answers = parseSdohAnswers(s.answers);
                const flagged = SDOH_QUESTIONS.filter((q) => q.options.find((o) => o.code === answers[q.key])?.need);
                return (
                  <tr key={s.id}>
                    <td>{formatDate(s.screenedAt)}</td>
                    <td>
                      {s.declined
                        ? "Declined"
                        : s.needs
                          ? s.needs
                              .split(",")
                              .map((n) => sdohDomainLabel[n] ?? n)
                              .join(", ")
                          : "None"}
                    </td>
                    <td className="cm-detail">
                      {flagged.map((q) => (
                        <div key={q.key}>
                          {q.text} <strong>{q.options.find((o) => o.code === answers[q.key])?.label}</strong>
                        </div>
                      ))}
                      {s.notes ? <div className="muted">{s.notes}</div> : null}
                      {!s.declined && flagged.length === 0 && !s.notes ? `${Object.keys(answers).length} of ${SDOH_QUESTIONS.length} answered` : null}
                    </td>
                    <td>{s.screenedById ? (screeners.get(s.screenedById) ?? "—") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </PatientShell>
  );
}
