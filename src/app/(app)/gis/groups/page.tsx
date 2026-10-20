import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { can, rolesFor } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { atLeast, GRANTABLE_ROLES, isMapRole, MAP_ROLE_ABOUT, MAP_ROLE_LABEL } from "@/lib/gis/maps";
import { groupIcon, GROUP_ICONS, GROUP_SORTS, myGroups, openGroup } from "@/lib/gis/groups";
import { gisStatusKey, loadBoard } from "@/lib/gis/board";
import { GIS_STATUSES, gisStatus } from "@/lib/gis/shared";
import { fullAddress } from "@/lib/gis/geocode";
import { displayName, FIELD_PROVIDER_WHERE, getGisSettings, gisTitleLabel } from "@/lib/gis/settings";
import { SelectAll } from "@/components/SelectAll";
import { GisPage } from "../gis-shell";
import { addGroupPatients, addGroupProvider, createGroup, deleteGroup, removeGroupMember, removeGroupPatients, removeGroupProvider, setGroupActive, setGroupMemberRole, shareGroup, toggleGroupOnMap, updateGroup } from "../group-actions";

type SearchParams = { ok?: string; error?: string; q?: string; type?: string; vis?: string; status?: string; new?: string; groupId?: string; tab?: string; add?: string; chip?: string; pq?: string };

