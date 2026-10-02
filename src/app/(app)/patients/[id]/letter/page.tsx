import { requireChartAccess } from "@/lib/privacy";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { patientName } from "@/lib/format";
import { LETTER_ROLES, MERGE_FIELDS, ensureLetters, fillTemplate, mergeValues } from "@/lib/letters";
import { createLetter } from "./actions";

export default async function PatientLetterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string; error?: string }> }) {
  const user = await requireUser(LETTER_ROLES);
  const { id } = await params;
  await requireChartAccess(user, id, `/patients/${id}/letter`);
  const sp = await searchParams;
  await ensureLetters(user.practiceId);
  const patient = await prisma.patient.findFirst({ where: { id, practiceId: user.practiceId } });
  if (!patient) notFound();
  const templates = await prisma.letterTemplate.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { name: "asc" } });
  const t = templates.find((x) => x.id === sp.t) ?? null;
  const { values, user: me } = await mergeValues(user.practiceId, patient.id, user.id);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href={`/patients/${patient.id}`}>{patientName(patient)}</Link>
          </p>
          <h1>New letter</h1>
        </div>
        {user.role === "ADMIN" && (
          <Link className="btn ghost" href="/settings/letters">
            Edit templates
          </Link>
        )}
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <nav className="cn-filters">
        {templates.map((x) => (
          <Link key={x.id} href={`/patients/${patient.id}/letter?t=${x.id}`} className={t?.id === x.id ? "active" : ""}>
            {x.name}
          </Link>
        ))}
        <Link href={`/patients/${patient.id}/letter?t=blank`} className={sp.t === "blank" ? "active" : ""}>
          Blank letter
        </Link>
      </nav>
      {(t || sp.t === "blank") && (
        <form action={createLetter.bind(null, patient.id)} className="panel stack">
          <input type="hidden" name="name" value={t?.name ?? "Letter"} />
          <label>
            Subject (Re:)
            <input name="subject" defaultValue={t ? fillTemplate(t.subject ?? "", values) : ""} />
          </label>
          <label>
            Letter
            <textarea name="body" rows={16} defaultValue={t ? fillTemplate(t.body, values) : `Dear ${patient.firstName},\n\n\n\nSincerely,\n\n${me.name}`} className="lt-body" />
          </label>
          <div className="form-grid gw-grid-3">
            <label className="checkbox-inline">
              <input type="checkbox" name="sign" defaultChecked={Boolean(me.signatureImage)} disabled={!me.signatureImage} /> Add my signature
              {!me.signatureImage && <span className="muted cn-small"> (none on file)</span>}
            </label>
            <label>
              Also fax to (optional)
              <input name="faxTo" placeholder="(480) 555-2513" />
            </label>
            <label>
              Fax recipient
              <input name="faxName" placeholder="Dr. Smith's office" />
            </label>
          </div>
          <p className="muted cn-small">The letter is saved to the patient&apos;s documents as a PDF on your letterhead, ready to print, mail or fax.</p>
          <div>
            <button className="btn" type="submit">
              Create letter
            </button>
          </div>
        </form>
      )}
      <details className="panel">
        <summary>Merge fields</summary>
        <table className="cn-table">
          <tbody>
            {MERGE_FIELDS.map(([k, l]) => (
              <tr key={k}>
                <td>
                  <code>{`{{${k}}}`}</code>
                </td>
                <td>{l}</td>
                <td className="muted">{values[k]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
