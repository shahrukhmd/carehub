"use client";

import { useState } from "react";
import { GisMapView, type GisLine, type GisPin } from "@/components/GisMapView";
import { miles, minutes, stopLetter, type Layer } from "@/lib/gis/shared";

// The public route viewer: a Routes panel with each shared layer and its numbered stops (toggle on the map), the
// map with lettered stops and the drive, and a Step-by-Step panel per layer.
export function SharedRoutes({ mapLabel, origin, base, layers, phones, expires }: { mapLabel: string; origin: string; base: GisPin | null; layers: Layer[]; phones: Record<string, string>; expires: string }) {
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(layers.map((l) => [l.id, true])));
  const [steps, setSteps] = useState<string | null>(null);
  const pins: GisPin[] = [];
  const lines: GisLine[] = [];
  for (const l of layers) {
    if (!on[l.id]) continue;
    l.stops.forEach((s, i) => {
      if (s.lat == null || s.lng == null) return;
      pins.push({ id: s.id, lat: s.lat, lng: s.lng, color: l.markerColor, label: stopLetter(i), title: s.name, lines: [s.address, ...(phones[s.id] ? [`Phone ${phones[s.id]}`] : []), ...(s.note ? [s.note] : [])] });
    });
    if (l.directions) lines.push({ id: l.id, color: l.markerColor, coordinates: l.directions.geometry });
  }
  const stepLayer = steps ? layers.find((l) => l.id === steps) : null;

  return (
    <div className="share-page">
      <aside className="pp-card share-routes">
        <h1 className="share-title">Routes</h1>
        <p className="pp-muted cn-small">
          {mapLabel} · from {origin} · link valid until {expires}
        </p>
        {layers.map((l) => (
          <section key={l.id} className="share-layer" style={{ borderColor: l.markerColor }}>
            <label className="checkbox-inline">
              <input type="checkbox" checked={on[l.id] ?? true} onChange={(e) => setOn((o) => ({ ...o, [l.id]: e.target.checked }))} />
              <strong>{l.label}</strong>
            </label>
            <div className="pp-muted cn-small">
              {l.visitDate} · {l.stops.length} stop{l.stops.length === 1 ? "" : "s"}
              {l.directions ? ` · ${miles(l.directions.distanceM)} · ${minutes(l.directions.durationS)}` : ""}
            </div>
            {l.note && <div className="cn-small">{l.note}</div>}
            <ol className="share-stops">
              {l.stops.map((s, i) => (
                <li key={s.id}>
                  <span className="gis-dot" style={{ background: s.lat == null ? "#9ca3af" : l.markerColor }}>
                    {stopLetter(i)}
                  </span>
                  <span>
                    <strong>{s.name}</strong>
                    <div className="cn-small">{s.address || "No address"}</div>
                    {phones[s.id] && (
                      <div className="cn-small">
                        <a href={`tel:${phones[s.id]}`}>{phones[s.id]}</a>
                      </div>
                    )}
                    {s.note && <div className="cn-small pp-muted">{s.note}</div>}
                    {s.lat != null && (
                      <div className="cn-small">
                        <a href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`} target="_blank" rel="noreferrer">
                          Navigate
                        </a>
                      </div>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {l.directions && (
              <button className="btn secondary" type="button" onClick={() => setSteps(steps === l.id ? null : l.id)}>
                {steps === l.id ? "Hide step-by-step" : "Open step-by-step"}
              </button>
            )}
          </section>
        ))}
      </aside>
      <div className="share-map">
        <GisMapView pins={pins} bases={base ? [base] : []} lines={lines} height="100%" />
      </div>
      {stepLayer?.directions && (
        <aside className="pp-card share-steps">
          <div className="gw-section-head">
            <strong>Step-by-step · {stepLayer.label}</strong>
            <button className="btn ghost" type="button" onClick={() => setSteps(null)}>
              Hide
            </button>
          </div>
          <p>
            Drive {miles(stepLayer.directions.distanceM)} · {minutes(stepLayer.directions.durationS)} · {stepLayer.directions.legs.length} legs
          </p>
          {stepLayer.directions.legs.map((leg, i) => {
            const to = stepLayer.directions!.fromHome ? stepLayer.stops.filter((s) => s.lat != null)[i] : stepLayer.stops.filter((s) => s.lat != null)[i + 1];
            return (
              <section key={i} className="share-leg">
                <strong>
                  Leg {i + 1}: {to ? `to ${to.name}` : "back to base"} · {miles(leg.distanceM)} · {minutes(leg.durationS)}
                </strong>
                <ol>
                  {(leg.steps ?? []).map((s, j) => (
                    <li key={j}>
                      {s.text} <span className="pp-muted">({miles(s.distanceM)})</span>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </aside>
      )}
    </div>
  );
}
