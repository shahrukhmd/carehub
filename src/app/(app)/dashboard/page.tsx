import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { TILES, VIEWS, loadTile, parseTiles, tilesFor, type TileData } from "@/lib/dashboard-tiles";
import { DashboardPicker } from "@/components/DashboardPicker";
import { saveDashboardTiles } from "./actions";

type Search = { view?: string; customize?: string };

// The practice dashboard: pick a view (a preset set of tiles) or build your own. Every tile links into the
// screen where the work is done.
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const allowed = tilesFor(user);
  const mine = parseTiles(user.dashboardTiles).filter((k) => allowed.some((t) => t.key === k));
  // The first preset that has tiles for this role, unless the user picked one or has a view of their own.
  const presets = VIEWS.map((v) => ({ ...v, tiles: v.key === "custom" ? mine : v.tiles.filter((k) => allowed.some((t) => t.key === k)) })).filter((v) => v.key === "custom" || v.tiles.length > 0);
  const view = presets.find((v) => v.key === sp.view) ?? (mine.length ? presets.find((v) => v.key === "custom")! : presets[0]);
  const customize = sp.customize === "1" || (view.key === "custom" && mine.length === 0);
  const defs = view.tiles.map((k) => TILES.find((t) => t.key === k)!).filter(Boolean);
  const data = await Promise.all(defs.map((t) => loadTile(t.key, user)));

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">{user.practice.name}</p>
          <h1>Dashboard</h1>
        </div>
        <Link className="btn secondary" href={`/dashboard?view=custom&customize=1`}>
          {mine.length ? "Change my view" : "Build my view"}
        </Link>
      </div>
      <nav className="view-tabs" style={{ width: "fit-content" }}>
        {presets.map((v) => (
          <Link key={v.key} href={`/dashboard?view=${v.key}`} className={`view-tab${v.key === view.key ? " active" : ""}`}>
            {v.label}
          </Link>
        ))}
      </nav>

      {customize && <DashboardPicker tiles={allowed} initial={mine} action={saveDashboardTiles} />}

      {!customize && defs.length === 0 && <p className="muted">No tiles in this view.</p>}
      <div className="db-grid">
        {defs.map((t, i) => (
          <Tile key={t.key} title={t.title} span={t.span} data={data[i]} />
        ))}
      </div>
    </div>
  );
}

function Tile({ title, span, data }: { title: string; span: 1 | 2; data: TileData | null }) {
  return (
    <section className={`panel db-tile${data?.tone ? ` db-${data.tone}` : ""}`} style={{ gridColumn: `span ${span}` }}>
      <div className="db-head">
        <h2>{data?.href ? <Link href={data.href}>{title}</Link> : title}</h2>
      </div>
      {!data ? (
        <p className="muted">Nothing to show.</p>
      ) : (
        <>
          <p className="db-value">
            <strong>{data.value}</strong>
            {data.sub && <span className="muted"> {data.sub}</span>}
          </p>
          {data.rows && data.rows.length > 0 && (
            <ul className="db-rows">
              {data.rows.map((r, i) => (
                <li key={i} className={r.tone ? `db-row-${r.tone}` : undefined}>
                  <span>{r.href ? <Link href={r.href}>{r.label}</Link> : r.label}</span>
                  <strong>{r.value}</strong>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
