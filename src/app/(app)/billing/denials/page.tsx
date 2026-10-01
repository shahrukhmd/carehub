import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney, patientName } from "@/lib/format";
import { claimNumber } from "@/lib/claim-format";
import {
  APPEAL_ALERT_DAYS,
  APPEAL_LEVELS,
  APPEAL_STATUS,
  DEFAULT_APPEAL_DAYS,
  DENIAL_ACTION_LABEL,
  DENIAL_CATEGORIES,
  DENIAL_RESOLUTION,
  DENIAL_ROLES,
  DENIAL_STATUS,
  daysUntil,
  deadlineLabel,
  deadlineTone,
  ensureDenialRecords,
} from "@/lib/denials";
import { assignDenialToMe } from "./actions";

type Search = { view?: string; category?: string; payer?: string; q?: string };

const VIEWS: [string, string][] = [
  ["open", "To work"],
  ["mine", "Mine"],
  ["due", "Deadline soon"],
  ["appealed", "Under appeal"],
  ["resolved", "Resolved"],
  ["all", "All"],
];
const DAY = 86_400_000;

export default async function DenialsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(DENIAL_ROLES);
  const sp = await searchParams;
  await ensureDenialRecords(user.practiceId);
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : "open";
  const q = sp.q?.trim();
  const soon = new Date(Date.now() + APPEAL_ALERT_DAYS * DAY);

  const byView: Record<string, Prisma.ClaimDenialWhereInput> = {
    open: { status: "OPEN" },
    mine: { status: { not: "RESOLVED" }, ownerId: user.id },
    due: { status: "OPEN", appealDueAt: { lte: soon } },
    appealed: { status: "APPEALED" },
    resolved: { status: "RESOLVED" },
    all: {},
  };
  const where: Prisma.ClaimDenialWhereInput = {
    practiceId: user.practiceId,
    ...byView[view],
    ...(sp.category && DENIAL_CATEGORIES[sp.category] ? { category: sp.category } : {}),
    ...(sp.payer ? { claim: { payerName: sp.payer } } : {}),
    ...(q
      ? {
          claim: {
            ...(sp.payer ? { payerName: sp.payer } : {}),
            OR: [{ patient: { lastName: { contains: q } } }, { patient: { firstName: { contains: q } } }, { patient: { mrn: { contains: q } } }, { payerName: { contains: q } }],
          },
        }
      : {}),
  };

  const [active, rows, staff] = await Promise.all([
    prisma.claimDenial.findMany({
      where: { practiceId: user.practiceId, status: { not: "RESOLVED" } },
      select: { status: true, category: true, amountCents: true, appealDueAt: true, ownerId: true, claim: { select: { payerName: true } } },
    }),
    prisma.claimDenial.findMany({
      where,
      include: {
        claim: { include: { patient: true, lines: { select: { dosFrom: true, cptCode: true }, orderBy: { lineNumber: "asc" } } } },
        appeals: { orderBy: { createdAt: "desc" } },
      },
      orderBy: view === "resolved" ? { resolvedAt: "desc" } : [{ appealDueAt: "asc" }, { deniedAt: "asc" }],
      take: 300,
    }),
    prisma.membership.findMany({ where: { practiceId: user.practiceId }, include: { user: { select: { id: true, name: true } } } }),
  ]);
  const nameOf = new Map(staff.map((m) => [m.user.id, m.user.name]));

  const open = active.filter((d) => d.status === "OPEN");
  const appealed = active.filter((d) => d.status === "APPEALED");
  const due = open.filter((d) => d.appealDueAt && d.appealDueAt <= soon);
  const sum = (list: { amountCents: number }[]) => list.reduce((s, d) => s + d.amountCents, 0);
  const categories = Object.keys(DENIAL_CATEGORIES)
    .map((k) => ({ k, n: active.filter((d) => d.category === k).length }))
    .filter((c) => c.n > 0);
  const payers = [...new Set(active.map((d) => d.claim.payerName))].sort();
  const link = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ view, category: sp.category, payer: sp.payer, q, ...over })) if (v) p.set(k, v);
    return `/billing/denials?${p}`;
  };

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/billing">Revenue cycle</Link> · Denials &amp; appeals
          </p>
          <h1>Denial worklist</h1>
        </div>
        <div className="gw-actions">
          <Link className="btn secondary" href="/billing/reports?r=denial_rate">
            Denial reports
          </Link>
        </div>
      </div>

      <section className="grid-stats">
        <Link className="stat" href="/billing/denials?view=open">
          <span>Denials to work</span>
          <strong>
            {open.length} · {formatMoney(sum(open))}
          </strong>
        </Link>
        <Link className="stat" href="/billing/denials?view=due">
          <span>Appeal deadline within {APPEAL_ALERT_DAYS} days</span>
          <strong>{due.length}</strong>
        </Link>
        <Link className="stat" href="/billing/denials?view=appealed">
          <span>Under appeal</span>
          <strong>
            {appealed.length} · {formatMoney(sum(appealed))}
          </strong>
        </Link>
        <div className="stat">
          <span>Not assigned to anyone</span>
          <strong>{active.filter((d) => !d.ownerId).length}</strong>
        </div>
      </section>

      <nav className="cn-filters">
        {VIEWS.map(([k, l]) => (
          <Link key={k} href={link({ view: k })} className={k === view ? "active" : ""}>
            {l}
          </Link>
        ))}
      </nav>

      <form method="get" className="panel gw-filters">
        <input type="hidden" name="view" value={view} />
        <input name="q" defaultValue={q} placeholder="Patient, MRN or payer" aria-label="Search" />
        <select name="category" defaultValue={sp.category ?? ""} aria-label="Denial category">
          <option value="">Any category</option>
          {Object.entries(DENIAL_CATEGORIES).map(([k, c]) => (
            <option key={k} value={k}>
              {c.label}
            </option>
          ))}
        </select>
        <select name="payer" defaultValue={sp.payer ?? ""} aria-label="Payer">
          <option value="">Any payer</option>
          {payers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button className="btn secondary" type="submit">
          Filter
        </button>
        <Link className="btn ghost" href={`/billing/denials?view=${view}`}>
          Clear
        </Link>
      </form>

      {categories.length > 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Open by category:{" "}
          {categories.map((c) => (
            <Link key={c.k} href={link({ category: c.k })} className={`gw-tag gw-tag-${sp.category === c.k ? "info" : "muted"}`} style={{ marginRight: "0.35rem" }}>
              {DENIAL_CATEGORIES[c.k].label} · {c.n}
            </Link>
          ))}
        </p>
      )}

      <section className="panel gw-table vw-worklist">
        <table>
          <thead>
            <tr>
              <th>Claim</th>
              <th>Patient</th>
              <th>Payer</th>
              <th>Denied</th>
              <th>Reason</th>
              <th>Amount</th>
              <th>{view === "resolved" ? "Outcome" : "Appeal by"}</th>
              <th>Owner</th>
              <th>Next step</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const c = d.claim;
              const cat = DENIAL_CATEGORIES[d.category] ?? DENIAL_CATEGORIES.OTHER;
              const dos = c.lines.map((l) => l.dosFrom.getTime());
              const age = -(daysUntil(d.deniedAt) ?? 0);
              const appeal = d.appeals[0];
              const [statusLabel, statusTone] = DENIAL_STATUS[d.status] ?? [d.status, "muted"];
              return (
                <tr key={d.id}>
                  <td>
                    <Link href={`/billing/claims/${c.id}#denial`}>
                      <strong>{claimNumber(c)}</strong>
                    </Link>
                    <div className="muted">
                      {dos.length ? `DOS ${formatDate(new Date(Math.min(...dos)))}` : ""} · {c.lines.map((l) => l.cptCode).join(", ")}
                    </div>
                  </td>
                  <td>
                    <Link href={`/patients/${c.patientId}`}>{patientName(c.patient)}</Link>
                    <div className="muted">{c.patient.mrn}</div>
                  </td>
                  <td>{c.payerName}</td>
                  <td>
                    {formatDate(d.deniedAt)}
                    <div className="muted">
                      {age <= 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`} · {d.source === "ERA" ? "ERA" : "keyed"}
                    </div>
                  </td>
                  <td>
                    <span className="gw-tag gw-tag-info">{cat.label}</span>
                    <div className="gw-missing">{d.reason}</div>
                    {d.remarks && <div className="muted">Remarks {d.remarks}</div>}
                  </td>
                  <td>
                    {formatMoney(d.amountCents)}
                    {d.recoveredCents > 0 && <div className="muted">recovered {formatMoney(d.recoveredCents)}</div>}
                  </td>
                  <td>
                    {d.status === "RESOLVED" ? (
                      <>
                        <span className="gw-tag gw-tag-ok">{DENIAL_RESOLUTION[d.resolution ?? ""] ?? "Resolved"}</span>
                        {d.resolvedAt && <div className="muted">{formatDate(d.resolvedAt)}</div>}
                      </>
                    ) : d.status === "APPEALED" && appeal ? (
                      <>
                        <span className={`gw-tag gw-tag-${APPEAL_STATUS[appeal.status]?.[1] ?? "info"}`}>Level {appeal.level}</span>
                        <div className="muted">{appeal.filedAt ? `filed ${formatDate(appeal.filedAt)}` : "not filed yet"}</div>
                      </>
                    ) : (
                      <span className={`gw-tag gw-tag-${deadlineTone(daysUntil(d.appealDueAt))}`}>{deadlineLabel(d.appealDueAt)}</span>
                    )}
                  </td>
                  <td>
                    {d.ownerId ? (
                      (nameOf.get(d.ownerId) ?? "—")
                    ) : d.status === "RESOLVED" ? (
                      <span className="muted">—</span>
                    ) : (
                      <form action={assignDenialToMe.bind(null, d.id)}>
                        <button className="btn ghost gw-mini" type="submit">
                          Assign to me
                        </button>
                      </form>
                    )}
                  </td>
                  <td>
                    {d.status === "RESOLVED" ? (
                      <span className="muted">—</span>
                    ) : (
                      <>
                        <span className={`gw-tag gw-tag-${statusTone}`}>{d.status === "OPEN" ? DENIAL_ACTION_LABEL[cat.action] : statusLabel}</span>
                        {appeal?.status === "DRAFT" && <div className="muted">{APPEAL_LEVELS[appeal.level]} drafted</div>}
                        {d.followUpAt && <div className="muted">Follow up {formatDate(d.followUpAt)}</div>}
                        {d.workNote && <div className="muted">{d.workNote.slice(0, 80)}</div>}
                      </>
                    )}
                  </td>
                  <td className="gw-actions">
                    <Link className="btn secondary gw-mini" href={`/billing/claims/${c.id}#denial`}>
                      {d.status === "RESOLVED" ? "Open" : "Work"}
                    </Link>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  {view === "open" ? "No denials waiting to be worked." : "No denials match."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      <p className="muted">
        Denials arrive here automatically when an ERA posts a denial or a biller records one on a claim. Appeal deadlines use each payer&apos;s appeal limit (Settings →
        Directories → Insurance), or {DEFAULT_APPEAL_DAYS} days when none is set.
      </p>
    </div>
  );
}
