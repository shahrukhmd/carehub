import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { formatMoney } from "@/lib/format";
import {
  addSuperbillTemplateItem,
  createBillingProvider,
  createPayer,
  createReferringPhysician,
  createSuperbillTemplate,
  removeSuperbillTemplateItem,
  togglePayerActive,
  toggleBillingProviderActive,
  toggleReferringPhysicianActive,
  toggleSuperbillTemplateActive,
} from "./actions";

export default async function DirectoriesPage() {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "BILLER", "CLINICIAN"]);

  const [payers, physicians, billingProviders, superbillTemplates] = await Promise.all([
    prisma.payer.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } }),
    prisma.referringPhysician.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } }),
    prisma.billingProvider.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } }),
    prisma.superbillTemplate.findMany({
      where: { practiceId: user.practiceId },
      include: { items: { orderBy: { order: "asc" } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Practice management</p>
          <h1>Directories</h1>
        </div>
      </div>

      <div className="two-col" style={{ marginBottom: "1.25rem" }}>
        <section className="panel">
          <h2>Payers</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Payer code</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payers.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    {p.phone && <div className="muted">{p.phone}</div>}
                  </td>
                  <td>{p.payerCode ?? "—"}</td>
                  <td>
                    <StatusBadge value={p.active ? "ACTIVE" : "INACTIVE"} />
                  </td>
                  <td>
                    <form action={togglePayerActive.bind(null, p.id)}>
                      <button className="btn ghost" type="submit">
                        {p.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {payers.length === 0 && (
                <tr>
                  <td colSpan={4}>No payers yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <form className="panel stack" action={createPayer}>
          <h2>Add payer</h2>
          <label>
            Name
            <input name="name" placeholder="Horizon Blue Cross" required />
          </label>
          <label>
            Payer code
            <input name="payerCode" placeholder="EDI / clearinghouse ID" />
          </label>
          <label>
            Phone
            <input name="phone" />
          </label>
          <label>
            Address
            <input name="addressLine1" />
          </label>
          <div className="form-grid">
            <label>
              City
              <input name="city" />
            </label>
            <label>
              State
              <input name="state" />
            </label>
            <label>
              ZIP
              <input name="zip" />
            </label>
          </div>
          <button className="btn" type="submit">
            Add payer
          </button>
        </form>
      </div>

      <div className="two-col">
        <section className="panel">
          <h2>Referring physicians</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>NPI / specialty</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {physicians.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    {p.phone && <div className="muted">{p.phone}</div>}
                  </td>
                  <td>
                    {p.npi ?? "—"}
                    {p.specialty ? ` · ${p.specialty}` : ""}
                  </td>
                  <td>
                    <StatusBadge value={p.active ? "ACTIVE" : "INACTIVE"} />
                  </td>
                  <td>
                    <form action={toggleReferringPhysicianActive.bind(null, p.id)}>
                      <button className="btn ghost" type="submit">
                        {p.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {physicians.length === 0 && (
                <tr>
                  <td colSpan={4}>No referring physicians yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <form className="panel stack" action={createReferringPhysician}>
          <h2>Add referring physician</h2>
          <label>
            Name
            <input name="name" placeholder="Dr. Amanda Moore" required />
          </label>
          <label>
            NPI
            <input name="npi" />
          </label>
          <label>
            Specialty
            <input name="specialty" placeholder="Podiatry" />
          </label>
          <label>
            Phone
            <input name="phone" />
          </label>
          <label>
            Fax
            <input name="fax" />
          </label>
          <button className="btn" type="submit">
            Add referring physician
          </button>
        </form>
      </div>

      <div className="two-col" style={{ marginTop: "1.25rem" }}>
        <section className="panel">
          <h2>Billing providers</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>NPI / Tax ID</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {billingProviders.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    {p.addressLine1 && <div className="muted">{p.addressLine1}</div>}
                  </td>
                  <td>
                    {p.npi ?? "—"}
                    {p.taxId ? ` · ${p.taxId}` : ""}
                  </td>
                  <td>
                    <StatusBadge value={p.active ? "ACTIVE" : "INACTIVE"} />
                  </td>
                  <td>
                    <form action={toggleBillingProviderActive.bind(null, p.id)}>
                      <button className="btn ghost" type="submit">
                        {p.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {billingProviders.length === 0 && (
                <tr>
                  <td colSpan={4}>No billing providers yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <form className="panel stack" action={createBillingProvider}>
          <h2>Add billing provider</h2>
          <label>
            Name
            <input name="name" placeholder="Riverside Family Practice PLLC" required />
          </label>
          <label>
            NPI
            <input name="npi" />
          </label>
          <label>
            Tax ID (EIN)
            <input name="taxId" />
          </label>
          <label>
            Address
            <input name="addressLine1" />
          </label>
          <div className="form-grid">
            <label>
              City
              <input name="city" />
            </label>
            <label>
              State
              <input name="state" />
            </label>
            <label>
              ZIP
              <input name="zip" />
            </label>
          </div>
          <button className="btn" type="submit">
            Add billing provider
          </button>
        </form>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <section className="panel">
          <h2>Superbill templates</h2>
          <p className="muted">
            Common CPT codes with a preset fee, grouped by template, so charges can be added to a visit with one
            click instead of retyping codes every time.
          </p>
          <div className="two-col">
            {superbillTemplates.map((t) => (
              <div key={t.id} className="panel" style={{ background: "var(--panel-alt, #f7f7f9)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0 }}>
                    {t.name} <StatusBadge value={t.active ? "ACTIVE" : "INACTIVE"} />
                  </h3>
                  <form action={toggleSuperbillTemplateActive.bind(null, t.id)}>
                    <button className="btn ghost" type="submit">
                      {t.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>CPT</th>
                      <th>Description</th>
                      <th>Fee</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.cptCode}
                          {item.modifiers ? <div className="muted">{item.modifiers}</div> : null}
                        </td>
                        <td>{item.description}</td>
                        <td>{formatMoney(item.amountCents)}</td>
                        <td>
                          <form action={removeSuperbillTemplateItem.bind(null, item.id, t.id)}>
                            <button className="btn ghost" type="submit">
                              Remove
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                    {t.items.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted">
                          No items yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <form className="stack" action={addSuperbillTemplateItem.bind(null, t.id)}>
                  <div className="form-grid">
                    <label>
                      CPT
                      <input name="cptCode" placeholder="99213" required />
                    </label>
                    <label>
                      Description
                      <input name="description" required />
                    </label>
                    <label>
                      Fee (USD)
                      <input name="amount" type="number" step="0.01" required />
                    </label>
                    <label>
                      Modifiers
                      <input name="modifiers" placeholder="25" />
                    </label>
                  </div>
                  <button className="btn secondary" type="submit">
                    Add code to template
                  </button>
                </form>
              </div>
            ))}
            {superbillTemplates.length === 0 && <p className="muted">No superbill templates yet.</p>}

            <form className="panel stack" action={createSuperbillTemplate}>
              <h3>New template</h3>
              <label>
                Name
                <input name="name" placeholder="Family medicine — common visits" required />
              </label>
              <button className="btn" type="submit">
                Create template
              </button>
            </form>
          </div>
        </section>
      </div>
    </>
  );
}