// Groups: reusable patient lists (or clinician panels) with a colour and icon, shared by role, loaded onto any map
// in one click. A group page has Overview, Patients (or Clinicians), Members and Settings tabs, and the Add
// Patients dialog with status chips, search and a multi-select table.
export default async function GisGroupsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser(rolesFor("gis.view"));
  const sp = await searchParams;
  const canEdit = can(user, "gis.edit");
  const settings = await getGisSettings(user.practiceId);
  const groups = await myGroups(user.id, user.practiceId);
  const q = (sp.q ?? "").trim().toLowerCase();
  const list = groups.filter((g) => (!q || g.name.toLowerCase().includes(q) || (g.description ?? "").toLowerCase().includes(q)) && (!sp.type || g.groupType === sp.type) && (!sp.vis || g.visibility === sp.vis) && (!sp.status || (sp.status === "active" ? g.active : !g.active)));
  const here = (o: Partial<SearchParams>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...o })) if (v && k !== "ok" && k !== "error") p.set(k, v);
    return `/gis/groups?${p.toString()}`;
  };
  const opened = sp.groupId ? await openGroup(user.id, user.practiceId, sp.groupId) : null;

  return (
    <GisPage
      title="My groups"
      subtitle="Manage and organise your patient groups. A group loads onto any map in one click in its colour."
      sp={sp}
      actions={
        canEdit && (
          <Link className="btn" href={here({ new: "1", groupId: undefined })}>
            + Create new group
          </Link>
        )
      }
    >
      {canEdit && sp.new && <CreateGroup cancel={here({ new: undefined })} />}

      {!opened && (
        <>
          <form className="panel fr-filters" method="get">
            <label>
              Search
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Search groups…" />
            </label>
            <label>
              Type
              <select name="type" defaultValue={sp.type ?? ""}>
                <option value="">All</option>
                <option value="PATIENT">Patient</option>
                <option value="PROVIDER">Provider</option>
              </select>
            </label>
            <label>
              Visibility
              <select name="vis" defaultValue={sp.vis ?? ""}>
                <option value="">All</option>
                <option value="PRIVATE">Private</option>
                <option value="SHARED">Shared</option>
              </select>
            </label>
            <label>
              Status
              <select name="status" defaultValue={sp.status ?? ""}>
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <button className="btn ghost" type="submit">
              Apply
            </button>
          </form>
          {list.length === 0 ? (
            <section className="panel">
              <p className="muted">{groups.length === 0 ? "No groups yet." : "No groups match."}</p>
            </section>
          ) : (
            <div className="gis-cards">
              {list.map((g) => (
                <Link key={g.id} href={here({ groupId: g.id })} className="panel gis-card">
                  <div className="gis-card-head">
                    <span>
                      <span className="gis-icon" style={{ background: g.color }}>
                        {groupIcon(g.icon)}
                      </span>{" "}
                      <strong>{g.name}</strong>
                    </span>
                    <span className="sa-chip">{MAP_ROLE_LABEL[g.myRole]}</span>
                  </div>
                  <div className="muted cn-small">
                    {g.groupType === "PATIENT" ? `${g._count.patients} patient${g._count.patients === 1 ? "" : "s"}` : `${g._count.providers} clinician${g._count.providers === 1 ? "" : "s"}`} · {g.visibility.toLowerCase()} · {g.active ? "active" : "inactive"}
                    {g.visibleOnMap ? "" : " · hidden on your maps"}
                  </div>
                  {g.description && <div className="muted cn-small">{g.description}</div>}
                  <div className="muted cn-small">Owner {g.ownerName}</div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {opened && <GroupDetail sp={sp} user={user} canEdit={canEdit} opened={opened} nameFormat={settings.nameFormat} here={here} />}
    </GisPage>
  );
}

function CreateGroup({ cancel }: { cancel: string }) {
  return (
    <form action={createGroup} className="panel stack">
      <div className="gw-section-head">
        <h2>Create new group</h2>
        <Link className="muted" href={cancel}>
          Cancel
        </Link>
      </div>
      <GroupFields />
      <label>
        Group type
        <select name="groupType" defaultValue="PATIENT">
          <option value="PATIENT">Patient group (a saved patient list)</option>
          <option value="PROVIDER">Provider group (clinicians whose patients show together)</option>
        </select>
      </label>
      <button className="btn" type="submit">
        Create group
      </button>
    </form>
  );
}

function GroupFields({ g }: { g?: { name: string; description: string | null; color: string; icon: string; visibility: string; sortBy: string; showAge: boolean } }) {
  return (
    <>
      <div className="form-grid">
        <label>
          Group name *
          <input name="name" required maxLength={80} defaultValue={g?.name ?? ""} placeholder="A descriptive name for your patient group" />
        </label>
        <label>
          Visibility
          <select name="visibility" defaultValue={g?.visibility ?? "PRIVATE"}>
            <option value="PRIVATE">Private</option>
            <option value="SHARED">Shared</option>
          </select>
        </label>
      </div>
      <label>
        Description
        <textarea name="description" rows={2} maxLength={300} defaultValue={g?.description ?? ""} placeholder="Brief description of the group's purpose" />
      </label>
      <div className="form-grid">
        <label>
          Colour
          <input name="color" type="color" defaultValue={g?.color ?? "#2563eb"} />
        </label>
        <label>
          Icon
          <select name="icon" defaultValue={g?.icon ?? "USERS"}>
            {GROUP_ICONS.map(([k, glyph, label]) => (
              <option key={k} value={k}>
                {glyph} {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort patients by
          <select name="sortBy" defaultValue={g?.sortBy ?? "name"}>
            {GROUP_SORTS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-inline">
          <input type="checkbox" name="showAge" defaultChecked={g?.showAge ?? true} /> Show age
        </label>
      </div>
    </>
  );
}

type Opened = NonNullable<Awaited<ReturnType<typeof openGroup>>>;

async function GroupDetail({ sp, user, canEdit, opened, nameFormat, here }: { sp: SearchParams; user: { id: string; practiceId: string }; canEdit: boolean; opened: Opened; nameFormat: string; here: (o: Partial<SearchParams>) => string }) {
  const { group: g, role } = opened;
  const isAdmin = canEdit && atLeast(role, "ADMIN");
  const isEditor = canEdit && atLeast(role, "EDITOR");
  const tab = ["patients", "members", "settings"].includes(sp.tab ?? "") ? sp.tab! : "overview";
  const me = g.members.find((m) => m.userId === user.id);
  const age = (dob: Date) => Math.floor((Date.now() - dob.getTime()) / (365.25 * 86_400_000));
  const rows = g.patients
    .map((gp) => ({ ...gp.patient, statusKey: gisStatusKey(gp.patient.intakeCases[0]), display: displayName(gp.patient, nameFormat) }))
    .sort((a, b) => (g.sortBy === "mrn" ? a.mrn.localeCompare(b.mrn) : g.sortBy === "dob" ? a.dob.getTime() - b.dob.getTime() : g.sortBy === "status" ? a.statusKey.localeCompare(b.statusKey) : g.sortBy === "zip" ? (a.zip ?? "").localeCompare(b.zip ?? "") : a.display.localeCompare(b.display)));

  // The Add Patients dialog: status chips, search and a multi-select table over the whole practice.
  const adding = isEditor && g.groupType === "PATIENT" && sp.add === "1";
  const chip = sp.chip ?? "";
  const picker = adding ? await loadBoard(user.practiceId, { q: sp.pq ?? "", status: chip || undefined }, { all: true, nameFormat }) : null;
  const inGroup = new Set(g.patients.map((p) => p.patientId));
  const clinicians = isEditor && g.groupType === "PROVIDER" ? await prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId, ...FIELD_PROVIDER_WHERE, gisActive: true, gisTitle: { not: null }, id: { notIn: g.providers.map((p) => p.renderingProviderId) } }, select: { id: true, name: true, gisTitle: true }, orderBy: { name: "asc" } }) : [];
  const colleagues = isAdmin ? await prisma.membership.findMany({ where: { practiceId: user.practiceId, user: { active: true }, userId: { notIn: g.members.map((m) => m.userId) } }, include: { user: { select: { id: true, name: true, role: true } } }, orderBy: { user: { name: "asc" } } }) : [];

  return (
    <>
      <section className="panel">
        <div className="gw-section-head">
          <h2>
            <span className="gis-icon" style={{ background: g.color }}>
              {groupIcon(g.icon)}
            </span>{" "}
            {g.name} <span className="sa-chip">{MAP_ROLE_LABEL[role]}</span> {!g.active && <span className="sa-chip">inactive</span>}
          </h2>
          <Link className="muted" href={here({ groupId: undefined, tab: undefined, add: undefined })}>
            ← All groups
          </Link>
        </div>
        <div className="view-tabs">
          {[
            ["overview", "Overview"],
            ["patients", g.groupType === "PATIENT" ? "Patients" : "Clinicians"],
            ["members", "Members"],
            ["settings", "Settings"],
          ].map(([k, label]) => (
            <Link key={k} className={`view-tab${tab === k ? " active" : ""}`} href={here({ tab: k, add: undefined })}>
              {label}
            </Link>
          ))}
        </div>
      </section>

      {tab === "overview" && (
        <section className="panel stack">
          {g.description && <p>{g.description}</p>}
          <div className="wa-stats">
            <div>
              <strong>{g.groupType === "PATIENT" ? g.patients.length : g.providers.length}</strong>
              <div className="muted">{g.groupType === "PATIENT" ? "patients" : "clinicians"}</div>
            </div>
            <div>
              <strong>{g.members.length}</strong>
              <div className="muted">members</div>
            </div>
            <div>
              <strong>{g.visibility === "SHARED" ? "Shared" : "Private"}</strong>
              <div className="muted">visibility</div>
            </div>
            <div>
              <strong>{g.patients.filter((p) => p.patient.latitude != null).length}</strong>
              <div className="muted">with a map pin</div>
            </div>
          </div>
          <form action={toggleGroupOnMap.bind(null, g.id)} className="fr-bulk">
            <input type="hidden" name="back" value={here({})} />
            <span className="muted cn-small">{me?.visibleOnMap ? "Shown in My Groups on your maps." : "Hidden from My Groups on your maps."}</span>
            <button className="btn ghost" type="submit">
              {me?.visibleOnMap ? "Deactivate on my maps" : "Activate on my maps"}
            </button>
          </form>
        </section>
      )}

      {tab === "patients" && g.groupType === "PATIENT" && (
        <section className="panel stack">
          <div className="gw-section-head">
            <h3>Patients</h3>
            {isEditor && (
              <Link className="btn secondary" href={here({ tab: "patients", add: "1" })}>
                + Add patients to group
              </Link>
            )}
          </div>
          {adding && picker && (
            <div className="panel stack gis-picker">
              <div className="gw-section-head">
                <strong>Add Patients to Group</strong>
                <Link className="muted" href={here({ add: undefined, chip: undefined, pq: undefined })}>
                  Close
                </Link>
              </div>
              <p className="muted cn-small">Choose a status, search, then tick who to add.</p>
              <form method="get" className="fr-bulk">
                {Object.entries({ ...sp, add: "1", chip }).map(([k, v]) => v && k !== "pq" && k !== "ok" && k !== "error" && <input key={k} type="hidden" name={k} value={v} />)}
                <input name="pq" defaultValue={sp.pq ?? ""} placeholder="Type patient name or MRN" />
                <button className="btn ghost" type="submit">
                  Search
                </button>
              </form>
              <div className="gis-chips">
                <Link className={`gis-chip${!chip ? " active" : ""}`} href={here({ add: "1", chip: undefined })}>
                  All
                </Link>
                {GIS_STATUSES.filter((s) => s.key !== "none").map((s) => (
                  <Link key={s.key} className={`gis-chip${chip === s.key ? " active" : ""}`} href={here({ add: "1", chip: s.key })} style={chip === s.key ? { background: s.tone, color: "#fff" } : undefined}>
                    {s.label}
                  </Link>
                ))}
              </div>
              <form id="addp" action={addGroupPatients.bind(null, g.id)} className="fr-bulk">
                <SelectAll name="ids" noun="patient" />
                <button className="btn" type="submit">
                  Add selected
                </button>
                <span className="muted cn-small">Patients found ({picker.total})</span>
              </form>
              <div className="table-scroll gis-picker-table">
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Patient name</th>
                      <th>Status</th>
                      <th>MRN</th>
                      <th>DOB</th>
                      <th>Address</th>
                      <th>County</th>
                      <th>NP</th>
                      <th>MA</th>
                      <th>LPN</th>
                      <th>Home health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {picker.rows.slice(0, 500).map((r) => {
                      const st = gisStatus(r.statusKey);
                      const already = inGroup.has(r.id);
                      return (
                        <tr key={r.id} className={already ? "muted" : undefined}>
                          <td>
                            <input type="checkbox" name="ids" value={r.id} form="addp" disabled={already} aria-label={`Select ${r.name}`} />
                          </td>
                          <td>
                            {r.name}
                            {already ? <span className="muted cn-small"> · in group</span> : ""}
                          </td>
                          <td>
                            <span className="gis-badge" style={{ background: st.tone }}>
                              {st.label}
                            </span>
                          </td>
                          <td className="cn-small">{r.mrn}</td>
                          <td className="cn-small">{formatDate(r.dob)}</td>
                          <td className="cn-small">{r.address}</td>
                          <td className="cn-small">{r.county ?? ""}</td>
                          <td className="cn-small">{r.np?.name ?? "-"}</td>
                          <td className="cn-small">{r.ma?.name ?? "-"}</td>
                          <td className="cn-small">{r.lpn?.name ?? "-"}</td>
                          <td className="cn-small">{r.homeHealth ?? "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {isEditor && rows.length > 0 && (
            <form id="rmp" action={removeGroupPatients.bind(null, g.id)} className="fr-bulk">
              <SelectAll name="ids" noun="patient" />
              <button className="btn ghost" type="submit">
                Remove selected
              </button>
            </form>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {isEditor && <th></th>}
                  <th>Patient</th>
                  <th>Status</th>
                  <th>Address</th>
                  <th>NP</th>
                  <th>LPN</th>
                  <th>MA</th>
                  <th>Pin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const st = gisStatus(p.statusKey);
                  return (
                    <tr key={p.id}>
                      {isEditor && (
                        <td>
                          <input type="checkbox" name="ids" value={p.id} form="rmp" aria-label={`Select ${p.display}`} />
                        </td>
                      )}
                      <td>
                        <Link href={`/patients/${p.id}`}>{p.display}</Link>
                        <div className="muted cn-small">
                          {p.mrn}
                          {g.showAge ? ` · ${age(p.dob)}y` : ""}
                        </div>
                      </td>
                      <td>
                        <span className="gis-badge" style={{ background: st.tone }}>
                          {st.label}
                        </span>
                      </td>
                      <td className="cn-small">{fullAddress(p)}</td>
                      <td className="cn-small">{p.npProvider?.name ?? "-"}</td>
                      <td className="cn-small">{p.lpnProvider?.name ?? "-"}</td>
                      <td className="cn-small">{p.maProvider?.name ?? "-"}</td>
                      <td className="cn-small">{p.latitude != null ? "Yes" : <span className="gw-missing">No</span>}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8}>No patients in this group yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "patients" && g.groupType === "PROVIDER" && (
        <section className="panel stack">
          <h3>Clinicians</h3>
          <ul className="rp-list">
            {g.providers.map((p) => (
              <li key={p.id}>
                <span>
                  {p.provider.name} <span className="muted cn-small">{gisTitleLabel(p.provider.gisTitle)}</span>
                </span>
                {isEditor && (
                  <form action={removeGroupProvider.bind(null, g.id, p.renderingProviderId)}>
                    <button className="btn ghost" type="submit">
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
            {g.providers.length === 0 && <li className="muted">No clinicians yet.</li>}
          </ul>
          {isEditor && clinicians.length > 0 && (
            <form action={addGroupProvider.bind(null, g.id)} className="fr-bulk">
              <select name="providerId" required defaultValue="" aria-label="Clinician to add">
                <option value="">— clinician —</option>
                {clinicians.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {gisTitleLabel(c.gisTitle)}
                  </option>
                ))}
              </select>
              <button className="btn secondary" type="submit">
                Add clinician
              </button>
            </form>
          )}
          <p className="muted cn-small">On a map this group shows every patient assigned to any of these clinicians.</p>
        </section>
      )}

      {tab === "members" && (
        <section className="panel stack">
          <h3>Members</h3>
          <ul className="rp-list">
            {g.members.map((m) => (
              <li key={m.id}>
                <span>
                  {m.user.name} <span className="muted cn-small">{m.user.email}</span>
                </span>
                <span className="fr-bulk">
                  {isAdmin && m.role !== "OWNER" ? (
                    <form action={setGroupMemberRole.bind(null, m.id)} className="inline-select">
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
                    <span className="muted cn-small">{MAP_ROLE_LABEL[isMapRole(m.role) ? m.role : "VIEWER"]}</span>
                  )}
                  {m.role !== "OWNER" && (isAdmin || m.userId === user.id) && (
                    <form action={removeGroupMember.bind(null, m.id)}>
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
            <form action={shareGroup.bind(null, g.id)} className="fr-bulk">
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
      )}

      {tab === "settings" && (
        <section className="panel stack">
          <h3>Settings</h3>
          {isAdmin ? (
            <>
              <form action={updateGroup.bind(null, g.id)} className="stack">
                <GroupFields g={g} />
                <div className="fr-bulk">
                  <button className="btn" type="submit">
                    Save
                  </button>
                </div>
              </form>
              <form action={setGroupActive.bind(null, g.id)} className="fr-bulk">
                <label className="checkbox-inline">
                  <input type="checkbox" name="active" defaultChecked={g.active} /> Active
                </label>
                <button className="btn ghost" type="submit">
                  Apply
                </button>
              </form>
              {role === "OWNER" && (
                <form action={deleteGroup.bind(null, g.id)}>
                  <button className="btn ghost" type="submit">
                    Delete this group
                  </button>
                </form>
              )}
            </>
          ) : (
            <p className="muted">Only the group&apos;s Admins change its settings.</p>
          )}
        </section>
      )}
    </>
  );
}
