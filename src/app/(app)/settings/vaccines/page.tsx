import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { MANUFACTURERS, VACCINES } from "@/lib/immunizations";
import { SettingsNav } from "../settings-nav";
import { addVaccineLot, adjustVaccineLot, retireVaccineLot } from "./actions";

const LOW_STOCK = 5;
const EXPIRING_DAYS = 30;
const FUNDING: Record<string, string> = { PRIVATE: "Private stock", VFC: "Vaccines for Children", STATE: "State supplied" };
type Search = { error?: string; ok?: string; all?: string };

// Vaccine stock by lot. Recording a vaccine "given here" with a lot number from this list takes one dose off it.
export default async function VaccineInventoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("immunizations.stock"));
  const sp = await searchParams;
  const showAll = sp.all === "1";
  const lots = await prisma.vaccineLot.findMany({
    where: { practiceId: user.practiceId, ...(showAll ? {} : { active: true }) },
    include: { _count: { select: { immunizations: true } } },
    orderBy: [{ active: "desc" }, { vaccine: "asc" }, { expirationDate: "asc" }],
  });
  const now = Date.now();
  const state = (l: (typeof lots)[number]) => {
    const days = l.expirationDate ? Math.ceil((l.expirationDate.getTime() - now) / 86_400_000) : null;
    return { days, expired: days !== null && days < 0, expiring: days !== null && days >= 0 && days <= EXPIRING_DAYS, low: l.dosesOnHand > 0 && l.dosesOnHand <= LOW_STOCK, out: l.dosesOnHand === 0 };
  };
  const inStock = lots.filter((l) => l.active);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Vaccine inventory</h1>
        </div>
      </div>
      <SettingsNav current="vaccines" role={user.role} />
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}

      <section className="grid-stats cd-tiles cm-tiles">
        <div className="stat">
          <span>Lots in stock</span>
          <strong>{inStock.length}</strong>
        </div>
        <div className="stat">
          <span>Doses on hand</span>
          <strong>{inStock.reduce((s, l) => s + l.dosesOnHand, 0)}</strong>
        </div>
        <div className="stat">
          <span>Expired or expiring in {EXPIRING_DAYS} days</span>
          <strong className={inStock.some((l) => state(l).expired) ? "cd-bad" : inStock.some((l) => state(l).expiring) ? "cd-warn" : undefined}>
            {inStock.filter((l) => state(l).expired || state(l).expiring).length}
          </strong>
        </div>
        <div className="stat">
          <span>Low or out of stock</span>
          <strong className={inStock.some((l) => state(l).low || state(l).out) ? "cd-warn" : undefined}>{inStock.filter((l) => state(l).low || state(l).out).length}</strong>
        </div>
      </section>

      <section className="panel">
        <div className="gw-section-head">
          <h2>Receive vaccine</h2>
        </div>
        <form action={addVaccineLot} className="form-grid gw-grid-3">
          <label>
            Vaccine
            <select name="cvx" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {VACCINES.map((v) => (
                <option key={v.cvx} value={v.cvx}>
                  {v.name} (CVX {v.cvx})
                </option>
              ))}
            </select>
          </label>
          <label>
            Lot number
            <input name="lotNumber" required maxLength={40} />
          </label>
          <label>
            Expiration date
            <input type="date" name="expirationDate" required />
          </label>
          <label>
            Doses received
            <input name="doses" type="number" min="1" max="10000" step="1" required />
          </label>
          <label>
            Manufacturer
            <select name="manufacturer" defaultValue="">
              <option value="">From the vaccine</option>
              {Object.entries(MANUFACTURERS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Funding source
            <select name="funding" defaultValue="PRIVATE">
              {Object.entries(FUNDING).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="pv-wide">
            Notes
            <input name="notes" maxLength={300} placeholder="e.g. storage unit, order number" />
          </label>
          <div className="pv-actions">
            <button className="btn" type="submit">
              Add to stock
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="gw-section-head">
          <h2>Stock by lot</h2>
          <Link href={showAll ? "/settings/vaccines" : "/settings/vaccines?all=1"}>{showAll ? "Hide lots removed from stock" : "Show lots removed from stock"}</Link>
        </div>
        <table>
          <thead>
            <tr>
              <th>Vaccine</th>
              <th>Lot</th>
              <th>Expires</th>
              <th>Funding</th>
              <th className="num">Received</th>
              <th className="num">Given</th>
              <th>On hand — correct the count</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => {
              const s = state(l);
              return (
                <tr key={l.id} className={l.active ? undefined : "cm-blocked"}>
                  <td>
                    {l.vaccine}
                    <div className="muted">
                      CVX {l.cvxCode}
                      {l.manufacturer ? ` · ${MANUFACTURERS[l.manufacturer] ?? l.manufacturer}` : ""}
                    </div>
                  </td>
                  <td>
                    {l.lotNumber}
                    {l.notes ? <div className="muted">{l.notes}</div> : null}
                  </td>
                  <td>
                    {l.expirationDate ? formatDate(l.expirationDate) : "—"}
                    {s.expired && <span className="gw-tag gw-tag-bad">Expired — do not use</span>}
                    {s.expiring && <span className="gw-tag gw-tag-warn">{s.days} days left</span>}
                  </td>
                  <td>{FUNDING[l.funding] ?? l.funding}</td>
                  <td className="num">{l.dosesReceived}</td>
                  <td className="num">{l._count.immunizations}</td>
                  <td>
                    <form action={adjustVaccineLot.bind(null, l.id)} className="pv-inline">
                      <input name="dosesOnHand" type="number" min="0" max="10000" step="1" defaultValue={l.dosesOnHand} aria-label="Doses on hand" style={{ maxWidth: "5rem", flex: "0 0 5rem" }} />
                      {s.out && <span className="gw-tag gw-tag-bad">Out</span>}
                      {s.low && <span className="gw-tag gw-tag-warn">Low</span>}
                      <input name="reason" placeholder="Reason for the change" maxLength={200} aria-label="Reason" />
                      <button className="btn secondary gw-mini" type="submit">
                        Save
                      </button>
                    </form>
                  </td>
                  <td className="num">
                    <form action={retireVaccineLot.bind(null, l.id)}>
                      <button className="btn ghost gw-mini" type="submit">
                        {l.active ? "Remove from stock" : "Return to stock"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {lots.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No vaccine in stock. Add a lot above when a shipment arrives.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
