import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { codeSetLabel, codeSetSource, searchMasterCodes, type CodeSet } from "@/lib/master-codes";
import { SettingsNav } from "../settings-nav";
import { importCptFile, refreshCodeSet } from "./actions";

type Search = { ok?: string; error?: string; q?: string; set?: string };

const SETS: CodeSet[] = ["ICD10", "HCPCS", "CPT"];

export default async function CodeLibraryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(["ADMIN", "BILLER", "CDS"]);
  const sp = await searchParams;
  const admin = user.role === "ADMIN";
  const stats = await Promise.all(
    SETS.map(async (set) => {
      const [total, billable, newest] = await Promise.all([
        prisma.masterCode.count({ where: { codeSet: set } }),
        prisma.masterCode.count({ where: { codeSet: set, billable: true } }),
        prisma.masterCode.findFirst({ where: { codeSet: set }, orderBy: { loadedAt: "desc" }, select: { loadedAt: true, edition: true } }),
      ]);
      return { set, total, billable, newest };
    })
  );
  const q = sp.q?.trim() ?? "";
  const only = SETS.find((s) => s === sp.set);
  const hits = q ? await searchMasterCodes(q, only ? [only] : SETS, 60) : [];

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Settings · Providers, insurance &amp; fees</p>
          <h1>Code library</h1>
        </div>
      </div>
      <SettingsNav current="code-library" role={user.role} />
      <p className="muted">
        Every diagnosis and billing code, held once for all practices. Charge schedules, the superbill and the practice code list pick from it, so nobody types a code or its description by hand.
      </p>
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}

      <div className="st-cards">
        {stats.map(({ set, total, billable, newest }) => (
          <section key={set} className="panel" style={{ display: "grid", gap: "0.5rem", alignContent: "start" }}>
            <div className="gw-section-head">
              <h2>{codeSetLabel[set]}</h2>
              <span className={`gw-tag gw-tag-${total ? "ok" : "warn"}`}>{total ? (newest?.edition ?? "Loaded") : "Not loaded"}</span>
            </div>
            <p className="muted">
              {total
                ? `${total.toLocaleString("en-US")} codes${set === "ICD10" ? ` (${billable.toLocaleString("en-US")} billable, the rest are category headings)` : ""} · loaded ${newest ? formatDate(newest.loadedAt) : ""}`
                : "None loaded yet."}
              <br />
              Source: {codeSetSource[set]}
            </p>
            {admin && set !== "CPT" && (
              <form action={refreshCodeSet.bind(null, set as "ICD10" | "HCPCS")}>
                <button className="btn secondary" type="submit">
                  {total ? "Check for a new edition and update" : "Fetch the current edition"}
                </button>
                <p className="muted" style={{ marginTop: "0.4rem" }}>
                  {set === "ICD10" ? "A new edition takes effect every October 1. Fetching takes up to a minute." : "CMS publishes this file every quarter (January, April, July, October)."}
                </p>
              </form>
            )}
            {admin && set === "CPT" && (
              <form action={importCptFile} style={{ display: "grid", gap: "0.45rem" }}>
                <p className="muted">
                  CPT codes and descriptions belong to the American Medical Association and cannot be fetched freely. Load the file you receive under your AMA licence (Excel or CSV with a code
                  column and a description column).
                </p>
                <input type="file" name="file" accept=".xlsx,.csv,.txt,.tsv" required />
                <input name="edition" placeholder="Edition, e.g. CPT 2027" maxLength={40} />
                <label className="checkbox-inline">
                  <input type="checkbox" name="licensed" required /> The practice holds an AMA licence covering this file.
                </label>
                <button className="btn secondary" type="submit">
                  {total ? "Replace the CPT codes" : "Load the CPT codes"}
                </button>
              </form>
            )}
          </section>
        ))}
      </div>

      <section className="panel">
        <div className="gw-section-head">
          <h2>Look up a code</h2>
        </div>
        <form method="get" className="pv-inline">
          <input name="q" defaultValue={q} placeholder="Code or words — e.g. L97.4, pressure ulcer heel, A6212, alginate" aria-label="Search codes" style={{ flex: 1 }} />
          <select name="set" defaultValue={only ?? ""} aria-label="Code set">
            <option value="">All code sets</option>
            {SETS.map((s) => (
              <option key={s} value={s}>
                {codeSetLabel[s]}
              </option>
            ))}
          </select>
          <button className="btn secondary" type="submit">
            Search
          </button>
        </form>
        {q && (
          <table className="ws-table" style={{ marginTop: "0.6rem" }}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th>Set</th>
              </tr>
            </thead>
            <tbody>
              {hits.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No code matches “{q}”.
                  </td>
                </tr>
              )}
              {hits.map((h) => (
                <tr key={`${h.codeSet}-${h.code}`}>
                  <td>
                    <strong>{h.code}</strong>
                    {!h.billable && (
                      <div>
                        <span className="gw-tag gw-tag-muted">Heading — not billable</span>
                      </div>
                    )}
                  </td>
                  <td>{h.description}</td>
                  <td>{h.codeSet === "ICD10" ? "ICD-10-CM" : h.codeSet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
