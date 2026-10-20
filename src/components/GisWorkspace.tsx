"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type DragEvent } from "react";
import { GisMapView, type GisLine, type GisPin, type GisRegion, type GisView } from "@/components/GisMapView";
import { gisStatus, miles, minutes, stopLetter, type Layer, type SidebarPatient } from "@/lib/gis/shared";
import type { ActionResult } from "@/app/(app)/gis/route-actions";
import type { LinkResult } from "@/app/(app)/gis/share-actions";

type Actions = {
  createShareLink: (mapId: string, routeIds: string[]) => Promise<LinkResult>;
  createLayer: (mapId: string, fd: FormData) => Promise<ActionResult>;
  updateLayer: (routeId: string, fd: FormData) => Promise<ActionResult>;
  deleteLayer: (routeId: string) => Promise<ActionResult>;
  addStops: (routeId: string, patientIds: string[], at?: number) => Promise<ActionResult>;
  removeStop: (stopId: string) => Promise<ActionResult>;
  reorderStops: (routeId: string, orderedIds: string[]) => Promise<ActionResult>;
  moveStop: (stopId: string, targetRouteId: string, at?: number) => Promise<ActionResult>;
  updateStopNote: (stopId: string, note: string) => Promise<ActionResult>;
  setOptimize: (routeId: string, on: boolean) => Promise<ActionResult>;
  redrawDirections: (routeId: string) => Promise<ActionResult>;
  saveMapCenter: (fd: FormData) => Promise<void>;
};

type Drag = { kind: "patient"; patientId: string } | { kind: "stop"; stopId: string; routeId: string };

