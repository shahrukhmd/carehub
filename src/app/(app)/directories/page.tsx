import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { formatMoney, insuranceTypeLabel, providerRoleLabel } from "@/lib/format";
import {
  addSuperbillTemplateItem,
  createBillingProvider,
  createSuperbillTemplate,
  removeSuperbillTemplateItem,
  savePracticeCode,
  togglePracticeCode,
  toggleBillingProviderActive,
  toggleSuperbillTemplateActive,
} from "./actions";

type SearchParams = Record<string, string | undefined>;

const SECTIONS = [
  { key: "providers", label: "Providers" },
  { key: "insurance", label: "Insurance" },
  { key: "groups", label: "Groups (billing entities)" },
  { key: "superbills", label: "Superbill templates" },
  { key: "codes", label: "Code lists & fees" },
];

const ROLE_FILTERS = [["", "All types"], ...Object.entries(providerRoleLabel)] as const;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export default async function DirectoriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "BILLER", "CLINICIAN", "CREDENTIALING", "INTAKE", "VERIFICATION", "SCHEDULER", "CDS"]);
  const sp = await searchParams;
  const section = SECTIONS.some((x) => x.key === sp.section) ? sp.section! : "providers";
  const canEditProviders = ["ADMIN", "CREDENTIALING", "FRONT_DESK"].includes(user.role);
  const canEditInsurance = ["ADMIN", "FRONT_DESK", "BILLER", "CREDENTIALING"].includes(user.role);
  const q = (sp.q ?? "").trim();
  const role = sp.type && sp.type in providerRoleLabel ? (sp.type as keyof typeof providerRoleLabel) : null;
  const letter = sp.letter && LETTERS.includes(sp.letter) ? sp.letter : null;

  const [providers, payers, billingProviders, superbillTemplates] = await Promise.all([
    section === "providers"
      ? prisma.renderingProvider.findMany({
          where: {
            practiceId: user.practiceId,
            ...(role ? { [role]: true } : {}),
            ...(q ? { OR: [{ name: { contains: q } }, { npi: { contains: q } }, { specialty: { contains: q } }] } : {}),
          },
          include: { supervisingProvider: true, user: true },
          orderBy: [{ status: "asc" }, { name: "asc" }],
        })
      : [],
    section === "insurance"
      ? prisma.payer.findMany({
          where: {
            practiceId: user.practiceId,
            ...(letter ? { name: { startsWith: letter } } : {}),
            ...(q ? { OR: [{ name: { contains: q } }, { payerCode: { contains: q } }, { eraPayerId: { contains: q } }] } : {}),
          },
          include: { parentPayer: true, alternatePayer: true },
          orderBy: { name: "asc" },
        })
      : [],
    prisma.billingProvider.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } }),
    section === "superbills"
      ? prisma.superbillTemplate.findMany({
          where: { practiceId: user.practiceId },
          include: { items: { orderBy: { order: "asc" } } },
          orderBy: { name: "asc" },
        })
      : [],
  ]);
  const practiceCodes =
    section === "codes"
      ? await prisma.practiceCode.findMany({
          where: { practiceId: user.practiceId },
          orderBy: [{ type: "asc" }, { active: "desc" }, { code: "asc" }],
        })
      : [];
  const canEditCodes = ["ADMIN", "BILLER", "CDS"].includes(user.role);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Practice management</p>
          <h1>Directories</h1>
        </div>
        {section === "providers" && canEditProviders && (
          <Link className="btn" href="/directories/providers/new">
            Add provider
          </Link>
        )}
        {section === "insurance" && canEditInsurance && (
          <Link className="btn" href="/directories/insurance/new">
            Add insurance
          </Link>
        )}
      </div>

      <nav className="view-tabs" style={{ marginBottom: "0.9rem", width: "fit-content" }}>
        {SECTIONS.map((x) => (
          <Link key={x.key} href={`/directories?section=${x.key}`} className={`view-tab${x.key === section ? " active" : ""}`}>
            {x.label}
          </Link>
        ))}
      </nav>

      {section === "providers" && (
        <section className="panel">
          <form method="get" className="compact-filters" style={{ marginBottom: "0.7rem" }}>
            <input type="hidden" name="section" value="providers" />
            <nav className="view-tabs">
              {ROLE_FILTERS.map(([key, label]) => (
                <Link
                  key={key}
                  href={`/directories?section=providers${key ? `&type=${key}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                  className={`view-tab${(role ?? "") === key ? " active" : ""}`}
                >
                  {label}
                </Link>
              ))}
            </nav>
            {role && <input type="hidden" name="type" value={role} />}
            <label>
              Search
              <input name="q" defaultValue={q} placeholder="Name, NPI or specialty" />
            </label>
            <button className="btn secondary" type="submit">
              Search
            </button>
          </form>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Type</th>
                <th>NPI / TIN</th>
                <th>License</th>
                <th>Specialty</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    {p.credential ? `, ${p.credential}` : ""}
                    <div className="muted">
                      {[p.phone, p.email, p.user ? "has CareHub login" : null].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td>
                    <span className="role-tags">
                      {(Object.keys(providerRoleLabel) as (keyof typeof providerRoleLabel)[])
                        .filter((k) => p[k])
                        .map((k) => (
                          <span key={k} className={`role-tag role-${k}`}>
                            {providerRoleLabel[k]}
                          </span>
                        ))}
                    </span>
                    {p.supervisingProvider && <div className="muted">Supervised by {p.supervisingProvider.name}</div>}
                  </td>
                  <td>
                    {p.npi ?? "—"}
                    {p.tin && <div className="muted">TIN {p.tin}</div>}
                  </td>
                  <td>
                    {p.licenseNumber ?? "—"}
                    {p.licenseState ? ` (${p.licenseState})` : ""}
                  </td>
                  <td>{p.specialty ?? "—"}</td>
                  <td>
                    <StatusBadge value={p.status} />
                  </td>
                  <td>
                    {canEditProviders && (
                      <Link className="btn ghost" href={`/directories/providers/${p.id}`}>
                        Edit
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No providers match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {section === "insurance" && (
        <section className="panel">
          <div className="az-index">
            {LETTERS.map((l) => (
              <Link
                key={l}
                href={`/directories?section=insurance&letter=${l}`}
                className={letter === l ? "active" : ""}
              >
                {l}
              </Link>
            ))}
            <Link href="/directories?section=insurance" className={!letter ? "active" : ""}>
              All
            </Link>
          </div>
          <form method="get" className="compact-filters" style={{ margin: "0.6rem 0 0.7rem" }}>
            <input type="hidden" name="section" value="insurance" />
            <label>
              Search
              <input name="q" defaultValue={q} placeholder="Name or payer ID" />
            </label>
            <button className="btn secondary" type="submit">
              Search
            </button>
          </form>
          <table>
            <thead>
              <tr>
                <th>Insurance</th>
                <th>Type</th>
                <th>EDI / ERA / eligibility ID</th>
                <th>Phone</th>
                <th>Timely filing</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payers.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    <div className="muted">
                      {[p.addressLine1, p.city, p.state].filter(Boolean).join(", ")}
                      {p.parentPayer ? ` · follows ${p.parentPayer.name}` : ""}
                      {p.alternatePayer ? ` · alternate: ${p.alternatePayer.name}` : ""}
                    </div>
                  </td>
                  <td>{p.insuranceType ? insuranceTypeLabel[p.insuranceType] : "—"}</td>
                  <td>
                    {p.payerCode ?? "—"} / {p.eraPayerId ?? "—"} / {p.eligibilityPayerId ?? "—"}
                  </td>
                  <td>{p.phone ?? "—"}</td>
                  <td>
                    {p.timelyFilingLimit ? `${p.timelyFilingLimit} ${p.timelyFilingUnit.toLowerCase()}` : "—"}
                  </td>
                  <td>
                    <StatusBadge value={p.active ? "ACTIVE" : "INACTIVE"} />
                  </td>
                  <td>
                    {canEditInsurance && (
                      <Link className="btn ghost" href={`/directories/insurance/${p.id}`}>
                        Edit
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {payers.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No insurances match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {section === "groups" && (
      <div className="two-col">
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
      )}

      {section === "superbills" && (
      <div>
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
      )}
      {section === "codes" && (
        <div className="stack">
          <section className="panel">
            <h2>Code lists &amp; fee schedule</h2>
            <p className="muted">
              ICD-10 favorites appear first on every superbill; CPT/HCPCS codes carry the practice fee and default modifiers. The
              built-in quick reference (wound care, E/M, debridement, skin substitutes…) is always available on the superbill.
            </p>
            {canEditCodes && (
              <form action={savePracticeCode} className="form-grid gw-grid-3">
                <label>
                  Type
                  <select name="type" defaultValue="CPT">
                    <option value="CPT">CPT / HCPCS</option>
                    <option value="ICD10">ICD-10 diagnosis</option>
                  </select>
                </label>
                <label>
                  Code
                  <input name="code" required placeholder="99213 or L97.422" className="cl-code" />
                </label>
                <label>
                  Description
                  <input name="description" required />
                </label>
                <label>
                  Category
                  <input name="category" placeholder="Wound care, E/M…" />
                </label>
                <label>
                  Fee $ (CPT)
                  <input name="fee" inputMode="decimal" />
                </label>
                <label>
                  Default modifiers (CPT)
                  <input name="modifiers" placeholder="25" />
                </label>
                <button className="btn" type="submit">
                  Save code
                </button>
              </form>
            )}
          </section>
          <section className="panel">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Fee</th>
                  <th>Modifiers</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {practiceCodes.map((c) => (
                  <tr key={c.id}>
                    <td>{c.type === "CPT" ? "CPT" : "ICD-10"}</td>
                    <td className="cl-code">{c.code}</td>
                    <td>{c.description}</td>
                    <td>{c.category ?? "—"}</td>
                    <td>{c.feeCents != null ? `$${(c.feeCents / 100).toFixed(2)}` : "—"}</td>
                    <td>{c.modifiers ?? "—"}</td>
                    <td>{c.active ? "Active" : "Inactive"}</td>
                    <td>
                      {canEditCodes && (
                        <form action={togglePracticeCode.bind(null, c.id)}>
                          <button className="btn ghost gw-mini" type="submit">
                            {c.active ? "Deactivate" : "Activate"}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
                {practiceCodes.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted">
                      No practice codes yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </>
  );
}
