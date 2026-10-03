import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import { StatusGrid, type GridRow } from "@/components/StatusGrid";
import {
  ACTIVE_ENROLLMENT_STATUSES,
  OPEN_ENROLLMENT_STATUSES,
  enrollmentStatusLabel,
  planSegmentFamily,
  planSegmentLabel,
  statusShortCode,
} from "@/lib/format";
import { updateGridCell, updateGroupCell } from "./actions";

type SearchParams = Record<string, string | undefined>;

const SEGMENT_ORDER = Object.keys(planSegmentLabel);

type LineWithEnrollments = {
  id: string;
  planSegment: string;
  groupStatus: string;
  ediStatus: string;
  eftStatus: string;
  effectiveDate: Date | null;
  payerGroupId: string | null;
  notes: string | null;
  payer: { name: string; payerCode: string | null };
  providerEnrollments: {
    id: string;
    renderingProviderId: string;
    status: string;
    effectiveDate: Date | null;
    notes: string | null;
    payerProviderId: string | null;
  }[];
};

// Insurance filter: payers are kept per practice, so the same insurance in two practices is matched by name.
const payerKey = (name: string) => name.trim().toLowerCase();

function toGridRows(lines: LineWithEnrollments[], sp: SearchParams): GridRow[] {
  const q = (sp.q ?? "").trim().toLowerCase();
  return lines
    .filter((l) => !sp.seg || planSegmentFamily[l.planSegment] === sp.seg)
    .filter((l) => !sp.payer || payerKey(l.payer.name) === sp.payer)
    .filter((l) => !q || l.payer.name.toLowerCase().includes(q) || (l.payer.payerCode ?? "").toLowerCase().includes(q))
    .sort((a, b) => a.payer.name.localeCompare(b.payer.name) || SEGMENT_ORDER.indexOf(a.planSegment) - SEGMENT_ORDER.indexOf(b.planSegment))
    .map((l) => ({
      lineId: l.id,
      payer: l.payer.name,
      segment: planSegmentLabel[l.planSegment] ?? l.planSegment,
      payerId: l.payer.payerCode,
      groupStatus: l.groupStatus,
      ediStatus: l.ediStatus,
      eftStatus: l.eftStatus,
      groupEffectiveDate: l.effectiveDate?.toISOString() ?? null,
      groupNumber: l.payerGroupId,
      groupRemarks: l.notes,
      cells: Object.fromEntries(
        l.providerEnrollments.map((e) => [
          e.renderingProviderId,
          { id: e.id, status: e.status, effectiveDate: e.effectiveDate?.toISOString() ?? null, remarks: e.notes, payerProviderId: e.payerProviderId },
        ])
      ),
    }));
}

function GridLegend() {
  const items = [
    ["APPROVED", "ok"],
    ["FOLLOWS_PARENT", "ok"],
    ["SUBMITTED", "warn"],
    ["PAYER_FOLLOW_UP", "warn"],
    ["BLOCKED", "bad"],
    ["PANEL_CLOSED", "bad"],
    ["NOT_STARTED", "empty"],
    ["TERMED", "mute"],
  ] as const;
  return (
    <div className="sgrid-legend">
      {items.map(([s, tone]) => (
        <span key={s}>
          <span className={`scell tone-${tone}`}>{statusShortCode[s]}</span>
          {enrollmentStatusLabel[s]}
        </span>
      ))}
      <span>
        <span className="scell tone-empty">
          ·<i className="scell-dot" />
        </span>
        Has remarks
      </span>
      <span>FM = group follows Medicare</span>
    </div>
  );
}

// The same clinician credentialed in several states has one record per practice;
// group those records by NPI, or by name when no NPI is on file.
function personKey(p: { npi: string | null; name: string }) {
  if (p.npi) return `npi:${p.npi}`;
  const words = p.name
    .toLowerCase()
    .replace(/[^a-z, ]/g, "")
    .split(/[ ,]+/)
    .filter((w) => w.length > 1)
    .sort();
  return `name:${words.join("-")}`;
}

