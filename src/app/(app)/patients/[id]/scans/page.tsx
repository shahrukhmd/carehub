import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDate, formatTime } from "@/lib/format";

import { SCAN_GROUPS } from "@/lib/patient-docs";
import { PatientShell, loadPatientShell } from "../patient-shell";
import { addScans, deleteScan, updateScan } from "./actions";

type Search = { q?: string; add?: string; edit?: string; error?: string; ok?: string };

export default async function PatientScansPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("patients.scans"));
  const { id } = await params;
  const sp = await searchParams;
  const shell = await loadPatientShell(id, user);
  const q = sp.q?.trim();

  const [scans, visits] = await Promise.all([
    prisma.patientDocument.findMany({
      where: { patientId: id, practiceId: user.practiceId, ...(q ? { name: { contains: q } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.encounter.findMany({ where: { patientId: id, practiceId: user.practiceId }, orderBy: { date: "desc" }, take: 100, include: { provider: { select: { name: true } } } }),
  ]);
  const visitLabel = (v: (typeof visits)[number]) => `${formatDate(v.date)} · ${v.provider.name}`;
  const groups = Object.keys(SCAN_GROUPS)
    .map((g) => ({ g, rows: scans.filter((s) => (s.docType in SCAN_GROUPS ? s.docType : "OTHER") === g) }))
    .filter((x) => x.rows.length > 0);

  const VisitSelect = ({ value }: { value: string | null }) => (
    <select name="encounterId" defaultValue={value ?? ""}>
      <option value="" />
      {visits.map((v) => (
        <option key={v.id} value={v.id}>
          {visitLabel(v)}
        </option>
      ))}
    </select>
  );
  const GroupSelect = ({ value }: { value: string }) => (
    <select name="group" defaultValue={value in SCAN_GROUPS ? value : "OTHER"}>
      {Object.entries(SCAN_GROUPS).map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <PatientShell data={shell}>
      <p className="pd-back">
        <Link href={`/patients/${id}`}>« Back to dashboard</Link>
      </p>
      <div className="pd-head">
        <h1>Scans</h1>
        <Link className="btn" href={`/patients/${id}/scans?add=1`}>
          + Add item
        </Link>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}

      {sp.add === "1" && (
        <section className="panel">
          <h2>Add scans</h2>
          <form action={addScans.bind(null, id)} className="form-grid reg-narrow">
            <label>
              Group
              <GroupSelect value="OTHER" />
            </label>
            <label>
              Associated visit (optional)
              <VisitSelect value={null} />
            </label>
            <label className="reg-wide">
              Title (optional — the file name is used when left blank or when adding several files)
              <input name="title" maxLength={160} />
            </label>
            <label className="reg-wide scan-drop">
              Upload scan file — PDF, PNG, JPG, DOC or DOCX, up to 10 MB each
              <input type="file" name="files" multiple required accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" />
            </label>
            <div className="form-actions reg-wide">
              <Link className="btn ghost" href={`/patients/${id}/scans`}>
                Cancel
              </Link>
              <button className="btn" type="submit">
                Add
              </button>
            </div>
          </form>
        </section>
      )}

      <form method="get" className="cn-inline">
        <label>
          Title search
          <input name="q" defaultValue={q} placeholder="Search here" />
        </label>
        <button className="btn secondary" type="submit">
          Search
        </button>
        {q && (
          <Link className="btn ghost" href={`/patients/${id}/scans`}>
            Clear
          </Link>
        )}
      </form>

      <section className="panel gw-table">
        <table className="scan-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Date and time uploaded</th>
              <th>Associated visit</th>
              <th>Actions</th>
            </tr>
          </thead>
          {groups.map(({ g, rows }) => (
            <tbody key={g}>
              <tr className="scan-group">
                <th colSpan={4}>
                  {SCAN_GROUPS[g]} <span className="muted">({rows.length})</span>
                </th>
              </tr>
              {rows.map((s) => {
                const visit = visits.find((v) => v.id === s.encounterId);
                return sp.edit === s.id ? (
                  <tr key={s.id}>
                    <td colSpan={4}>
                      <form action={updateScan.bind(null, id, s.id)} className="form-grid gw-grid-3">
                        <label>
                          Title
                          <input name="name" defaultValue={s.name} required maxLength={160} />
                        </label>
                        <label>
                          Group
                          <GroupSelect value={s.docType} />
                        </label>
                        <label>
                          Associated visit
                          <VisitSelect value={s.encounterId} />
                        </label>
                        <div className="form-actions gw-span-3">
                          <Link className="btn ghost" href={`/patients/${id}/scans`}>
                            Cancel
                          </Link>
                          <button className="btn" type="submit">
                            Save
                          </button>
                        </div>
                      </form>
                      <form action={deleteScan.bind(null, id, s.id)}>
                        <button className="btn ghost gw-mini" type="submit">
                          Delete this scan
                        </button>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id}>
                    <td>
                      <a href={`/api/files/patientdoc/${s.id}`} target="_blank" rel="noopener">
                        {s.name}
                      </a>
                      {s.status === "PROCESSING" && <span className="muted"> · reading…</span>}
                    </td>
                    <td>
                      {formatDate(s.createdAt)} {formatTime(s.createdAt)}
                    </td>
                    <td>{visit ? <Link href={`/encounters/${visit.id}`}>{visitLabel(visit)}</Link> : ""}</td>
                    <td>
                      <Link className="btn ghost gw-mini" href={`/patients/${id}/scans?edit=${s.id}`} aria-label={`Edit ${s.name}`}>
                        ✎ Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
          {groups.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={4} className="muted">
                  {q ? "No scans match that title." : "No scans yet — use “Add item” to upload one."}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </section>
    </PatientShell>
  );
}
