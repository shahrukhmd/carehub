import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { saveWoundAssessment, updateWoundStatus } from "@/app/(app)/wounds/actions";
import { WoundTrendChart } from "@/components/WoundTrendChart";
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
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  const { id: encounterId, woundId } = await params;

  const encounter = await prisma.encounter.findFirst({
    where: { id: encounterId, practiceId: user.practiceId },
    include: { patient: true },
  });
  if (!encounter) notFound();

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

  const latestPhoto = wound.assessments.find((a) => a.photoUrl)?.photoUrl;

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
        <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
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
        </div>
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

          {latestPhoto && (
            <section className="panel">
              <h2>Most recent photo</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={latestPhoto} alt={`${wound.label} wound photo`} style={{ maxWidth: "100%", borderRadius: "0.6rem" }} />
            </section>
          )}
        </div>

        <form className="panel stack" action={saveWoundAssessment.bind(null, wound.id, encounterId)}>
          <h2>New assessment</h2>

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

          <h3>Photo</h3>
          <label>
            Upload wound photo
            <input name="photo" type="file" accept="image/*" />
          </label>

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
      </div>
    </>
  );
}
