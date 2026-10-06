import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SATISFIER_KINDS, ensureCareRules, parseCriteria } from "@/lib/care-rules";
import { etiologyLabel } from "@/lib/wound";
import { specialtyLabel } from "@/lib/specialties";
import { SettingsNav } from "../settings-nav";
import { deleteCareRule, saveCareRule, toggleCareRule } from "../../care-gaps/actions";

type Rule = Awaited<ReturnType<typeof prisma.careRule.findMany>>[number];

export default async function ClinicalRulesPage({ searchParams }: { searchParams: Promise<{ edit?: string; saved?: string; error?: string }> }) {
  const user = await requireUser(["ADMIN"]);
  const sp = await searchParams;
  await ensureCareRules(user.practiceId);
  const [rules, forms] = await Promise.all([
    prisma.careRule.findMany({ where: { practiceId: user.practiceId }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.documentTemplate.findMany({ where: { practiceId: user.practiceId, audience: "STAFF", active: true }, orderBy: { name: "asc" }, select: { key: true, name: true } }),
  ]);
  const editing = sp.edit === "new" ? null : rules.find((r) => r.id === sp.edit);
  const formName = new Map(forms.map((f) => [f.key, f.name]));
  const describe = (r: Rule) => {
    const c = parseCriteria(r.criteria);
    const who = [
      c.ageMin !== undefined ? `age ${c.ageMin}+` : "",
      c.ageMax !== undefined ? `up to ${c.ageMax}` : "",
      c.sex ? (c.sex === "F" ? "female" : "male") : "",
      c.icd10?.length ? `dx ${c.icd10.join(", ")}` : "",
      c.activeWound ? "open wound" : "",
      c.etiologies?.length ? c.etiologies.map((e) => etiologyLabel[e] ?? e).join("/") : "",
    ].filter(Boolean);
    const [kind, arg] = [r.satisfiedBy.split(":")[0], r.satisfiedBy.split(":").slice(1).join(":")];
    const what = kind === "DOCUMENT" ? `"${formName.get(arg) ?? arg}" completed` : arg ? `${SATISFIER_KINDS[kind]?.replace("…", "")} "${arg}"` : SATISFIER_KINDS[kind];
    return { who: who.join(" · ") || "Everyone", what };
  };

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Clinical rules</h1>
        </div>
        <div className="cn-actions">
          <Link className="btn ghost" href="/care-gaps">
            Care gap report
          </Link>
          <Link className="btn secondary" href="/settings/clinical-rules?edit=new#edit">
            + New rule
          </Link>
        </div>
      </div>
      <SettingsNav current="clinical-rules" />
      {sp.saved && <p className="notice-ok">Saved.</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <section className="panel">
        <p className="muted">
          Rules show as care-gap alerts on the patient chart and visit, and in the care gap report. A rule is met when what satisfies it happened within its
          interval; staff can also mark a gap done elsewhere, not applicable or refused.
        </p>
        <table className="cn-table">
          <thead>
            <tr>
              <th>Rule</th>
              <th>Applies to</th>
              <th>Met by</th>
              <th>Every</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const d = describe(r);
              return (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                    {r.severity === "INFO" && <span className="cn-tag">info</span>}
                    {r.specialty && <span className="cn-tag">{specialtyLabel(r.specialty)}</span>}
                    {r.source && <div className="muted cn-small">{r.source}</div>}
                  </td>
                  <td className="cn-small">{d.who}</td>
                  <td className="cn-small">{d.what}</td>
                  <td>{r.intervalDays % 365 === 0 ? `${r.intervalDays / 365} yr` : `${r.intervalDays} days`}</td>
                  <td>{r.active ? "On" : <span className="muted">Off</span>}</td>
                  <td className="cn-actions">
                    <Link className="btn ghost gw-mini" href={`/settings/clinical-rules?edit=${r.id}#edit`}>
                      Edit
                    </Link>
                    <form action={toggleCareRule.bind(null, r.id)}>
                      <button className="btn ghost gw-mini" type="submit">
                        {r.active ? "Turn off" : "Turn on"}
                      </button>
                    </form>
                    {!r.standard && (
                      <form action={deleteCareRule.bind(null, r.id)}>
                        <button className="btn ghost gw-mini" type="submit">
                          Delete
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {(sp.edit === "new" || editing) && <RuleEditor rule={editing ?? null} forms={forms} />}
    </div>
  );
}

function RuleEditor({ rule, forms }: { rule: Rule | null; forms: { key: string; name: string }[] }) {
  const c = rule ? parseCriteria(rule.criteria) : {};
  const kind = rule ? rule.satisfiedBy.split(":")[0] : "DOCUMENT";
  const arg = rule ? rule.satisfiedBy.split(":").slice(1).join(":") : "";
  return (
    <section className="panel" id="edit">
      <h2>{rule ? `Edit: ${rule.name}` : "New rule"}</h2>
      <form action={saveCareRule.bind(null, rule?.id ?? "new")} className="stack">
        <div className="form-grid gw-grid-3">
          <label>
            Name
            <input name="name" required defaultValue={rule?.name ?? ""} />
          </label>
          <label className="gw-span-2">
            Alert text
            <input name="message" defaultValue={rule?.message ?? ""} placeholder="e.g. A1C due — order or record the latest result." />
          </label>
          <label className="gw-span-3">
            Description
            <input name="description" defaultValue={rule?.description ?? ""} />
          </label>
        </div>
        <fieldset className="cn-types">
          <legend>Applies to</legend>
          <label>
            Age from <input type="number" name="ageMin" min={0} max={120} defaultValue={c.ageMin ?? ""} style={{ width: "5rem" }} />
          </label>
          <label>
            to <input type="number" name="ageMax" min={0} max={120} defaultValue={c.ageMax ?? ""} style={{ width: "5rem" }} />
          </label>
          <label>
            Sex{" "}
            <select name="sex" defaultValue={c.sex ?? ""}>
              <option value="">Any</option>
              <option value="F">Female</option>
              <option value="M">Male</option>
            </select>
          </label>
          <label>
            Diagnosis codes starting with <input name="icd10" defaultValue={(c.icd10 ?? []).join(", ")} placeholder="E11, L97" />
          </label>
          <label className="checkbox-inline">
            <input type="checkbox" name="activeWound" defaultChecked={Boolean(c.activeWound)} /> Only while a wound is open
          </label>
          {Object.entries(etiologyLabel).map(([k, l]) => (
            <label key={k} className="checkbox-inline">
              <input type="checkbox" name="etiologies" value={k} defaultChecked={(c.etiologies ?? []).includes(k)} /> {l}
            </label>
          ))}
        </fieldset>
        <div className="form-grid gw-grid-3">
          <label>
            Met by
            <select name="kind" defaultValue={kind}>
              {Object.entries(SATISFIER_KINDS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lab / vaccine name, or chart form
            <input name="arg" list="rule-forms" defaultValue={arg} placeholder="A1C · TDAP|TD · diabetic_foot_exam" />
            <datalist id="rule-forms">
              {forms.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </datalist>
          </label>
          <label>
            Every (days)
            <input type="number" name="intervalDays" min={1} max={3650} defaultValue={rule?.intervalDays ?? 365} />
          </label>
          <label>
            Type
            <select name="severity" defaultValue={rule?.severity ?? "ALERT"}>
              <option value="ALERT">Alert (highlighted)</option>
              <option value="INFO">Reminder (quiet)</option>
            </select>
          </label>
          <label className="checkbox-inline">
            <input type="checkbox" name="active" defaultChecked={rule?.active ?? true} /> On
          </label>
        </div>
        <div>
          <button className="btn" type="submit">
            Save rule
          </button>{" "}
          <Link className="btn ghost" href="/settings/clinical-rules">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
