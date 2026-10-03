import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { OPEN_ENROLLMENT_STATUSES, connectionStatusLabel, credentialingStatusLabel, enrollmentStatusLabel, formatDate, planSegmentLabel } from "@/lib/format";
import { daysBetween, type CredentialingAlert } from "@/lib/credentialing";
import { syncPlansFromCoverage } from "@/lib/payer-plans";
import { moveEnrollment } from "./actions";

type SearchParams = Record<string, string | undefined>;

// One line of the work queue. Everything credentialing staff have to act on is one of these, whatever it is:
// an application still in progress, a follow-up that is late, a document about to expire, a screening that is
// due, or a group enrollment that isn't finished.
type Item = {
  key: string;
  category: "APPLICATION" | "FOLLOW_UP" | "DOCUMENT" | "SCREENING" | "REVALIDATION" | "GROUP" | "PLAN";
  urgent: boolean;
  title: string;
  detail: string;
  flags: string[];
  href: string;
  due: Date | null;
  owner: string | null;
  ownerId: string | null;
  practice: string;
  // Applications can be moved to another status straight from the list.
  enrollment?: { id: string; status: string };
};

const CATEGORIES: { key: string; label: string; hint: string }[] = [
  { key: "", label: "Everything", hint: "All items that need work" },
  { key: "URGENT", label: "Urgent", hint: "Overdue, expired or flagged" },
  { key: "APPLICATION", label: "Applications in progress", hint: "Provider enrollments not yet approved" },
  { key: "FOLLOW_UP", label: "Follow-ups & stalled", hint: "Follow-up date reached, or no activity logged" },
  { key: "GROUP", label: "Group enrollments", hint: "Group status, EDI or EFT not finished with a payer" },
  { key: "PLAN", label: "Plans to review", hint: "Plan names VOB found on patients that credentialing has not decided on" },
  { key: "DOCUMENT", label: "Expiring documents", hint: "Licenses, DEA, malpractice and other documents" },
  { key: "REVALIDATION", label: "Revalidation", hint: "Revalidation or recredentialing coming due" },
  { key: "SCREENING", label: "Screenings", hint: "OIG / SAM exclusion checks (30-day cycle)" },
];
const TAG: Record<Item["category"], string> = {
  APPLICATION: "Application",
  FOLLOW_UP: "Follow-up",
  DOCUMENT: "Document",
  SCREENING: "Screening",
  REVALIDATION: "Revalidation",
  GROUP: "Group enrollment",
  PLAN: "Plan to review",
};
const GROUP_DONE = ["APPROVED", "FOLLOWS_MEDICARE", "PANEL_CLOSED", "DENIED"];
const CONNECTION_DONE = ["APPROVED", "NOT_ALLOWED"];
const LIST_LIMIT = 300;

