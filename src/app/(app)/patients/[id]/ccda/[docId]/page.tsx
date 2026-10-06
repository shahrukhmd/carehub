import { requireChartAccess } from "@/lib/privacy";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { patientName } from "@/lib/format";
import type { CcdImport } from "@/lib/ccda";
import { applyCcda } from "../actions";
import { rolesFor } from "@/lib/permissions";

export default async function CcdaReviewPage({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const user = await requireUser(rolesFor("records.exchange"));
  const { id, docId } = await params;
  await requireChartAccess(user, id, `/patients/${id}`);
  const [patient, doc] = await Promise.all([
    prisma.patient.findFirst({ where: { id, practiceId: user.practiceId }, include: { problems: true, medications: { where: { status: "ACTIVE" } }, allergies: true, immunizations: true } }),
    prisma.patientDocument.findFirst({ where: { id: docId, patientId: id, practiceId: user.practiceId, docType: "CCDA" } }),
  ]);
  if (!patient || !doc?.extraction) notFound();
  const data = JSON.parse(doc.extraction) as CcdImport;
  const has = {
    p: new Set(patient.problems.map((x) => x.icd10.toUpperCase())),
    m: new Set(patient.medications.map((x) => x.name.toLowerCase())),
    a: new Set(patient.allergies.map((x) => x.allergen.toLowerCase())),
    i: new Set(patient.immunizations.map((x) => `${x.cvxCode ?? x.vaccine}|${x.administeredAt.toISOString().slice(0, 10)}`)),
  };
  const nameMatch = data.patient.lastName.toLowerCase() === patient.lastName.toLowerCase() && (!data.patient.dob || data.patient.dob === patient.dob.toISOString().slice(0, 10));
  const groups: [string, string, { label: string; exists: boolean }[]][] = [
    ["p", "Problems", data.problems.map((x) => ({ label: `${x.code} ${x.description}`, exists: has.p.has(x.code.toUpperCase()) }))],
    ["m", "Medications", data.medications.map((x) => ({ label: `${x.name}${x.sig ? ` — ${x.sig}` : ""}`, exists: has.m.has(x.name.toLowerCase()) }))],
    ["a", "Allergies", data.allergies.map((x) => ({ label: `${x.allergen}${x.reaction ? ` (${x.reaction})` : ""}`, exists: has.a.has(x.allergen.toLowerCase()) }))],
    ["i", "Immunizations", data.immunizations.map((x) => ({ label: `${x.vaccine} ${x.date ?? ""}`, exists: has.i.has(`${x.cvx ?? x.vaccine}|${x.date}`) }))],
  ];
  const applied = doc.status === "APPLIED";

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href={`/patients/${patient.id}`}>{patientName(patient)}</Link> · Import C-CDA
          </p>
          <h1>{doc.originalName}</h1>
        </div>
      </div>
      <p className={nameMatch ? "notice-ok" : "gw-error"}>
        Document is for {data.patient.firstName} {data.patient.lastName}
        {data.patient.dob ? `, born ${data.patient.dob}` : ""}
        {data.patient.mrn ? ` (outside ID ${data.patient.mrn})` : ""}.{" "}
        {nameMatch ? "Matches this chart." : "This does NOT match this chart — check before importing."}
      </p>
      {applied && <p className="notice-ok">Already imported.</p>}
      <form action={applyCcda.bind(null, patient.id, doc.id)} className="stack">
        {groups.map(([k, title, items]) => (
          <section key={k} className="panel">
            <h2>
              {title} ({items.length})
            </h2>
            {items.length === 0 ? (
              <p className="muted">None in the document.</p>
            ) : (
              <ul className="cc-list">
                {items.map((it, i) => (
                  <li key={i}>
                    <label className="checkbox-inline">
                      <input type="checkbox" name="pick" value={`${k}${i}`} defaultChecked={!it.exists && !applied} disabled={applied} /> {it.label}
                      {it.exists && <span className="cn-tag">already on chart</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
        {!applied && (
          <div>
            <button className="btn" type="submit">
              Import ticked items
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
