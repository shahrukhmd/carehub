import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney, patientName } from "@/lib/format";

export default async function PatientStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["ADMIN", "BILLER", "FRONT_DESK"]);
  const { id } = await params;

  const patient = await prisma.patient.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      insurances: true,
      encounters: {
        include: { charges: { include: { claim: true } } },
        orderBy: { date: "desc" },
      },
    },
  });

  if (!patient) notFound();

  const lines = patient.encounters.flatMap((e) =>
    e.charges.map((c) => ({
      date: e.date,
      cptCode: c.cptCode,
      description: c.description,
      billedCents: c.amountCents,
      claim: c.claim,
    }))
  );

  const totalBilled = lines.reduce((s, l) => s + l.billedCents, 0);
  const totalPaid = lines.reduce((s, l) => s + (l.claim?.paidCents ?? 0), 0);
  const totalAdjusted = lines.reduce((s, l) => s + (l.claim?.adjustedCents ?? 0), 0);
  const totalDue = totalBilled - totalPaid - totalAdjusted;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Patient statement</p>
          <h1>
            <Link href={`/patients/${patient.id}`}>{patientName(patient)}</Link>
          </h1>
          <p className="chart-meta">
            <span>{patient.mrn}</span>
            <span>{patient.insurances.find((i) => i.isPrimary)?.payerName ?? "Self-pay"}</span>
          </p>
        </div>
      </div>

      <section className="grid-stats">
        <div className="stat">
          <span>Total billed</span>
          <strong>{formatMoney(totalBilled)}</strong>
        </div>
        <div className="stat">
          <span>Insurance paid</span>
          <strong>{formatMoney(totalPaid)}</strong>
        </div>
        <div className="stat">
          <span>Adjustments</span>
          <strong>{formatMoney(totalAdjusted)}</strong>
        </div>
        <div className="stat">
          <span>Balance due</span>
          <strong>{formatMoney(Math.max(totalDue, 0))}</strong>
        </div>
      </section>

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>CPT</th>
              <th>Description</th>
              <th>Billed</th>
              <th>Status</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const claim = l.claim;
              const balance = claim ? claim.billedCents - claim.paidCents - claim.adjustedCents : l.billedCents;
              return (
                <tr key={i}>
                  <td>{formatDate(l.date)}</td>
                  <td>{l.cptCode}</td>
                  <td>{l.description}</td>
                  <td>{formatMoney(l.billedCents)}</td>
                  <td>{claim ? claim.status : "Not billed"}</td>
                  <td>{formatMoney(Math.max(balance, 0))}</td>
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td colSpan={6}>No charges on file.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
