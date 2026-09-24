import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import {
  createPayer,
  createReferringPhysician,
  togglePayerActive,
  toggleReferringPhysicianActive,
} from "./actions";

export default async function DirectoriesPage() {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "BILLER", "CLINICIAN"]);

  const [payers, physicians] = await Promise.all([
    prisma.payer.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } }),
    prisma.referringPhysician.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Practice management</p>
          <h1>Directories</h1>
        </div>
      </div>

      <div className="two-col" style={{ marginBottom: "1.25rem" }}>
        <section className="panel">
          <h2>Payers</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Payer code</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payers.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    {p.phone && <div className="muted">{p.phone}</div>}
                  </td>
                  <td>{p.payerCode ?? "—"}</td>
                  <td>
                    <StatusBadge value={p.active ? "ACTIVE" : "INACTIVE"} />
                  </td>
                  <td>
                    <form action={togglePayerActive.bind(null, p.id)}>
                      <button className="btn ghost" type="submit">
                        {p.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {payers.length === 0 && (
                <tr>
                  <td colSpan={4}>No payers yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <form className="panel stack" action={createPayer}>
          <h2>Add payer</h2>
          <label>
            Name
            <input name="name" placeholder="Horizon Blue Cross" required />
          </label>
          <label>
            Payer code
            <input name="payerCode" placeholder="EDI / clearinghouse ID" />
          </label>
          <label>
            Phone
            <input name="phone" />
          </label>
          <label>
            Address
            <input name="addressLine1" />
          </label>
          <div className="form-grid">
            <label>
              City
              <input name="city" />
            </label>
            <label>
              State
              <input name="state" />
            </label>
            <label>
              ZIP
              <input name="zip" />
            </label>
          </div>
          <button className="btn" type="submit">
            Add payer
          </button>
        </form>
      </div>

      <div className="two-col">
        <section className="panel">
          <h2>Referring physicians</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>NPI / specialty</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {physicians.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    {p.phone && <div className="muted">{p.phone}</div>}
                  </td>
                  <td>
                    {p.npi ?? "—"}
                    {p.specialty ? ` · ${p.specialty}` : ""}
                  </td>
                  <td>
                    <StatusBadge value={p.active ? "ACTIVE" : "INACTIVE"} />
                  </td>
                  <td>
                    <form action={toggleReferringPhysicianActive.bind(null, p.id)}>
                      <button className="btn ghost" type="submit">
                        {p.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {physicians.length === 0 && (
                <tr>
                  <td colSpan={4}>No referring physicians yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <form className="panel stack" action={createReferringPhysician}>
          <h2>Add referring physician</h2>
          <label>
            Name
            <input name="name" placeholder="Dr. Amanda Moore" required />
          </label>
          <label>
            NPI
            <input name="npi" />
          </label>
          <label>
            Specialty
            <input name="specialty" placeholder="Podiatry" />
          </label>
          <label>
            Phone
            <input name="phone" />
          </label>
          <label>
            Fax
            <input name="fax" />
          </label>
          <button className="btn" type="submit">
            Add referring physician
          </button>
        </form>
      </div>
    </>
  );
}
