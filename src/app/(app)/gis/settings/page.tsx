import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { getGisSettings, NAME_FORMATS } from "@/lib/gis/settings";
import { GisPage } from "../gis-shell";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { deleteRegion, saveGisSettings, setRegionActive, uploadRegion } from "../actions";

// GIS settings: map provider key, patient name display and share link defaults. Region overlays arrive with the
// map page.
export default async function GisSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser(rolesFor("gis.admin"));
  const sp = await searchParams;
  const s = await getGisSettings(user.practiceId);
  const envKey = Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim());
  const regions = await prisma.gisRegion.findMany({ where: { practiceId: user.practiceId }, select: { id: true, name: true, color: true, featureCount: true, active: true, createdAt: true }, orderBy: { createdAt: "desc" } });

  return (
    <GisPage title="GIS settings" sp={sp}>
      <form action={saveGisSettings} className="panel stack">
        <h2>Map provider</h2>
        <p className="muted cn-small">
          Blank uses the free stack: OpenStreetMap tiles, the US Census geocoder and OpenStreetMap routing. A Google Maps Platform key (Maps JavaScript, Geocoding and Directions enabled, restricted by HTTP referrer) switches geocoding, the map and turn-by-turn directions to Google.
          {envKey ? " A key is also set in the server environment and is used when this field is blank." : ""}
        </p>
        <label>
          Google Maps key
          <input name="googleMapsKey" type="password" autoComplete="off" placeholder={s.googleMapsKey ? "A key is saved" : "AIza…"} />
        </label>
        {s.googleMapsKey && (
          <label className="checkbox-inline">
            <input type="checkbox" name="keepKey" defaultChecked /> Keep the saved key (untick and leave the field blank to clear it)
          </label>
        )}

        <h2>Display</h2>
        <label>
          Patient name format
          <select name="nameFormat" defaultValue={s.nameFormat}>
            {NAME_FORMATS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <h2>Share links</h2>
        <div className="form-grid">
          <label>
            Days a link stays open
            <input name="shareLinkDays" type="number" min={1} max={90} defaultValue={s.shareLinkDays} />
          </label>
          <label>
            Opens allowed per link
            <input name="shareLinkMaxOpens" type="number" min={1} max={10000} defaultValue={s.shareLinkMaxOpens} />
          </label>
        </div>
        <button className="btn" type="submit">
          Save
        </button>
      </form>

      <section className="panel stack">
        <h2>Region overlays</h2>
        <p className="muted cn-small">County boundaries or territories drawn on every map of the practice. Upload KML, KMZ or GeoJSON; polygons and lines are kept, points are ignored.</p>
        <form action={uploadRegion} className="fr-filters">
          <label>
            File
            <input name="file" type="file" accept=".kml,.kmz,.geojson,.json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,application/geo+json,application/json" required />
          </label>
          <label>
            Name
            <input name="name" maxLength={80} placeholder="From the file name" />
          </label>
          <label>
            Colour
            <input name="color" type="color" defaultValue="#1f2937" />
          </label>
          <button className="btn secondary" type="submit">
            Upload
          </button>
        </form>
        <ul className="rp-list">
          {regions.map((r) => (
            <li key={r.id}>
              <span>
                <span className="gis-swatch" style={{ background: r.color }} /> <strong>{r.name}</strong> <span className="muted cn-small">{r.featureCount} shape{r.featureCount === 1 ? "" : "s"} · {formatDate(r.createdAt)}</span>
              </span>
              <span className="fr-bulk">
                <form action={setRegionActive.bind(null, r.id)} className="inline-select">
                  <label className="checkbox-inline cn-small">
                    <input type="checkbox" name="active" defaultChecked={r.active} /> on maps
                  </label>
                  <button className="btn ghost" type="submit">
                    Apply
                  </button>
                </form>
                <form action={deleteRegion.bind(null, r.id)}>
                  <button className="btn ghost" type="submit">
                    Remove
                  </button>
                </form>
              </span>
            </li>
          ))}
          {regions.length === 0 && <li className="muted">No overlays yet.</li>}
        </ul>
      </section>
    </GisPage>
  );
}
