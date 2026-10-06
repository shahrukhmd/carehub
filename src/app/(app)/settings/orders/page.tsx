import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SEND_METHODS, ensureOrderCatalog } from "@/lib/orders";
import { specialtyLabel } from "@/lib/specialties";
import { SettingsNav } from "../settings-nav";
import { addCatalogItem, saveOrderProvider, toggleCatalogItem } from "../../orders/actions";

export default async function OrderSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser(["ADMIN"]);
  const sp = await searchParams;
  await ensureOrderCatalog(user.practiceId);
  const [providers, catalog] = await Promise.all([
    prisma.orderProvider.findMany({ where: { practiceId: user.practiceId }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    prisma.orderCatalogItem.findMany({ where: { practiceId: user.practiceId }, orderBy: [{ kind: "asc" }, { category: "asc" }, { name: "asc" }] }),
  ]);
  const providerFields = (p?: (typeof providers)[number]) => (
    <>
      <select name="kind" defaultValue={p?.kind ?? "LAB"} aria-label="Type">
        <option value="LAB">Lab</option>
        <option value="IMAGING">Imaging / vascular</option>
      </select>
      <input name="name" defaultValue={p?.name ?? ""} placeholder="Name (e.g. Quest Diagnostics)" required aria-label="Name" />
      <input name="phone" defaultValue={p?.phone ?? ""} placeholder="Phone" aria-label="Phone" />
      <input name="fax" defaultValue={p?.fax ?? ""} placeholder="Fax" aria-label="Fax" />
      <input name="accountNumber" defaultValue={p?.accountNumber ?? ""} placeholder="Account #" aria-label="Account number" />
      <select name="sendMethod" defaultValue={p?.sendMethod ?? "FAX"} aria-label="Send by">
        {Object.entries(SEND_METHODS).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      {p && (
        <select name="active" defaultValue={p.active ? "on" : "off"} aria-label="Status">
          <option value="on">Active</option>
          <option value="off">Inactive</option>
        </select>
      )}
    </>
  );
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Labs, imaging &amp; order catalog</h1>
        </div>
      </div>
      <SettingsNav current="orders" />
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      <section className="panel">
        <h2>Labs &amp; imaging centers</h2>
        <p className="muted">
          Where orders go. Fax sends the signed requisition through the practice fax line; electronic (HL7) ordering needs the lab&apos;s interface and isn&apos;t
          connected yet — results can still be imported from the lab&apos;s HL7 file on the Orders page.
        </p>
        {providers.map((p) => (
          <form key={p.id} action={saveOrderProvider.bind(null, p.id)} className="cn-inline or-prov">
            {providerFields(p)}
            <button className="btn ghost gw-mini" type="submit">
              Save
            </button>
          </form>
        ))}
        <form action={saveOrderProvider.bind(null, "new")} className="cn-inline or-prov">
          {providerFields()}
          <button className="btn secondary gw-mini" type="submit">
            Add
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>Order catalog</h2>
        <table className="cn-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Code</th>
              <th>Name</th>
              <th>Category</th>
              <th>Specimen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {catalog.map((c) => (
              <tr key={c.id} className={c.active ? "" : "muted"}>
                <td>{c.kind === "LAB" ? "Lab" : "Imaging"}</td>
                <td>{c.code}</td>
                <td>
                  {c.name}
                  {c.fasting && <span className="cn-tag">fasting</span>}
                  {c.specialty && <span className="cn-tag">{specialtyLabel(c.specialty)}</span>}
                </td>
                <td>{c.category}</td>
                <td className="cn-small">{c.specimen}</td>
                <td>
                  <form action={toggleCatalogItem.bind(null, c.id)}>
                    <button className="btn ghost gw-mini" type="submit">
                      {c.active ? "Hide" : "Show"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={addCatalogItem} className="cn-inline" style={{ marginTop: "0.7rem" }}>
          <select name="kind" aria-label="Type">
            <option value="LAB">Lab</option>
            <option value="IMAGING">Imaging</option>
          </select>
          <input name="code" placeholder="LOINC / CPT" aria-label="Code" />
          <input name="name" placeholder="Test or study name" required aria-label="Name" />
          <input name="category" placeholder="Category" aria-label="Category" />
          <input name="specimen" placeholder="Specimen" aria-label="Specimen" />
          <label className="checkbox-inline">
            <input type="checkbox" name="fasting" /> Fasting
          </label>
          <button className="btn secondary gw-mini" type="submit">
            Add to catalog
          </button>
        </form>
      </section>
    </div>
  );
}
