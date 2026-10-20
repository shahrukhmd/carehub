import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { can, rolesFor } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { fullAddress } from "@/lib/gis/geocode";
import { FIELD_PROVIDER_WHERE, GIS_TITLES, gisTitleLabel } from "@/lib/gis/settings";
import { InlineSelect } from "@/components/InlineSelect";
import { GisPage } from "../gis-shell";
import { geocodeProviderNow, setProviderGis } from "../actions";

// Field clinicians are CareHub's directory providers of type Clinician or Rendering. Here they get a GIS title
// (NP, LPN, MA, Clinical Team) and their home base is geocoded from the directory address, which becomes the
// origin and destination of every route they drive.
export default async function GisProvidersPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; q?: string; title?: string }> }) {
  const user = await requireUser(rolesFor("gis.view"));
  const sp = await searchParams;
  const canEdit = can(user, "gis.edit");
  const q = (sp.q ?? "").trim();
  const providers = await prisma.renderingProvider.findMany({
    where: {
      practiceId: user.practiceId,
      ...FIELD_PROVIDER_WHERE,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
      ...(sp.title ? (sp.title === "none" ? { gisTitle: null } : { gisTitle: sp.title }) : {}),
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  const titleOptions = [{ key: "", label: "— not a field clinician —" }, ...GIS_TITLES.map(([k, l]) => ({ key: k, label: l }))];

  return (
    <GisPage
      title="Clinicians"
      subtitle="Directory providers of type Clinician or Rendering. Give each field clinician a title; the directory address is their home base."
      sp={sp}
      actions={
        <Link className="btn ghost" href="/settings/directories?section=providers">
          Provider directory
        </Link>
      }
    >
      <form className="panel fr-filters" method="get">
        <label>
          Search
          <input name="q" defaultValue={q} placeholder="Name or email" />
        </label>
        <label>
          Title
          <select name="title" defaultValue={sp.title ?? ""}>
            <option value="">All</option>
            {GIS_TITLES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
            <option value="none">No title yet</option>
          </select>
        </label>
        <button className="btn" type="submit">
          Apply
        </button>
        <Link className="btn ghost" href="/gis/providers">
          Clear
        </Link>
      </form>

      <section className="panel">
        <div className="gw-section-head">
          <h2>Field clinicians</h2>
          <span className="muted">{providers.length}</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Title</th>
                <th>Active in GIS</th>
                <th>Home base</th>
                <th>Map pin</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => {
                const placed = p.latitude != null && p.longitude != null;
                const address = fullAddress(p);
                return (
                  <tr key={p.id} className={p.gisTitle && p.gisActive ? undefined : "muted"}>
                    <td>
                      <strong>{p.name}</strong>
                      {p.credential && <span className="muted"> {p.credential}</span>}
                      <div className="muted cn-small">
                        {[p.isClinician ? "Clinician" : null, p.isRendering ? "Rendering" : null].filter(Boolean).join(" · ")}
                        {p.user ? ` · login: ${p.user.name}` : " · no login"}
                      </div>
                    </td>
                    <td>
                      <InlineSelect action={setProviderGis.bind(null, p.id)} name="gisTitle" value={p.gisTitle ?? ""} options={titleOptions} readOnly={!canEdit} placeholder={gisTitleLabel(p.gisTitle) || "—"} ariaLabel={`GIS title for ${p.name}`} />
                    </td>
                    <td>
                      {canEdit ? (
                        <form action={setProviderGis.bind(null, p.id)} className="inline-select">
                          <input type="hidden" name="gisActiveSet" value="1" />
                          <label className="checkbox-inline">
                            <input type="checkbox" name="gisActive" defaultChecked={p.gisActive} /> active
                          </label>
                          <button className="btn ghost" type="submit">
                            Save
                          </button>
                        </form>
                      ) : p.gisActive ? (
                        "Yes"
                      ) : (
                        "No"
                      )}
                    </td>
                    <td className="cn-small">
                      {address || <span className="gw-missing">No address in the directory</span>}
                      {canEdit && (
                        <div>
                          <Link className="muted" href={`/settings/directories?section=providers&edit=${p.id}`}>
                            Edit address
                          </Link>
                        </div>
                      )}
                    </td>
                    <td className="cn-small">
                      {placed ? (
                        <>
                          On the map
                          <div className="muted">
                            {p.latitude!.toFixed(4)}, {p.longitude!.toFixed(4)}
                            {p.geocodedAt ? ` · ${formatDate(p.geocodedAt)}` : ""}
                          </div>
                        </>
                      ) : p.geocodeError ? (
                        <span className="gw-missing">Not found: {p.geocodeError}</span>
                      ) : address ? (
                        "Waiting for geocoding"
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {canEdit && address && (
                        <form action={geocodeProviderNow.bind(null, p.id)}>
                          <button className="btn ghost" type="submit">
                            {placed ? "Re-geocode" : "Geocode now"}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
              {providers.length === 0 && (
                <tr>
                  <td colSpan={6}>No providers of type Clinician or Rendering match. Add them in the provider directory.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </GisPage>
  );
}