// Enrollment status: every group with its own status per insurance (group, EDI, EFT) and each individual
// provider's status under that group. Filters narrow it to one group, one provider or one insurance; with one
// provider picked it reads as that provider's sheet (effective date, payer provider number, remarks).
export async function GridTab({ practiceIds, sp, multi }: { practiceIds: string[]; sp: SearchParams; multi: boolean }) {
  const practiceId = { in: practiceIds };
  const [groups, providers] = await Promise.all([
    prisma.billingProvider.findMany({
      where: { practiceId, active: true },
      include: { practice: true, payerEnrollments: { include: { payer: true, providerEnrollments: true } } },
      orderBy: [{ practice: { name: "asc" } }, { name: "asc" }],
    }),
    prisma.renderingProvider.findMany({
      // A provider picked by name is shown even when termed, so their history stays reachable.
      where: { practiceId, isRendering: true, ...(sp.person ? {} : { status: "ACTIVE" }) },
      include: { practice: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Filter choices.
  const people = new Map<string, { label: string; count: number }>();
  for (const r of providers) {
    const key = personKey(r);
    const entry = people.get(key) ?? { label: `${r.name}${r.credential ? `, ${r.credential}` : ""}`, count: 0 };
    entry.count++;
    people.set(key, entry);
  }
  const personOptions = [...people.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
  const person = sp.person && people.has(sp.person) ? sp.person : "";
  const group = sp.group && groups.some((g) => g.id === sp.group) ? sp.group : "";
  const payerOptions = [...new Map(groups.flatMap((g) => g.payerEnrollments.map((l) => [payerKey(l.payer.name), l.payer.name] as const))).entries()].sort((a, b) =>
    a[1].localeCompare(b[1])
  );
  const filtered = Boolean(group || person || sp.payer || sp.seg || sp.q);

  const sections = groups
    .filter((g) => !group || g.id === group)
    .map((g) => ({
      g,
      cols: providers.filter((p) => p.practiceId === g.practiceId && (!person || personKey(p) === person)),
      rows: toGridRows(g.payerEnrollments, sp),
    }))
    // With a provider picked, groups that provider doesn't work under drop out.
    .filter((s) => !person || s.cols.length > 0);

  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      <div className="grid-controls">
        <form method="get" className="compact-filters">
          <input type="hidden" name="tab" value="grid" />
          {sp.p && <input type="hidden" name="p" value={sp.p} />}
          <label>
            Group
            <select name="group" defaultValue={group}>
              <option value="">All groups ({groups.length})</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {multi && g.practice.name !== g.name ? ` · ${g.practice.name}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Individual provider
            <select name="person" defaultValue={person}>
              <option value="">All providers ({personOptions.length})</option>
              {personOptions.map(([key, p]) => (
                <option key={key} value={key}>
                  {p.label}
                  {p.count > 1 ? ` (${p.count} practices)` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Insurance
            <select name="payer" defaultValue={sp.payer ?? ""}>
              <option value="">All insurances ({payerOptions.length})</option>
              {payerOptions.map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Plan segment
            <select name="seg" defaultValue={sp.seg ?? ""}>
              <option value="">All segments</option>
              <option value="MEDICARE">Medicare (incl. Advantage / Supplemental)</option>
              <option value="MEDICAID">Medicaid (incl. MCO)</option>
              <option value="COMMERCIAL">Commercial &amp; federal</option>
            </select>
          </label>
          <label>
            Payer name or payer ID
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Aetna, 60054…" />
          </label>
          <button className="btn secondary" type="submit">
            Apply
          </button>
          {filtered && (
            <Link className="btn ghost" href={`/credentialing?tab=grid${sp.p ? `&p=${encodeURIComponent(sp.p)}` : ""}`}>
              Clear
            </Link>
          )}
        </form>
        <GridLegend />
      </div>

      {groups.length === 0 && <p className="panel muted">No groups yet — add a billing provider in Directories.</p>}
      {groups.length > 0 && sections.length === 0 && <p className="panel muted">No group matches these filters.</p>}

      {sections.map(({ g, cols, rows }, i) => {
        const colIds = new Set(cols.map((c) => c.id));
        const lineIds = new Set(rows.map((r) => r.lineId));
        const cells = g.payerEnrollments
          .filter((l) => lineIds.has(l.id))
          .flatMap((l) => l.providerEnrollments)
          .filter((e) => colIds.has(e.renderingProviderId) && e.status !== "NOT_APPLICABLE");
        const approved = cells.filter((e) => ACTIVE_ENROLLMENT_STATUSES.includes(e.status)).length;
        const open = cells.filter((e) => OPEN_ENROLLMENT_STATUSES.includes(e.status)).length;
        const groupApproved = rows.filter((r) => ["APPROVED", "FOLLOWS_MEDICARE"].includes(r.groupStatus)).length;
        const only = cols.length === 1 ? cols[0] : null;
        return (
          <details key={g.id} className="panel grid-section" open={sections.length === 1 || !multi || i === 0}>
            <summary>
              <strong>{g.name}</strong>
              <span className="muted">
                {multi && g.practice.name !== g.name ? `${g.practice.name} · ` : ""}Tax ID {g.taxId ?? "—"} · Group NPI {g.npi ?? "—"}
              </span>
              <span className="muted">
                Group: {groupApproved} of {rows.length} insurances approved · Providers: {cells.length ? Math.round((approved / cells.length) * 100) : 0}% approved, {open} open
              </span>
              <Link href={`/credentialing/groups/${g.id}`} className="btn ghost">
                Group file &amp; numbers
              </Link>
            </summary>
            {only && (
              <p className="grid-person">
                <strong>
                  {only.name}
                  {only.credential ? `, ${only.credential}` : ""}
                </strong>
                <span className="muted">
                  NPI {only.npi ?? "—"} · License {only.licenseNumber ?? "—"}
                  {only.licenseState ? ` (${only.licenseState})` : ""}
                </span>
                <StatusBadge value={only.status} />
                <Link href={`/credentialing/providers/${only.id}`} className="btn ghost">
                  Provider file &amp; numbers
                </Link>
              </p>
            )}
            <div style={{ marginTop: "0.6rem" }}>
              <StatusGrid
                rows={rows}
                providers={cols.map((p) => ({ id: p.id, name: p.name, credential: p.credential }))}
                updateCell={updateGridCell}
                updateGroup={updateGroupCell}
                enrollmentBasePath="/credentialing/enrollments/"
                providerBasePath="/credentialing/providers/"
              />
            </div>
          </details>
        );
      })}
    </div>
  );
}
