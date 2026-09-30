import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GATEWAY_ROLES, canWorkTeam } from "@/lib/gateway";
import { AutoRefresh } from "@/components/AutoRefresh";
import { formatDate, patientName } from "@/lib/format";
import { DOC_STATUS, DOC_TYPES, READ_METHODS, parseExtraction } from "@/lib/patient-docs";
import { claudeConfigured } from "@/lib/document-reader";
import { uploadPatientDocuments } from "./actions";

const TABS: [string, string][] = [
  ["review", "To review"],
  ["unfiled", "Not filed to a patient"],
  ["applied", "Applied"],
  ["all", "All documents"],
];

export default async function PatientDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; error?: string; uploaded?: string; q?: string }>;
}) {
  const user = await requireUser(GATEWAY_ROLES);
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "review";
  const canUpload = canWorkTeam(user.role, "DATA_ENTRY");
  const where: Prisma.PatientDocumentWhereInput = {
    practiceId: user.practiceId,
    ...(tab === "review" ? { status: { in: ["PROCESSING", "READ", "FAILED"] } } : {}),
    ...(tab === "unfiled" ? { patientId: null } : {}),
    ...(tab === "applied" ? { status: "APPLIED" } : {}),
    ...(sp.q ? { name: { contains: sp.q } } : {}),
  };
  const [docs, counts, settings] = await Promise.all([
    prisma.patientDocument.findMany({
      where,
      include: { patient: true, uploadedBy: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.patientDocument.groupBy({ by: ["status"], where: { practiceId: user.practiceId }, _count: { _all: true } }),
    prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId } }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const reading = docs.some((d) => d.status === "PROCESSING");
  const aiOn = Boolean(settings?.documentAiEnabled && claudeConfigured());

  return (
    <div className="stack">
      {reading && <AutoRefresh seconds={4} />}
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/?tab=data-entry">Patient Gateway</Link> · Data entry
          </p>
          <h1>Patient documents</h1>
        </div>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.uploaded && <p className="notice-ok">{sp.uploaded} documents uploaded — they&apos;re being read now.</p>}

      {canUpload && (
        <section className="panel">
          <h2>Upload documents</h2>
          <p className="muted">
            Referrals, face sheets, insurance cards, IDs, orders — PDF, PNG or JPG. Each document is read automatically (
            {aiOn ? "with Claude AI" : "on this computer: PDF text, or OCR for scans and photos"}), then you review the details, rename it, and fill the
            patient&apos;s record in one step.
          </p>
          <form action={uploadPatientDocuments} className="form-grid gw-grid-3">
            <label className="pd-drop">
              Documents (up to 20, 10 MB each)
              <input type="file" name="files" multiple required accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,application/pdf,image/png,image/jpeg" />
            </label>
            <label>
              Document type
              <select name="docType" defaultValue="OTHER">
                <option value="OTHER">Detect automatically</option>
                {Object.entries(DOC_TYPES)
                  .filter(([k]) => k !== "OTHER")
                  .map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
              </select>
            </label>
            <button className="btn" type="submit">
              Upload &amp; read
            </button>
          </form>
        </section>
      )}

      <nav className="view-tabs" style={{ width: "fit-content", flexWrap: "wrap" }}>
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/gateway/documents?tab=${k}`} className={`view-tab${tab === k ? " active" : ""}`}>
            {l}
            {k === "review" ? ` (${count("PROCESSING") + count("READ") + count("FAILED")})` : ""}
          </Link>
        ))}
      </nav>

      <section className="panel">
        <form className="vw-inline" style={{ marginBottom: "0.7rem" }}>
          <input type="hidden" name="tab" value={tab} />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search document name" aria-label="Search documents" />
          <button className="btn secondary gw-mini" type="submit">
            Search
          </button>
        </form>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Patient</th>
                <th>Status</th>
                <th>Found</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const found = Object.values(parseExtraction(d.extraction)?.fields ?? {}).filter((f) => f.value).length;
                return (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/gateway/documents/${d.id}`}>{d.name}</Link>
                      {d.name !== d.originalName && <div className="muted">{d.originalName}</div>}
                    </td>
                    <td>{DOC_TYPES[d.docType] ?? d.docType}</td>
                    <td>{d.patient ? <Link href={`/patients/${d.patient.id}`}>{patientName(d.patient)}</Link> : <span className="muted">Not filed</span>}</td>
                    <td>
                      <span
                        className={`gw-tag gw-tag-${d.status === "APPLIED" ? "ok" : d.status === "FAILED" ? "bad" : d.status === "READ" ? "warn" : "info"}`}
                      >
                        {DOC_STATUS[d.status] ?? d.status}
                      </span>
                      {d.readMethod && <div className="muted">{READ_METHODS[d.readMethod]}</div>}
                    </td>
                    <td>{d.status === "PROCESSING" ? "…" : found}</td>
                    <td>
                      {formatDate(d.createdAt)}
                      <div className="muted">{d.uploadedBy?.name ?? ""}</div>
                    </td>
                  </tr>
                );
              })}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No documents here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
