import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { patientName } from "@/lib/format";
import { ORDER_WRITE_ROLES, ensureOrderCatalog } from "@/lib/orders";
import { createOrder } from "../actions";

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ patientId?: string; kind?: string; encounterId?: string; error?: string }> }) {
  const user = await requireUser(ORDER_WRITE_ROLES);
  const sp = await searchParams;
  const kind = sp.kind === "IMAGING" ? "IMAGING" : "LAB";
  await ensureOrderCatalog(user.practiceId);
  const [patient, patients, catalog, providers] = await Promise.all([
    sp.patientId ? prisma.patient.findFirst({ where: { id: sp.patientId, practiceId: user.practiceId }, include: { problems: { where: { status: "ACTIVE" } }, encounters: { orderBy: { date: "desc" }, take: 1, include: { diagnoses: { orderBy: { priority: "asc" } } } } } }) : null,
    sp.patientId ? Promise.resolve([]) : prisma.patient.findMany({ where: { practiceId: user.practiceId, status: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 2000 }),
    prisma.orderCatalogItem.findMany({ where: { practiceId: user.practiceId, kind, active: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    prisma.orderProvider.findMany({ where: { practiceId: user.practiceId, kind, active: true }, orderBy: { name: "asc" } }),
  ]);
  const dx = patient ? [...new Set([...(patient.encounters[0]?.diagnoses.map((d) => d.icd10) ?? []), ...patient.problems.map((p) => p.icd10)])].slice(0, 8).join(", ") : "";
  const groups = new Map<string, typeof catalog>();
  for (const c of catalog) groups.set(c.category ?? "Other", [...(groups.get(c.category ?? "Other") ?? []), c]);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/orders">Lab &amp; imaging orders</Link>
            {patient ? (
              <>
                {" · "}
                <Link href={`/patients/${patient.id}`}>{patientName(patient)}</Link>
              </>
            ) : null}
          </p>
          <h1>New {kind === "LAB" ? "lab" : "imaging"} order</h1>
        </div>
        <Link className="btn ghost" href={`/orders/new?kind=${kind === "LAB" ? "IMAGING" : "LAB"}${sp.patientId ? `&patientId=${sp.patientId}` : ""}`}>
          Switch to {kind === "LAB" ? "imaging" : "lab"}
        </Link>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {!patient ? (
        <section className="panel">
          <form method="get" className="cn-inline">
            <input type="hidden" name="kind" value={kind} />
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
        <form action={createOrder} className="stack">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="patientId" value={patient.id} />
          {sp.encounterId && <input type="hidden" name="encounterId" value={sp.encounterId} />}
          <section className="panel">
            <h2>{kind === "LAB" ? "Tests" : "Studies"}</h2>
            <div className="or-groups">
              {[...groups.entries()].map(([g, items]) => (
                <fieldset key={g} className="or-group">
                  <legend>{g}</legend>
                  {items.map((c) => (
                    <label key={c.id} className="checkbox-inline">
                      <input type="checkbox" name="item" value={c.id} /> {c.name}
                      <span className="muted cn-small">
                        {c.code}
                        {c.fasting ? " · fasting" : ""}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <label>
              Other {kind === "LAB" ? "tests" : "studies"} (one per line, optionally &quot;CODE - Name&quot;)
              <textarea name="custom" rows={2} />
            </label>
          </section>
          <section className="panel">
            <div className="form-grid gw-grid-3">
              <label>
                {kind === "LAB" ? "Lab" : "Imaging center"}
                <select name="providerId" defaultValue={providers[0]?.id ?? ""}>
                  <option value="">Not chosen (patient picks / print)</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select name="priority" defaultValue="ROUTINE">
                  <option value="ROUTINE">Routine</option>
                  <option value="URGENT">Urgent</option>
                  <option value="STAT">STAT</option>
                </select>
              </label>
              <label>
                {kind === "LAB" ? "Draw / collect by" : "Schedule for"} (optional)
                <input type="date" name="scheduledFor" />
              </label>
              <label className="gw-span-2">
                Diagnosis codes (ICD-10)
                <input name="diagnosisCodes" defaultValue={dx} placeholder="E11.621, L97.412" />
              </label>
              {kind === "LAB" && (
                <label className="checkbox-inline">
                  <input type="checkbox" name="fasting" /> Fasting
                </label>
              )}
              <label className="gw-span-3">
                Clinical information for the {kind === "LAB" ? "lab" : "radiologist"}
                <textarea name="clinicalNotes" rows={2} placeholder={kind === "IMAGING" ? "e.g. Non-healing plantar ulcer 6 weeks, probe-to-bone positive — rule out osteomyelitis" : ""} />
              </label>
            </div>
            <label className="checkbox-inline">
              <input type="checkbox" name="sign" defaultChecked /> Sign now
            </label>
            <div style={{ marginTop: "0.6rem" }}>
              <button className="btn" type="submit">
                Save order
              </button>
            </div>
            {providers.length === 0 && (
              <p className="muted cn-small">
                No {kind === "LAB" ? "labs" : "imaging centers"} set up yet{user.role === "ADMIN" ? <> — add them in <Link href="/settings/orders">Labs &amp; catalog</Link></> : ""}. You can still print the requisition.
              </p>
            )}
          </section>
        </form>
      )}
    </div>
  );
}
