import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { codeSetLabel, codeSetSource, searchMasterCodes, type CodeSet } from "@/lib/master-codes";
import { SettingsNav } from "../settings-nav";
import Link from "next/link";
import { SelectAll } from "@/components/SelectAll";
import { formatMoney } from "@/lib/format";
import { addCodesToSchedule, importCptFile, refreshCodeSet } from "./actions";

type Search = { ok?: string; error?: string; q?: string; set?: string; added?: string };

const SETS: CodeSet[] = ["ICD10", "HCPCS", "CPT"];

export default async function CodeLibraryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(["ADMIN", "BILLER", "CDS", "CODER"]);
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
  // Search pressed with nothing typed lists the chosen set from the start, so it never looks broken.
  const searched = sp.q !== undefined || Boolean(only);
  const LIMIT = 100;
  const hits = searched ? await searchMasterCodes(q, only ? [only] : SETS, LIMIT) : [];
  const loaded = stats.filter((s) => (only ? s.set === only : true)).reduce((n, s) => n + s.total, 0);

  // Charge schedules the ticked codes can go onto, and where each code shown already is (with its fee there).
  const canAdd = ["ADMIN", "BILLER"].includes(user.role);
  const schedules = await prisma.chargeSchedule.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const billingHits = hits.filter((h) => h.codeSet !== "ICD10" && h.billable).map((h) => h.code);
  const placed = billingHits.length
    ? await prisma.chargeScheduleItem.findMany({ where: { code: { in: billingHits }, schedule: { practiceId: user.practiceId } }, select: { code: true, feeCents: true, scheduleId: true, schedule: { select: { name: true } } } })
    : [];
  const onSchedules = (code: string) => placed.filter((p) => p.code === code);
  const pickable = canAdd && schedules.length > 0 && billingHits.length > 0;
  const addedTo = schedules.find((s) => s.id === sp.added);

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
      {sp.ok && (
        <p className="notice-ok">
          {sp.ok}{" "}
          {addedTo && (
            <Link href={`/settings/charge-schedules/${addedTo.id}?fees=0`}>
              <strong>Open {addedTo.name} to enter the fees »</strong>
            </Link>
          )}
        </p>
      )}
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

      <section className="panel" id="lookup">
        <div className="gw-section-head">
          <h2>Look up a code</h2>
          <span className="muted">Tick billing codes in the results to add them to a charge schedule</span>
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
        {searched && (
          <p className="muted" style={{ marginTop: "0.6rem" }}>
            {loaded === 0
              ? `${only ? codeSetLabel[only] : "No code set"} ${only ? "are" : "is"} not loaded yet — use the button in the box above.`
              : q
                ? `${hits.length === LIMIT ? `First ${LIMIT}` : hits.length} match${hits.length === 1 ? "" : "es"} for “${q}”${hits.length === LIMIT ? " — add a word to narrow it down" : ""}.`
                : `Showing the first ${hits.length} ${only ? codeSetLabel[only] : "codes"} in code order. Type a code or words to find a particular one.`}
          </p>
        )}
        {searched && loaded > 0 && (
          <form action={addCodesToSchedule}>
          <input type="hidden" name="q" value={q} />
          <input type="hidden" name="set" value={only ?? ""} />
          {pickable && (
            <div className="cl-addbar">
              <SelectAll name="pick" noun="code" />
              <span>Add the ticked codes to</span>
              <select name="scheduleId" required defaultValue={addedTo?.id ?? (schedules.length === 1 ? schedules[0].id : "")} aria-label="Charge schedule">
                {schedules.length > 1 && <option value="">— choose a charge schedule —</option>}
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button className="btn" type="submit">
                Add to charge schedule
              </button>
              <span className="muted">Codes go on with no fee; enter the fee on the schedule afterwards.</span>
            </div>
          )}
          {canAdd && schedules.length === 0 && billingHits.length > 0 && (
            <p className="muted">
              There is no charge schedule yet. <Link href="/settings/charge-schedules">Create one</Link>, then tick codes here to add them.
            </p>
          )}
          {canAdd && hits.length > 0 && billingHits.length === 0 && <p className="muted">Diagnosis codes are chosen on the visit, not priced, so they are not added to charge schedules. Search HCPCS or CPT codes to add billing codes.</p>}
          <table className="ws-table" style={{ marginTop: "0.3rem" }}>
            <thead>
              <tr>
                {pickable && <th aria-label="Select" />}
                <th>Code</th>
                <th>Description</th>
                <th>Set</th>
                <th>On charge schedules</th>
              </tr>
            </thead>
            <tbody>
              {hits.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No code matches “{q}”. Try fewer or different words, or the start of the code.
                  </td>
                </tr>
              )}
              {hits.map((h) => (
                <tr key={`${h.codeSet}-${h.code}`}>
                  {pickable && (
                    <td style={{ width: "1%" }}>
                      {h.codeSet !== "ICD10" && h.billable && <input type="checkbox" name="pick" value={`${h.codeSet}|${h.code}`} aria-label={`Select ${h.code}`} />}
                    </td>
                  )}
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
                  <td>
                    {h.codeSet === "ICD10" ? (
                      <span className="muted">—</span>
                    ) : onSchedules(h.code).length === 0 ? (
                      <span className="muted">Not on any</span>
                    ) : (
                      onSchedules(h.code).map((p) => (
                        <div key={p.scheduleId}>
                          <Link href={`/settings/charge-schedules/${p.scheduleId}?q=${h.code}`}>{p.schedule.name}</Link>{" "}
                          <span className={`gw-tag gw-tag-${p.feeCents > 0 ? "ok" : "warn"}`}>{p.feeCents > 0 ? formatMoney(p.feeCents) : "Fee not set"}</span>
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </form>
        )}
      </section>
    </div>
  );
}