export async function WorkQueue({
  practiceIds,
  userId,
  sp,
  alerts,
  multi,
  scopeQuery,
}: {
  practiceIds: string[];
  userId: string;
  sp: SearchParams;
  alerts: CredentialingAlert[];
  multi: boolean;
  scopeQuery: string;
}) {
  const practiceId = { in: practiceIds };
  const now = new Date();
  for (const id of practiceIds) await syncPlansFromCoverage(id);
  const [plans, enrollments, lines] = await Promise.all([
    prisma.payerPlan.findMany({ where: { practiceId, status: "REVIEW", seenCount: { gt: 0 } }, include: { payer: true, practice: true } }),
    prisma.providerEnrollment.findMany({
      where: { renderingProvider: { practiceId }, status: { in: OPEN_ENROLLMENT_STATUSES } },
      include: { renderingProvider: { include: { practice: true } }, assignedTo: true, groupPayerEnrollment: { include: { payer: true, billingProvider: true } } },
    }),
    prisma.groupPayerEnrollment.findMany({
      where: { billingProvider: { practiceId, active: true } },
      include: { payer: true, billingProvider: { include: { practice: true } } },
    }),
  ]);

  // Alerts about an enrollment are folded into that enrollment's line instead of appearing twice.
  const byEnrollment = new Map<string, CredentialingAlert[]>();
  for (const a of alerts) {
    const id = a.href.match(/\/credentialing\/enrollments\/([a-z0-9]+)/)?.[1];
    if (id && a.kind !== "DOCUMENT" && a.kind !== "SCREENING") byEnrollment.set(id, [...(byEnrollment.get(id) ?? []), a]);
  }

  const items: Item[] = [];
  const seen = new Set<string>();
  for (const e of enrollments) {
    seen.add(e.id);
    const mine = byEnrollment.get(e.id) ?? [];
    const late = mine.filter((a) => a.kind === "FOLLOW_UP" || a.kind === "STALE");
    const reval = mine.some((a) => a.kind === "REVALIDATION") || e.status === "REVALIDATION_DUE";
    const days = daysBetween(e.statusChangedAt, now);
    items.push({
      key: `enr-${e.id}`,
      category: reval ? "REVALIDATION" : late.length ? "FOLLOW_UP" : "APPLICATION",
      urgent: mine.some((a) => a.severity === "high") || e.status === "BLOCKED",
      title: `${e.renderingProvider.name} / ${e.groupPayerEnrollment.payer.name}`,
      detail: [
        enrollmentStatusLabel[e.status] ?? e.status,
        `${days} day${days === 1 ? "" : "s"} in this status`,
        e.groupPayerEnrollment.billingProvider.name,
        e.blockingReason ? `Blocked: ${e.blockingReason}` : null,
        e.nextAction ? `Next: ${e.nextAction}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      flags: mine.map((a) => (a.kind === "FOLLOW_UP" ? `Follow-up ${a.detail.toLowerCase()}` : a.kind === "STALE" ? "No activity logged" : "Revalidation due")),
      href: `/credentialing/enrollments/${e.id}`,
      due: e.followUpDate ?? mine.find((a) => a.dueDate)?.dueDate ?? null,
      owner: e.assignedTo?.name ?? null,
      ownerId: e.assignedToId,
      practice: e.renderingProvider.practice.name,
      enrollment: { id: e.id, status: e.status },
    });
  }
  // Alerts that are not about an open application: documents, screenings, revalidation of an approved enrollment.
  for (const a of alerts) {
    const id = a.href.match(/\/credentialing\/enrollments\/([a-z0-9]+)/)?.[1];
    if (id && seen.has(id) && a.kind !== "DOCUMENT" && a.kind !== "SCREENING") continue;
    items.push({
      key: a.key,
      category: a.kind === "STALE" ? "FOLLOW_UP" : a.kind,
      urgent: a.severity === "high",
      title: a.title,
      detail: a.detail,
      flags: [],
      href: a.href,
      due: a.dueDate,
      owner: null,
      ownerId: a.assignedToId,
      practice: a.practiceName,
    });
  }
  for (const l of lines) {
    const todo = [
      GROUP_DONE.includes(l.groupStatus) ? null : `Group: ${credentialingStatusLabel[l.groupStatus] ?? l.groupStatus}`,
      // EDI and EFT only matter once the group itself can be approved with the payer.
      ["PANEL_CLOSED", "DENIED"].includes(l.groupStatus) || CONNECTION_DONE.includes(l.ediStatus) ? null : `EDI / ERA: ${connectionStatusLabel[l.ediStatus] ?? l.ediStatus}`,
      ["PANEL_CLOSED", "DENIED"].includes(l.groupStatus) || CONNECTION_DONE.includes(l.eftStatus) ? null : `EFT: ${connectionStatusLabel[l.eftStatus] ?? l.eftStatus}`,
    ].filter((v): v is string => Boolean(v));
    if (todo.length === 0) continue;
    items.push({
      key: `grp-${l.id}`,
      category: "GROUP",
      urgent: false,
      title: `${l.billingProvider.name} / ${l.payer.name}`,
      detail: `${planSegmentLabel[l.planSegment] ?? l.planSegment} · ${todo.join(" · ")}`,
      flags: [],
      href: `/credentialing?tab=grid&group=${l.billingProviderId}&payer=${encodeURIComponent(l.payer.name.trim().toLowerCase())}`,
      due: null,
      owner: null,
      ownerId: null,
      practice: l.billingProvider.practice.name,
    });
  }

  for (const pl of plans) {
    items.push({
      key: `plan-${pl.id}`,
      category: "PLAN",
      urgent: false,
      title: `${pl.payer.name} / ${pl.name}`,
      detail: `On ${pl.seenCount} patient record${pl.seenCount === 1 ? "" : "s"} · decide whether the practice is approved for this plan`,
      flags: [],
      href: `/credentialing?tab=board&view=plans&status=REVIEW`,
      due: null,
      owner: null,
      ownerId: null,
      practice: pl.practice.name,
    });
  }

  const mineOnly = sp.mine === "1";
  const q = (sp.q ?? "").trim().toLowerCase();
  const pool = items.filter((i) => (!mineOnly || i.ownerId === userId) && (!q || i.title.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q)));
  const inCat = (i: Item, cat: string) => (cat === "" ? true : cat === "URGENT" ? i.urgent : i.category === cat);
  const cat = CATEGORIES.some((c) => c.key === sp.cat) ? sp.cat! : "";
  const shown = pool
    .filter((i) => inCat(i, cat))
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity) || a.title.localeCompare(b.title));
  const link = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ tab: "board" });
    for (const [k, v] of Object.entries({ cat: cat || undefined, mine: mineOnly ? "1" : undefined, q: sp.q || undefined, ...extra })) if (v) p.set(k, v);
    return `/credentialing?${p}${scopeQuery}`;
  };

  return (
    <div className="stack" style={{ gap: "0.6rem" }}>
      <nav className="wq-cats" aria-label="Work queue categories">
        {CATEGORIES.map((c) => {
          const n = pool.filter((i) => inCat(i, c.key)).length;
          return (
            <Link key={c.key} href={link({ cat: c.key || undefined })} className={`${c.key === cat ? "wq-on" : ""}${c.key === "URGENT" && n ? " wq-urgent" : ""}`} title={c.hint}>
              <strong>{n}</strong>
              <span>{c.label}</span>
            </Link>
          );
        })}
      </nav>

      <section className="panel cd-list">
        <div className="cd-list-head">
          <strong>
            {shown.length} item{shown.length === 1 ? "" : "s"}
            {cat ? ` · ${CATEGORIES.find((c) => c.key === cat)!.label}` : ""}
          </strong>
          <form method="get" className="wq-find">
            <input type="hidden" name="tab" value="board" />
            {cat && <input type="hidden" name="cat" value={cat} />}
            {sp.p && <input type="hidden" name="p" value={sp.p} />}
            <label className="cm-check">
              <input type="checkbox" name="mine" value="1" defaultChecked={mineOnly} />
              Assigned to me
            </label>
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Provider, payer or group" aria-label="Find in the work queue" />
            <button className="btn secondary gw-mini" type="submit">
              Filter
            </button>
          </form>
        </div>
        <div className="cd-scroll">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>What needs doing</th>
                <th>Due</th>
                <th>Owner</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, LIST_LIMIT).map((i) => {
                const overdue = i.due !== null && i.due.getTime() < now.getTime();
                return (
                  <tr key={i.key}>
                    <td>
                      <span className={`gw-tag gw-tag-${i.urgent ? "bad" : i.category === "APPLICATION" ? "info" : "warn"}`}>{TAG[i.category]}</span>
                      {i.urgent && <span className="gw-tag gw-tag-bad">Urgent</span>}
                    </td>
                    <td>
                      <Link href={i.href}>
                        <strong>{i.title}</strong>
                      </Link>
                      <div className="muted">
                        {multi ? `${i.practice} · ` : ""}
                        {i.detail}
                      </div>
                      {i.flags.map((f) => (
                        <span key={f} className="gw-tag gw-tag-warn">
                          {f}
                        </span>
                      ))}
                    </td>
                    <td className={overdue ? "cd-bad" : undefined}>{i.due ? formatDate(i.due) : "—"}</td>
                    <td>{i.owner ?? (i.category === "APPLICATION" || i.enrollment ? <span className="muted">Unassigned</span> : "—")}</td>
                    <td>
                      {i.enrollment ? (
                        <form action={moveEnrollment.bind(null, i.enrollment.id)} className="pv-inline">
                          <select name="status" defaultValue={i.enrollment.status} aria-label="Move to status">
                            {Object.entries(enrollmentStatusLabel).map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                          <button className="btn secondary gw-mini" type="submit">
                            Move
                          </button>
                        </form>
                      ) : (
                        <Link className="btn secondary gw-mini" href={i.href}>
                          Open
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Nothing here needs work right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {shown.length > LIST_LIMIT && <p className="muted">Showing the first {LIST_LIMIT} of {shown.length}. Pick a category or use the filter to narrow the list.</p>}
      </section>
    </div>
  );
}