// The map page: route layers (left), patient sidebar (middle), map (right). Drag a sidebar row onto a layer or
// between stops to add it; drag a stop within its layer to reorder, or onto another layer to move it. Every change
// updates local state first so the map redraws at once, then persists and refreshes.
export function GisWorkspace({
  mapId,
  origin,
  base,
  layers: initialLayers,
  patients,
  loaded,
  quickFilters,
  pinStyles,
  view,
  canEdit,
  todayParam,
  actions,
  regions = [],
}: {
  mapId: string;
  origin: string;
  base: GisPin | null;
  layers: Layer[];
  patients: SidebarPatient[];
  loaded: { key: string; label: string; color: string } | null;
  quickFilters: { key: string; label: string; href: string; active: boolean; color?: string }[];
  pinStyles: Record<string, string>;
  view: GisView | null;
  canEdit: boolean;
  todayParam: string;
  actions: Actions;
  regions?: GisRegion[];
}) {
  const [showRegions, setShowRegions] = useState(true);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [layers, setLayers] = useState(initialLayers);
  const [serverKey, setServerKey] = useState(JSON.stringify(initialLayers.map((l) => [l.id, l.stops.map((s) => s.id), l.directions?.computedAt])));
  const [visible, setVisible] = useState<Record<string, boolean>>(() => Object.fromEntries(initialLayers.map((l) => [l.id, true])));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"both" | "patient" | "county">("both");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState<string | null>(null);
  const [share, setShare] = useState<{ url: string; expires: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // A fresh server render (after an action) replaces the local layers.
  const key = JSON.stringify(initialLayers.map((l) => [l.id, l.stops.map((s) => s.id), l.directions?.computedAt]));
  if (key !== serverKey) {
    setServerKey(key);
    setLayers(initialLayers);
    setVisible((v) => Object.fromEntries(initialLayers.map((l) => [l.id, v[l.id] ?? true])));
  }

  const run = (work: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await work();
      setToast(r.ok ? { ok: true, text: r.message ?? "Saved" } : { ok: false, text: r.error });
      setTimeout(() => setToast(null), 4000);
      router.refresh();
    });

  // ---- sidebar ----
  const term = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      patients.filter((p) => {
        if (!term) return true;
        const inPatient = p.name.toLowerCase().includes(term) || p.mrn.toLowerCase().includes(term) || gisStatus(p.statusKey).label.toLowerCase().includes(term) || (p.zip ?? "").startsWith(term);
        const inCounty = (p.county ?? "").toLowerCase().includes(term);
        return scope === "patient" ? inPatient : scope === "county" ? inCounty : inPatient || inCounty;
      }),
    [patients, term, scope]
  );
  const byId = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // ---- pins and lines ----
  const onLayers = new Set(layers.flatMap((l) => l.stops.map((s) => s.patientId)));
  const pins: GisPin[] = [];
  for (const id of selected) {
    const p = byId.get(id);
    if (!p || p.lat == null || p.lng == null || onLayers.has(id)) continue;
    pins.push({ id: `p-${p.id}`, patientId: p.id, lat: p.lat, lng: p.lng, color: pinStyles[p.id] ?? loaded?.color ?? "#2563eb", title: p.name, lines: [p.mrn, p.address, `${gisStatus(p.statusKey).label} · DOB ${p.dob}`], href: `/patients/${p.id}` });
  }
  const lines: GisLine[] = [];
  let totalM = 0;
  let shown = 0;
  for (const l of layers) {
    if (!visible[l.id]) continue;
    shown++;
    l.stops.forEach((s, i) => {
      if (s.lat == null || s.lng == null) return;
      pins.push({ id: s.id, lat: s.lat, lng: s.lng, color: pinStyles[s.patientId] ?? l.markerColor, label: stopLetter(i), title: s.name, lines: [`${l.label} · stop ${i + 1}`, s.address, ...(s.note ? [s.note] : [])], href: `/patients/${s.patientId}` });
    });
    if (l.directions) {
      lines.push({ id: l.id, color: l.markerColor, coordinates: l.directions.geometry });
      totalM += l.directions.distanceM;
    }
  }

  // ---- drag and drop ----
  const allow = (e: DragEvent, id: string) => {
    if (!drag || !canEdit) return;
    e.preventDefault();
    setOver(id);
  };
  const dropOnLayer = (routeId: string, at?: number) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    setOver(null);
    if (d.kind === "patient") {
      run(() => actions.addStops(routeId, [d.patientId], at));
    } else if (d.routeId === routeId) {
      const layer = layers.find((l) => l.id === routeId);
      if (!layer) return;
      const ids = layer.stops.map((s) => s.id).filter((id) => id !== d.stopId);
      const pos = at == null ? ids.length : Math.min(at, ids.length);
      ids.splice(pos, 0, d.stopId);
      // Local first so the line and letters update at once.
      setLayers((ls) => ls.map((l) => (l.id === routeId ? { ...l, stops: ids.map((id, index) => ({ ...l.stops.find((s) => s.id === id)!, index })) } : l)));
      run(() => actions.reorderStops(routeId, ids));
    } else {
      run(() => actions.moveStop(d.stopId, routeId, at));
    }
  };

  const steps = showSteps ? layers.find((l) => l.id === showSteps) : null;

  return (
    <div className="gis-work">
      {toast && (
        <div className={`gis-toast ${toast.ok ? "ok" : "err"}`} role="status">
          {toast.text}
        </div>
      )}
      {/* ---- left: routes ---- */}
      <aside className="panel gis-pane-left">
        <div className="gis-origin">
          <span className="gis-dot" style={{ background: "#16a34a" }}>
            O
          </span>
          <div>
            <div className="cn-small">
              <strong>Origin</strong>
            </div>
            <div className="muted cn-small">{origin}</div>
          </div>
        </div>
        {canEdit && (
          <div className="fr-bulk">
            <button className="btn secondary" type="button" onClick={() => setAdding((a) => !a)}>
              + Add layer
            </button>
            <Link className="btn ghost" href={`/gis/maps/${mapId}/settings`}>
              Settings
            </Link>
          </div>
        )}
        {adding && canEdit && (
          <form
            className="gis-layer-form"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              setAdding(false);
              run(() => actions.createLayer(mapId, fd));
            }}
          >
            <input name="label" required maxLength={80} placeholder="Layer name (e.g. Monday)" autoFocus />
            <input name="visitDate" type="date" required defaultValue={todayParam} />
            <div className="gis-colors">
              <label title="Marker colour">
                <input name="markerColor" type="color" defaultValue="#2563eb" /> pins
              </label>
              <label title="Layer background">
                <input name="layerColor" type="color" defaultValue="#dbeafe" /> layer
              </label>
              <label title="Layer text">
                <input name="layerTextColor" type="color" defaultValue="#1e3a8a" /> text
              </label>
            </div>
            <div className="fr-bulk">
              <button className="btn" type="submit">
                Create
              </button>
              <button className="btn ghost" type="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {regions.length > 0 && (
          <label className="checkbox-inline cn-small">
            <input type="checkbox" checked={showRegions} onChange={(e) => setShowRegions(e.target.checked)} /> Region overlays ({regions.length})
          </label>
        )}
        <h3 className="gis-h">My groups</h3>
        <ul className="gis-quick">
          {quickFilters.map((f) => (
            <li key={f.key}>
              <Link href={f.href} className={f.active ? "active" : undefined}>
                {f.key.startsWith("g:") && <span className="gis-swatch" style={{ background: f.color }} />} {f.label}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/gis/groups" className="muted">
              Manage groups…
            </Link>
          </li>
        </ul>

        <h3 className="gis-h">Layers</h3>
        {layers.length === 0 && <p className="muted cn-small">No layers yet. Add one, then drag patients onto it.</p>}
        {layers.map((l) => (
          <section
            key={l.id}
            className={`gis-layer${over === `layer-${l.id}` ? " over" : ""}`}
            style={{ background: l.layerColor, color: l.layerTextColor }}
            onDragOver={(e) => allow(e, `layer-${l.id}`)}
            onDragLeave={() => setOver((o) => (o === `layer-${l.id}` ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              dropOnLayer(l.id);
            }}
          >
            <div className="gis-layer-head">
              <label className="checkbox-inline cn-small">
                <input type="checkbox" checked={visible[l.id] ?? true} onChange={(e) => setVisible((v) => ({ ...v, [l.id]: e.target.checked }))} />
                <span className="gis-swatch" style={{ background: l.markerColor }} />
                <strong>{l.label}</strong> <span className="cn-small">({l.stops.length})</span>
              </label>
              <span className="cn-small">{l.visitDate}</span>
              {canEdit && (
                <span className="gis-layer-menu">
                  <button className="btn ghost" type="button" onClick={() => setEditing(editing === l.id ? null : l.id)} aria-label="Edit layer">
                    ⋯
                  </button>
                </span>
              )}
            </div>
            {editing === l.id && canEdit && (
              <form
                className="gis-layer-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  setEditing(null);
                  run(() => actions.updateLayer(l.id, fd));
                }}
              >
                <input name="label" defaultValue={l.label} maxLength={80} />
                <input name="visitDate" type="date" defaultValue={l.visitDate} />
                <input name="note" defaultValue={l.note ?? ""} placeholder="Note" maxLength={300} />
                <div className="gis-colors">
                  <label>
                    <input name="markerColor" type="color" defaultValue={l.markerColor} /> pins
                  </label>
                  <label>
                    <input name="layerColor" type="color" defaultValue={l.layerColor} /> layer
                  </label>
                  <label>
                    <input name="layerTextColor" type="color" defaultValue={l.layerTextColor} /> text
                  </label>
                </div>
                <div className="fr-bulk">
                  <button className="btn" type="submit">
                    Save
                  </button>
                  <button className="btn ghost" type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete layer "${l.label}" and its ${l.stops.length} stops?`)) run(() => actions.deleteLayer(l.id));
                    }}
                  >
                    Delete
                  </button>
                </div>
              </form>
            )}
            {canEdit && (
              <label className="checkbox-inline cn-small gis-optimize">
                <input type="checkbox" checked={l.optimize} disabled={pending} onChange={(e) => run(() => actions.setOptimize(l.id, e.target.checked))} /> Optimize
              </label>
            )}
            <ol className="gis-stops">
              {l.stops.map((s, i) => (
                <li
                  key={s.id}
                  className={`gis-stop${over === `stop-${s.id}` ? " over" : ""}${drag?.kind === "stop" && drag.stopId === s.id ? " dragging" : ""}`}
                  draggable={canEdit}
                  onDragStart={() => setDrag({ kind: "stop", stopId: s.id, routeId: l.id })}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  onDragOver={(e) => {
                    e.stopPropagation();
                    allow(e, `stop-${s.id}`);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropOnLayer(l.id, i);
                  }}
                  title={canEdit ? "Drag to reorder or onto another layer" : undefined}
                >
                  <span className="gis-dot" style={{ background: s.lat == null ? "#9ca3af" : l.markerColor }}>
                    {stopLetter(i)}
                  </span>
                  <span className="gis-stop-text">
                    <Link href={`/patients/${s.patientId}`}>{s.name}</Link>
                    <span className="cn-small gis-stop-sub">
                      {s.address || "No address"}
                      {s.lat == null ? " · no pin" : ""}
                      {l.directions && l.directions.stopIds.includes(s.id) && legFor(l, s.id)}
                    </span>
                  </span>
                  {canEdit && (
                    <button className="gis-x" type="button" aria-label="Remove stop" onClick={() => run(() => actions.removeStop(s.id))}>
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {canEdit && (
              <form
                className="gis-addrow"
                onSubmit={(e) => {
                  e.preventDefault();
                  const ids = [...selected].filter((id) => !l.stops.some((s) => s.patientId === id));
                  if (ids.length) run(() => actions.addStops(l.id, ids));
                }}
              >
                <button className="btn ghost" type="submit" disabled={selected.size === 0 || pending}>
                  Add {selected.size || ""} selected
                </button>
                <button className="btn ghost" type="button" disabled={pending} onClick={() => run(() => actions.redrawDirections(l.id))}>
                  Redraw
                </button>
                {l.directions && (
                  <button className="btn ghost" type="button" onClick={() => setShowSteps(showSteps === l.id ? null : l.id)}>
                    Steps
                  </button>
                )}
              </form>
            )}
            <div className="cn-small gis-layer-foot">
              {l.directions ? `${miles(l.directions.distanceM)} · ${minutes(l.directions.durationS)}${l.directions.fromHome ? " · from home and back" : ""}` : l.stops.some((s) => s.lat != null) ? "No directions yet" : ""}
            </div>
            <div className="gis-dest cn-small">
              <span className="gis-dot" style={{ background: "#16a34a" }}>
                D
              </span>
              Destination: {origin}
            </div>
          </section>
        ))}
      </aside>

      {/* ---- middle: patients ---- */}
      <aside className="panel gis-pane-mid">
        <div className="gis-mid-head">
          <strong>{loaded ? loaded.label : "Patients"}</strong> <span className="muted cn-small">{rows.length}</span>
          <span className="gis-mid-tools">
            <button className="btn ghost" type="button" onClick={() => router.refresh()} title="Refresh">
              ↻
            </button>
            <button className="btn ghost" type="button" onClick={() => setSelected(new Set())} title="Clear selection">
              ✕ {selected.size || ""}
            </button>
          </span>
        </div>
        <div className="gis-mid-search">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, status, zip or county…" aria-label="Search patients" />
          <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} aria-label="Search scope">
            <option value="both">Both</option>
            <option value="patient">Patient</option>
            <option value="county">County</option>
          </select>
        </div>
        {!loaded && <p className="muted cn-small">Pick a group on the left to load patients here. Tick a row to show its pin; drag a row onto a layer to add it as a stop.</p>}
        {loaded && rows.length > 0 && (
          <label className="checkbox-inline cn-small">
            <input type="checkbox" checked={rows.every((r) => selected.has(r.id))} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /> Show all {rows.length} on the map
          </label>
        )}
        <ul className="gis-rows">
          {rows.map((p) => {
            const st = gisStatus(p.statusKey);
            return (
              <li
                key={p.id}
                className={`gis-row${onLayers.has(p.id) ? " on-layer" : ""}`}
                draggable={canEdit}
                onDragStart={() => setDrag({ kind: "patient", patientId: p.id })}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
              >
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Show ${p.name} on the map`} disabled={p.lat == null} title={p.lat == null ? "No coordinates" : undefined} />
                <span className="gis-grip" aria-hidden="true">
                  ⠿
                </span>
                <span className="gis-row-name">
                  {p.name}
                  {p.lat == null && <span className="muted cn-small"> · no pin</span>}
                </span>
                <span className="gis-badge" style={{ background: st.tone }}>
                  {st.label}
                </span>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* ---- right: map ---- */}
      <section className="gis-pane-map">
        <GisMapView
          pins={pins}
          bases={base ? [base] : []}
          lines={lines}
          height="100%"
          view={view}
          onViewChange={canEdit ? actions.saveMapCenter : undefined}
          regions={showRegions ? regions : []}
          pinAction={canEdit && layers.length > 0 ? { label: `Add to ${layers[0].label}`, run: async (patientId) => void (await actions.addStops(layers[0].id, [patientId])) } : undefined}
        />
        <div className="gis-foot">
          <span>
            {shown} layer{shown === 1 ? "" : "s"} shown
          </span>
          <span>Total {miles(totalM)}</span>
          <span className="muted cn-small">{pending ? "Saving…" : ""}</span>
          {canEdit && (
            <button
              className="btn secondary gis-foot-btn"
              type="button"
              disabled={shown === 0 || pending}
              onClick={() =>
                start(async () => {
                  const r = await actions.createShareLink(mapId, layers.filter((l) => visible[l.id]).map((l) => l.id));
                  if (r.ok) setShare({ url: r.url, expires: r.expiresAt.slice(0, 10) });
                  else setToast({ ok: false, text: r.error });
                })
              }
            >
              Generate link
            </button>
          )}
        </div>
        {share && (
          <div className="gis-share-modal" role="dialog" aria-label="Share link">
            <div className="panel stack gis-share-box">
              <h2>Share link</h2>
              <p className="muted cn-small">
                Opens without login and shows the ticked layers with stop names, addresses, the map and step-by-step directions. Valid until {share.expires}. Shown once: copy it now.
              </p>
              <div className="gis-share-url">
                <input readOnly value={share.url} aria-label="Share link URL" onFocus={(e) => e.currentTarget.select()} />
                <button
                  className="btn"
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(share.url);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="fr-bulk">
                <a className="btn ghost" href={share.url} target="_blank" rel="noreferrer">
                  Open
                </a>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    setShare(null);
                    setCopied(false);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
        {steps && steps.directions && (
          <div className="panel gis-steps">
            <div className="gw-section-head">
              <strong>Step-by-step · {steps.label}</strong>
              <button className="btn ghost" type="button" onClick={() => setShowSteps(null)}>
                Hide
              </button>
            </div>
            <p className="cn-small">
              Drive {miles(steps.directions.distanceM)} · {minutes(steps.directions.durationS)} · {steps.directions.legs.length} legs
            </p>
            {steps.directions.legs.map((leg, i) => (
              <details key={i} className="cn-small">
                <summary>
                  Leg {i + 1}: {miles(leg.distanceM)} · {minutes(leg.durationS)}
                </summary>
                <ol>
                  {(leg.steps ?? []).map((s, j) => (
                    <li key={j}>
                      {s.text} <span className="muted">({miles(s.distanceM)})</span>
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// Drive from the previous point for a placed stop, when the layer's directions are current.
function legFor(l: Layer, stopId: string) {
  const d = l.directions!;
  const i = d.stopIds.indexOf(stopId);
  const leg = d.fromHome ? d.legs[i] : i > 0 ? d.legs[i - 1] : null;
  return leg ? ` · ${miles(leg.distanceM)}, ${minutes(leg.durationS)}` : "";
}
