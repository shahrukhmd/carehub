import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { VIEW_PARTS } from "@/lib/document-catalog";
import { SettingsNav } from "../../../settings-nav";
import { deleteView, saveView } from "../../actions";

export default async function DocumentationViewEditor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const user = await requireUser(rolesFor("settings.admin"));
  const { id } = await params;
  const sp = await searchParams;
  const view = id === "new" ? null : await prisma.documentationView.findFirst({ where: { id, practiceId: user.practiceId } });
  if (id !== "new" && !view) notFound();
  const forms = await prisma.documentTemplate.findMany({
    where: { audience: "STAFF",  practiceId: user.practiceId, kind: "FORM" },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  let parts: string[] = [];
  try {
    parts = view ? JSON.parse(view.parts) : ["note", "signatures"];
  } catch {
    parts = [];
  }
  const orderOf = (p: string) => (parts.includes(p) ? (parts.indexOf(p) + 1) * 10 : "");

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings/documentation?tab=views">Documentation settings</Link> · Documentation view
          </p>
          <h1>{view?.name ?? "New documentation view"}</h1>
        </div>
        {view && (
          <form action={deleteView.bind(null, view.id)}>
            <button className="btn ghost" type="submit">
              Delete view
            </button>
          </form>
        )}
      </div>
      <SettingsNav current="documentation" />
      {sp.saved && <p className="notice-ok">Saved.</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <form action={saveView.bind(null, view?.id ?? "new")} className="panel stack">
        <div className="form-grid gw-grid-3">
          <label>
            Name
            <input name="name" defaultValue={view?.name ?? ""} required placeholder="e.g. Wound Care Order Packet" />
          </label>
          <label>
            Description
            <input name="description" defaultValue={view?.description ?? ""} />
          </label>
          <label className="checkbox-inline">
            <input type="checkbox" name="active" defaultChecked={view?.active ?? true} /> Active
          </label>
        </div>
        <p className="muted">Tick what to include; the order boxes set the print order (lowest first).</p>
        <h3>Chart sections</h3>
        <div className="st-parts">
          {Object.entries(VIEW_PARTS).map(([p, label]) => (
            <div key={p} className="st-part">
              <label className="checkbox-inline">
                <input type="checkbox" name="parts" value={p} defaultChecked={parts.includes(p)} /> {label}
              </label>
              <input name={`order_${p}`} type="number" defaultValue={orderOf(p)} className="st-num" aria-label={`${label} order`} />
            </div>
          ))}
        </div>
        <h3>Documents</h3>
        <div className="st-parts">
          {forms.map((t) => {
            const p = `doc:${t.key}`;
            return (
              <div key={t.id} className="st-part">
                <label className="checkbox-inline">
                  <input type="checkbox" name="parts" value={p} defaultChecked={parts.includes(p)} /> {t.name}
                </label>
                <input name={`order_${p}`} type="number" defaultValue={orderOf(p)} className="st-num" aria-label={`${t.name} order`} />
              </div>
            );
          })}
        </div>
        <div className="form-actions">
          <button className="btn" type="submit">
            Save view
          </button>
        </div>
      </form>
    </div>
  );
}
