import { markClaimPaid, submitClaim } from "@/app/actions";
import { StatusBadge } from "@/components/StatusBadge";
import { prisma } from "@/lib/prisma";
import { formatMoney, patientName } from "@/lib/format";

export default async function BillingPage() {
  const charges = await prisma.charge.findMany({
    include: {
      claim: true,
      encounter: { include: { patient: true, provider: true } },
    },
    orderBy: { encounter: { date: "desc" } },
  });

  const billed = charges.reduce((s, c) => s + c.amountCents, 0);
  const paid = charges.reduce((s, c) => s + (c.claim?.paidCents ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Practice management</p>
          <h1>Revenue cycle</h1>
        </div>
      </div>

      <section className="grid-stats">
        <div className="stat">
          <span>Charges</span>
          <strong>{charges.length}</strong>
        </div>
        <div className="stat">
          <span>Billed</span>
          <strong>{formatMoney(billed)}</strong>
        </div>
        <div className="stat">
          <span>Collected</span>
          <strong>{formatMoney(paid)}</strong>
        </div>
        <div className="stat">
          <span>Open AR</span>
          <strong>{formatMoney(billed - paid)}</strong>
        </div>
      </section>

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>CPT / ICD</th>
              <th>Payer / claim</th>
              <th>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {charges.map((c) => (
              <tr key={c.id}>
                <td>
                  {patientName(c.encounter.patient)}
                  <div className="muted">{c.encounter.provider.name}</div>
                </td>
                <td>
                  {c.cptCode}
                  <div className="muted">{c.icd10}</div>
                </td>
                <td>
                  {c.claim ? (
                    <>
                      {c.claim.payerName} <StatusBadge value={c.claim.status} />
                    </>
                  ) : (
                    "No claim"
                  )}
                </td>
                <td>{formatMoney(c.amountCents)}</td>
                <td>
                  {!c.claim || c.claim.status === "DRAFT" ? (
                    <form action={submitClaim.bind(null, c.id)}>
                      <button className="btn" type="submit">
                        Submit claim
                      </button>
                    </form>
                  ) : c.claim.status === "SUBMITTED" ? (
                    <form action={markClaimPaid.bind(null, c.claim.id)}>
                      <button className="btn secondary" type="submit">
                        Post payment
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
