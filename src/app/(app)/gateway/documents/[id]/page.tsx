import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GATEWAY_ROLES, canWorkTeam } from "@/lib/gateway";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PdfPreview } from "@/components/PdfPreview";
import { formatDate, patientName } from "@/lib/format";
import {
  DOC_FIELDS,
  DOC_STATUS,
  DOC_TYPES,
  FIELD_GROUPS,
  READ_METHODS,
  parseExtraction,
  type FieldGroup,
} from "@/lib/patient-docs";
import { applyDocument, deletePatientDocument, linkDocument, rereadDocument, saveDocumentDetails } from "../actions";

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "inc", "health", "plan", "insurance", "company", "of"].includes(w));

// Best directory match for a payer name read off the document.
function matchPayer(name: string | undefined, payers: { id: string; name: string }[]) {
  if (!name) return null;
  const n = name.toLowerCase();
  const exact = payers.find((p) => p.name.toLowerCase() === n || n.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(n));
  if (exact) return exact.id;
  const w = new Set(words(name));
  let best: { id: string; score: number } | null = null;
  for (const p of payers) {
    const score = words(p.name).filter((x) => w.has(x)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: p.id, score };
  }
  return best?.id ?? null;
}

function chartValue(key: string, p: Record<string, unknown> | null) {
  if (!p) return null;
  const col = key.split(".")[1];
  const raw = p[col];
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return raw ? String(raw) : null;
}

