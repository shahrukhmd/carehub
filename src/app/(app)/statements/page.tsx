import Link from "next/link";
import { generateStatements } from "@/app/actions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney, patientName } from "@/lib/format";

export default async function StatementsPage() {
  const user = await requireUser(["ADMIN", "BILLER"]);

  const statements = await prisma.statement.findMany({
    where: { practiceId: user.practiceId },
    include: {
      patient: true,
      lines: { include: { claim: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Revenue cycle</p>
          <h1>Patient statements</h1>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: "1.25rem" }}>
        <h2>Generate statements</h2>
        <p className="muted">
          Bundles every claim whose remaining balance has shifted to patient responsibility into one statement per
          patient. Set a minimum balance to skip small amounts.
        </p>
        <form className="stack" action={generateStatements}>
          <label>
            Minimum balance (USD)
            <input name="minBalance" type="number" step="0.01" defaultValue="0" />
          </label>
          <button className="btn" type="submit">
            Generate statements
          </button>
        </form>
      </section>

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Patient</th>
              <th>Claims</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {statements.map((s) => (
              <tr key={s.id}>
                <td>{formatDate(s.createdAt)}</td>
                <td>
                  <Link href={`/patients/${s.patientId}`}>{patientName(s.patient)}</Link>
                </td>
                <td>
                  {s.lines.map((l) => (
                    <div key={l.id} className="muted">
                      {l.claim.payerName} — {formatMoney(l.balanceCents)}
                    </div>
                  ))}
                </td>
                <td>{formatMoney(s.totalCents)}</td>
              </tr>
            ))}
            {statements.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No statements generated yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
