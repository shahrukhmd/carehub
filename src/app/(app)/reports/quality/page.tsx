import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { measureYears, qualityMeasures } from "@/lib/quality";

const LIST_LIMIT = 300;
type Search = { year?: string; m?: string };

// Quality measures for the practice, with the list of patients behind each gap.
export default async function QualityMeasuresPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(["ADMIN", "CLINICIAN", "CDS"]);
  const sp = await searchParams;
  const years = measureYears();
  const year = years.includes(Number(sp.year)) ? Number(sp.year) : years[0];
  const measures = await qualityMeasures(user.practiceId, year);
  const open = measures.find((m) => m.key === sp.m) ?? null;

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Practice reports</p>
          <h1>Quality measures · {year}</h1>
          <p className="muted" style={{ margin: 0 }}>
            Worked out from the charts. Simplified versions of the named MIPS measures for the practice&apos;s own improvement work — not a certified calculation or a submission file.
          </p>
        </div>
        <form method="get" className="pv-inline">
          <select name="year" defaultValue={year} aria-label="Year">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button className="btn secondary" type="submit">
            Show
          </button>
        </form>
      </div>

      <section className="panel">
        <table className="qm-table">
          <thead>
            <tr>
              <th>Measure</th>
              <th>Based on</th>
              <th className="num">Met</th>
              <th className="num">Out of</th>
              <th>Rate</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {measures.map((m) => (
              <tr key={m.key} className={open?.key === m.key ? "cd-row-on" : undefined}>
                <td>
                  <strong>{m.title}</strong>
                  <div className="muted">{m.description}</div>
                </td>
                <td>{m.basedOn}</td>
                <td className="num">{m.numerator}</td>
                <td className="num">
                  {m.denominator} {m.unit}
                </td>
                <td>
                  {m.rate === null ? (
                    <span className="muted">No {m.unit} in this year</span>
                  ) : (
                    <div className="qm-rate">
                      <div className="qm-bar" role="img" aria-label={`${m.rate}%`}>
                        <span className={m.rate >= 80 ? "qm-good" : m.rate >= 50 ? "qm-mid" : "qm-low"} style={{ width: `${m.rate}%` }} />
                      </div>
                      <strong>{m.rate}%</strong>
                    </div>
                  )}
                </td>
                <td className="num">
                  {m.notMet.length > 0 && (
                    <Link className="btn secondary gw-mini" href={`/reports/quality?year=${year}&m=${m.key}#gaps`}>
                      {m.notMet.length} not met
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {open && (
        <section className="panel" id="gaps">
          <div className="gw-section-head">
            <h2>{open.title} — not met</h2>
            <span className="muted">
              {open.notMet.length} {open.unit}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>MRN</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {open.notMet.slice(0, LIST_LIMIT).map((p, i) => (
                <tr key={`${p.id}-${i}`}>
                  <td>{p.restricted && user.role !== "ADMIN" ? <span className="muted">Restricted chart</span> : <Link href={`/patients/${p.id}`}>{p.name}</Link>}</td>
                  <td>{p.restricted && user.role !== "ADMIN" ? "—" : p.mrn}</td>
                  <td>{p.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {open.notMet.length > LIST_LIMIT && <p className="muted">Showing the first {LIST_LIMIT}.</p>}
        </section>
      )}
    </div>
  );
}
