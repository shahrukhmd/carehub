import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { IMPORT_FIELDS, type ImportRow } from "@/lib/patient-import";
import { SettingsNav } from "../settings-nav";
import { discardImport, remapImport, runImport, undoImportBatch, uploadImport } from "./actions";

type Search = { batch?: string; error?: string; imported?: string; undone?: string; kept?: string; show?: string };

const STATUS: Record<string, [string, string]> = { READY: ["Will import", "ok"], DUPLICATE: ["Skip — duplicate", "warn"], ERROR: ["Can't import", "bad"], IMPORTED: ["Imported", "ok"] };

export default async function PatientImportPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("settings.admin"));
  const sp = await searchParams;
  const [batch, history] = await Promise.all([
    sp.batch ? prisma.importBatch.findFirst({ where: { id: sp.batch, practiceId: user.practiceId } }) : null,
    prisma.importBatch.findMany({ where: { practiceId: user.practiceId, status: { not: "PREVIEW" } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const saved = batch ? (JSON.parse(batch.mapping) as { headers: string[]; map: Record<string, number> }) : null;
  const rows = batch ? (JSON.parse(batch.rows) as ImportRow[]) : [];
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const shown = rows.filter((r) => !sp.show || r.status === sp.show).slice(0, 300);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Patient import</h1>
        </div>
      </div>
      <SettingsNav current="import" />
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.imported && <p className="notice-ok">{sp.imported} patients imported.</p>}
      {sp.undone && (
        <p className="notice-ok">
          Undo complete — {sp.undone} patients removed{Number(sp.kept) ? `, ${sp.kept} kept because staff already scheduled, charted or attached documents for them` : ""}.
        </p>
      )}
      {!batch && (
        <section className="panel">
          <h2>Upload a patient list</h2>
          <p className="muted">
            Export patients from the old system as a spreadsheet and save it as CSV. CareHub matches the columns (name, date of birth, sex, MRN, phone, email,
            address, primary insurance, member ID, group), checks every row and shows a preview — nothing is saved until you press Import.
          </p>
          <form action={uploadImport} className="cn-inline">
            <input type="file" name="file" accept=".csv,.txt,.tsv,text/csv" required aria-label="CSV file" />
            <button className="btn" type="submit">
              Upload &amp; preview
            </button>
          </form>
          <p className="muted cn-small">
            Insurance is added when the payer name matches your payer directory (Settings → Directories) and a member ID is given. Patients already in CareHub
            (same name and date of birth) are skipped.
          </p>
        </section>
      )}
      {batch && saved && (
        <>
          <section className="grid-stats">
            <div className="stat">
              <span>Rows in {batch.fileName}</span>
              <strong>{rows.length}</strong>
            </div>
            <Link className="stat" href={`/settings/import?batch=${batch.id}&show=READY`}>
              <span>{batch.status === "PREVIEW" ? "Ready to import" : "Imported"}</span>
              <strong>{batch.status === "PREVIEW" ? count("READY") : count("IMPORTED")}</strong>
            </Link>
            <Link className="stat" href={`/settings/import?batch=${batch.id}&show=DUPLICATE`}>
              <span>Duplicates (skipped)</span>
              <strong>{count("DUPLICATE")}</strong>
            </Link>
            <Link className="stat" href={`/settings/import?batch=${batch.id}&show=ERROR`}>
              <span>Errors</span>
              <strong>{count("ERROR")}</strong>
            </Link>
          </section>
          {batch.status === "PREVIEW" && (
            <section className="panel">
              <h2>Column mapping</h2>
              <form action={remapImport.bind(null, batch.id)} className="im-map">
                {IMPORT_FIELDS.map((f) => (
                  <label key={f.key}>
                    {f.label}
                    {f.required ? " *" : ""}
                    <select name={`map_${f.key}`} defaultValue={saved.map[f.key] !== undefined ? String(saved.map[f.key]) : ""}>
                      <option value="">— not in file —</option>
                      {saved.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label>
                  Full name (&quot;Last, First&quot;) in one column
                  <select name="map_fullName" defaultValue={saved.map.fullName !== undefined ? String(saved.map.fullName) : ""}>
                    <option value="">—</option>
                    {saved.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn secondary" type="submit">
                  Re-check with this mapping
                </button>
              </form>
            </section>
          )}
          <section className="panel">
            <div className="cn-head">
              <h2>Preview {sp.show ? `— ${STATUS[sp.show]?.[0] ?? ""}` : ""}</h2>
              {sp.show && (
                <Link className="muted" href={`/settings/import?batch=${batch.id}`}>
                  Show all
                </Link>
              )}
            </div>
            <div className="table-scroll">
              <table className="cn-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Patient</th>
                    <th>DOB</th>
                    <th>Contact</th>
                    <th>Insurance</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const [label, tone] = STATUS[r.status] ?? [r.status, "info"];
                    return (
                      <tr key={r.line}>
                        <td>{r.line}</td>
                        <td>
                          {r.values.lastName}, {r.values.firstName}
                          <div className="muted cn-small">
                            {r.values.sex} {r.values.mrn ? `· ${r.values.mrn}` : ""}
                          </div>
                        </td>
                        <td>{r.values.dob}</td>
                        <td className="cn-small">{[r.values.phone, r.values.email, [r.values.city, r.values.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</td>
                        <td className="cn-small">{r.values.payer ? `${r.values.payer} ${r.values.memberId}` : "—"}</td>
                        <td>
                          <span className={`gw-tag gw-tag-${tone}`}>{label}</span>
                          {r.issues.length > 0 && <div className="muted cn-small">{r.issues.join(" · ")}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > shown.length && <p className="muted cn-small">Showing the first {shown.length} rows.</p>}
          </section>
          {batch.status === "PREVIEW" && (
            <section className="panel">
              <form action={runImport.bind(null, batch.id)} className="cn-inline">
                <label className="checkbox-inline">
                  <input type="checkbox" name="confirm" /> Import {count("READY")} patients
                </label>
                <button className="btn" type="submit" disabled={!count("READY")}>
                  Import
                </button>
              </form>
              <form action={discardImport.bind(null, batch.id)} style={{ marginTop: "0.5rem" }}>
                <button className="btn ghost gw-mini" type="submit">
                  Discard this file
                </button>
              </form>
            </section>
          )}
        </>
      )}
      {history.length > 0 && (
        <section className="panel">
          <h2>Import history</h2>
          <table className="cn-table">
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{formatDate(h.importedAt ?? h.createdAt)}</td>
                  <td>
                    <Link href={`/settings/import?batch=${h.id}`}>{h.fileName}</Link>
                  </td>
                  <td>
                    {h.createdCount} imported · {h.skippedCount} skipped
                  </td>
                  <td>{h.status === "UNDONE" ? <span className="muted">Undone</span> : "Imported"}</td>
                  <td>
                    {h.status === "IMPORTED" && (
                      <form action={undoImportBatch.bind(null, h.id)}>
                        <button className="btn ghost gw-mini" type="submit">
                          Undo
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
