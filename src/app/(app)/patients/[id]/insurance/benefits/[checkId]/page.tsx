import { rolesFor } from "@/lib/permissions";
import { requireChartAccess } from "@/lib/privacy";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PrintButton } from "@/components/PrintButton";
import { compareBenefits, loadBenefitContext, parseBenefits } from "@/lib/eligibility-apply";
import { formatDate, formatMoney, formatTime, patientName, planSegmentLabel } from "@/lib/format";

const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : formatMoney(cents));
const day = (isoDate: string | undefined) => (isoDate ? formatDate(new Date(`${isoDate}T12:00:00`)) : "—");

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span>{label}</span>
      {children || "—"}
    </div>
  );
}

// The payer's full eligibility and benefits response for one check: on screen, and laid out to print.
export default async function BenefitsPage({ params, searchParams }: { params: Promise<{ id: string; checkId: string }>; searchParams: Promise<{ case?: string }> }) {
  const user = await requireUser(rolesFor("patients.view"));
  const { id, checkId } = await params;
  await requireChartAccess(user, id, `/patients/${id}/insurance`);
  const { case: caseId } = await searchParams;
  const check = await prisma.eligibilityCheck.findFirst({
    where: { id: checkId, patientId: id, practiceId: user.practiceId },
    include: { payer: true, patient: { include: { practice: true } } },
  });
  if (!check) notFound();
  const [loaded, checkedBy] = await Promise.all([
    loadBenefitContext(check.id, user.practiceId),
    check.checkedById ? prisma.user.findUnique({ where: { id: check.checkedById }, select: { name: true } }) : null,
  ]);
  const b = parseBenefits(check.benefits);
  const fields = loaded && check.status === "ACTIVE" ? compareBenefits(loaded.ctx, loaded.check) : [];
  const insurance = loaded?.ctx.insurance;
  const patient = check.patient;
  const backCase = caseId && /^[a-z0-9]{10,40}$/.test(caseId) ? caseId : check.intakeCaseId;
  await logAudit(user.practiceId, user.id, "patient.benefits_viewed", "EligibilityCheck", check.id);

  const statusLabel = check.status === "ACTIVE" ? "Active coverage" : check.status === "INACTIVE" ? "Inactive / termed" : check.status === "ERROR" ? "No response (error)" : "No definitive answer";

  return (
    <>
      <div className="page-head no-print">
        <div>
          <p className="muted">Eligibility &amp; benefits</p>
          <h1>Benefits — {patientName(patient)}</h1>
        </div>
        <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
          {backCase && (
            <Link className="btn secondary" href={`/gateway/${backCase}`}>
              Back to case
            </Link>
          )}
          <Link className="btn secondary" href={`/patients/${patient.id}/insurance`}>
            Patient insurance
          </Link>
          <PrintButton />
        </div>
      </div>

      <section className="panel print-doc">
        <div className="print-header">
          <div>
            <strong className="print-brand">CareHub</strong>
            <p className="muted">{patient.practice.name}</p>
          </div>
          <div>
            <p className="muted">Eligibility &amp; benefits response</p>
            <p>
              Checked {formatDate(check.checkedAt)} {formatTime(check.checkedAt)}
              {checkedBy ? ` by ${checkedBy.name}` : ""}
            </p>
          </div>
        </div>

        <div className="gw-facts">
          <Fact label="Patient">
            {patientName(patient)} · {patient.mrn} · DOB {formatDate(patient.dob)}
          </Fact>
          <Fact label="Payer">{check.payer.name}</Fact>
          <Fact label="Member ID">{b.subscriber?.memberId ?? insurance?.memberId}</Fact>
          <Fact label="Coverage status">
            <strong>{statusLabel}</strong>
          </Fact>
          <Fact label="Plan">
            {[b.plan?.name ?? check.planName, b.plan?.type].filter(Boolean).join(" · ")}
            {b.plan?.segment ? ` (${planSegmentLabel[b.plan.segment] ?? b.plan.segment})` : ""}
          </Fact>
          <Fact label="Group">{[b.plan?.groupNumber, b.plan?.groupName].filter(Boolean).join(" · ")}</Fact>
          <Fact label="Coverage effective">{day(b.plan?.effectiveDate)}</Fact>
          <Fact label="Coverage ends">{day(b.plan?.terminationDate)}</Fact>
          <Fact label="Subscriber">
            {[b.subscriber?.lastName, b.subscriber?.firstName].filter(Boolean).join(", ")}
            {b.subscriber?.dob ? ` · DOB ${day(b.subscriber.dob)}` : ""}
          </Fact>
        </div>
        {check.payerMessage && (
          <p>
            <strong>Payer message:</strong> {check.payerMessage}
          </p>
        )}

        {check.status === "ACTIVE" && (
          <>
            <h3>Patient responsibility</h3>
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Total</th>
                  <th>Met</th>
                  <th>Remaining</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Deductible (individual)</td>
                  <td>{money(b.deductible?.totalCents)}</td>
                  <td>{money(b.deductible?.metCents)}</td>
                  <td>{money(b.deductible?.remainingCents ?? check.deductibleRemainingCents)}</td>
                </tr>
                <tr>
                  <td>Out-of-pocket maximum</td>
                  <td>{b.outOfPocket?.maxCents ? money(b.outOfPocket.maxCents) : "—"}</td>
                  <td>{b.outOfPocket?.maxCents ? money(b.outOfPocket?.metCents) : "—"}</td>
                  <td>{money(b.outOfPocket?.remainingCents ?? check.outOfPocketRemainingCents)}</td>
                </tr>
              </tbody>
            </table>
            <p>
              Office visit copay <strong>{money(check.copayCents)}</strong> · Coinsurance <strong>{check.coinsurancePercent === null ? "—" : `${check.coinsurancePercent}%`}</strong> · PCP referral required:{" "}
              <strong>{b.referralRequired === undefined ? "Not stated" : b.referralRequired ? "Yes" : "No"}</strong>
              {b.pcp?.name ? ` · PCP on file with payer: ${b.pcp.name}${b.pcp.phone ? ` ${b.pcp.phone}` : ""}` : ""}
            </p>

            {(b.services ?? []).length > 0 && (
              <>
                <h3>Benefits by service</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Covered</th>
                      <th>Copay</th>
                      <th>Coinsurance</th>
                      <th>Prior auth</th>
                      <th>Limits / notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.services!.map((s) => (
                      <tr key={s.code}>
                        <td>{s.label}</td>
                        <td>{s.covered ? "Yes" : "No"}</td>
                        <td>{s.copayCents === undefined ? "—" : money(s.copayCents)}</td>
                        <td>{s.coinsurancePercent === undefined ? "—" : `${s.coinsurancePercent}%`}</td>
                        <td>{s.authRequired === undefined ? "—" : s.authRequired ? "Required" : "Not required"}</td>
                        <td>{[s.limit, s.note].filter(Boolean).join(" · ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {(b.messages ?? []).length > 0 && (
              <>
                <h3>Payer notes</h3>
                <ul>
                  {b.messages!.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </>
            )}

            {fields.length > 0 && (
              <>
                <h3>Compared with the chart</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>On the chart</th>
                      <th>Payer returned</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f) => (
                      <tr key={f.key}>
                        <td>{f.label}</td>
                        <td>{f.current || "—"}</td>
                        <td>{f.payer}</td>
                        <td>{f.state === "MATCH" ? "Matches" : f.state === "FILL" ? "Not on the chart" : <strong>Differs</strong>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {backCase && fields.some((f) => f.state !== "MATCH") && <p className="muted no-print">Update the fields that differ from the case page.</p>}
              </>
            )}
          </>
        )}

        {check.raw && (
          <details className="no-print">
            <summary className="muted">Raw response from the clearinghouse</summary>
            <pre className="gw-raw">{check.raw}</pre>
          </details>
        )}
        <p className="muted">Eligibility and benefits are as reported by the payer on the date shown and are not a guarantee of payment.</p>
      </section>
    </>
  );
}
