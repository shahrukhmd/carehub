import { requireChartAccess } from "@/lib/privacy";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney, patientName } from "@/lib/format";
import { visitBillingStatusLabel } from "@/lib/claim-format";
import { getPracticeSettings } from "@/lib/chart-setup";
import { addressLines, settingsAddress } from "@/lib/practice-settings";

export default async function PatientStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["ADMIN", "BILLER", "FRONT_DESK"]);
  const { id } = await params;
  await requireChartAccess(user, id, `/patients/${id}/statement`);

  const patient = await prisma.patient.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      insurances: { include: { payer: true } },
      encounters: {
        include: { charges: true, claims: { where: { status: { not: "VOID" } } } },
        orderBy: { date: "desc" },
      },
    },
  });

  if (!patient) notFound();
  const settings = await getPracticeSettings(user.practiceId);
  const s = settings as unknown as Record<string, unknown>;
  const payee = settingsAddress(s, "payee");
  const remit = settingsAddress(s, "remit") ?? payee;

  // One ledger row per visit: charges less what insurance paid and adjusted across its claims.
  const lines = patient.encounters
    .filter((e) => e.charges.length > 0)
    .map((e) => {
      const billedCents = e.charges.reduce((s, c) => s + c.amountCents, 0);
      const paidCents = e.claims.reduce((s, c) => s + c.paidCents, 0);
      const adjustedCents = e.claims.reduce((s, c) => s + c.adjustedCents, 0);
      return {
        id: e.id,
        date: e.date,
        cptCode: e.charges.map((c) => c.cptCode).join(", "),
        description: e.charges.map((c) => c.description).join("; "),
        billedCents,
        paidCents,
        adjustedCents,
        status: visitBillingStatusLabel[e.billingStatus] ?? e.billingStatus,
      };
    });

  const totalBilled = lines.reduce((s, l) => s + l.billedCents, 0);
  const totalPaid = lines.reduce((s, l) => s + l.paidCents, 0);
  const totalAdjusted = lines.reduce((s, l) => s + l.adjustedCents, 0);
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
            <span>{patient.insurances.find((i) => i.rank === "PRIMARY")?.payer.name ?? "Self-pay"}</span>
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

      {(payee || remit || settings.billingPhone) && (
        <section className="panel st-remit">
          {payee && (
            <div>
              <span className="muted">Make checks payable to</span>
              {addressLines(payee).map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          )}
          {remit && (
            <div>
              <span className="muted">Mail payments to</span>
              {addressLines(remit).map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          )}
          {settings.billingPhone && (
            <div>
              <span className="muted">Billing questions</span>
              <p>{settings.billingPhone}</p>
            </div>
          )}
        </section>
      )}

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
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{formatDate(l.date)}</td>
                <td>{l.cptCode}</td>
                <td>{l.description}</td>
                <td>{formatMoney(l.billedCents)}</td>
                <td>{l.status}</td>
                <td>{formatMoney(Math.max(l.billedCents - l.paidCents - l.adjustedCents, 0))}</td>
              </tr>
            ))}
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
