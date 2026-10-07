import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { visitTypeNames } from "@/lib/scheduler-setup";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureChartSetup } from "@/lib/chart-setup";
import { DOCUMENT_SECTIONS, parseFields } from "@/lib/chart-forms";
import { VIEW_PARTS } from "@/lib/document-catalog";
import { SPECIALTIES, specialtyLabel } from "@/lib/specialties";

import { SettingsNav } from "../settings-nav";
import {
  createTemplate,
  createWorkflow,
  saveDocumentOptions,
  saveProgressNoteSettings,
  saveTemplateFlags,
} from "./actions";

const TABS: [string, string][] = [
  ["templates", "Document options"],
  ["workflows", "Chart workflows"],
  ["finalize", "Finalize visit admin"],
  ["signatures", "Form signature requirements"],
  ["critical", "Critical documents admin"],
  ["progress", "Progress note admin"],
  ["views", "Documentation views"],
];

export default async function DocumentationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; saved?: string; error?: string }>;
}) {
  const user = await requireUser(rolesFor("settings.admin"));
  const vtNames = await visitTypeNames(user.practiceId);
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "templates";
  await ensureChartSetup(user.practiceId);

  const [templates, workflows, views, usage] = await Promise.all([
    prisma.documentTemplate.findMany({ where: { practiceId: user.practiceId, audience: "STAFF" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.chartWorkflow.findMany({
      where: { practiceId: user.practiceId },
      include: { steps: { include: { template: true }, orderBy: { sortOrder: "asc" } }, _count: { select: { encounters: true } } },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    prisma.documentationView.findMany({ where: { practiceId: user.practiceId }, orderBy: { sortOrder: "asc" } }),
    prisma.encounterDocument.groupBy({ by: ["templateId"], where: { encounter: { practiceId: user.practiceId } }, _count: { _all: true } }),
  ]);
  const used = new Map(usage.map((u) => [u.templateId, u._count._all]));
  const forms = templates.filter((t) => t.kind === "FORM");
  const nameByKey = new Map(templates.map((t) => [t.key, t.name]));
  const partLabel = (p: string) => (p.startsWith("doc:") ? (nameByKey.get(p.slice(4)) ?? p.slice(4)) : (VIEW_PARTS[p] ?? p));

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Settings</p>
          <h1>Documentation settings</h1>
        </div>
      </div>
      <SettingsNav current="documentation" />
      <nav className="view-tabs st-tabs" aria-label="Documentation settings">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/settings/documentation?tab=${k}`} className={`view-tab${tab === k ? " active" : ""}`}>
            {label}
          </Link>
        ))}
      </nav>
      {sp.saved && <p className="notice-ok">Saved.</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}

      {tab === "templates" && (
        <>
          <section className="panel">
            <h2>New chart template</h2>
            <p className="muted">
              Design your own form (assessments, consents, order sheets, scored scales) or start from a copy of an existing one. Built-in chart
              sections (vitals, wounds, superbill…) can be renamed, moved and required, but their fields are fixed.
            </p>
            <form className="form-grid gw-grid-3" action={createTemplate}>
              <label>
                Template name
                <input name="name" required placeholder="e.g. Hyperbaric Oxygen Treatment" />
              </label>
              <label>
                Section
                <select name="section" defaultValue="ADDITIONAL">
                  {Object.entries(DOCUMENT_SECTIONS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start from
                <select name="copyFrom" defaultValue="">
                  <option value="">Blank form</option>
                  {forms.map((t) => (
                    <option key={t.id} value={t.id}>
                      Copy of {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-inline">
                <input type="checkbox" name="perWound" /> Complete once per wound
              </label>
              <button className="btn" type="submit">
                Create &amp; design →
              </button>
            </form>
          </section>
          <section className="panel">
            <h2>Document options</h2>
            <p className="muted">Turn documents on or off for charting, choose their section, and set the order they are listed in.</p>
            <form action={saveDocumentOptions} className="stack">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Active</th>
                      <th>Document</th>
                      <th>Type</th>
                      <th>Section</th>
                      <th title="Shown only while this specialty pack is on (Practice setup)">Specialty</th>
                      <th>Order</th>
                      <th>Used</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((t) => (
                      <tr key={t.id} className={t.active ? undefined : "muted"}>
                        <td>
                          <input type="hidden" name={`present_${t.id}`} value="1" />
                          <input type="checkbox" name={`active_${t.id}`} defaultChecked={t.active} aria-label={`${t.name} active`} />
                        </td>
                        <td>
                          <strong>{t.name}</strong>
                          <div className="muted">
                            {t.perWound ? "Per wound · " : ""}
                            {t.signatureRequired ? "Signature required · " : ""}
                            {t.critical ? "Critical · " : ""}
                            {t.standard ? "Standard" : "Custom"}
                          </div>
                        </td>
                        <td>{t.kind === "BUILTIN" ? "Built-in section" : `Form · ${parseFields(t.fields).length} fields`}</td>
                        <td>
                          <select name={`section_${t.id}`} defaultValue={t.section} aria-label={`${t.name} section`}>
                            {Object.entries(DOCUMENT_SECTIONS).map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select name={`spec_${t.id}`} defaultValue={t.specialty ?? ""} aria-label={`${t.name} specialty`}>
                            <option value="">General</option>
                            {Object.entries(SPECIALTIES).map(([k, sp]) => (
                              <option key={k} value={k}>
                                {sp.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input name={`sort_${t.id}`} type="number" defaultValue={t.sortOrder} className="st-num" aria-label={`${t.name} order`} />
                        </td>
                        <td>{used.get(t.id) ?? 0}</td>
                        <td>
                          <Link href={`/settings/documentation/templates/${t.id}`}>{t.kind === "FORM" ? "Design" : "Edit"}</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="form-actions">
                <button className="btn" type="submit">
                  Save document options
                </button>
              </div>
            </form>
          </section>
        </>
      )}

      {tab === "workflows" && (
        <>
          <section className="panel">
            <h2>Chart workflows</h2>
            <p className="muted">
              A workflow is the set of documents charted for a visit type, in order, grouped into Documentation, Procedure &amp; treatment,
              Progress note and Billing. Everything else stays available under Additional documents.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Specialty</th>
                  <th>Visit types</th>
                  <th>Documents</th>
                  <th>Required to finalize</th>
                  <th>Visits</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {workflows.map((w) => (
                  <tr key={w.id} className={w.active ? undefined : "muted"}>
                    <td>
                      <strong>{w.name}</strong>
                      {w.isDefault && <span className="gw-tag gw-tag-info">Default</span>}
                      {!w.active && <span className="gw-tag gw-tag-muted">Inactive</span>}
                      {w.description && <div className="muted">{w.description}</div>}
                    </td>
                    <td>{specialtyLabel(w.specialty)}</td>
                    <td>
                      {(w.visitTypes ?? "")
                        .split(",")
                        .filter(Boolean)
                        .map((v) => vtNames[v] ?? v)
                        .join(", ") || "—"}
                    </td>
                    <td>{w.steps.length}</td>
                    <td>{w.steps.filter((s) => s.requiredToFinalize).length}</td>
                    <td>{w._count.encounters}</td>
                    <td>
                      <Link href={`/settings/documentation/workflows/${w.id}`}>Edit</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel">
            <h2>New workflow</h2>
            <form className="form-grid gw-grid-3" action={createWorkflow}>
              <label>
                Name
                <input name="name" required placeholder="e.g. Non-Provider Ultrasound Mist Therapy" />
              </label>
              <label>
                Start from
                <select name="copyFrom" defaultValue="">
                  <option value="">Empty workflow</option>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      Copy of {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn" type="submit">
                Create &amp; edit →
              </button>
            </form>
          </section>
        </>
      )}

      {tab === "finalize" && (
        <section className="panel">
          <h2>Finalize visit admin</h2>
          <p className="muted">
            &ldquo;Finalize Visit&rdquo; sends the chart to CDS. It is blocked until every required document in the visit&apos;s workflow is complete,
            critical documents are complete, and forms that need a signature are signed. Set requirements per workflow.
          </p>
          {workflows.map((w) => (
            <div key={w.id} className="st-finalize">
              <h3>
                {w.name} <Link href={`/settings/documentation/workflows/${w.id}`}>Edit requirements</Link>
              </h3>
              <p>
                {w.steps
                  .filter((s) => s.requiredToFinalize || s.template.critical)
                  .map((s) => `${s.template.name}${s.template.critical && !s.requiredToFinalize ? " (critical)" : ""}`)
                  .join(" · ") || <span className="muted">Nothing required — the visit can be finalized at any time.</span>}
              </p>
            </div>
          ))}
        </section>
      )}

      {(tab === "signatures" || tab === "critical") && (
        <section className="panel">
          <h2>{tab === "signatures" ? "Form signature requirements" : "Critical documents admin"}</h2>
          <p className="muted">
            {tab === "signatures"
              ? "Forms ticked here must be signed by the provider (with their signature on file) before the visit can be finalized."
              : "Critical documents are flagged on the chart until complete, and block finalizing when they are part of the visit's workflow."}
          </p>
          <form action={saveTemplateFlags.bind(null, tab === "signatures" ? "signatureRequired" : "critical")} className="stack">
            <div className="st-checks">
              {(tab === "signatures" ? forms : templates).map((t) => (
                <label key={t.id} className="checkbox-inline">
                  <input type="checkbox" name={`flag_${t.id}`} defaultChecked={tab === "signatures" ? t.signatureRequired : t.critical} />
                  <span>
                    {t.name}
                    {!t.active && <span className="muted"> (inactive)</span>}
                  </span>
                </label>
              ))}
            </div>
            <div className="form-actions">
              <button className="btn" type="submit">
                Save
              </button>
            </div>
          </form>
        </section>
      )}

      {tab === "progress" && (
        <section className="panel">
          <h2>Progress note admin</h2>
          <p className="muted">
            Choose which completed forms are written into the progress note (after the SOAP sections) and in what order.
          </p>
          <form action={saveProgressNoteSettings} className="stack">
            <table>
              <thead>
                <tr>
                  <th>Include</th>
                  <th>Document</th>
                  <th>Order in note</th>
                </tr>
              </thead>
              <tbody>
                {[...forms]
                  .sort((a, b) => a.noteOrder - b.noteOrder)
                  .map((t) => (
                    <tr key={t.id}>
                      <td>
                        <input type="checkbox" name={`inc_${t.id}`} defaultChecked={t.inProgressNote} aria-label={`Include ${t.name}`} />
                      </td>
                      <td>{t.name}</td>
                      <td>
                        <input name={`ord_${t.id}`} type="number" defaultValue={t.noteOrder} className="st-num" aria-label={`${t.name} order`} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="form-actions">
              <button className="btn" type="submit">
                Save progress note settings
              </button>
            </div>
          </form>
        </section>
      )}

      {tab === "views" && (
        <section className="panel">
          <div className="gw-section-head">
            <h2>Documentation views</h2>
            <Link className="btn" href="/settings/documentation/views/new">
              New view
            </Link>
          </div>
          <p className="muted">Printable combinations of chart documents, listed under Progress Note ▾ and Patient Reports on every visit.</p>
          <table>
            <thead>
              <tr>
                <th>View</th>
                <th>Includes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {views.map((v) => {
                let parts: string[] = [];
                try {
                  parts = JSON.parse(v.parts);
                } catch {
                  parts = [];
                }
                return (
                  <tr key={v.id} className={v.active ? undefined : "muted"}>
                    <td>
                      <strong>{v.name}</strong>
                      {!v.active && <span className="gw-tag gw-tag-muted">Inactive</span>}
                      {v.description && <div className="muted">{v.description}</div>}
                    </td>
                    <td>{parts.map(partLabel).join(" · ")}</td>
                    <td>
                      <Link href={`/settings/documentation/views/${v.id}`}>Edit</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
