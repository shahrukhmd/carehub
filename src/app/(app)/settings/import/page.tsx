import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { FIELDS, IMPORT_KINDS, migrationProgress, type ImportKind, type Row } from "@/lib/import-kinds";
import { SettingsNav } from "../settings-nav";
import { discardImport, remapImport, runImport, undoImportBatch, uploadImport } from "./actions";

type Search = { batch?: string; kind?: string; error?: string; imported?: string; undone?: string; kept?: string; show?: string };

const STATUS: Record<string, [string, string]> = {
  READY: ["Will import", "ok"],
  MATCHED: ["Matched", "ok"],
  NEEDS_REVIEW: ["Check the match", "warn"],
  DUPLICATE: ["Skip — duplicate", "warn"],
  ERROR: ["Can't import", "bad"],
  IMPORTED: ["Imported", "ok"],
};
const kindOf = (v: string | null | undefined): ImportKind => (v && v in IMPORT_KINDS ? (v as ImportKind) : "PATIENTS");

// Import & migration: upload any CSV or workbook for a kind of data, map the columns (remembered next time),
// dry-run validate, review, commit, undo. The toolkit at the top is the onboarding order for a new client.
export default async function ImportPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("settings.admin"));
  const sp = await searchParams;
  const [batch, history, progress] = await Promise.all([
    sp.batch ? prisma.importBatch.findFirst({ where: { id: sp.batch, practiceId: user.practiceId } }) : null,
    prisma.importBatch.findMany({ where: { practiceId: user.practiceId, status: { not: "PREVIEW" } }, orderBy: { createdAt: "desc" }, take: 25 }),
    migrationProgress(user.practiceId),
  ]);
  const kind = kindOf(batch?.kind ?? sp.kind);
  const fields = FIELDS[kind];
  const saved = batch ? (JSON.parse(batch.mapping) as { headers: string[]; map: Record<string, number>; savedName?: string | null }) : null;
  const rows = batch ? (JSON.parse(batch.rows) as Row[]) : [];
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const shown = rows.filter((r) => !sp.show || r.status === sp.show).slice(0, 300);
  const previewCols = fields.filter((f) => rows.some((r) => r.values[f.key])).slice(0, 8);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Import &amp; migration</h1>
        </div>
      </div>
      <SettingsNav current="import" />
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.imported && <p className="notice-ok">{sp.imported} records imported.</p>}
      {sp.undone && (
        <p className="notice-ok">
          Undo complete — {sp.undone} records removed{Number(sp.kept) ? `, ${sp.kept} kept because they are already in use` : ""}.
        </p>
      )}

      {!batch && (
        <>
          <section className="panel">
            <h2>Onboarding toolkit</h2>
            <p className="muted">Bring a new client over in this order. Every step is a file with the same validate → review → commit → undo controls.</p>
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>What</th>
                  <th>In CareHub now</th>
                  <th>Files imported</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(Object.entries(IMPORT_KINDS) as [ImportKind, (typeof IMPORT_KINDS)[ImportKind]][]).map(([k, meta]) => (
                  <tr key={k}>
                    <td>{meta.step}</td>
                    <td>
                      <strong>{meta.label}</strong>
                      <div className="muted cn-small">{meta.about}</div>
                    </td>
                    <td>{progress[k].count}</td>
                    <td>{progress[k].batches}</td>
                    <td>
                      <Link className="btn ghost gw-mini" href={`/settings/import?kind=${k}`}>
                        {kind === k ? "Selected" : "Upload"}
                      </Link>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>5</td>
                  <td>
                    <strong>Documents</strong>
                    <div className="muted cn-small">Scanned records from the previous system — add them per patient under Documents, or as a bulk fax/scan drop; a bundle import comes with the document store.</div>
                  </td>
                  <td colSpan={3} className="muted cn-small">
                    Providers, sites, payers and the clearinghouse are set up under Directories and Practice setup; credentialing and payer enrollment under Credentialing. The{" "}
                    <Link href="/settings/organization">organization checklist</Link> tracks the whole onboarding.
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
          <section className="panel">
            <h2>Upload: {IMPORT_KINDS[kind].label}</h2>
            <p className="muted">
              {IMPORT_KINDS[kind].about}. Export from the old system as CSV or Excel. CareHub proposes the column mapping (or reuses the one you saved for this file layout), checks every row and shows a preview — nothing is saved until you press Import.
              {kind !== "PATIENTS" ? " Rows match patients by MRN, else by name and date of birth, so import patients first." : ""}
            </p>
            <form action={uploadImport} className="cn-inline">
              <select name="kind" defaultValue={kind} aria-label="Kind of data">
                {(Object.entries(IMPORT_KINDS) as [ImportKind, (typeof IMPORT_KINDS)[ImportKind]][]).map(([k, meta]) => (
                  <option key={k} value={k}>
                    {meta.label}
                  </option>
                ))}
              </select>
              <input type="file" name="file" accept=".csv,.txt,.tsv,.xlsx,text/csv" required aria-label="File" />
              <button className="btn" type="submit">
                Upload &amp; preview
              </button>
            </form>
            <details>
              <summary className="muted cn-small">Columns CareHub looks for in a {IMPORT_KINDS[kind].label.toLowerCase()} file</summary>
              <p className="cn-small">{fields.map((f) => `${f.label}${f.required ? " *" : ""}`).join(" · ")}</p>
            </details>
          </section>
        </>
      )}

      {batch && saved && (
        <>
          <section className="stats">
            <div className="stat">
              <span>
                {IMPORT_KINDS[kind].label} · {batch.fileName}
              </span>
              <strong>{rows.length} rows</strong>
            </div>
            {(["READY", "NEEDS_REVIEW", "DUPLICATE", "ERROR", "IMPORTED"] as const)
              .filter((s) => count(s) > 0 || s === "READY" || s === "ERROR")
              .map((s) => (
                <Link key={s} className="stat" href={`/settings/import?batch=${batch.id}&show=${s}`}>
                  <span>{STATUS[s][0]}</span>
                  <strong>{count(s)}</strong>
                </Link>
              ))}
          </section>
          {batch.status === "PREVIEW" && (
            <section className="panel">
              <h2>Column mapping {saved.savedName ? <span className="muted cn-small">· using saved mapping “{saved.savedName}”</span> : null}</h2>
              <form action={remapImport.bind(null, batch.id)} className="im-map">
                {fields.map((f) => (
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
                {kind === "PATIENTS" && (
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
                )}
                <label className="checkbox-inline">
                  <input type="checkbox" name="remember" defaultChecked /> Remember this mapping for files with these columns
                </label>
                <label>
                  Mapping name
                  <input name="mappingName" placeholder={`${IMPORT_KINDS[kind].label} · ${batch.fileName}`} />
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
                    <th>Line</th>
                    <th>Status</th>
                    {kind !== "PATIENTS" && <th>Patient</th>}
                    {previewCols.map((f) => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.line}>
                      <td>{r.line}</td>
                      <td>
                        <span className={`gw-tag gw-tag-${STATUS[r.status]?.[1] ?? "muted"}`}>{STATUS[r.status]?.[0] ?? r.status}</span>
                      </td>
                      {kind !== "PATIENTS" && <td className="cn-small">{r.refs?.patientName ?? "—"}</td>}
                      {previewCols.map((f) => (
                        <td key={f.key} className="cn-small">
                          {f.key === "billed" || f.key === "paid" || f.key === "adjusted" || f.key === "patientPaid" ? (r.values[f.key] ? `$${(Number(r.values[f.key]) / 100).toFixed(2)}` : "") : f.key === "start" && r.values.start ? new Date(r.values.start).toLocaleString("en-US") : r.values[f.key]}
                        </td>
                      ))}
                      <td className="cn-small muted">{r.issues.join(" · ")}</td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={previewCols.length + 4} className="muted">
                        Nothing in this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {rows.length > 300 && <p className="muted cn-small">Showing the first 300 of {rows.length} rows.</p>}
          </section>
          {batch.status === "PREVIEW" && (
            <section className="panel cn-inline">
              <form action={runImport.bind(null, batch.id)} className="cn-inline">
                <label className="checkbox-inline">
                  <input type="checkbox" name="confirm" /> Import {count("READY") + count("MATCHED") + count("NEEDS_REVIEW")} rows into CareHub (duplicates and errors are skipped)
                </label>
                <button className="btn" type="submit">
                  Import
                </button>
              </form>
              <form action={discardImport.bind(null, batch.id)}>
                <button className="btn ghost" type="submit">
                  Discard this file
                </button>
              </form>
            </section>
          )}
          {batch.status !== "PREVIEW" && (
            <p className="muted">
              <Link href="/settings/import">Back to import</Link>
            </p>
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
                  <td className="cn-small">{IMPORT_KINDS[kindOf(h.kind)].label}</td>
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