export default async function DocumentReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; linked?: string }>;
}) {
  const user = await requireUser(GATEWAY_ROLES);
  const { id } = await params;
  const sp = await searchParams;
  const doc = await prisma.patientDocument.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      patient: { include: { insurances: { where: { active: true }, include: { payer: true } } } },
      intakeCase: true,
      uploadedBy: true,
      reviewedBy: true,
    },
  });
  if (!doc) notFound();
  const canEdit = canWorkTeam(user.role, "DATA_ENTRY");
  const extraction = parseExtraction(doc.extraction);
  const found = extraction?.fields ?? {};
  const val = (k: string) => found[k]?.value ?? "";

  const [payers, referring, candidates, allPatients] = await Promise.all([
    prisma.payer.findMany({ where: { practiceId: user.practiceId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.renderingProvider.findMany({
      where: { practiceId: user.practiceId, isReferring: true },
      select: { id: true, name: true, npi: true },
      orderBy: { name: "asc" },
    }),
    doc.patientId || (!val("patient.lastName") && !val("patient.dob"))
      ? Promise.resolve([])
      : prisma.patient.findMany({
          where: {
            practiceId: user.practiceId,
            OR: [
              ...(val("patient.lastName") ? [{ lastName: val("patient.lastName") }] : []),
              ...(val("patient.dob") ? [{ dob: new Date(`${val("patient.dob")}T00:00:00Z`) }] : []),
            ],
          },
          take: 8,
        }),
    doc.patientId ? Promise.resolve([]) : prisma.patient.findMany({ where: { practiceId: user.practiceId }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 300 }),
  ]);

  const patient = doc.patient as unknown as Record<string, unknown> | null;
  const primary = doc.patient?.insurances.find((i) => i.rank === "PRIMARY");
  const current = (key: string): string | null => {
    if (!doc.patient) return null;
    if (key.startsWith("patient.")) return chartValue(key, patient);
    if (key === "insurance.payerName") return primary?.payer.name ?? null;
    if (key === "insurance.memberId") return primary?.memberId ?? null;
    if (key === "insurance.groupNumber") return primary?.groupNumber ?? null;
    if (key === "insurance.planName") return primary?.planName ?? null;
    const c = doc.intakeCase;
    if (!c) return null;
    const map: Record<string, unknown> = {
      "referral.referralDate": c.referralDate?.toISOString().slice(0, 10),
      "referral.sourceName": c.referralSourceName,
      "referral.contactName": c.referralContactName,
      "referral.contactPhone": c.referralContactPhone,
      "referral.contactFax": c.referralContactFax,
      "referral.servicesRequested": c.servicesRequested,
      "pcp.name": c.pcpName,
      "pcp.phone": c.pcpPhone,
      "pcp.fax": c.pcpFax,
    };
    return (map[key] as string | null | undefined) ?? null;
  };
  const same = (a: string | null, b: string) => Boolean(a) && a!.trim().toLowerCase() === b.trim().toLowerCase();

  const payerMatch = matchPayer(val("insurance.payerName"), payers);
  const secondaryMatch = matchPayer(val("secondary.payerName"), payers);
  const npi = val("referral.physicianNpi");
  const physName = val("referral.physicianName").toLowerCase().replace(/^dr\.?\s*/, "");
  const physicianMatch =
    referring.find((r) => npi && r.npi === npi)?.id ??
    referring.find((r) => physName && physName.length > 3 && r.name.toLowerCase().includes(physName.split(/\s+/).pop() ?? "~"))?.id ??
    "";
  const foundCount = Object.values(found).filter((f) => f.value).length;
  const fileUrl = `/api/files/patientdoc/${doc.id}`;
  const processing = doc.status === "PROCESSING";

  return (
    <div className="stack">
      {processing && <AutoRefresh seconds={3} />}
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/gateway/documents">Patient documents</Link> · {DOC_STATUS[doc.status] ?? doc.status}
            {doc.readMethod ? ` · read by ${READ_METHODS[doc.readMethod] ?? doc.readMethod}` : ""}
          </p>
          <h1>{doc.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            Uploaded {formatDate(doc.createdAt)} by {doc.uploadedBy?.name ?? "—"} · {doc.originalName}
            {doc.pageCount ? ` · ${doc.pageCount} page${doc.pageCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="vw-view-links">
          {doc.intakeCaseId && (
            <Link className="btn secondary" href={`/gateway/${doc.intakeCaseId}`}>
              Open intake case
            </Link>
          )}
          <a className="btn ghost" href={fileUrl} target="_blank" rel="noreferrer">
            Open file
          </a>
        </div>
      </div>

      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.saved && <p className="notice-ok">Name and document type saved.</p>}
      {sp.linked && <p className="notice-ok">Linked to the patient — review the details below against their chart, then apply.</p>}
      {doc.status === "APPLIED" && (
        <p className="notice-ok">
          Applied to {doc.patient ? patientName(doc.patient) : "the patient"} on {doc.appliedAt ? formatDate(doc.appliedAt) : ""}
          {doc.reviewedBy ? ` by ${doc.reviewedBy.name}` : ""}. You can apply again after correcting a value.
        </p>
      )}

      <div className="pd-layout">
        <section className="panel pd-preview">
          {doc.mimeType === "application/pdf" ? (
            <PdfPreview src={`${fileUrl}#view=FitH`} title={`Preview of ${doc.name}`} />
          ) : doc.mimeType.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl} alt={`Scanned document ${doc.name}`} />
          ) : (
            <p className="muted">
              No preview for this file type. <a href={fileUrl}>Download it</a>.
            </p>
          )}
        </section>

        <section className="panel stack pd-review">
          {processing ? (
            <div className="pd-reading">
              <span className="pd-spinner" aria-hidden="true" />
              <div>
                <strong>Reading the document…</strong>
                <p className="muted">Scanned pages take a few seconds each. This page updates on its own.</p>
              </div>
            </div>
          ) : doc.status === "FAILED" ? (
            <div className="gw-error" role="alert">
              <strong>Couldn&apos;t read this document.</strong> {doc.error}
              <p className="muted" style={{ margin: "0.3rem 0 0" }}>
                You can still name it, file it to a patient, and type the details in by hand.
              </p>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Found <strong>{foundCount}</strong> detail{foundCount === 1 ? "" : "s"}. Check each value against the document, correct anything that&apos;s
              wrong, and untick what shouldn&apos;t be saved. <span className="pd-conf pd-conf-low">low</span> values came from hard-to-read text — check them.
            </p>
          )}
          {extraction?.notes && <p className="pd-notes">{extraction.notes}</p>}

          {canEdit ? (
            <form action={applyDocument.bind(null, doc.id)} className="stack">
              <input type="hidden" name="mode" value={doc.patientId ? "update" : "create"} />
              <div className="form-grid">
                <label>
                  Document name
                  <input name="name" defaultValue={doc.name} required />
                </label>
                <label>
                  Document type
                  <select name="docType" defaultValue={doc.docType}>
                    {Object.entries(DOC_TYPES).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="vw-step-actions" style={{ justifyContent: "flex-start" }}>
                <button className="btn secondary gw-mini" type="submit" formAction={saveDocumentDetails.bind(null, doc.id)}>
                  Save name &amp; type only
                </button>
              </div>

              <div className="pd-target">
                {doc.patient ? (
                  <p style={{ margin: 0 }}>
                    Filing to <Link href={`/patients/${doc.patient.id}`}>{patientName(doc.patient)}</Link> ({doc.patient.mrn}, DOB {formatDate(doc.patient.dob)}). Values
                    that differ from the chart are left unticked so nothing is overwritten by accident.
                  </p>
                ) : (
                  <>
                    <p style={{ margin: 0 }}>
                      <strong>Not filed to a patient yet.</strong> Applying registers a new patient and opens their Patient Gateway case.
                    </p>
                    {candidates.length > 0 && (
                      <p className="pd-dupes" style={{ margin: 0 }}>
                        Possible existing patient:{" "}
                        {candidates.map((c) => (
                          <button key={c.id} className="btn ghost gw-mini" type="submit" formAction={linkDocument.bind(null, doc.id)} name="patientId" value={c.id}>
                            {patientName(c)} · {c.mrn} · DOB {formatDate(c.dob)} — use this patient
                          </button>
                        ))}
                      </p>
                    )}
                  </>
                )}
              </div>

              {(Object.keys(FIELD_GROUPS) as FieldGroup[]).map((group) => {
                const defs = DOC_FIELDS.filter((f) => f.group === group);
                const any = defs.some((f) => found[f.key]) || group === "patient";
                return (
                  <details key={group} className="pd-group" open={any}>
                    <summary>
                      {FIELD_GROUPS[group]}
                      <span className="muted"> · {defs.filter((f) => found[f.key]?.value).length} found</span>
                    </summary>
                    {group === "insurance" && (
                      <label className="pd-directory">
                        Payer in directory
                        <select name="payerId" defaultValue={payerMatch ?? ""}>
                          <option value="">— Don&apos;t add insurance —</option>
                          {payers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        {val("insurance.payerName") && !payerMatch && (
                          <span className="gw-missing">&ldquo;{val("insurance.payerName")}&rdquo; isn&apos;t in the payer directory — pick the matching payer.</span>
                        )}
                      </label>
                    )}
                    {group === "secondary" && (
                      <label className="pd-directory">
                        Secondary payer in directory
                        <select name="secondaryPayerId" defaultValue={secondaryMatch ?? ""}>
                          <option value="">— None —</option>
                          {payers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {group === "referral" && (
                      <label className="pd-directory">
                        Referring physician in directory
                        <select name="referringPhysicianId" defaultValue={physicianMatch}>
                          <option value="">— Not in directory (kept in referral notes) —</option>
                          {referring.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                              {r.npi ? ` · NPI ${r.npi}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <table className="pd-fields">
                      <thead>
                        <tr>
                          <th>Use</th>
                          <th>Field</th>
                          <th>Value from document</th>
                          {doc.patient && <th>In chart now</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {defs.map((f) => {
                          const hit = found[f.key];
                          const now = current(f.key);
                          const value = hit?.value ?? "";
                          const differs = Boolean(value && now && !same(now, value));
                          // New patient: use everything found. Existing patient: only fill what the chart is missing.
                          const checked = Boolean(value) && (!doc.patient || !now);
                          if (!hit && group !== "patient") return null;
                          return (
                            <tr key={f.key} className={differs ? "pd-differs" : undefined}>
                              <td>
                                <input type="checkbox" name={`use_${f.key}`} defaultChecked={checked} aria-label={`Use ${f.label}`} />
                              </td>
                              <td>
                                {f.label}
                                {hit && <span className={`pd-conf pd-conf-${hit.confidence}`}>{hit.confidence}</span>}
                                {hit?.source && <div className="pd-source" title={hit.source}>&ldquo;{hit.source}&rdquo;</div>}
                              </td>
                              <td>
                                {f.kind === "long" ? (
                                  <textarea name={`val_${f.key}`} defaultValue={value} rows={2} />
                                ) : (
                                  <input
                                    name={`val_${f.key}`}
                                    defaultValue={value}
                                    type={f.kind === "date" ? "date" : "text"}
                                    placeholder={hit && !value ? "Couldn't read — check the document" : undefined}
                                  />
                                )}
                              </td>
                              {doc.patient && (
                                <td className="pd-now">
                                  {now ?? <span className="muted">—</span>}
                                  {differs && <div className="gw-missing">differs</div>}
                                  {value && now && !differs && <div className="muted">same</div>}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </details>
                );
              })}

              {!doc.patient && candidates.length > 0 && (
                <label className="checkbox-inline">
                  <input type="checkbox" name="confirmNew" /> Register anyway (this isn&apos;t any of the possible matches above)
                </label>
              )}
              <div className="vw-step-actions">
                <button className="btn" type="submit" disabled={processing}>
                  {doc.patient ? "Apply ticked details to patient" : "Register patient & apply"}
                </button>
              </div>
            </form>
          ) : (
            <p className="muted">Only the data entry team can apply document details.</p>
          )}

          {canEdit && !doc.patient && (
            <details className="gw-inline-form">
              <summary>File to another existing patient</summary>
              <form action={linkDocument.bind(null, doc.id)} className="vw-inline">
                <select name="patientId" required defaultValue="">
                  <option value="" disabled>
                    Choose patient…
                  </option>
                  {allPatients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {patientName(p)} · {p.mrn} · DOB {formatDate(p.dob)}
                    </option>
                  ))}
                </select>
                <button className="btn secondary gw-mini" type="submit">
                  File to patient
                </button>
              </form>
            </details>
          )}

          {doc.extractedText && (
            <details className="pd-text">
              <summary>Text read from the document</summary>
              <pre>{doc.extractedText}</pre>
            </details>
          )}

          {canEdit && (
            <div className="vw-view-links">
              <form action={rereadDocument.bind(null, doc.id)}>
                <button className="btn ghost gw-mini" type="submit" disabled={processing}>
                  Read again
                </button>
              </form>
              <form action={deletePatientDocument.bind(null, doc.id)}>
                <button className="btn ghost gw-mini" type="submit">
                  Delete document
                </button>
              </form>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
