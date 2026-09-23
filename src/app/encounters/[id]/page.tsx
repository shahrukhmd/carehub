import Link from "next/link";
import { notFound } from "next/navigation";
import { addCharge, saveEncounter } from "@/app/actions";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, patientName } from "@/lib/format";

export default async function EncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encounter = await prisma.encounter.findUnique({
    where: { id },
    include: {
      patient: { include: { allergies: true, problems: true } },
      provider: true,
      charges: { include: { claim: true } },
    },
  });

  if (!encounter) notFound();

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">SOAP note</p>
          <h1>
            <Link href={`/patients/${encounter.patientId}`}>{patientName(encounter.patient)}</Link>
          </h1>
          <p className="chart-meta">
            <span>{formatDate(encounter.date)}</span>
            <span>{encounter.provider.name}</span>
            <span>{encounter.type}</span>
          </p>
        </div>
      </div>

      <div className="two-col">
        <form className="panel stack" action={saveEncounter.bind(null, encounter.id)}>
          <label>
            Chief complaint
            <input name="chiefComplaint" defaultValue={encounter.chiefComplaint ?? ""} />
          </label>
          <div className="soap-grid">
            <label>
              Subjective
              <textarea name="subjective" defaultValue={encounter.subjective ?? ""} />
            </label>
            <label>
              Objective
              <textarea name="objective" defaultValue={encounter.objective ?? ""} />
            </label>
            <label>
              Assessment
              <textarea name="assessment" defaultValue={encounter.assessment ?? ""} />
            </label>
            <label>
              Plan
              <textarea name="plan" defaultValue={encounter.plan ?? ""} />
            </label>
          </div>
          <label>
            Status
            <select name="status" defaultValue={encounter.status}>
              <option value="IN_PROGRESS">In progress</option>
              <option value="SIGNED">Sign encounter</option>
            </select>
          </label>
          <button className="btn" type="submit">
            Save chart
          </button>
        </form>

        <div className="stack">
          <section className="panel">
            <h2>Safety</h2>
            <p>
              Allergies:{" "}
              {encounter.patient.allergies.map((a) => a.allergen).join(", ") || "NKDA"}
            </p>
            <p>
              Problems:{" "}
              {encounter.patient.problems.map((p) => `${p.icd10} ${p.description}`).join("; ") || "None"}
            </p>
          </section>
          <section className="panel">
            <h2>Charges</h2>
            <table>
              <tbody>
                {encounter.charges.map((c) => (
                  <tr key={c.id}>
                    <td>{c.cptCode}</td>
                    <td>{c.description}</td>
                    <td>{formatMoney(c.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form className="stack" action={addCharge.bind(null, encounter.id)} style={{ marginTop: "1rem" }}>
              <label>
                CPT
                <input name="cptCode" placeholder="99213" required />
              </label>
              <label>
                Description
                <input name="description" required />
              </label>
              <label>
                Amount (USD)
                <input name="amount" type="number" step="0.01" required />
              </label>
              <label>
                ICD-10
                <input name="icd10" />
              </label>
              <button className="btn secondary" type="submit">
                Add charge
              </button>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}
