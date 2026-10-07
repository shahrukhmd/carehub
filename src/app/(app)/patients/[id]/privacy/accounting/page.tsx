import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PrintButton } from "@/components/PrintButton";
import { formatDate, patientName } from "@/lib/format";

import { disclosureMethodLabel, disclosurePurposeLabel, requireChartAccess } from "@/lib/privacy";

const YEARS = 6;
type Search = { from?: string; to?: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (v: string | undefined, fallback: Date, end = false) => {
  const d = v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${end ? "23:59:59" : "00:00:00"}`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
};

// The accounting a patient is entitled to ask for: every disclosure in the period, to print or save as PDF.
export default async function DisclosureAccountingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("patients.privacy"));
  const { id } = await params;
  const sp = await searchParams;
  await requireChartAccess(user, id, `/patients/${id}/privacy/accounting`);
  const patient = await prisma.patient.findFirst({ where: { id, practiceId: user.practiceId }, include: { practice: true } });
  if (!patient) notFound();

  const now = new Date();
  const from = day(sp.from, new Date(now.getFullYear() - YEARS, now.getMonth(), now.getDate()));
  const to = day(sp.to, now, true);
  const rows = await prisma.disclosure.findMany({ where: { patientId: id, practiceId: user.practiceId, disclosedAt: { gte: from, lte: to } }, orderBy: { disclosedAt: "asc" } });
  await logAudit(user.practiceId, user.id, "VIEW_DISCLOSURE_ACCOUNTING", "Patient", id, `${iso(from)} to ${iso(to)} · ${rows.length} disclosure(s)`);

  return (
    <div className="stack">
      <div className="page-head no-print">
        <div>
          <p className="muted">
            <Link href={`/patients/${id}/privacy`}>« Privacy, disclosures &amp; consent</Link>
          </p>
          <h1>Accounting of disclosures</h1>
        </div>
        <form method="get" className="cm-bar cm-bar-plain">
          <label>
            From
            <input type="date" name="from" defaultValue={iso(from)} />
          </label>
          <label>
            To
            <input type="date" name="to" defaultValue={iso(to)} />
          </label>
          <button className="btn secondary" type="submit">
            Update
          </button>
          <PrintButton />
        </form>
      </div>

      <section className="panel pv-sheet">
        <h2>{patient.practice.name}</h2>
        <h3>Accounting of disclosures of protected health information</h3>
        <p>
          <strong>Patient:</strong> {patientName(patient)} · MRN {patient.mrn} · Date of birth {formatDate(patient.dob)}
          <br />
          <strong>Period:</strong> {formatDate(from)} to {formatDate(to)}
          <br />
          <strong>Prepared:</strong> {formatDate(now)} by {user.name}
        </p>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Disclosed to</th>
              <th>Information disclosed</th>
              <th>Purpose</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>{formatDate(d.disclosedAt)}</td>
                <td>
                  {d.recipient}
                  {d.recipientAddress ? <div>{d.recipientAddress}</div> : null}
                </td>
                <td>{d.description}</td>
                <td>{disclosurePurposeLabel[d.purpose] ?? d.purpose}</td>
                <td>{d.method ? disclosureMethodLabel[d.method] : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5}>No disclosures were made in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="muted">
          This accounting lists disclosures recorded by the practice other than those for treatment, payment and health care operations, those made to the patient, and those made with the patient&apos;s
          written authorization where the law does not require them to be listed.
        </p>
      </section>
    </div>
  );
}
