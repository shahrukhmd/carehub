import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { formatDate, patientName } from "@/lib/format";
import { fullAddress, geocodeCandidates, geocodeStatus, type Candidate } from "@/lib/gis/geocode";
import { GisPage } from "../gis-shell";
import { clearPatientPoint, geocodePatientNow, runGeocodeNow, setPatientPoint } from "../actions";

type SearchParams = { ok?: string; error?: string; show?: string; q?: string; pick?: string };
const PAGE = 100;

// The Resolver: patients the geocoding job could not place. Re-run one, pick among the geocoder's candidates, or
// type coordinates by hand. Without coordinates a patient never gets a pin.
export default async function GisResolverPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser(rolesFor("gis.edit"));
  const sp = await searchParams;
  const show = sp.show ?? "unplaced";
  const q = (sp.q ?? "").trim();
  const where = {
    practiceId: user.practiceId,
    status: "ACTIVE",
    ...(q ? { OR: [{ lastName: { contains: q, mode: "insensitive" as const } }, { firstName: { contains: q, mode: "insensitive" as const } }, { mrn: { contains: q, mode: "insensitive" as const } }, { addressLine1: { contains: q, mode: "insensitive" as const } }] } : {}),
    ...(show === "placed" ? { latitude: { not: null } } : show === "failed" ? { latitude: null, geocodeError: { not: null } } : show === "noaddress" ? { OR: [{ addressLine1: null }, { addressLine1: "" }] } : { latitude: null, addressLine1: { not: null } }),
  };
  const [patients, geo] = await Promise.all([
    prisma.patient.findMany({ where, orderBy: [{ geocodeError: "desc" }, { lastName: "asc" }], take: PAGE }),
    geocodeStatus(user.practiceId),
  ]);
  const picking = sp.pick ? patients.find((p) => p.id === sp.pick) ?? (await prisma.patient.findFirst({ where: { id: sp.pick, practiceId: user.practiceId } })) : null;
  let candidates: Candidate[] = [];
  let candidateError: string | null = null;
  if (picking) {
    try {
      candidates = await geocodeCandidates(user.practiceId, picking);
    } catch (err) {
      candidateError = err instanceof Error ? err.message : "The geocoder did not answer";
    }
  }
  const here = (o: Partial<SearchParams>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...o })) if (v && k !== "ok" && k !== "error") p.set(k, v);
    return `/gis/resolver?${p.toString()}`;
  };
  const back = here({ pick: undefined });

  return (
    <GisPage
      title="Resolver"
      subtitle="Patients the geocoding job could not place. Re-run, pick a candidate, or enter coordinates by hand."
      sp={sp}
      actions={
        <form action={runGeocodeNow}>
          <button className="btn secondary" type="submit">
            Run geocoding now
          </button>
        </form>
      }
    >
      <section className="panel">
        <div className="wa-stats">
          <div>
            <strong>{geo.located}</strong>
            <div className="muted">on the map</div>
          </div>
          <div>
            <strong>{geo.waiting}</strong>
            <div className="muted">waiting</div>
          </div>
          <div>
            <strong>{geo.failed}</strong>
            <div className="muted">not found</div>
          </div>
          <div>
            <strong>{geo.noAddress}</strong>
            <div className="muted">no street address</div>
          </div>
        </div>
      </section>

      {picking && (
        <section className="panel stack">
          <div className="gw-section-head">
            <h2>
              Place {patientName(picking)} <span className="muted cn-small">{picking.mrn}</span>
            </h2>
            <Link className="muted" href={back}>
              Close
            </Link>
          </div>
          <p className="muted">{fullAddress(picking) || "No street address on the chart."}</p>
          {candidateError && <p className="gw-error">{candidateError}</p>}
          {candidates.length > 0 ? (
            <ul className="rp-list">
              {candidates.map((c, i) => (
                <li key={i}>
                  <span>{c.label}</span>
                  <form action={setPatientPoint.bind(null, picking.id)} className="inline-select">
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="latitude" value={c.latitude} />
                    <input type="hidden" name="longitude" value={c.longitude} />
                    <input type="hidden" name="source" value={c.source} />
                    <span className="muted cn-small">
                      {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}
                    </span>
                    <button className="btn secondary" type="submit">
                      Use this
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            !candidateError && <p className="muted">The geocoder returned no candidates for this address. Fix the address on the chart, or enter coordinates below.</p>
          )}
          <form action={setPatientPoint.bind(null, picking.id)} className="fr-filters">
            <input type="hidden" name="back" value={back} />
            <label>
              Latitude
              <input name="latitude" required inputMode="decimal" placeholder="39.9905" />
            </label>
            <label>
              Longitude
              <input name="longitude" required inputMode="decimal" placeholder="-74.9764" />
            </label>
            <button className="btn ghost" type="submit">
              Set by hand
            </button>
            <Link className="btn ghost" href={`/patients/${picking.id}/edit`}>
              Edit address on the chart
            </Link>
          </form>
        </section>
      )}

      <form className="panel fr-filters" method="get">
        <label>
          Show
          <select name="show" defaultValue={show}>
            <option value="unplaced">Unplaced (waiting or not found)</option>
            <option value="failed">Not found only</option>
            <option value="noaddress">No street address</option>
            <option value="placed">Placed</option>
          </select>
        </label>
        <label>
          Search
          <input name="q" defaultValue={q} placeholder="Name, MRN or street" />
        </label>
        <button className="btn" type="submit">
          Apply
        </button>
      </form>

      <section className="panel">
        <div className="gw-section-head">
          <h2>Patients</h2>
          <span className="muted">
            {patients.length}
            {patients.length === PAGE ? "+" : ""}
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Address</th>
                <th>Geocoding</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => {
                const placed = p.latitude != null && p.longitude != null;
                const address = fullAddress(p);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/patients/${p.id}`}>{patientName(p)}</Link>
                      <div className="muted cn-small">{p.mrn}</div>
                    </td>
                    <td className="cn-small">{address || <span className="gw-missing">No street address</span>}</td>
                    <td className="cn-small">
                      {placed ? (
                        <>
                          {p.latitude!.toFixed(4)}, {p.longitude!.toFixed(4)}
                          <div className="muted">
                            {p.geocodeSource ?? ""}
                            {p.geocodedAt ? ` · ${formatDate(p.geocodedAt)}` : ""}
                          </div>
                        </>
                      ) : p.geocodeError ? (
                        <span className="gw-missing">{p.geocodeError}</span>
                      ) : address ? (
                        "Waiting for the job"
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <div className="fr-bulk">
                        {address && (
                          <form action={geocodePatientNow.bind(null, p.id)}>
                            <input type="hidden" name="back" value={back} />
                            <button className="btn ghost" type="submit">
                              {placed ? "Re-geocode" : "Geocode now"}
                            </button>
                          </form>
                        )}
                        <Link className="btn ghost" href={here({ pick: p.id })}>
                          Pick
                        </Link>
                        {placed && (
                          <form action={clearPatientPoint.bind(null, p.id)}>
                            <input type="hidden" name="back" value={back} />
                            <button className="btn ghost" type="submit">
                              Clear
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {patients.length === 0 && (
                <tr>
                  <td colSpan={4}>Nothing to resolve here.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </GisPage>
  );
}
