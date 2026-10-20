import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { can, rolesFor } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { geocodeStatus } from "@/lib/gis/geocode";
import { MAP_ROLE_LABEL, myMaps } from "@/lib/gis/maps";
import { FIELD_PROVIDER_WHERE, gisGoogleKey, gisTitleLabel } from "@/lib/gis/settings";
import { unreadCount } from "@/lib/gis/notify";
import { GisPage } from "./gis-shell";
import { createMap } from "./map-actions";

type SearchParams = { ok?: string; error?: string; show?: string; q?: string; sort?: string; new?: string };

// My Map: the boards this user belongs to, filterable All / Owned / Shared, searchable, sorted. A map is a workspace
// of route layers for one field clinician (PROVIDER) or none (GENERAL).
export default async function GisHome({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser(rolesFor("gis.view"));
  const sp = await searchParams;
  const canEdit = can(user, "gis.edit");
  const show = sp.show === "owned" || sp.show === "shared" ? sp.show : "all";
  const q = (sp.q ?? "").trim().toLowerCase();
  const sort = sp.sort === "name" ? "name" : sp.sort === "created" ? "created" : "updated";
  const [maps, clinicians, geo, key, unread] = await Promise.all([
    myMaps(user.id, user.practiceId),
    prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId, ...FIELD_PROVIDER_WHERE, gisActive: true, gisTitle: { not: null } }, select: { id: true, name: true, gisTitle: true, latitude: true }, orderBy: { name: "asc" } }),
    geocodeStatus(user.practiceId),
    gisGoogleKey(user.practiceId),
    unreadCount(user.id),
  ]);
  const list = maps
    .filter((m) => (show === "owned" ? m.myRole === "OWNER" : show === "shared" ? m.myRole !== "OWNER" : true))
    .filter((m) => !q || m.label.toLowerCase().includes(q) || (m.provider?.name ?? "").toLowerCase().includes(q))
    .sort((a, b) => (sort === "name" ? a.label.localeCompare(b.label) : sort === "created" ? b.createdAt.getTime() - a.createdAt.getTime() : b.updatedAt.getTime() - a.updatedAt.getTime()));
  const here = (o: Partial<SearchParams>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...o })) if (v && k !== "ok" && k !== "error") p.set(k, v);
    return `/gis?${p.toString()}`;
  };

  return (
    <GisPage
      title="My maps"
      subtitle="Plan home-visit routes for field clinicians and share them as links."
      sp={sp}
      actions={
        <>
          <Link className="btn ghost" href="/gis/notifications">
            Notifications{unread ? ` (${unread})` : ""}
          </Link>
          {canEdit && (
            <Link className="btn" href={here({ new: "1" })}>
              + Create new map
            </Link>
          )}
        </>
      }
    >
      {canEdit && sp.new && (
        <form action={createMap} className="panel stack">
          <div className="gw-section-head">
            <h2>Create new map</h2>
            <Link className="muted" href={here({ new: undefined })}>
              Cancel
            </Link>
          </div>
          <div className="form-grid">
            <label>
              Map name
              <input name="label" required maxLength={80} placeholder="e.g. Rembert's Map" autoFocus />
            </label>
            <label>
              Type
              <select name="mapType" defaultValue="PROVIDER">
                <option value="PROVIDER">Provider map (routes start and end at the clinician&apos;s home)</option>
                <option value="GENERAL">General map (first and last stop are the ends)</option>
              </select>
            </label>
            <label>
              Provider (for a provider map)
              <select name="providerId" defaultValue="">
                <option value="">—</option>
                {clinicians.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {gisTitleLabel(c.gisTitle)}
                    {c.latitude == null ? " (no home base yet)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted cn-small">You become the map&apos;s Owner. Share it with colleagues from the map&apos;s settings.</p>
          <button className="btn" type="submit">
            Create map
          </button>
        </form>
      )}

      <form className="panel fr-filters" method="get">
        <label>
          Search
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Map or clinician name" />
        </label>
        <label>
          Show
          <select name="show" defaultValue={show}>
            <option value="all">All</option>
            <option value="owned">Owned</option>
            <option value="shared">Shared with me</option>
          </select>
        </label>
        <label>
          Sort
          <select name="sort" defaultValue={sort}>
            <option value="updated">Last updated</option>
            <option value="created">Newest</option>
            <option value="name">Name</option>
          </select>
        </label>
        <button className="btn ghost" type="submit">
          Apply
        </button>
      </form>

      {list.length === 0 ? (
        <section className="panel">
          <p className="muted">{maps.length === 0 ? "No maps yet. Create one to start planning routes." : "No maps match."}</p>
        </section>
      ) : (
        <div className="gis-cards">
          {list.map((m) => (
            <Link key={m.id} href={`/gis/maps/${m.id}`} className="panel gis-card">
              <div className="gis-card-head">
                <strong>{m.label}</strong>
                <span className="sa-chip">{MAP_ROLE_LABEL[m.myRole]}</span>
              </div>
              <div className="muted cn-small">
                {m.mapType === "PROVIDER" ? (m.provider ? `${m.provider.name} · ${gisTitleLabel(m.provider.gisTitle)}` : "Provider map") : "General map"}
              </div>
              <div className="muted cn-small">
                {m._count.routes} layer{m._count.routes === 1 ? "" : "s"} · {m.memberCount} member{m.memberCount === 1 ? "" : "s"} · {m.maskId}
              </div>
              <div className="muted cn-small">
                Owner {m.ownerName} · updated {formatDate(m.updatedAt)}
              </div>
            </Link>
          ))}
        </div>
      )}

      <section className="panel">
        <div className="wa-stats">
          <div>
            <strong>{geo.located}</strong>
            <div className="muted">patients on the map</div>
          </div>
          <div>
            <strong>{geo.waiting + geo.failed}</strong>
            <div className="muted">without a pin</div>
          </div>
          <div>
            <strong>{clinicians.filter((c) => c.latitude != null).length} / {clinicians.length}</strong>
            <div className="muted">clinicians with a home base</div>
          </div>
          <div>
            <strong>{key ? "Google" : "OSM"}</strong>
            <div className="muted">map provider</div>
          </div>
        </div>
      </section>
    </GisPage>
  );
}
