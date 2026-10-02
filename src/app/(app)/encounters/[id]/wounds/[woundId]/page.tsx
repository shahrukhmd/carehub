import { requireEncounterAccess } from "@/lib/privacy";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ENCOUNTER_VIEW_ROLES, canEditClinical, visitStatusLabel } from "@/lib/visit-workflow";
import { saveWoundAssessment, updateWoundStatus } from "@/app/(app)/wounds/actions";
import { analyzeWoundPhoto } from "@/app/(app)/wounds/analyze";
import { WoundTrendChart } from "@/components/WoundTrendChart";
import { WoundPhotoAnalyzer } from "@/components/WoundPhotoAnalyzer";
import { areaChange, changeText } from "@/lib/wound-analysis";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, patientName } from "@/lib/format";
import {
  BWAT_ITEMS,
  PUSH_EXUDATE_OPTIONS,
  PUSH_TISSUE_OPTIONS,
  debridementMethodLabel,
  etiologyLabel,
  exudateAmountLabel,
  exudateTypeLabel,
  stageLabel,
} from "@/lib/wound";

export default async function WoundPage({
  params,
}: {
  params: Promise<{ id: string; woundId: string }>;
}) {
  const user = await requireUser(ENCOUNTER_VIEW_ROLES);
  const { id: encounterId, woundId } = await params;
  await requireEncounterAccess(user, encounterId);

  const encounter = await prisma.encounter.findFirst({
    where: { id: encounterId, practiceId: user.practiceId },
    include: { patient: true, appointment: { select: { visitType: true } } },
  });
  if (!encounter) notFound();
  // Encounter types can switch the photo analyzer off (Scheduler admin -> Encounter types).
  const visitType = encounter.appointment ? await prisma.visitType.findFirst({ where: { practiceId: user.practiceId, code: encounter.appointment.visitType }, select: { woundAnalytics: true } }) : null;
  const photoAnalysis = visitType?.woundAnalytics ?? true;
  const editable = canEditClinical(encounter.status, user.role);

  const wound = await prisma.wound.findFirst({
    where: { id: woundId, practiceId: user.practiceId, patientId: encounter.patientId },
    include: {
      assessments: {
        include: { assessedBy: true, debridement: true },
        orderBy: { assessedAt: "desc" },
      },
    },
  });
  if (!wound) notFound();

  const chartPoints = [...wound.assessments]
    .reverse()
    .map((a) => ({ date: a.assessedAt, areaCm2: a.areaCm2 }));

  // The two most recent photos, newest first, for the side-by-side comparison.
  const withPhotos = wound.assessments.filter((a) => a.photoUrl);
  const [latest, earlier] = withPhotos;
  const change = latest && earlier ? areaChange(earlier.areaCm2, latest.areaCm2) : null;
  const first = withPhotos.length > 2 ? withPhotos[withPhotos.length - 1] : null;
  const sinceFirst = latest && first ? areaChange(first.areaCm2, latest.areaCm2) : null;
  const size = (a: { lengthCm: number | null; widthCm: number | null; areaCm2: number | null }) =>
    `${a.lengthCm ?? "—"} × ${a.widthCm ?? "—"} cm${a.areaCm2 ? ` · ${a.areaCm2.toFixed(1)} cm²` : ""}`;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Wound care</p>
          <h1>
            {wound.label} <StatusBadge value={wound.status} />
          </h1>
          <p className="chart-meta">
            <span>
              <Link href={`/patients/${encounter.patientId}`}>{patientName(encounter.patient)}</Link>
            </span>
            <span>{wound.location}</span>
            <span>{etiologyLabel[wound.etiology] ?? wound.etiology}</span>
            {wound.onsetDate && <span>Onset {formatDate(wound.onsetDate)}</span>}
          </p>
        </div>
        <fieldset className="stack gw-fieldset" style={{ gridAutoFlow: "column", gap: "0.5rem" }} disabled={!editable}>
          <Link className="btn ghost" href={`/encounters/${encounterId}#wounds`}>
            « Back to chart
          </Link>
          {wound.status !== "HEALED" && (
            <form action={updateWoundStatus.bind(null, wound.id, encounterId, "HEALED")}>
              <button className="btn secondary" type="submit">
                Mark healed
              </button>
            </form>
          )}
          {wound.status === "ACTIVE" && (
            <form action={updateWoundStatus.bind(null, wound.id, encounterId, "CLOSED")}>
              <button className="btn ghost" type="submit">
                Close wound
              </button>
            </form>
          )}
          {wound.status !== "ACTIVE" && (
            <form action={updateWoundStatus.bind(null, wound.id, encounterId, "ACTIVE")}>
              <button className="btn ghost" type="submit">
                Reactivate
              </button>
            </form>
          )}
        </fieldset>
      </div>

      <div className="two-col">
        <div className="stack">
          <section className="panel">
            <h2>Healing trend</h2>
            <WoundTrendChart points={chartPoints} />
          </section>

          <section className="panel">
            <h2>Assessment history</h2>
            {wound.assessments.length === 0 && <p className="muted">No assessments recorded yet.</p>}
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>L × W × D (cm)</th>
                  <th>Area</th>
                  <th>Stage</th>
                  <th>PUSH</th>
                  <th>BWAT</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {wound.assessments.map((a) => (
                  <tr key={a.id}>
                    <td>{formatDate(a.assessedAt)}</td>
                    <td>
                      {a.lengthCm ?? "—"} × {a.widthCm ?? "—"} × {a.depthCm ?? "—"}
                    </td>
                    <td>{a.areaCm2 ? `${a.areaCm2.toFixed(1)} cm²` : "—"}</td>
                    <td>{a.stage ? stageLabel[a.stage] ?? a.stage : "—"}</td>
                    <td>{a.pushTotal ?? "—"}</td>
                    <td>{a.bwatTotal ?? "—"}</td>
                    <td>{a.assessedBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {latest && (
            <section className="panel">
              <div className="gw-section-head">
                <h2>{earlier ? "Photo comparison" : "Most recent photo"}</h2>
                <span>
                  {change !== null && <span className={`gw-tag gw-tag-${change < 0 ? "ok" : change > 0 ? "bad" : "muted"}`}>Area {changeText(change)} since {formatDate(earlier.assessedAt)}</span>}{" "}
                  {sinceFirst !== null && first && (
                    <span className={`gw-tag gw-tag-${sinceFirst < 0 ? "ok" : sinceFirst > 0 ? "bad" : "muted"}`}>
                      {changeText(sinceFirst)} since {formatDate(first.assessedAt)}
                    </span>
                  )}
                </span>
              </div>
              <div className="wpa-photos">
                {earlier && (
                  <figure>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={earlier.photoUrl!} alt={`${wound.label} on ${formatDate(earlier.assessedAt)}`} />
                    <figcaption>
                      {formatDate(earlier.assessedAt)} · {size(earlier)}
                    </figcaption>
                  </figure>
                )}
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={latest.photoUrl!} alt={`${wound.label} on ${formatDate(latest.assessedAt)}`} />
                  <figcaption>
                    {formatDate(latest.assessedAt)} · {size(latest)}
                  </figcaption>
                </figure>
              </div>
              {withPhotos.length > 2 && (
                <details>
                  <summary className="muted">All photos ({withPhotos.length})</summary>
                  <div className="wpa-photos wpa-strip">
                    {withPhotos.map((a) => (
                      <figure key={a.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.photoUrl!} alt={`${wound.label} on ${formatDate(a.assessedAt)}`} />
                        <figcaption>
                          {formatDate(a.assessedAt)} · {size(a)}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </details>
              )}
            </section>
          )}
        </div>

        {!editable && <p className="muted">This chart is {visitStatusLabel[encounter.status] ?? encounter.status} — wound documentation is read-only.</p>}
        <fieldset className="gw-fieldset" disabled={!editable}>
        <form className="panel stack" action={saveWoundAssessment.bind(null, wound.id, encounterId)}>
          <h2>New assessment</h2>

          {photoAnalysis && (
            <>
              <h3>Photo &amp; AI analysis</h3>
              <WoundPhotoAnalyzer action={analyzeWoundPhoto.bind(null, wound.id, encounterId)} />
            </>
          )}

          <h3>Measurements</h3>
          <div className="form-grid">
            <label>
              Length (cm)
              <input name="lengthCm" type="number" step="0.1" />
            </label>
            <label>
              Width (cm)
              <input name="widthCm" type="number" step="0.1" />
            </label>
            <label>
              Depth (cm)
              <input name="depthCm" type="number" step="0.1" />
            </label>
            <label>
              Stage
              <select name="stage" defaultValue="">
                <option value="">—</option>
                {Object.entries(stageLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Undermining (cm)
              <input name="underminingCm" type="number" step="0.1" />
            </label>
            <label>
              Undermining clock position
              <input name="underminingClock" placeholder="e.g. 3-6 o'clock" />
            </label>
            <label>
              Tunneling (cm)
              <input name="tunnelingCm" type="number" step="0.1" />
            </label>
            <label>
              Tunneling clock position
              <input name="tunnelingClock" placeholder="e.g. 9 o'clock" />
            </label>
          </div>

          <h3>Wound bed tissue (%)</h3>
          <div className="form-grid">
            <label>
              Granulation
              <input name="granulationPct" type="number" min="0" max="100" />
            </label>
            <label>
              Slough
              <input name="sloughPct" type="number" min="0" max="100" />
            </label>
            <label>
              Eschar
              <input name="escharPct" type="number" min="0" max="100" />
            </label>
            <label>
              Epithelial
              <input name="epithelialPct" type="number" min="0" max="100" />
            </label>
          </div>

          <h3>Exudate &amp; periwound</h3>
          <div className="form-grid">
            <label>
              Exudate amount
              <select name="exudateAmount" defaultValue="">
                <option value="">—</option>
                {Object.entries(exudateAmountLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Exudate type
              <select name="exudateType" defaultValue="">
                <option value="">—</option>
                {Object.entries(exudateTypeLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Periwound skin
              <input name="periwoundSkin" placeholder="e.g. Macerated, intact, erythematous" />
            </label>
            <label>
              Pain (0-10)
              <input name="painLevel" type="number" min="0" max="10" />
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "0.4rem" }}>
            <input name="odor" type="checkbox" style={{ width: "auto" }} />
            Odor present
          </label>

          <h3>PUSH Tool 3.0</h3>
          <div className="form-grid">
            <label>
              Exudate amount
              <select name="pushExudateAmount" defaultValue="">
                <option value="">—</option>
                {PUSH_EXUDATE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tissue type
              <select name="pushTissueType" defaultValue="">
                <option value="">—</option>
                {PUSH_TISSUE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">Surface area subscore is calculated automatically from length × width.</p>

          <h3>BWAT (Bates-Jensen)</h3>
          <p className="muted">Score each item 1 (best) to 5 (worst). Leave any item blank to skip BWAT scoring.</p>
          <div className="form-grid">
            {BWAT_ITEMS.map((item) => (
              <label key={item.key}>
                {item.label}
                <select name={`bwat_${item.key}`} defaultValue="">
                  <option value="">—</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <label>
            Notes
            <textarea name="notes" />
          </label>

          <h3>Debridement</h3>
          <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "0.4rem" }}>
            <input name="documentDebridement" type="checkbox" style={{ width: "auto" }} />
            Debridement performed this visit
          </label>
          <div className="form-grid">
            <label>
              Method
              <select name="debridementMethod" defaultValue="">
                <option value="">—</option>
                {Object.entries(debridementMethodLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              CPT code
              <input name="debridementCpt" placeholder="97597" />
            </label>
            <label>
              Charge amount (USD)
              <input name="debridementAmount" type="number" step="0.01" />
            </label>
            <label>
              Tissue removed
              <input name="tissueRemoved" />
            </label>
          </div>

          <button className="btn" type="submit">
            Save assessment
          </button>
        </form>
        </fieldset>
      </div>
    </>
  );
}
