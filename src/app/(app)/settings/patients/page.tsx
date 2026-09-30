import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatDate, patientName } from "@/lib/format";
import { findDuplicates } from "@/lib/patient-merge";
import { SettingsNav } from "../settings-nav";
import { dismissPair } from "./actions";

export default async function DuplicatePatientsPage() {
  const user = await requireUser(["ADMIN"]);
  const pairs = await findDuplicates(user.practiceId);
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Duplicate patients</h1>
        </div>
      </div>
      <SettingsNav current="patients" />
      <section className="panel">
        <p className="muted">
          Charts that look like the same person — matched on date of birth, name (including swapped first/last), phone, email and address. Open a pair to
          compare and merge, or mark it as two different people so it stops showing.
        </p>
        {pairs.length === 0 ? (
          <p className="muted">No likely duplicates found.</p>
        ) : (
          <table className="cn-table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Chart A</th>
                <th>Chart B</th>
                <th>Why</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pairs.map(({ a, b, score, reasons }) => (
                <tr key={a.id + b.id}>
                  <td>
                    <span className={`cn-status ${score >= 80 ? "cn-cancelled" : "cn-in_progress"}`}>{score}%</span>
                  </td>
                  {[a, b].map((p) => (
                    <td key={p.id}>
                      <Link href={`/patients/${p.id}`}>{patientName(p)}</Link>
                      <div className="muted cn-small">
                        {p.mrn} · {formatDate(p.dob)} · {p.phone ?? "no phone"}
                      </div>
                    </td>
                  ))}
                  <td className="cn-small">{reasons.join(" · ")}</td>
                  <td className="cn-actions">
                    <Link className="btn secondary gw-mini" href={`/settings/patients/merge?a=${a.id}&b=${b.id}`}>
                      Compare &amp; merge
                    </Link>
                    <form action={dismissPair.bind(null, a.id, b.id)}>
                      <button className="btn ghost gw-mini" type="submit">
                        Not the same
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
