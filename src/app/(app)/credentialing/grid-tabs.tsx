import type { ReactNode } from "react";
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

function toGridRows(lines: LineWithEnrollments[], sp: SearchParams): GridRow[] {
  const q = (sp.q ?? "").trim().toLowerCase();
  return lines
    .filter((l) => !sp.seg || planSegmentFamily[l.planSegment] === sp.seg)
    .filter(
      (l) =>
        !q ||
        l.payer.name.toLowerCase().includes(q) ||
        (l.payer.payerCode ?? "").toLowerCase().includes(q),
    )
    .sort(
      (a, b) =>
        a.payer.name.localeCompare(b.payer.name) ||
        SEGMENT_ORDER.indexOf(a.planSegment) -
          SEGMENT_ORDER.indexOf(b.planSegment),
    )
    .map((l) => ({
      lineId: l.id,
      payer: l.payer.name,
      segment: planSegmentLabel[l.planSegment] ?? l.planSegment,
      cpid: l.payer.payerCode,
      groupStatus: l.groupStatus,
      ediStatus: l.ediStatus,
      eftStatus: l.eftStatus,
      groupEffectiveDate: l.effectiveDate?.toISOString() ?? null,
      groupRemarks: l.notes,
      cells: Object.fromEntries(
        l.providerEnrollments.map((e) => [
          e.renderingProviderId,
          {
            id: e.id,
            status: e.status,
            effectiveDate: e.effectiveDate?.toISOString() ?? null,
            remarks: e.notes,
            payerProviderId: e.payerProviderId,
          },
        ]),
      ),
    }));
}

