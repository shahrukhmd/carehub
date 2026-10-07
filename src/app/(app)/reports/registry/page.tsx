import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { sdohDomainLabel } from "@/lib/care-plan";
import { formatDate, patientAccountStatusLabel } from "@/lib/format";
import { REGISTRY_KEYS, REGISTRY_LIMIT, ageOf, hasCriteria, runRegistry, type RegistryCriteria } from "@/lib/registry";
import { etiologyLabel } from "@/lib/wound";
import { rolesFor, allowed } from "@/lib/permissions";

const SHOWN = 500;
const EXPORT_ROLES = rolesFor("reports.export");
type Search = RegistryCriteria & { run?: string };

// Build a list of patients from clinical and demographic criteria, then export it.
export default async function PatientRegistryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("reports.clinical"));
  const sp = await searchParams;
  const ran = sp.run === "1" || hasCriteria(sp);

  const [payers, providers, fields, result] = await Promise.all([
    prisma.payer.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.customField.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { key: true, label: true } }),
    ran ? runRegistry(user.practiceId, sp, { includeRestricted: user.role === "ADMIN" }) : null,
  ]);
  const qs = new URLSearchParams();
  for (const k of REGISTRY_KEYS) if (sp[k]) qs.set(k, sp[k]!);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Practice reports</p>
          <h1>Patient registry</h1>
          <p className="muted" style={{ margin: 0 }}>
            Find every patient who matches a set of criteria — for outreach, recalls, audits or a payer request.
          </p>
        </div>
        {result && result.rows.length > 0 && allowed(user, EXPORT_ROLES) && (
          <a className="btn secondary" href={`/api/reports/registry?${qs}`}>
            Export CSV ({result.rows.length})
          </a>
        )}
      </div>

      <form method="get" className="panel cd-filter-form rg-form">
        <input type="hidden" name="run" value="1" />
        <label>
          Diagnosis (ICD-10 starts with; commas for several)
          <input name="dx" defaultValue={sp.dx ?? ""} placeholder="e.g. E11, L97" />
        </label>
        <label>
          Active medication (name contains)
          <input name="med" defaultValue={sp.med ?? ""} placeholder="e.g. metformin, insulin" />
        </label>
        <label>
          Open wounds
          <select name="wound" defaultValue={sp.wound ?? ""}>
            <option value="">Any or none</option>
            <option value="ANY">Has an open wound</option>
            <option value="NONE">No open wound</option>
            {Object.entries(etiologyLabel).map(([k, l]) => (
              <option key={k} value={k}>
                Open wound: {l}
              </option>
            ))}
          </select>
        </label>
        <div className="cd-pair">
          <label>
            Age from
            <input name="ageMin" type="number" min="0" max="130" defaultValue={sp.ageMin ?? ""} />
          </label>
          <label>
            to
            <input name="ageMax" type="number" min="0" max="130" defaultValue={sp.ageMax ?? ""} />
          </label>
        </div>
        <label>
          Sex
          <select name="sex" defaultValue={sp.sex ?? ""}>
            <option value="">All</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
          </select>
        </label>
        <label>
          Insurance plan
          <select name="payer" defaultValue={sp.payer ?? ""}>
            <option value="">All</option>
            {payers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Provider (wound care, primary care or referring)
          <select name="provider" defaultValue={sp.provider ?? ""}>
            <option value="">All</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="cd-pair">
          <label>
            Last visit from
            <input type="date" name="seenFrom" defaultValue={sp.seenFrom ?? ""} />
          </label>
          <label>
            to
            <input type="date" name="seenTo" defaultValue={sp.seenTo ?? ""} />
          </label>
        </div>
        <label>
          Not seen for at least (days)
          <input name="notSeenDays" type="number" min="1" max="999" defaultValue={sp.notSeenDays ?? ""} placeholder="e.g. 60" />
        </label>
        <label>
          Social need found
          <select name="need" defaultValue={sp.need ?? ""}>
            <option value="">Any or none</option>
            {Object.entries(sdohDomainLabel).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Text message consent
          <select name="consent" defaultValue={sp.consent ?? ""}>
            <option value="">Any</option>
            <option value="YES">Consented</option>
            <option value="NO">Declined</option>
            <option value="NONE">Not asked yet</option>
          </select>
        </label>
        <label>
          Account status
          <select name="status" defaultValue={sp.status ?? "ACTIVE"}>
            {Object.entries(patientAccountStatusLabel).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
            <option value="ALL">All statuses</option>
          </select>
        </label>
        {fields.length > 0 && (
          <div className="cd-pair">
            <label>
              Custom field
              <select name="cf" defaultValue={sp.cf ?? ""}>
                <option value="">—</option>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              contains
              <input name="cfv" defaultValue={sp.cfv ?? ""} />
            </label>
          </div>
        )}
        <div className="gw-actions">
          <button className="btn" type="submit">
            Build list
          </button>
          <Link className="btn ghost" href="/reports/registry">
            Clear
          </Link>
        </div>
      </form>

      {result && (
        <section className="panel cd-list">
          <div className="cd-list-head">
            <strong>
              {result.rows.length} patient{result.rows.length === 1 ? "" : "s"} match
            </strong>
            {result.truncated && <span>Stopped at {REGISTRY_LIMIT} — add criteria to narrow the list</span>}
          </div>
          <div className="cd-scroll">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>MRN</th>
                  <th>Age · sex</th>
                  <th>Phone</th>
                  <th>Primary insurance</th>
                  <th>Last visit</th>
                  <th>Active problems</th>
                  <th>Active medications</th>
                  <th>Open wounds</th>
                  {result.customLabel && <th>{result.customLabel}</th>}
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, SHOWN).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/patients/${p.id}`}>
                        {p.lastName}, {p.firstName}
                      </Link>
                    </td>
                    <td>{p.mrn}</td>
                    <td>
                      {ageOf(p.dob)} · {p.sex}
                    </td>
                    <td>{p.phone ?? "—"}</td>
                    <td>{p.insurances[0]?.payer.name ?? "—"}</td>
                    <td>{p.lastVisit ? formatDate(p.lastVisit) : <span className="muted">Never</span>}</td>
                    <td className="cm-detail">{p.problems.map((x) => x.icd10).join(", ") || "—"}</td>
                    <td className="cm-detail">{p.medications.map((m) => m.name).join(", ") || "—"}</td>
                    <td className="cm-detail">{p.wounds.map((w) => `${w.label} (${w.location})`).join(", ") || "—"}</td>
                    {result.customLabel && <td>{p.custom || "—"}</td>}
                  </tr>
                ))}
                {result.rows.length === 0 && (
                  <tr>
                    <td colSpan={result.customLabel ? 10 : 9} className="muted">
                      No patients match these criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {result.rows.length > SHOWN && <p className="muted">Showing the first {SHOWN}. The export has all {result.rows.length}.</p>}
        </section>
      )}
    </div>
  );
}
