import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { BULK_RELEASE_EVENT, PAPER_CLAIM_EVENT, releaseOutcomeLabel } from "@/lib/claim-submit";
import { claimNumber, claimStatusLabel } from "@/lib/claim-format";
import { formatDate, formatTime, patientName } from "@/lib/format";
import { BillingTabs, ClaimsMenu } from "../../../tabs";

const LIST_LIMIT = 500;
const TONE: Record<string, string> = { RELEASED: "ok", REJECTED: "bad", ERROR: "warn", BLOCKED: "warn" };
type Search = { batch?: string; result?: string; date?: string; kind?: string };

// What happened to each claim in a bulk release (or paper) batch: sent, rejected, or left behind and why.
export default async function BulkReleaseStatusPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const sp = await searchParams;
  const result = sp.result && sp.result in releaseOutcomeLabel ? sp.result : "";
  const batch = sp.batch && /^(RB|PB)-\d{6}-[0-9A-F]{4}$/.test(sp.batch) ? sp.batch : "";
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : "";
  const kind = sp.kind === "PAPER" || sp.kind === "EDI" ? sp.kind : "";
  const actions = kind === "PAPER" ? [PAPER_CLAIM_EVENT] : kind === "EDI" ? [BULK_RELEASE_EVENT] : [BULK_RELEASE_EVENT, PAPER_CLAIM_EVENT];
  const mine = { action: { in: [BULK_RELEASE_EVENT, PAPER_CLAIM_EVENT] }, claim: { practiceId: user.practiceId } };

  const [events, recent] = await Promise.all([
    prisma.claimEvent.findMany({
      where: {
        action: { in: actions },
        claim: { practiceId: user.practiceId },
        ...(batch ? { field: batch } : {}),
        ...(result ? { newValue: result } : {}),
        ...(date ? { createdAt: { gte: new Date(`${date}T00:00:00`), lte: new Date(`${date}T23:59:59`) } } : {}),
      },
      include: {
        user: { select: { name: true } },
        claim: {
          select: {
            id: true,
            createdAt: true,
            status: true,
            payerName: true,
            patient: { select: { firstName: true, lastName: true } },
            lines: { select: { dosFrom: true }, orderBy: { lineNumber: "asc" }, take: 1 },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: LIST_LIMIT,
    }),
    // The batch picker: the latest batches, newest first.
    prisma.claimEvent.findMany({ where: mine, select: { field: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 2000 }),
  ]);
  const batches = [...new Map(recent.filter((e) => e.field).map((e) => [e.field!, e.createdAt])).entries()].slice(0, 40);
  const count = (o: string) => events.filter((e) => e.newValue === o).length;
  const filtered = Boolean(batch || result || date || kind);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/billing">Revenue cycle</Link>
          </p>
          <h1>Billing batch status</h1>
        </div>
        <Link className="btn" href="/billing/claims/release">
          Bulk release claims
        </Link>
      </div>
      <BillingTabs active="claims" />
      <ClaimsMenu active="status" />

      <section className="grid-stats cd-tiles cm-tiles">
        <div className="stat">
          <span>{batch ? `Batch ${batch}` : "Claims listed"}</span>
          <strong>{events.length}</strong>
        </div>
        <div className="stat">
          <span>Released</span>
          <strong>{count("RELEASED")}</strong>
        </div>
        <div className="stat">
          <span>Rejected by clearinghouse</span>
          <strong className={count("REJECTED") ? "cd-bad" : undefined}>{count("REJECTED")}</strong>
        </div>
        <div className="stat">
          <span>Not released</span>
          <strong className={count("BLOCKED") + count("ERROR") ? "cd-warn" : undefined}>{count("BLOCKED") + count("ERROR")}</strong>
        </div>
      </section>

      <form method="get" className="panel cm-bar">
        <label>
          Release status
          <select name="result" defaultValue={result}>
            <option value="">All</option>
            {Object.entries(releaseOutcomeLabel).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Release date
          <input type="date" name="date" defaultValue={date} />
        </label>
        <label>
          Release batch
          <select name="batch" defaultValue={batch}>
            <option value="">All batches</option>
            {batches.map(([id, at]) => (
              <option key={id} value={id}>
                {id} · {formatDate(at)} {formatTime(at)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sent by
          <select name="kind" defaultValue={kind}>
            <option value="">Electronic and paper</option>
            <option value="EDI">Electronic (clearinghouse)</option>
            <option value="PAPER">Paper (CMS-1500)</option>
          </select>
        </label>
        <button className="btn" type="submit">
          Search
        </button>
        {filtered && (
          <Link className="btn ghost" href="/billing/claims/release/status">
            Clear
          </Link>
        )}
      </form>

      <section className="panel cd-list">
        <div className="cd-scroll">
          <table>
            <thead>
              <tr>
                <th>Claim #</th>
                <th>Release batch</th>
                <th>Patient</th>
                <th>Date of service</th>
                <th>Released</th>
                <th>Release status</th>
                <th>Claim status now</th>
                <th>Errors / details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/billing/claims/${e.claim.id}`}>{claimNumber(e.claim)}</Link>
                  </td>
                  <td>
                    <Link href={`/billing/claims/release/status?batch=${e.field}`}>{e.field}</Link>
                    {e.action === PAPER_CLAIM_EVENT && <span className="gw-tag gw-tag-muted">Paper</span>}
                  </td>
                  <td>{patientName(e.claim.patient)}</td>
                  <td>{e.claim.lines[0] ? formatDate(e.claim.lines[0].dosFrom) : "—"}</td>
                  <td>
                    {formatDate(e.createdAt)} {formatTime(e.createdAt)}
                    <span className="muted"> · {e.user?.name ?? "System"}</span>
                  </td>
                  <td>
                    <span className={`gw-tag gw-tag-${TONE[e.newValue ?? ""] ?? "muted"}`}>{releaseOutcomeLabel[e.newValue ?? ""] ?? e.newValue}</span>
                  </td>
                  <td>{claimStatusLabel[e.claim.status] ?? e.claim.status}</td>
                  <td className={e.newValue === "RELEASED" ? "muted" : "cm-detail"}>{e.note ?? ""}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {filtered ? "Nothing matches these filters." : "No claims have been released in bulk yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {events.length === LIST_LIMIT && <p className="muted">Showing the latest {LIST_LIMIT}. Pick a batch or a date to see older ones.</p>}
      </section>
    </>
  );
}
