import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, patientName } from "@/lib/format";
import { SettingsNav } from "../../settings-nav";
import { mergeCharts } from "../actions";

const FIELDS: [string, string][] = [
  ["mrn", "MRN"],
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["dob", "Date of birth"],
  ["sex", "Sex"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["addressLine1", "Address"],
  ["city", "City"],
  ["state", "State"],
  ["zip", "ZIP"],
  ["status", "Status"],
  ["createdAt", "Created"],
];

export default async function MergePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string; error?: string }> }) {
  const user = await requireUser(rolesFor("settings.admin"));
  const sp = await searchParams;
  const include = {
    _count: { select: { appointments: true, encounters: true, claims: true, insurances: true, documents: true, wounds: true, medications: true, allergies: true, problems: true } },
    insurances: { include: { payer: true } },
  } as const;
  const a = sp.a ? await prisma.patient.findFirst({ where: { id: sp.a, practiceId: user.practiceId }, include }) : null;
  if (!a) notFound();
  const b = sp.b ? await prisma.patient.findFirst({ where: { id: sp.b, practiceId: user.practiceId }, include }) : null;
  const others = b ? [] : await prisma.patient.findMany({ where: { practiceId: user.practiceId, id: { not: a.id } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 2000 });
  const show = (p: NonNullable<typeof a>, k: string) => {
    const v = (p as unknown as Record<string, unknown>)[k];
    return v instanceof Date ? formatDate(v) : v ? String(v) : "—";
  };
  const counts: [keyof NonNullable<typeof a>["_count"], string][] = [
    ["appointments", "Appointments"],
    ["encounters", "Visits"],
    ["claims", "Claims"],
    ["insurances", "Insurance policies"],
    ["documents", "Documents"],
    ["wounds", "Wounds"],
    ["medications", "Medications"],
    ["allergies", "Allergies"],
    ["problems", "Problems"],
  ];
  const suggested = b ? (a._count.encounters + a._count.claims >= b._count.encounters + b._count.claims ? a.id : b.id) : a.id;

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings/patients">Settings · Duplicate patients</Link>
          </p>
          <h1>Merge charts</h1>
        </div>
      </div>
      <SettingsNav current="patients" />
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {!b ? (
        <section className="panel">
          <h2>Merge {patientName(a)} with…</h2>
          <form method="get" className="cn-inline">
            <input type="hidden" name="a" value={a.id} />
            <select name="b" required aria-label="Other chart">
              <option value="">Choose the other chart…</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {patientName(p)} · {p.mrn} · {formatDate(p.dob)}
                </option>
              ))}
            </select>
            <button className="btn secondary" type="submit">
              Compare
            </button>
          </form>
        </section>
      ) : (
        <form action={mergeCharts} className="stack">
          <input type="hidden" name="a" value={a.id} />
          <input type="hidden" name="b" value={b.id} />
          <section className="panel">
            <table className="cn-table mg-table">
              <thead>
                <tr>
                  <th />
                  {[a, b].map((p) => (
                    <th key={p.id}>
                      <label className="checkbox-inline">
                        <input type="radio" name="keep" value={p.id} defaultChecked={p.id === suggested} required /> Keep this chart
                      </label>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FIELDS.map(([k, l]) => {
                  const va = show(a, k);
                  const vb = show(b, k);
                  return (
                    <tr key={k} className={va !== vb ? "mg-diff" : ""}>
                      <th>{l}</th>
                      <td>{va}</td>
                      <td>{vb}</td>
                    </tr>
                  );
                })}
                <tr>
                  <th>Insurance</th>
                  {[a, b].map((p) => (
                    <td key={p.id} className="cn-small">
                      {p.insurances.length ? p.insurances.map((i) => `${i.rank.toLowerCase()}: ${i.payer.name} ${i.memberId}${i.active ? "" : " (inactive)"}`).join("; ") : "—"}
                    </td>
                  ))}
                </tr>
                {counts.map(([k, l]) => (
                  <tr key={k}>
                    <th>{l}</th>
                    <td>{a._count[k]}</td>
                    <td>{b._count[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel">
            <p>
              Everything on the other chart — visits, claims, appointments, documents, wounds, medications, insurance and history — moves to the chart you keep.
              Blank details on the kept chart (phone, address, contacts…) are filled in from the other one. The other chart is then deleted. This can&apos;t be
              undone.
            </p>
            <label className="checkbox-inline">
              <input type="checkbox" name="confirm" /> I&apos;ve checked these are the same person
            </label>
            <div style={{ marginTop: "0.7rem" }}>
              <button className="btn" type="submit">
                Merge charts
              </button>{" "}
              <Link className="btn ghost" href="/settings/patients">
                Cancel
              </Link>
            </div>
          </section>
        </form>
      )}
    </div>
  );
}
