import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { can, rolesFor } from "@/lib/permissions";
import { atLeast, GRANTABLE_ROLES, isMapRole, MAP_ROLE_ABOUT, MAP_ROLE_LABEL, openMap } from "@/lib/gis/maps";
import { FIELD_PROVIDER_WHERE, gisTitleLabel } from "@/lib/gis/settings";
import { GisPage } from "../../../gis-shell";
import { deleteMap, removeMember, setMemberRole, shareMap, updateMap } from "../../../map-actions";

// A map's settings: name, type and provider (Admins), members and their roles (Admins), delete (Owner).
export default async function GisMapSettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser(rolesFor("gis.view"));
  const { id } = await params;
  const sp = await searchParams;
  const opened = await openMap(user.id, user.practiceId, id);
  if (!opened) notFound();
  const { map, role } = opened;
  const canEdit = can(user, "gis.edit");
  const isAdmin = canEdit && atLeast(role, "ADMIN");
  const [clinicians, colleagues] = await Promise.all([
    prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId, ...FIELD_PROVIDER_WHERE, gisActive: true, gisTitle: { not: null } }, select: { id: true, name: true, gisTitle: true }, orderBy: { name: "asc" } }),
    isAdmin
      ? prisma.membership.findMany({ where: { practiceId: user.practiceId, user: { active: true }, userId: { notIn: map.members.map((m) => m.userId) } }, include: { user: { select: { id: true, name: true, role: true } } }, orderBy: { user: { name: "asc" } } })
      : Promise.resolve([]),
  ]);

  return (
    <GisPage
      title={`${map.label} · settings`}
      subtitle={`${map.maskId} · you are ${MAP_ROLE_LABEL[role]}`}
      sp={sp}
      actions={
        <Link className="btn secondary" href={`/gis/maps/${map.id}`}>
          Back to map
        </Link>
      }
    >
      <section className="panel stack">
        <h2>Map</h2>
        {isAdmin ? (
          <form action={updateMap.bind(null, map.id)} className="stack">
            <div className="form-grid">
              <label>
                Name
                <input name="label" required maxLength={80} defaultValue={map.label} />
              </label>
              <label>
                Type
                <select name="mapType" defaultValue={map.mapType}>
                  <option value="PROVIDER">Provider map</option>
                  <option value="GENERAL">General map</option>
                </select>
              </label>
              <label>
                Provider
                <select name="providerId" required defaultValue={map.providerId ?? ""}>
                  <option value="">—</option>
                  {clinicians.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {gisTitleLabel(c.gisTitle)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="fr-bulk">
              <button className="btn" type="submit">
                Save
              </button>
            </div>
          </form>
        ) : (
          <p className="muted">
            Routes start and end at {map.provider?.name ?? "the clinician"}&apos;s home address. Only the map&apos;s Admins change these.
          </p>
        )}
      </section>

      <section className="panel stack">
        <div className="gw-section-head">
          <h2>Members</h2>
          <span className="muted">{map.members.length}</span>
        </div>
        <ul className="rp-list">
          {map.members.map((m) => (
            <li key={m.id}>
              <span>
                {m.user.name} <span className="muted cn-small">{m.user.email}</span>
              </span>
              <span className="fr-bulk">
                {isAdmin && m.role !== "OWNER" ? (
                  <form action={setMemberRole.bind(null, m.id)} className="inline-select">
                    <select name="role" defaultValue={m.role} aria-label={`Role for ${m.user.name}`}>
                      {GRANTABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {MAP_ROLE_LABEL[r]} · {MAP_ROLE_ABOUT[r]}
                        </option>
                      ))}
                    </select>
                    <button className="btn ghost" type="submit">
                      Set
                    </button>
                  </form>
                ) : (
                  <span className="muted cn-small">
                    {MAP_ROLE_LABEL[isMapRole(m.role) ? m.role : "VIEWER"]} · {MAP_ROLE_ABOUT[isMapRole(m.role) ? m.role : "VIEWER"]}
                  </span>
                )}
                {m.role !== "OWNER" && (isAdmin || m.userId === user.id) && (
                  <form action={removeMember.bind(null, m.id)}>
                    <button className="btn ghost" type="submit">
                      {m.userId === user.id ? "Leave" : "Remove"}
                    </button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
        {isAdmin && colleagues.length > 0 && (
          <form action={shareMap.bind(null, map.id)} className="fr-bulk">
            <select name="userId" required defaultValue="" aria-label="Colleague to share with">
              <option value="">— colleague —</option>
              {colleagues.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.user.name} ({c.user.role.toLowerCase().replace("_", " ")})
                </option>
              ))}
            </select>
            <select name="role" defaultValue="EDITOR" aria-label="Role to grant">
              {GRANTABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {MAP_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <button className="btn secondary" type="submit">
              Share
            </button>
          </form>
        )}
      </section>

      {canEdit && role === "OWNER" && (
        <section className="panel">
          <h2>Delete</h2>
          <p className="muted cn-small">Removes the map and its route layers for every member. Patients and clinicians are untouched.</p>
          <form action={deleteMap.bind(null, map.id)}>
            <button className="btn ghost" type="submit">
              Delete this map
            </button>
          </form>
        </section>
      )}
    </GisPage>
  );
}
