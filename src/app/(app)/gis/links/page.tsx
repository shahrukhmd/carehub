import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { linkState, parseRouteIds } from "@/lib/gis/share";
import { SelectAll } from "@/components/SelectAll";
import { GisPage } from "../gis-shell";
import { deleteShareLinks, expireShareLinks, purgeExpiredLinks } from "../share-actions";

// Share links in the practice: masked code, map and layers, creator, usage and state, with expire, delete and
// purge. The code itself is shown only once, when the link is generated on the map page.
export default async function GisLinksPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; state?: string }> }) {
  const user = await requireUser(rolesFor("gis.edit"));
  const sp = await searchParams;
  const links = await prisma.gisShareLink.findMany({
    where: { practiceId: user.practiceId },
    include: { map: { select: { id: true, label: true, routes: { select: { id: true, label: true, visitDate: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const creators = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(links.map((l) => l.createdById).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const now = new Date();
  const rows = links.map((l) => ({ ...l, state: linkState(l, now), layers: parseRouteIds(l.routeIds).map((id) => l.map.routes.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r)) })).filter((l) => !sp.state || l.state === sp.state);
  const tone: Record<string, string> = { ACTIVE: "#16a34a", EXPIRED: "#6b7280", USED: "#d97706" };

  return (
    <GisPage
      title="Share links"
      subtitle="Public links to route layers, generated from a map. They open without login until they expire or hit their open cap."
      sp={sp}
      actions={
        <form action={purgeExpiredLinks}>
          <button className="btn ghost" type="submit">
            Purge all expired
          </button>
        </form>
      }
    >
      <form className="panel fr-filters" method="get">
        <label>
          State
          <select name="state" defaultValue={sp.state ?? ""}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="EXPIRED">Expired</option>
            <option value="USED">Used up</option>
          </select>
        </label>
        <button className="btn ghost" type="submit">
          Apply
        </button>
      </form>
      <section className="panel">
        <div className="gw-section-head">
          <h2>Links</h2>
          <span className="muted">{rows.length}</span>
        </div>
        <form id="links" className="fr-bulk">
          <SelectAll name="ids" noun="link" />
          <button className="btn ghost" type="submit" formAction={expireShareLinks}>
            Expire selected
          </button>
          <button className="btn ghost" type="submit" formAction={deleteShareLinks}>
            Delete selected
          </button>
        </form>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Link</th>
                <th>Map and layers</th>
                <th>Created</th>
                <th>Usage</th>
                <th>Expires</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>
                    <input type="checkbox" name="ids" value={l.id} form="links" aria-label={`Select link ${l.codeHint}`} />
                  </td>
                  <td>
                    <code>/r/{l.codeHint}</code>
                  </td>
                  <td className="cn-small">
                    <Link href={`/gis/maps/${l.map.id}`}>{l.map.label}</Link>
                    <div className="muted">{l.layers.map((r) => `${r.label} (${formatDate(r.visitDate)})`).join(", ") || "layers removed"}</div>
                  </td>
                  <td className="cn-small">
                    {formatDate(l.createdAt)}
                    <div className="muted">{l.createdById ? creators.get(l.createdById) ?? "" : ""}</div>
                  </td>
                  <td className="cn-small">
                    {l.accessCount} / {l.maxAccess} · {Math.min(100, Math.round((l.accessCount / l.maxAccess) * 100))}%
                    {l.lastOpenedAt && <div className="muted">last {formatDate(l.lastOpenedAt)}</div>}
                  </td>
                  <td className="cn-small">{formatDate(l.expiredAt ?? l.expiresAt)}</td>
                  <td>
                    <span className="sa-chip" style={{ background: tone[l.state], color: "#fff" }}>
                      {l.state === "USED" ? "Used up" : l.state[0] + l.state.slice(1).toLowerCase()}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7}>No share links yet. Open a map, tick the layers to share and press Generate Link.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </GisPage>
  );
}