function GridFilters({
  sp,
  tab,
  extra,
}: {
  sp: SearchParams;
  tab: string;
  extra?: ReactNode;
}) {
  return (
    <form method="get" className="compact-filters">
      <input type="hidden" name="tab" value={tab} />
      {sp.p && <input type="hidden" name="p" value={sp.p} />}
      {extra}
      <label>
        Plan segment
        <select name="seg" defaultValue={sp.seg ?? ""}>
          <option value="">All segments</option>
          <option value="MEDICARE">
            Medicare (incl. Advantage / Supplemental)
          </option>
          <option value="MEDICAID">Medicaid (incl. MCO)</option>
          <option value="COMMERCIAL">Commercial &amp; federal</option>
        </select>
      </label>
      <label>
        Payer or CPID
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Aetna, 60054…" />
      </label>
      <button className="btn secondary" type="submit">
        Apply
      </button>
    </form>
  );
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

export async function GridTab({
  practiceIds,
  sp,
  multi,
}: {
  practiceIds: string[];
  sp: SearchParams;
  multi: boolean;
}) {
  const practiceId = { in: practiceIds };
  const [groups, providers] = await Promise.all([
    prisma.billingProvider.findMany({
      where: { practiceId, active: true },
      include: {
        practice: true,
        payerEnrollments: {
          include: { payer: true, providerEnrollments: true },
        },
      },
      orderBy: [{ practice: { name: "asc" } }, { name: "asc" }],
    }),
    prisma.renderingProvider.findMany({
      where: { practiceId, status: "ACTIVE", isRendering: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      <div className="grid-controls">
        <GridFilters sp={sp} tab="grid" />
        <GridLegend />
      </div>
      {groups.length === 0 && (
        <p className="panel muted">
          No groups yet — add a billing provider in Directories.
        </p>
      )}
      {groups.map((g, i) => {
        const cols = providers
          .filter((p) => p.practiceId === g.practiceId)
          .map((p) => ({ id: p.id, name: p.name, credential: p.credential }));
        const cells = g.payerEnrollments
          .flatMap((l) => l.providerEnrollments)
          .filter((e) => e.status !== "NOT_APPLICABLE");
        const approved = cells.filter((e) =>
          ACTIVE_ENROLLMENT_STATUSES.includes(e.status),
        ).length;
        const open = cells.filter((e) =>
          OPEN_ENROLLMENT_STATUSES.includes(e.status),
        ).length;
        return (
          <details
            key={g.id}
            className="panel grid-section"
            open={!multi || i === 0}
          >
            <summary>
              <strong>{multi ? g.practice.name : g.name}</strong>
              <span className="muted">
                {multi && g.name !== g.practice.name ? `${g.name} · ` : ""}Tax
                ID {g.taxId ?? "—"} · NPI {g.npi ?? "—"}
              </span>
              <span className="muted">
                {g.payerEnrollments.length} payer lines · {cols.length}{" "}
                providers ·{" "}
                {cells.length ? Math.round((approved / cells.length) * 100) : 0}
                % approved · {open} open
              </span>
            </summary>
            <div style={{ marginTop: "0.6rem" }}>
              <StatusGrid
                rows={toGridRows(g.payerEnrollments, sp)}
                providers={cols}
                updateCell={updateGridCell}
                updateGroup={updateGroupCell}
                enrollmentBasePath="/credentialing/enrollments/"
              />
            </div>
          </details>
        );
      })}
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

export async function ProviderViewTab({
  practiceIds,
  sp,
  multi,
}: {
  practiceIds: string[];
  sp: SearchParams;
  multi: boolean;
}) {
  const records = await prisma.renderingProvider.findMany({
    where: { practiceId: { in: practiceIds }, isRendering: true },
    include: { practice: true },
    orderBy: [{ name: "asc" }],
  });

  const people = new Map<string, { label: string; records: typeof records }>();
  for (const r of records) {
    const key = personKey(r);
    const entry = people.get(key) ?? {
      label: `${r.name}${r.credential ? `, ${r.credential}` : ""}`,
      records: [],
    };
    entry.records.push(r);
    people.set(key, entry);
  }
  const options = [...people.entries()].sort((a, b) =>
    a[1].label.localeCompare(b[1].label),
  );
  const selectedKey =
    sp.person && people.has(sp.person) ? sp.person : options[0]?.[0];
  const selected = selectedKey ? people.get(selectedKey)! : null;

  const lines = selected
    ? await prisma.groupPayerEnrollment.findMany({
        where: {
          billingProvider: {
            practiceId: { in: selected.records.map((r) => r.practiceId) },
            active: true,
          },
        },
        include: {
          payer: true,
          billingProvider: true,
          providerEnrollments: {
            where: {
              renderingProviderId: { in: selected.records.map((r) => r.id) },
            },
          },
        },
      })
    : [];

  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      <GridFilters
        sp={sp}
        tab="provider"
        extra={
          <label>
            Provider
            <select name="person" defaultValue={selectedKey ?? ""}>
              {options.map(([key, p]) => (
                <option key={key} value={key}>
                  {p.label}
                  {p.records.length > 1
                    ? ` (${p.records.length} practices)`
                    : ""}
                </option>
              ))}
            </select>
          </label>
        }
      />
      <GridLegend />
      {!selected && (
        <p className="panel muted">
          No rendering providers yet — add them in Directories.
        </p>
      )}
      {selected?.records
        .slice()
        .sort((a, b) => a.practice.name.localeCompare(b.practice.name))
        .map((r, i) => {
          const mine = lines
            .flatMap((l) => l.providerEnrollments)
            .filter((e) => e.renderingProviderId === r.id);
          const approved = mine.filter((e) =>
            ACTIVE_ENROLLMENT_STATUSES.includes(e.status),
          ).length;
          const open = mine.filter((e) =>
            OPEN_ENROLLMENT_STATUSES.includes(e.status),
          ).length;
          return (
            <details
              key={r.id}
              className="panel grid-section"
              open={selected.records.length === 1 || i === 0}
            >
              <summary>
                <strong>{multi ? r.practice.name : r.name}</strong>
                <span className="muted">
                  NPI {r.npi ?? "—"} · License {r.licenseNumber ?? "—"}
                  {r.licenseState ? ` (${r.licenseState})` : ""}
                </span>
                <span className="muted">
                  {mine.length} payer lines · {approved} approved · {open} open
                </span>
                <StatusBadge value={r.status} />
                <Link
                  href={`/credentialing/providers/${r.id}`}
                  className="btn ghost"
                >
                  Credentialing file
                </Link>
              </summary>
              <StatusGrid
                rows={toGridRows(
                  lines.filter(
                    (l) => l.billingProvider.practiceId === r.practiceId,
                  ),
                  sp,
                )}
                providers={[
                  { id: r.id, name: r.name, credential: r.credential },
                ]}
                updateCell={updateGridCell}
                updateGroup={updateGroupCell}
                enrollmentBasePath="/credentialing/enrollments/"
              />
            </details>
          );
        })}
    </div>
  );
}
