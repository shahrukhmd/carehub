import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { SelectAll } from "@/components/SelectAll";
import { PAPER_STATUS, RELEASABLE_STATUSES, editsFor } from "@/lib/claim-submit";
import { claimNumber, claimStatusLabel, payerRankLabel } from "@/lib/claim-format";
import { formatDate, formatMoney, patientName } from "@/lib/format";
import { BillingTabs, ClaimsMenu } from "../../tabs";
import { createPaperClaims } from "../batch-actions";

const MAX_PAPER_CLAIMS = 75;
const LIST_LIMIT = 300;
const VIEWS: Record<string, string> = {
  AWAITING: "Awaiting printing — payer takes paper only",
  UNSENT: "All unsent claims",
  PRINTED: "Already printed",
};
type Search = { patient?: string; status?: string; payer?: string; claim?: string; batch?: string; printed?: string; skipped?: string; omitPayments?: string; dataOnly?: string; error?: string };

// Paper claims: CMS-1500 forms for the payers that can't be reached through the clearinghouse. Preview prints
// without changing anything; Create marks the claims as sent and keeps the batch for reprinting.
export default async function PaperClaimsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const sp = await searchParams;
  const view = sp.status && sp.status in VIEWS ? sp.status : "AWAITING";
  const claimQuery = sp.claim?.trim().toUpperCase().replace(/^CLM-?/, "") ?? "";
  const batch = sp.batch && /^PB-\d{6}-[0-9A-F]{4}$/.test(sp.batch) ? sp.batch : "";

  const where: Prisma.ClaimWhereInput = {
    practiceId: user.practiceId,
    formType: "CMS1500",
    ...(view === "PRINTED" ? { clearinghouseStatus: PAPER_STATUS, status: { not: "VOID" } } : { status: { in: RELEASABLE_STATUSES } }),
    ...(view === "AWAITING" ? { OR: [{ payerId: null }, { payer: { payerCode: null } }, { payer: { payerCode: "" } }] } : {}),
    ...(sp.payer ? { payerId: sp.payer } : {}),
    ...(sp.patient?.trim() ? { patient: { OR: [{ lastName: { contains: sp.patient.trim() } }, { firstName: { contains: sp.patient.trim() } }, { mrn: { startsWith: sp.patient.trim() } }] } } : {}),
  };
  const [found, payers] = await Promise.all([
    prisma.claim.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        submittedAt: true,
        status: true,
        payerRank: true,
        payerName: true,
        billedCents: true,
        paidCents: true,
        adjustedCents: true,
        patient: { select: { firstName: true, lastName: true, mrn: true } },
        lines: { select: { dosFrom: true }, orderBy: { lineNumber: "asc" }, take: 1 },
      },
      orderBy: view === "PRINTED" ? { submittedAt: "desc" } : [{ patient: { lastName: "asc" } }, { createdAt: "asc" }],
    }),
    prisma.payer.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" }, select: { id: true, name: true, payerCode: true } }),
  ]);
  const matching = claimQuery ? found.filter((c) => claimNumber(c).includes(claimQuery) || c.id.toUpperCase().endsWith(claimQuery)) : found;
  const claims = matching.slice(0, LIST_LIMIT);
  // Errors stop a claim from being created on paper just as they stop an electronic release.
  const edits = view === "PRINTED" ? new Map() : await editsFor(user.practiceId, claims.map((c) => c.id));
  const rows = claims.map((c) => {
    const errors = ((edits.get(c.id) ?? []) as { severity: string; message: string }[]).filter((e) => e.severity === "error");
    return { ...c, errors, balance: c.billedCents - c.paidCents - c.adjustedCents };
  });
  const filtered = Boolean(sp.patient || sp.payer || claimQuery);
  const batchUrl = batch ? `/api/claims/paper?batch=${batch}${sp.omitPayments === "on" ? "&omitPayments=on" : ""}${sp.dataOnly === "on" ? "&dataOnly=on" : ""}` : "";

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/billing">Revenue cycle</Link>
          </p>
          <h1>Create paper claims</h1>
        </div>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {batch && (
        <p className="notice-ok cm-done">
          <span>
            <strong>
              {sp.printed ?? ""} paper claim{sp.printed === "1" ? "" : "s"} created
            </strong>{" "}
            in batch {batch} and marked as submitted.
            {Number(sp.skipped) > 0 && (
              <>
                {" "}
                {sp.skipped} could not be created — <Link href={`/billing/claims/release/status?batch=${batch}`}>see why</Link>.
              </>
            )}
          </span>
          <a className="btn" href={batchUrl} target="_blank" rel="noreferrer">
            Open the CMS-1500 forms to print
          </a>
        </p>
      )}
      <BillingTabs active="claims" />
      <ClaimsMenu active="paper" />

      <form method="get" className="panel cm-bar">
        <label>
          Find patient
          <input name="patient" defaultValue={sp.patient ?? ""} placeholder="Name or MRN" />
        </label>
        <label>
          Status
          <select name="status" defaultValue={view}>
            {Object.entries(VIEWS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Payer
          <select name="payer" defaultValue={sp.payer ?? ""}>
            <option value="">All</option>
            {payers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.payerCode ? "" : " (paper only)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Claim #
          <input name="claim" defaultValue={sp.claim ?? ""} placeholder="e.g. CLM-26ABC123" />
        </label>
        <button className="btn" type="submit">
          Search
        </button>
        {(filtered || view !== "AWAITING") && (
          <Link className="btn ghost" href="/billing/claims/paper">
            Clear
          </Link>
        )}
      </form>

      <form action={createPaperClaims} className="panel cd-list cm-batch">
        <input type="hidden" name="view" value={view} />
        <div className="cd-list-head">
          <strong>
            CMS-1500 (HCFA) · {matching.length} claim{matching.length === 1 ? "" : "s"} — {VIEWS[view].toLowerCase()}
          </strong>
          <SelectAll name="claim" max={MAX_PAPER_CLAIMS} />
        </div>
        <div className="cd-scroll">
          <table>
            <thead>
              <tr>
                <th aria-label="Select" />
                <th>Claim #</th>
                <th>Patient</th>
                <th>Date of service</th>
                <th>Payer</th>
                <th>Date released</th>
                <th className="num">Charges</th>
                <th className="num">Balance</th>
                <th>Status</th>
                <th>Print</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={c.errors.length ? "cm-blocked" : undefined}>
                  <td>
                    <input type="checkbox" name="claim" value={c.id} aria-label={`Print ${claimNumber(c)}`} />
                  </td>
                  <td>
                    <Link href={`/billing/claims/${c.id}`}>{claimNumber(c)}</Link>
                  </td>
                  <td>{patientName(c.patient)}</td>
                  <td>{c.lines[0] ? formatDate(c.lines[0].dosFrom) : "—"}</td>
                  <td>
                    {c.payerName}
                    {c.payerRank !== "PRIMARY" && <span className="muted"> · {payerRankLabel[c.payerRank]}</span>}
                  </td>
                  <td>{c.submittedAt ? formatDate(c.submittedAt) : "—"}</td>
                  <td className="num">{formatMoney(c.billedCents)}</td>
                  <td className="num">{formatMoney(c.balance)}</td>
                  <td>
                    {view === "AWAITING" ? "Awaiting printing" : (claimStatusLabel[c.status] ?? c.status)}
                    {c.errors.length > 0 && (
                      <span className="gw-tag gw-tag-bad" title={c.errors.map((e) => e.message).join("\n")}>
                        {c.errors.length} error{c.errors.length === 1 ? "" : "s"} — fix before Create
                      </span>
                    )}
                  </td>
                  <td>
                    <a href={`/api/claims/${c.id}/cms1500`} target="_blank" rel="noreferrer">
                      CMS-1500
                    </a>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted">
                    {view === "AWAITING"
                      ? "No claims are awaiting printing. Claims land here when their payer has no EDI payer ID; pick “All unsent claims” to print any other claim."
                      : "No claims here."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {matching.length > LIST_LIMIT && <p className="muted">Showing the first {LIST_LIMIT} of {matching.length}. Narrow the list with the search above.</p>}
        <div className="cm-foot">
          <label className="cm-check" title="Leaves box 29 (amount paid) empty">
            <input type="checkbox" name="omitPayments" />
            Omit payments
          </label>
          <label className="cm-check" title="Prints only the data, to feed pre-printed red CMS-1500 forms into the printer">
            <input type="checkbox" name="dataOnly" />
            Pre-printed forms (data only)
          </label>
          <span className="muted">Maximum {MAX_PAPER_CLAIMS} paper claims at a time. UB-04 (institutional) forms are not available.</span>
          <button className="btn secondary" type="submit" formAction="/api/claims/paper" formMethod="get" formTarget="_blank" disabled={rows.length === 0} title="Opens the forms without changing the claims">
            Preview
          </button>
          {view !== "PRINTED" && (
            <button className="btn" type="submit" disabled={rows.length === 0} title="Marks the ticked claims as submitted on paper, then opens the forms to print">
              Create
            </button>
          )}
        </div>
      </form>
    </>
  );
}
