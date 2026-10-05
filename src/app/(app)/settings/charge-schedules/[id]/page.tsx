import { CodeLookup } from "@/components/CodeLookup";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { CheckList } from "@/components/CheckList";
import { parseIds } from "@/lib/charge-schedules";
import { SettingsNav } from "../../settings-nav";
import { addScheduleCode, copySchedule, importSchedule, removeScheduleCode, saveSchedule } from "../actions";

type Search = { error?: string; ok?: string; q?: string; fees?: string };

const iso = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "");

// One charge schedule: when it applies, who it applies to, and the fee for each billing code.
export default async function ChargeScheduleDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const { id } = await params;
  const sp = await searchParams;
  const schedule = await prisma.chargeSchedule.findFirst({ where: { id, practiceId: user.practiceId }, include: { items: { orderBy: { code: "asc" } } } });
  if (!schedule) notFound();

  const [locations, providers, payers] = await Promise.all([
    prisma.location.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" }, select: { id: true, name: true, active: true, serviceType: { select: { name: true } } } }),
    prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId, isRendering: true }, orderBy: { name: "asc" }, select: { id: true, name: true, credential: true, status: true } }),
    prisma.payer.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" }, select: { id: true, name: true, active: true, payerCode: true } }),
  ]);
  const q = sp.q?.trim().toLowerCase() ?? "";
  const onlyFees = sp.fees === "1";
  // fees=0: the codes still waiting for a fee (e.g. just added from the code library).
  const onlyNoFee = sp.fees === "0";
  const shown = schedule.items.filter(
    (i) => (!q || i.code.toLowerCase().startsWith(q) || i.description.toLowerCase().includes(q)) && (!onlyFees || i.feeCents > 0) && (!onlyNoFee || i.feeCents === 0)
  );
  const withFee = schedule.items.filter((i) => i.feeCents > 0).length;
  const formId = "schedule-form";

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings/charge-schedules">« Charge schedules</Link>
          </p>
          <h1>Charge schedule details</h1>
        </div>
        <div className="cs-actions">
          <a className="btn secondary" href={`/api/charge-schedules/${schedule.id}/export`}>
            Export
          </a>
          <form action={copySchedule.bind(null, schedule.id)}>
            <button className="btn secondary" type="submit" title="Start next year's schedule from this one">
              Copy
            </button>
          </form>
          <button className="btn" type="submit" form={formId}>
            Save schedule
          </button>
          <Link className="btn ghost" href="/settings/charge-schedules">
            Cancel
          </Link>
        </div>
      </div>
      <SettingsNav current="charge-schedules" role={user.role} />
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}

      <form id={formId} action={saveSchedule.bind(null, schedule.id)} className="stack">
        <section className="panel">
          <div className="form-grid gw-grid-3">
            <label>
              Name
              <input name="name" defaultValue={schedule.name} required maxLength={120} />
            </label>
            <label>
              Start date
              <input type="date" name="startDate" defaultValue={iso(schedule.startDate)} required />
            </label>
            <label>
              End date
              <input type="date" name="endDate" defaultValue={iso(schedule.endDate)} />
            </label>
            <label className="cm-check">
              <input type="checkbox" name="active" defaultChecked={schedule.active} />
              Active
            </label>
          </div>
        </section>

        <div className="cs-three">
          <section className="panel">
            <h2>Sites of service</h2>
            <CheckList
              name="locationIds"
              noun="site"
              emptyMeansAll
              selected={parseIds(schedule.locationIds)}
              options={locations.map((l) => ({ id: l.id, label: l.name, hint: [l.serviceType?.name, l.active ? null : "inactive"].filter(Boolean).join(" · ") || undefined }))}
            />
          </section>
          <section className="panel">
            <h2>Providers</h2>
            <CheckList
              name="providerIds"
              noun="provider"
              emptyMeansAll
              selected={parseIds(schedule.providerIds)}
              options={providers.map((p) => ({ id: p.id, label: p.name, hint: [p.credential, p.status === "ACTIVE" ? null : "inactive"].filter(Boolean).join(" · ") || undefined }))}
            />
          </section>
          <section className="panel">
            <h2>Insurances</h2>
            <CheckList
              name="payerIds"
              noun="insurance"
              emptyMeansAll
              selected={parseIds(schedule.payerIds)}
              options={payers.map((p) => ({ id: p.id, label: p.name, hint: [p.payerCode, p.active ? null : "inactive"].filter(Boolean).join(" · ") || undefined }))}
            />
          </section>
        </div>
        <p className="muted cs-note">Leave a list with nothing ticked to apply the schedule to all of them. When two schedules cover the same visit, the one that names more of site, provider and insurance wins.</p>

        <section className="panel cd-list">
          <div className="cd-list-head">
            <strong>
              {schedule.items.length} billing codes · {withFee} with a fee
              {schedule.items.length - withFee > 0 ? ` · ${schedule.items.length - withFee} with no fee yet` : ""}
              {q || onlyFees || onlyNoFee ? ` · showing ${shown.length}` : ""}
            </strong>
            <span>A code at $0.00 has no fee on this schedule and uses the practice code list</span>
          </div>
          <div className="cd-scroll">
            <table className="cs-fees">
              <thead>
                <tr>
                  <th>Billing code</th>
                  <th>Description</th>
                  <th>Fee $</th>
                  <th>Revenue code</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id}>
                    <td>{i.code}</td>
                    <td>
                      {i.description}
                      {i.feeCents === 0 && (
                        <>
                          {" "}
                          <span className="gw-tag gw-tag-warn">Fee not set</span>
                        </>
                      )}
                    </td>
                    <td>
                      <input name={`fee_${i.id}`} defaultValue={(i.feeCents / 100).toFixed(2)} inputMode="decimal" aria-label={`${i.code} fee`} />
                    </td>
                    <td>
                      <input name={`rev_${i.id}`} defaultValue={i.revenueCode ?? ""} maxLength={4} aria-label={`${i.code} revenue code`} />
                    </td>
                    <td className="num">
                      <button className="btn ghost gw-mini" type="submit" formAction={removeScheduleCode.bind(null, schedule.id, i.id)} title="Take this code off the schedule (fees typed on this page but not saved are lost)">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      {schedule.items.length === 0 ? "No billing codes yet — add one below or import a fee file." : "No code matches."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </form>

      <div className="pv-two">
        <section className="panel">
          <h2>Find a code</h2>
          <form method="get" className="pv-inline">
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Code starts with, or description contains" aria-label="Find a code" />
            <select name="fees" defaultValue={sp.fees ?? ""} aria-label="Fee filter">
              <option value="">All codes</option>
              <option value="1">Only codes with a fee</option>
              <option value="0">Only codes with no fee yet</option>
            </select>
            <button className="btn secondary" type="submit">
              Filter
            </button>
            {(q || onlyFees || onlyNoFee) && (
              <Link className="btn ghost" href={`/settings/charge-schedules/${schedule.id}`}>
                Show all
              </Link>
            )}
          </form>
          <p className="muted">Save the schedule before filtering — fees typed but not saved are lost when the list changes.</p>
        </section>

        <section className="panel">
          <h2>Add a billing code</h2>
          <form action={addScheduleCode.bind(null, schedule.id)} className="pv-inline" style={{ flexWrap: "wrap" }}>
            <CodeLookup sets={["CPT", "HCPCS"]} placeholder="Find a billing code in the code library — by code or words (e.g. A6212, alginate, debridement)" />
            <input name="code" required maxLength={5} placeholder="Code" aria-label="Billing code" style={{ flex: "0 0 6rem" }} />
            <input name="description" maxLength={300} placeholder="Description (from the code list if blank)" aria-label="Description" />
            <input name="fee" inputMode="decimal" placeholder="Fee" aria-label="Fee" style={{ flex: "0 0 6rem" }} />
            <input name="revenueCode" maxLength={4} placeholder="Rev." aria-label="Revenue code" style={{ flex: "0 0 5rem" }} />
            <button className="btn secondary" type="submit">
              Add
            </button>
          </form>
        </section>
      </div>

      <section className="panel">
        <h2>Import a fee file</h2>
        <form action={importSchedule.bind(null, schedule.id)} className="pv-inline">
          <input type="file" name="file" accept=".csv,text/csv" required aria-label="Fee file" />
          <button className="btn secondary" type="submit">
            Import
          </button>
          <span className="muted">
            CSV with columns Billing Code, Description, Fee, Revenue Code — the same layout Export gives you. Codes already here get the new fee; new codes are added; nothing is removed.
          </span>
        </form>
      </section>
    </div>
  );
}
