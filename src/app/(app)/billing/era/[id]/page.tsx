import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney, patientName } from "@/lib/format";
import { claimNumber, claimStatusLabel } from "@/lib/claim-format";
import { CAS_GROUPS, CLP_STATUS, PLB_REASONS, adjustmentText, allAdjustments, type EraAdjustment, type EraLine, type EraPlb } from "@/lib/era";
import { postEraFile, setEraMatch, skipEraLine } from "../actions";

const MATCH: Record<string, [string, string]> = {
  MATCHED: ["Ready to post", "info"],
  UNMATCHED: ["No matching claim", "warn"],
  POSTED: ["Posted", "ok"],
  SKIPPED: ["Skipped", "bad"],
};
const METHOD: Record<string, string> = { ACH: "EFT (ACH)", CHK: "Check", NON: "No payment", FWT: "Wire", BOP: "Financial institution option" };

export default async function EraPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; posted?: string; skipped?: string }> }) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const { id } = await params;
  const sp = await searchParams;
  const file = await prisma.eraFile.findFirst({ where: { id, practiceId: user.practiceId }, include: { claims: true } });
  if (!file) notFound();
  const claims = await prisma.claim.findMany({
    where: { id: { in: file.claims.map((c) => c.claimId).filter((x): x is string => Boolean(x)) } },
    include: { patient: true },
  });
  const byId = new Map(claims.map((c) => [c.id, c]));
  const needsMatch = file.claims.some((c) => c.matchStatus === "UNMATCHED");
  const openClaims = needsMatch
    ? await prisma.claim.findMany({
        where: { practiceId: user.practiceId, status: { in: ["SUBMITTED", "ACCEPTED", "PARTIAL", "TRANSFERRED", "APPEAL", "DENIED"] } },
        include: { patient: true },
        orderBy: { submittedAt: "desc" },
        take: 300,
      })
    : [];
  const ready = file.claims.filter((c) => c.matchStatus === "MATCHED").length;
  const plb = JSON.parse(file.plbDetail || "[]") as EraPlb[];
  const sum = (k: "paidCents" | "billedCents" | "patientRespCents") => file.claims.reduce((s, c) => s + c[k], 0);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/billing?tab=era">Revenue cycle · ERA / 835</Link>
          </p>
          <h1>{file.payerName}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {METHOD[file.paymentMethod] ?? file.paymentMethod} {file.traceNumber ? `· trace ${file.traceNumber}` : ""} · paid {file.paymentDate ? formatDate(file.paymentDate) : "—"} · {file.fileName}
          </p>
        </div>
        {ready > 0 && (
          <form action={postEraFile.bind(null, file.id)}>
            <button className="btn" type="submit">
              Post {ready} matched claim{ready === 1 ? "" : "s"}
            </button>
          </form>
        )}
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.posted !== undefined && (
        <p className={Number(sp.skipped) ? "gw-error" : "notice-ok"}>
          {sp.posted} claim{sp.posted === "1" ? "" : "s"} posted{Number(sp.skipped) ? ` · ${sp.skipped} need manual review (see below)` : ""}.
        </p>
      )}
      <section className="grid-stats">
        <div className="stat">
          <span>Payment total</span>
          <strong>{formatMoney(file.totalCents)}</strong>
        </div>
        <div className="stat">
          <span>Billed</span>
          <strong>{formatMoney(sum("billedCents"))}</strong>
        </div>
        <div className="stat">
          <span>Paid on claims</span>
          <strong>{formatMoney(sum("paidCents"))}</strong>
        </div>
        <div className="stat">
          <span>Patient responsibility</span>
          <strong>{formatMoney(sum("patientRespCents"))}</strong>
        </div>
        <div className="stat">
          <span>Status</span>
          <strong>{file.status === "POSTED" ? "Posted" : file.status === "PARTIAL" ? "Partly posted" : "Not posted"}</strong>
        </div>
      </section>
      {plb.length > 0 && (
        <section className="panel">
          <h2>Provider-level adjustments (PLB)</h2>
          <table className="cn-table">
            <thead>
              <tr>
                <th>Reason</th>
                <th>Reference</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {plb.map((x, i) => (
                <tr key={i}>
                  <td>
                    {x.reason} · {PLB_REASONS[x.reason] ?? "Other"}
                  </td>
                  <td>{x.reference || "—"}</td>
                  <td>{x.cents > 0 ? `− ${formatMoney(x.cents)}` : `+ ${formatMoney(-x.cents)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted cn-small">
            Claim payments {formatMoney(sum("paidCents"))} {file.plbCents >= 0 ? "−" : "+"} provider adjustments {formatMoney(Math.abs(file.plbCents))} = {formatMoney(sum("paidCents") - file.plbCents)} (payment total {formatMoney(file.totalCents)}). Recoupments reduce this deposit; follow up on the referenced claims in AR.
          </p>
        </section>
      )}
      {sum("paidCents") - file.plbCents !== file.totalCents && (
        <p className="gw-error">
          The claim payments on this remittance ({formatMoney(sum("paidCents"))}){plb.length ? " less provider adjustments" : ""} don&apos;t add up to the payment
          total ({formatMoney(file.totalCents)}). The file may be incomplete — check the payer&apos;s EOB before posting.
        </p>
      )}
      {file.depositId && (
        <p className="muted" style={{ margin: 0 }}>
          Payments were recorded on a deposit for this remittance — see <Link href="/billing?tab=deposits">Deposits</Link>.
        </p>
      )}
      <section className="panel">
        <h2>Claims on this remittance ({file.claims.length})</h2>
        <div className="table-scroll">
          <table className="cn-table">
            <thead>
              <tr>
                <th>Claim / patient</th>
                <th>Payer decision</th>
                <th>Billed</th>
                <th>Paid</th>
                <th>Patient resp.</th>
                <th>Adjustments</th>
                <th>CareHub claim</th>
              </tr>
            </thead>
            <tbody>
              {file.claims.map((ec) => {
                const adj = allAdjustments({ adjustments: JSON.parse(ec.adjustments) as EraAdjustment[], lines: JSON.parse(ec.lines) as EraLine[] });
                const lines = JSON.parse(ec.lines) as EraLine[];
                const c = ec.claimId ? byId.get(ec.claimId) : undefined;
                const [label, tone] = MATCH[ec.matchStatus] ?? [ec.matchStatus, "info"];
                return (
                  <tr key={ec.id}>
                    <td>
                      <strong>{ec.controlNumber}</strong>
                      <div className="muted cn-small">
                        {ec.patientName ?? ""} {ec.memberId ? `· ${ec.memberId}` : ""}
                      </div>
                      {ec.payerClaimNumber && <div className="muted cn-small">Payer # {ec.payerClaimNumber}</div>}
                    </td>
                    <td>
                      <span className={`cn-status ${ec.statusCode === "4" ? "cn-cancelled" : ec.statusCode === "22" ? "cn-in_progress" : "cn-completed"}`}>{CLP_STATUS[ec.statusCode] ?? `Status ${ec.statusCode}`}</span>
                      {ec.remarks && <div className="muted cn-small">Remarks: {ec.remarks}</div>}
                    </td>
                    <td>{formatMoney(ec.billedCents)}</td>
                    <td>{formatMoney(ec.paidCents)}</td>
                    <td>{formatMoney(ec.patientRespCents)}</td>
                    <td className="cn-small">
                      {adj.length === 0 ? (
                        "—"
                      ) : (
                        <details>
                          <summary>
                            {adj.length} adjustment{adj.length === 1 ? "" : "s"} · {formatMoney(adj.reduce((s, a) => s + a.cents, 0))}
                          </summary>
                          <ul className="era-adj">
                            {adj.map((a, i) => (
                              <li key={i} title={CAS_GROUPS[a.group]}>
                                {adjustmentText(a)} — {formatMoney(a.cents)}
                              </li>
                            ))}
                          </ul>
                          {lines.length > 0 && (
                            <p className="muted">
                              Lines: {lines.map((l) => `${l.code}${l.modifiers ? `-${l.modifiers}` : ""} paid ${formatMoney(l.paidCents)}`).join(" · ")}
                            </p>
                          )}
                        </details>
                      )}
                    </td>
                    <td>
                      <span className={`gw-tag gw-tag-${tone}`}>{label}</span>
                      {c && (
                        <div className="cn-small">
                          <Link href={`/billing/claims/${c.id}`}>{claimNumber(c)}</Link> · {patientName(c.patient)}
                          <div className="muted">{claimStatusLabel[c.status] ?? c.status}</div>
                        </div>
                      )}
                      {ec.note && <div className="muted cn-small">{ec.note}</div>}
                      {["MATCHED", "UNMATCHED"].includes(ec.matchStatus) && (
                        <div className="era-actions">
                          {ec.matchStatus === "UNMATCHED" && (
                            <form action={setEraMatch.bind(null, ec.id, file.id)} className="cn-inline" style={{ margin: 0 }}>
                              <select name="claimId" required aria-label="Match to claim" defaultValue="">
                                <option value="">Match to claim…</option>
                                {openClaims.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {claimNumber(o)} · {patientName(o.patient)} · {formatMoney(o.billedCents)}
                                  </option>
                                ))}
                              </select>
                              <button className="btn secondary gw-mini" type="submit">
                                Match
                              </button>
                            </form>
                          )}
                          {ec.matchStatus === "MATCHED" && (
                            <form action={setEraMatch.bind(null, ec.id, file.id)}>
                              <input type="hidden" name="claimId" value="" />
                              <button className="btn ghost gw-mini" type="submit">
                                Unmatch
                              </button>
                            </form>
                          )}
                          <form action={skipEraLine.bind(null, ec.id, file.id)}>
                            <input type="hidden" name="note" value="Skipped by biller" />
                            <button className="btn ghost gw-mini" type="submit">
                              Skip
                            </button>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted cn-small">
          Posting records the payment, writes off contractual adjustments (CO/OA/PI), moves patient responsibility (PR — deductible, coinsurance, copay) to the
          next payer or the patient, and marks denials with the payer&apos;s reason so they show in AR &amp; denials.
        </p>
      </section>
    </div>
  );
}
