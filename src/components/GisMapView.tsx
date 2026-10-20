"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

// A pin: a patient at their geocoded address, a route stop (with its letter), or a clinician's home base.
export type GisPin = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  title: string;
  lines: string[];
  href?: string;
  // Stop letter or home icon text; a labelled pin is drawn as a round badge.
  label?: string;
  textColor?: string;
  patientId?: string;
  actions?: { label: string; href: string }[];
};
// A drive drawn on the map: [lng, lat] pairs.
export type GisLine = { id: string; color: string; coordinates: [number, number][] };
export type GisView = { lat: number; lng: number; zoom: number };
// A boundary overlay: a GeoJSON FeatureCollection drawn as a faint fill with an outline.
export type GisRegion = { id: string; color: string; geojson: GeoJSON.FeatureCollection };
// A server action a pin's popup button calls with the pin's patientId (e.g. "Add to layer").
export type PinAction = { label: string; run: (patientId: string) => Promise<void> };

// MapLibre GL over OpenStreetMap raster tiles: no key, no billing. Google Maps replaces the style behind the same
// props when the practice sets a key. Loaded on the client only (the library needs window).
export function GisMapView({
  pins,
  bases,
  lines = [],
  height = 560,
  view,
  onViewChange,
  pinAction,
  className,
  regions = [],
}: {
  pins: GisPin[];
  bases: GisPin[];
  lines?: GisLine[];
  regions?: GisRegion[];
  height?: number | string;
  // Where to open (a saved centre); without it the map fits to the pins.
  view?: GisView | null;
  // Called, debounced, when the user pans or zooms (to remember the centre).
  onViewChange?: (fd: FormData) => Promise<void>;
  pinAction?: PinAction;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const onView = useRef(onViewChange);
  onView.current = onViewChange;
  const action = useRef(pinAction);
  action.current = pinAction;

  useEffect(() => {
    if (!el.current) return;
    let disposed = false;
    let map: import("maplibre-gl").Map | null = null;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (disposed || !el.current) return;
      const all = [...pins, ...bases];
      map = new maplibregl.Map({
        container: el.current,
        style: {
          version: 8,
          sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
        center: all.length ? [all[0].lng, all[0].lat] : [-86.8, 33.5],
        zoom: all.length ? 10 : 6,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
      const popupFor = (p: GisPin, offset: number) => {
        const node = document.createElement("div");
        node.innerHTML = `<strong>${p.href ? `<a href="${escape(p.href)}">${escape(p.title)}</a>` : escape(p.title)}</strong>${p.lines.map((l) => `<div class="muted">${escape(l)}</div>`).join("")}${(p.actions ?? []).map((a) => `<div><a class="gis-map-link" href="${escape(a.href)}">${escape(a.label)}</a></div>`).join("")}`;
        if (p.patientId && action.current) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn secondary gis-map-btn";
          btn.textContent = action.current.label;
          btn.onclick = async () => {
            btn.disabled = true;
            btn.textContent = "Working…";
            try {
              await action.current!.run(p.patientId!);
            } finally {
              window.location.reload();
            }
          };
          node.appendChild(btn);
        }
        return new maplibregl.Popup({ offset }).setDOMContent(node);
      };
      const marker = (p: GisPin, scale: number) => {
        if (p.label) {
          const div = document.createElement("div");
          div.className = "gis-map-stop";
          div.style.background = p.color;
          div.style.color = p.textColor ?? "#ffffff";
          div.textContent = p.label;
          div.title = p.title;
          return new maplibregl.Marker({ element: div });
        }
        return new maplibregl.Marker({ color: p.color, scale });
      };
      for (const p of bases) marker(p, 0.85).setLngLat([p.lng, p.lat]).setPopup(popupFor(p, 20)).addTo(map);
      for (const p of pins) marker(p, p.label ? 1 : 0.75).setLngLat([p.lng, p.lat]).setPopup(popupFor(p, 24)).addTo(map);
      map.on("load", () => {
        if (!map) return;
        for (const r of regions) {
          map.addSource(`region-${r.id}`, { type: "geojson", data: r.geojson });
          map.addLayer({ id: `region-fill-${r.id}`, type: "fill", source: `region-${r.id}`, filter: ["==", "$type", "Polygon"], paint: { "fill-color": r.color, "fill-opacity": 0.08 } });
          map.addLayer({ id: `region-line-${r.id}`, type: "line", source: `region-${r.id}`, paint: { "line-color": r.color, "line-width": 1.5, "line-opacity": 0.7 } });
        }
        for (const line of lines) {
          map.addSource(`line-${line.id}`, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line.coordinates } } });
          map.addLayer({ id: `line-casing-${line.id}`, type: "line", source: `line-${line.id}`, paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.8 }, layout: { "line-cap": "round", "line-join": "round" } });
          map.addLayer({ id: `line-${line.id}`, type: "line", source: `line-${line.id}`, paint: { "line-color": line.color, "line-width": 4 }, layout: { "line-cap": "round", "line-join": "round" } });
        }
      });
      const extent = [...all.map((p) => [p.lng, p.lat] as [number, number]), ...lines.flatMap((l) => l.coordinates)];
      if (view) {
        map.jumpTo({ center: [view.lng, view.lat], zoom: view.zoom });
      } else if (extent.length > 1) {
        const bounds = new maplibregl.LngLatBounds(extent[0], extent[0]);
        for (const c of extent) bounds.extend(c);
        map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 0 });
      }
      let timer: ReturnType<typeof setTimeout> | null = null;
      map.on("moveend", () => {
        if (!onView.current || !map) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const c = map!.getCenter();
          const fd = new FormData();
          fd.set("lat", String(c.lat));
          fd.set("lng", String(c.lng));
          fd.set("zoom", String(map!.getZoom()));
          onView.current!(fd).catch(() => {});
        }, 1000);
      });
    })();
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [pins, bases, lines, view, regions]);

  return <div ref={el} className={`gis-map${className ? ` ${className}` : ""}`} style={{ height }} role="region" aria-label="Map" />;
}
