import Link from "next/link";
import type { Location } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { US_STATES } from "@/lib/format";
import { placeOfServiceLabel } from "@/lib/superbill";
import { SettingsNav } from "../settings-nav";
import { addSite, deleteServiceType, saveServiceType, updateSite } from "./actions";
import { AddressValidator } from "@/components/AddressValidator";

type Search = { tab?: string; q?: string; type?: string; add?: string; edit?: string; error?: string; ok?: string };

function SiteForm({ site, types, action, cancel }: { site?: Location; types: { id: string; name: string }[]; action: (fd: FormData) => Promise<void>; cancel: string }) {
  return (
    <form action={action} className="st-site">
      <div className="form-grid">
        <label className="pv-wide">
          Site of service
          <input name="name" defaultValue={site?.name ?? ""} required maxLength={120} />
        </label>
        <label>
          Service type
          <select name="serviceTypeId" defaultValue={site?.serviceTypeId ?? ""}>
            <option value="">—</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Address 1
          <input name="addressLine1" defaultValue={site?.addressLine1 ?? ""} maxLength={120} />
        </label>
        <label>
          Address 2
          <input name="addressLine2" defaultValue={site?.addressLine2 ?? ""} maxLength={120} />
        </label>
        <label>
          City
          <input name="city" defaultValue={site?.city ?? ""} maxLength={80} />
        </label>
        <label>
          State
          <select name="state" defaultValue={site?.state ?? ""}>
            <option value="">—</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          ZIP
          <input name="zip" defaultValue={site?.zip ?? ""} placeholder="12345 or 12345-6789" maxLength={10} />
        </label>
        <AddressValidator fields={{ line1: "addressLine1", line2: "addressLine2", city: "city", state: "state", zip: "zip" }} />
        <label>
          Phone
          <input name="phone" defaultValue={site?.phone ?? ""} maxLength={30} />
        </label>
        <label>
          Fax
          <input name="fax" defaultValue={site?.fax ?? ""} maxLength={30} />
        </label>
        <label>
          Email
          <input name="email" type="email" defaultValue={site?.email ?? ""} maxLength={160} />
        </label>
      </div>
      <div className="form-grid">
        <label className="pv-wide">
          Place of service (on claims for visits here)
          <select name="placeOfService" defaultValue={site?.placeOfService ?? ""}>
            <option value="">— Set on each visit —</option>
            {Object.entries(placeOfServiceLabel).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tax ID
          <input name="taxId" defaultValue={site?.taxId ?? ""} placeholder="12-3456789" maxLength={10} />
        </label>
        <label>
          Facility NPI
          <input name="npi" defaultValue={site?.npi ?? ""} inputMode="numeric" maxLength={10} />
        </label>
        <label>
          Group NPI
          <input name="groupNpi" defaultValue={site?.groupNpi ?? ""} inputMode="numeric" maxLength={10} />
        </label>
        <label>
          PTAN
          <input name="ptan" defaultValue={site?.ptan ?? ""} maxLength={20} />
        </label>
        <label className="cm-check" title="The facility bills for services at this site">
          <input type="checkbox" name="facilityBilling" defaultChecked={site?.facilityBilling ?? false} />
          Facility billing
        </label>
        <label className="cm-check" title="Inactive sites stay on past visits and claims but are not offered for new patients or bookings">
          <input type="checkbox" name="active" defaultChecked={site?.active ?? true} />
          Active
        </label>
        <div className="pv-actions">
          <button className="btn" type="submit">
            {site ? "Save site" : "Add site"}
          </button>
          <Link className="btn ghost" href={cancel}>
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}

// Sites of service (facilities the practice visits, and its own clinics) and the kinds of site.
export default async function SitesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const tab = sp.tab === "types" ? "types" : "sites";
  const [sites, types] = await Promise.all([
    prisma.location.findMany({ where: { practiceId: user.practiceId }, include: { serviceType: true, _count: { select: { appointments: true } } }, orderBy: { name: "asc" } }),
    prisma.serviceType.findMany({ where: { practiceId: user.practiceId }, include: { _count: { select: { locations: true } } }, orderBy: { name: "asc" } }),
  ]);
  const q = sp.q?.trim().toLowerCase() ?? "";
  const shown = sites.filter((s) => (!q || s.name.toLowerCase().includes(q) || (s.city ?? "").toLowerCase().includes(q)) && (!sp.type || s.serviceTypeId === sp.type));

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Site of service administration</h1>
        </div>
        {tab === "sites" ? (
          <Link className="btn" href="/settings/sites?tab=sites&add=1">
            + Add site of service
          </Link>
        ) : null}
      </div>
      <SettingsNav current="sites" role={user.role} />
      <nav className="view-tabs" style={{ width: "fit-content" }}>
        <Link href="/settings/sites?tab=sites" className={`view-tab${tab === "sites" ? " active" : ""}`}>
          Sites of service ({sites.length})
        </Link>
        <Link href="/settings/sites?tab=types" className={`view-tab${tab === "types" ? " active" : ""}`}>
          Service types ({types.length})
        </Link>
      </nav>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}

      {tab === "sites" && (
        <>
          {sp.add === "1" && (
            <section className="panel">
              <h2>Add site of service</h2>
              <SiteForm types={types} action={addSite} cancel="/settings/sites?tab=sites" />
            </section>
          )}
          <form method="get" className="panel cm-bar">
            <input type="hidden" name="tab" value="sites" />
            <label>
              Find a site
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Name or city contains" />
            </label>
            <label>
              Service type
              <select name="type" defaultValue={sp.type ?? ""}>
                <option value="">All</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn secondary" type="submit">
              Search
            </button>
          </form>
          <section className="panel">
            <table>
              <thead>
                <tr>
                  <th>Site of service</th>
                  <th>Service type</th>
                  <th>Address</th>
                  <th>Phone · fax</th>
                  <th>Place of service</th>
                  <th>NPI</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((s) =>
                  sp.edit === s.id ? (
                    <tr key={s.id}>
                      <td colSpan={7}>
                        <SiteForm site={s} types={types} action={updateSite.bind(null, s.id)} cancel="/settings/sites?tab=sites" />
                      </td>
                    </tr>
                  ) : (
                    <tr key={s.id} className={s.active ? undefined : "cm-blocked"}>
                      <td>
                        <strong>{s.name}</strong>
                        {!s.active && <span className="gw-tag gw-tag-muted">Inactive</span>}
                        {s.facilityBilling && <span className="gw-tag gw-tag-info">Facility billing</span>}
                      </td>
                      <td>{s.serviceType?.name ?? "—"}</td>
                      <td>{[s.addressLine1, s.addressLine2, [s.city, [s.state, s.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") || "—"}</td>
                      <td>{[s.phone, s.fax ? `Fax ${s.fax}` : null].filter(Boolean).join(" · ") || "—"}</td>
                      <td>{s.placeOfService ? (placeOfServiceLabel[s.placeOfService] ?? s.placeOfService) : "—"}</td>
                      <td>
                        {s.npi ?? "—"}
                        {s.groupNpi ? <div className="muted">Group {s.groupNpi}</div> : null}
                      </td>
                      <td className="num">
                        <Link className="btn secondary gw-mini" href={`/settings/sites?tab=sites&edit=${s.id}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}>
                          Edit
                        </Link>
                      </td>
                    </tr>
                  )
                )}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      {sites.length === 0 ? "No sites of service yet." : "No site matches."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === "types" && (
        <section className="panel">
          <form action={saveServiceType.bind(null, null)} className="pv-inline pv-add">
            <input name="name" required maxLength={80} placeholder="New service type, e.g. Assisted Living Facility" aria-label="New service type" />
            <button className="btn" type="submit">
              + Add service type
            </button>
          </form>
          <table>
            <thead>
              <tr>
                <th>Service type</th>
                <th className="num">Sites</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td>
                    <form id={`type-${t.id}`} action={saveServiceType.bind(null, t.id)}>
                      <input name="name" defaultValue={t.name} required maxLength={80} aria-label="Service type name" />
                    </form>
                  </td>
                  <td className="num">
                    <Link href={`/settings/sites?tab=sites&type=${t.id}`}>{t._count.locations}</Link>
                  </td>
                  <td className="num cm-row-actions">
                    <button className="btn secondary gw-mini" type="submit" form={`type-${t.id}`}>
                      Save
                    </button>
                    <form action={deleteServiceType.bind(null, t.id)}>
                      <button className="btn ghost gw-mini" type="submit" disabled={t._count.locations > 0} title={t._count.locations > 0 ? "In use by sites of service" : undefined}>
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {types.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No service types yet. Add the kinds of site you visit: assisted living facility, SNF, home, group home, inpatient rehab, telehealth.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
