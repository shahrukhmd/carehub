import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { patientName } from "@/lib/format";
import { COMMON_SPECIALTIES, REFERRAL_ROLES } from "@/lib/referrals";
import { createReferral } from "../actions";

export default async function NewReferralPage({ searchParams }: { searchParams: Promise<{ patientId?: string; encounterId?: string; error?: string }> }) {
  const user = await requireUser(REFERRAL_ROLES);
  const sp = await searchParams;
  const [patient, patients, directory] = await Promise.all([
    sp.patientId ? prisma.patient.findFirst({ where: { id: sp.patientId, practiceId: user.practiceId }, include: { problems: { where: { status: "ACTIVE" } }, insurances: { where: { active: true }, include: { payer: true } } } }) : null,
    sp.patientId ? Promise.resolve([]) : prisma.patient.findMany({ where: { practiceId: user.practiceId, status: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 2000 }),
    prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId, isReferring: true, status: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/referrals">Outgoing referrals</Link>
            {patient && (
              <>
                {" · "}
                <Link href={`/patients/${patient.id}`}>{patientName(patient)}</Link>
              </>
            )}
          </p>
          <h1>New referral</h1>
        </div>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {!patient ? (
        <section className="panel">
          <form method="get" className="cn-inline">
            <select name="patientId" required aria-label="Patient">
              <option value="">Choose the patient…</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {patientName(p)} · {p.mrn}
                </option>
              ))}
            </select>
            <button className="btn secondary" type="submit">
              Continue
            </button>
          </form>
        </section>
      ) : (
        <form action={createReferral} className="panel stack">
          <input type="hidden" name="patientId" value={patient.id} />
          {sp.encounterId && <input type="hidden" name="encounterId" value={sp.encounterId} />}
          <div className="form-grid gw-grid-3">
            <label>
              From the directory
              <select name="toProviderId" defaultValue="">
                <option value="">— or type a recipient below —</option>
                {directory.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.specialty ? ` · ${d.specialty}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Recipient name
              <input name="toName" placeholder="Dr. Jane Smith, Valley Vascular" />
            </label>
            <label>
              Specialty
              <input name="toSpecialty" list="ref-specialties" />
              <datalist id="ref-specialties">
                {COMMON_SPECIALTIES.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            <label>
              Fax
              <input name="toFax" placeholder="Uses the directory fax if blank" />
            </label>
            <label>
              Phone
              <input name="toPhone" />
            </label>
            <label>
              Urgency
              <select name="urgency" defaultValue="ROUTINE">
                <option value="ROUTINE">Routine</option>
                <option value="URGENT">Urgent</option>
              </select>
            </label>
            <label className="gw-span-3">
              Reason for referral
              <input name="reason" required placeholder="e.g. Non-healing venous ulcer — evaluate for venous ablation" />
            </label>
            <label>
              Diagnosis codes
              <input name="diagnosisCodes" defaultValue={patient.problems.map((p) => p.icd10).slice(0, 6).join(", ")} />
            </label>
            <label>
              Referral / auth # (if the plan needs one)
              <input name="authNumber" />
            </label>
            <label>
              Follow up if no consult after (days)
              <input type="number" name="followUpDays" min={3} max={180} defaultValue={30} />
            </label>
            <label className="gw-span-3">
              Notes for the specialist
              <textarea name="notes" rows={3} />
            </label>
          </div>
          <p className="muted cn-small">
            The letter includes the patient&apos;s demographics, {patient.insurances.length ? "insurance, " : ""}active wounds, problems, medications, allergies and recent
            visits. Add specialists to the directory in Settings → Directories.
          </p>
          <div>
            <button className="btn" type="submit">
              Save referral
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
