import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PRODUCT_TYPES, UNITS, ensureWoundProducts } from "@/lib/wound-products";
import { SettingsNav } from "../settings-nav";
import { addProduct, addStep, saveSteps, toggleProduct, updateProduct } from "./actions";

type Search = { tab?: string; ok?: string; error?: string; type?: string; edit?: string };

// Wound products (brand → product → type, with the HCPCS code billed) and the steps a treatment note is built from.
export default async function WoundProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const tab = sp.tab === "steps" ? "steps" : "products";
  await ensureWoundProducts(user.practiceId);
  const [products, steps] = await Promise.all([
    prisma.woundProduct.findMany({ where: { practiceId: user.practiceId }, orderBy: [{ productType: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
    prisma.treatmentStep.findMany({ where: { practiceId: user.practiceId }, orderBy: { sortOrder: "asc" } }),
  ]);
  const shown = sp.type && sp.type in PRODUCT_TYPES ? products.filter((p) => p.productType === sp.type) : products;
  const editing = sp.edit ? products.find((p) => p.id === sp.edit) : null;

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link> · Clinical
          </p>
          <h1>Wound products &amp; treatment steps</h1>
          <p className="muted" style={{ margin: 0 }}>
            A treatment note picks a product for each step. Products with an HCPCS code can be pushed to the superbill from the note.
          </p>
        </div>
      </div>
      <SettingsNav current="wound-products" />
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <nav className="view-tabs" style={{ width: "fit-content" }}>
        <Link href="/settings/wound-products" className={`view-tab${tab === "products" ? " active" : ""}`}>
          Products ({products.length})
        </Link>
        <Link href="/settings/wound-products?tab=steps" className={`view-tab${tab === "steps" ? " active" : ""}`}>
          Treatment steps ({steps.length})
        </Link>
      </nav>

      {tab === "products" && (
        <>
          <section className="panel">
            <h2>{editing ? `Edit: ${editing.name}` : "Add a product"}</h2>
            <form action={editing ? updateProduct.bind(null, editing.id) : addProduct} className="form-grid gw-grid-3">
              <label>
                Product name
                <input name="name" required defaultValue={editing?.name ?? ""} placeholder="e.g. Calcium alginate 4×4" />
              </label>
              <label>
                Brand
                <input name="brand" defaultValue={editing?.brand ?? ""} placeholder="Manufacturer / brand" />
              </label>
              <label>
                Type
                <select name="productType" defaultValue={editing?.productType ?? "PRIMARY"}>
                  {Object.entries(PRODUCT_TYPES).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                HCPCS code (billed per unit)
                <input name="hcpcsCode" defaultValue={editing?.hcpcsCode ?? ""} maxLength={5} placeholder="A6196" />
              </label>
              <label>
                Unit
                <select name="unit" defaultValue={editing?.unit ?? "each"}>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Size
                <input name="size" defaultValue={editing?.size ?? ""} placeholder="e.g. 4×4 in, up to 16 in²" />
              </label>
              <label className="gw-span-2">
                Default instructions (shown on the treatment note)
                <input name="instructions" defaultValue={editing?.instructions ?? ""} />
              </label>
              {editing && (
                <label className="checkbox-inline">
                  <input type="checkbox" name="active" defaultChecked={editing.active} /> Active
                </label>
              )}
              <div className="gw-actions">
                <button className="btn" type="submit">
                  {editing ? "Save product" : "Add product"}
                </button>
                {editing && (
                  <Link className="btn ghost" href="/settings/wound-products">
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          </section>
          <section className="panel">
            <div className="gw-section-head">
              <h2>Product catalog</h2>
              <form method="get" className="cn-inline">
                <select name="type" defaultValue={sp.type ?? ""} aria-label="Type">
                  <option value="">All types</option>
                  {Object.entries(PRODUCT_TYPES).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <button className="btn secondary gw-mini" type="submit">
                  Filter
                </button>
              </form>
            </div>
            <table className="cn-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Product</th>
                  <th>Brand</th>
                  <th>HCPCS</th>
                  <th>Unit / size</th>
                  <th>Instructions</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className={p.active ? undefined : "muted"}>
                    <td className="cn-small">{PRODUCT_TYPES[p.productType] ?? p.productType}</td>
                    <td>
                      <strong>{p.name}</strong>
                      {!p.active && <span className="gw-tag gw-tag-muted">Hidden</span>}
                      {p.standard && <span className="muted cn-small"> · standard</span>}
                    </td>
                    <td>{p.brand ?? "—"}</td>
                    <td>{p.hcpcsCode ?? "—"}</td>
                    <td className="cn-small">
                      {p.unit}
                      {p.size ? ` · ${p.size}` : ""}
                    </td>
                    <td className="cn-small">{p.instructions ?? ""}</td>
                    <td className="cn-actions">
                      <Link className="btn ghost gw-mini" href={`/settings/wound-products?edit=${p.id}`}>
                        Edit
                      </Link>
                      <form action={toggleProduct.bind(null, p.id)}>
                        <button className="btn ghost gw-mini" type="submit">
                          {p.active ? "Hide" : "Show"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === "steps" && (
        <>
          <section className="panel">
            <h2>Treatment steps</h2>
            <p className="muted">The order a treatment is documented in, and which product types each step offers.</p>
            <form action={saveSteps} className="stack">
              <table className="cn-table">
                <thead>
                  <tr>
                    <th>Active</th>
                    <th>Step</th>
                    <th>Product types offered</th>
                    <th>Order</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((s) => {
                    const types = new Set(s.productTypes.split(",").filter(Boolean));
                    return (
                      <tr key={s.id} className={s.active ? undefined : "muted"}>
                        <td>
                          <input type="checkbox" name={`active_${s.id}`} defaultChecked={s.active} aria-label={`${s.name} active`} />
                        </td>
                        <td>
                          <input name={`name_${s.id}`} defaultValue={s.name} aria-label="Step name" />
                        </td>
                        <td className="st-checks">
                          {Object.entries(PRODUCT_TYPES).map(([k, l]) => (
                            <label key={k} className="checkbox-inline cn-small">
                              <input type="checkbox" name={`types_${s.id}`} value={k} defaultChecked={types.has(k)} /> {l}
                            </label>
                          ))}
                        </td>
                        <td>
                          <input name={`order_${s.id}`} type="number" defaultValue={s.sortOrder} className="st-num" aria-label={`${s.name} order`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="form-actions">
                <button className="btn" type="submit">
                  Save steps
                </button>
              </div>
            </form>
          </section>
          <section className="panel">
            <h2>Add a step</h2>
            <form action={addStep} className="form-grid gw-grid-3">
              <label>
                Step name
                <input name="name" required placeholder="e.g. Apply skin substitute" />
              </label>
              <div className="gw-span-2 st-checks">
                {Object.entries(PRODUCT_TYPES).map(([k, l]) => (
                  <label key={k} className="checkbox-inline cn-small">
                    <input type="checkbox" name="productTypes" value={k} /> {l}
                  </label>
                ))}
              </div>
              <button className="btn secondary" type="submit">
                Add step
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
