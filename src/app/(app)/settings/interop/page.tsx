import Link from "next/link";
import { cookies, headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatTime } from "@/lib/format";
import { FHIR_RESOURCES } from "@/lib/fhir";
import { CopyButton } from "@/components/CopyButton";
import { SettingsNav } from "../settings-nav";
import { createApiClient, revokeApiClient } from "./actions";

export default async function InteropPage({ searchParams }: { searchParams: Promise<{ created?: string; error?: string }> }) {
  const user = await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const token = sp.created ? (await cookies()).get("ch_new_token")?.value : undefined;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const [clients, unreported] = await Promise.all([
    prisma.apiClient.findMany({ where: { practiceId: user.practiceId }, orderBy: { createdAt: "desc" } }),
    prisma.immunization.count({ where: { practiceId: user.practiceId, reportedAt: null, source: { not: "HISTORICAL" } } }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Interoperability</h1>
        </div>
      </div>
      <SettingsNav current="interop" />
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {token && (
        <section className="panel cn-sent">
          <div>
            <h2>New API token — copy it now</h2>
            <p className="muted">This is the only time it is shown. Give it to the connected system as a Bearer token.</p>
            <p>
              <code className="cn-link">{token}</code> <CopyButton text={token} label="Copy token" />
            </p>
          </div>
        </section>
      )}
      <section className="panel">
        <h2>FHIR API (read-only)</h2>
        <p className="muted">
          Hospitals, HIEs, care-management platforms and payers can read patient data through a FHIR R4 (US Core-style) API. Every call is recorded in the audit
          log.
        </p>
        <p>
          Base URL: <code>{origin}/api/fhir</code> <CopyButton text={`${origin}/api/fhir`} label="Copy URL" />
        </p>
        <p className="muted cn-small">
          Resources: {FHIR_RESOURCES.join(", ")} · Patient search by family, given, name, birthdate or identifier (MRN) · clinical resources by <code>?patient=</code> ·{" "}
          <code>Patient/&lt;id&gt;/$everything</code> · capability statement at <code>/api/fhir/metadata</code>.
        </p>
        <table className="cn-table">
          <thead>
            <tr>
              <th>Connected system</th>
              <th>Token</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No API clients yet.
                </td>
              </tr>
            )}
            {clients.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.name}
                  <div className="muted cn-small">created {formatDate(c.createdAt)}</div>
                </td>
                <td>
                  <code>chk_…{c.tokenHint}</code>
                </td>
                <td>{c.lastUsedAt ? `${formatDate(c.lastUsedAt)} ${formatTime(c.lastUsedAt)}` : "Never"}</td>
                <td>{c.active ? "Active" : <span className="muted">Revoked</span>}</td>
                <td>
                  {c.active && (
                    <form action={revokeApiClient.bind(null, c.id)}>
                      <button className="btn ghost gw-mini" type="submit">
                        Revoke
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={createApiClient} className="cn-inline">
          <input name="name" required placeholder="e.g. Banner Health HIE" aria-label="Connected system name" />
          <button className="btn secondary" type="submit">
            Create API token
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>C-CDA care summaries</h2>
        <p className="muted">
          Every patient chart has <strong>Export C-CDA</strong> (a Continuity of Care Document with problems, wounds, medications, allergies, immunizations,
          vitals, results, visits and insurance) for referrals and transitions of care, and <strong>Import C-CDA</strong> to bring problems, medications,
          allergies and immunizations in from another system after review.
        </p>
      </section>
      <section className="panel">
        <h2>Immunization registry (IIS)</h2>
        <p className="muted">
          Download doses given here as an HL7 v2.5.1 VXU file for upload to the state immunization registry. {unreported} dose{unreported === 1 ? "" : "s"} not yet
          reported.
        </p>
        <form action="/api/immunizations/export" method="get" className="cn-inline">
          <label className="checkbox-inline">
            From <input type="date" name="from" defaultValue={monthAgo} />
          </label>
          <label className="checkbox-inline">
            To <input type="date" name="to" defaultValue={today} />
          </label>
          <label className="checkbox-inline">
            <input type="checkbox" name="unreported" value="1" defaultChecked /> Only not yet reported
          </label>
          <label className="checkbox-inline">
            <input type="checkbox" name="mark" value="1" /> Mark as reported
          </label>
          <button className="btn secondary" type="submit">
            Download VXU file
          </button>
        </form>
      </section>
    </div>
  );
}
