import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import {
  ACTIVE_ENROLLMENT_STATUSES,
  OPEN_ENROLLMENT_STATUSES,
  connectionStatusLabel,
  credentialingStatusLabel,
  enrollmentStatusLabel,
  planSegmentLabel,
} from "@/lib/format";
import { STALE_FOLLOW_UP_DAYS, daysBetween, getCredentialingAlerts } from "@/lib/credentialing";
import { CREDENTIALING_ROLES, credentialingPractices, selectedPracticeIds } from "@/lib/scope";
import { GridTab } from "./grid-tabs";
import { WorkQueue } from "./work-queue";
import { PayerPlans } from "./plans";
import {
  bulkSetLineStatus,
  createGroupPayerEnrollment,
  moveEnrollment,
  syncCredentialing,
  updateGroupPayerEnrollment,
} from "./actions";

type SearchParams = Record<string, string | undefined>;

// Three tabs. "Work queue" is the old Workboard, Needs attention and Payer lines setup in one place: everything
// that needs doing is a line in one list. Provider numbers and files live on each provider's and group's file.
const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "board", label: "Work queue" },
  { key: "grid", label: "Enrollment status" },
];
// Old links keep working.
const MOVED_TABS: Record<string, string> = { provider: "grid", numbers: "grid", providers: "grid", attention: "board", groups: "board" };

const BOARD_COLUMNS = [
  { key: "NOT_STARTED", label: "Not started", statuses: ["NOT_STARTED"] },
  { key: "DOCUMENTS_PENDING", label: "Documents pending", statuses: ["DOCUMENTS_PENDING"] },
  { key: "SUBMITTED", label: "Submitted / in process", statuses: ["SUBMITTED"] },
  { key: "PAYER_FOLLOW_UP", label: "Payer follow-up", statuses: ["PAYER_FOLLOW_UP"] },
  { key: "BLOCKED", label: "Blocked", statuses: ["BLOCKED"] },
  { key: "APPROVED", label: "Approved", statuses: ["APPROVED", "FOLLOWS_PARENT"] },
  { key: "REVALIDATION_DUE", label: "Revalidation / recred due", statuses: ["REVALIDATION_DUE"] },
  { key: "CLOSED", label: "Closed / not offered", statuses: ["PANEL_CLOSED", "DENIED"] },
  { key: "TERMED", label: "Termed", statuses: ["TERMED"] },
];

function dateInputValue(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

// "Personic Health - Alabama" -> "Alabama" when every practice shares the client prefix.
function shortPracticeName(name: string, all: { name: string }[]) {
  const prefix = (n: string) => n.split(/\s[-–]\s/)[0];
  const shared = prefix(name);
  const parts = name.split(/\s[-–]\s/);
  return parts.length > 1 && all.every((p) => prefix(p.name) === shared) ? parts.slice(1).join(" - ") : name;
}

export default async function CredentialingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const raw = await searchParams;
  // Checkbox lists (?p=a&p=b) arrive as arrays; everything else is a single value.
  const sp: SearchParams = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v])
  );
  const wanted = MOVED_TABS[sp.tab ?? ""] ?? sp.tab;
  // The work queue has three faces: the list (default), the board by status, and the payer lines setup.
  const queueView = sp.tab === "groups" || sp.view === "setup" ? "setup" : sp.view === "board" ? "board" : sp.view === "plans" ? "plans" : "list";
  const tab = TABS.some((t) => t.key === wanted) ? wanted! : "dashboard";
  const practiceIds = selectedPracticeIds(user, sp.p);
  const allPractices = credentialingPractices(user);
  const multi = user.isMaster && allPractices.length > 1;
  const alerts = await getCredentialingAlerts(practiceIds);

  // Carry the master's practice selection across tabs and exports.
  const scopeQuery = multi && sp.p ? `&p=${encodeURIComponent(sp.p)}` : "";
  const selectedNames = allPractices.filter((pr) => practiceIds.includes(pr.id)).map((pr) => pr.name);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            {multi ? `Master view · ${practiceIds.length} of ${allPractices.length} practices` : user.practice.name}
          </p>
          <h1>Credentialing</h1>
        </div>
        <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
          {/* Straight to the add screens; saving lands back in credentialing. */}
          <Link className="btn" href="/settings/directories/providers/new?from=credentialing">
            + Add provider
          </Link>
          <Link className="btn" href="/settings/directories/insurance/new?from=credentialing">
            + Add insurance
          </Link>
          <a className="btn secondary" href={`/api/credentialing/export?x=1${scopeQuery}`}>
            {multi ? "Download combined report (CSV)" : "Export to Excel (CSV)"}
          </a>
          <form action={syncCredentialing}>
            <button className="btn secondary" type="submit">
              Sync providers &amp; payer lines
            </button>
          </form>
        </div>
      </div>

      {multi && (
        <form method="get" className="panel practice-filter" style={{ marginBottom: "0.8rem", padding: "0.6rem 0.9rem" }}>
          <input type="hidden" name="tab" value={tab} />
          <strong style={{ color: "var(--navy)" }}>Practices</strong>
          {allPractices.map((pr) => (
            <label key={pr.id}>
              <input type="checkbox" name="p" value={pr.id} defaultChecked={practiceIds.includes(pr.id)} />
              {shortPracticeName(pr.name, allPractices)}
            </label>
          ))}
          <button className="btn secondary" type="submit">
            Apply
          </button>
          <Link className="btn ghost" href={`/credentialing?tab=${tab}`}>
            All practices
          </Link>
        </form>
      )}

      <nav className="view-tabs" style={{ marginBottom: "0.9rem", width: "fit-content", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/credentialing?tab=${t.key}${scopeQuery}`}
            className={`view-tab${t.key === tab ? " active" : ""}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "grid" && <GridTab practiceIds={practiceIds} sp={sp} multi={multi} />}
      {tab === "board" && (
        <>
          <nav className="cm-menu" aria-label="Work queue view">
            <Link href={`/credentialing?tab=board${scopeQuery}`} className={queueView === "list" ? "cm-on" : undefined} title="Everything that needs doing, in one list">
              To-do list
            </Link>
            <Link href={`/credentialing?tab=board&view=board${scopeQuery}`} className={queueView === "board" ? "cm-on" : undefined} title="Applications as cards in a column per status">
              Board by status
            </Link>
            <Link href={`/credentialing?tab=board&view=setup${scopeQuery}`} className={queueView === "setup" ? "cm-on" : undefined} title="Add an insurance to a group, or change a group's line">
              Payer lines setup
            </Link>
            <Link href={`/credentialing?tab=board&view=plans${scopeQuery}`} className={queueView === "plans" ? "cm-on" : undefined} title="Payer names with their plan type, and the plan names the practice is approved for">
              Payer names &amp; plans
            </Link>
          </nav>
          {queueView === "list" && <WorkQueue practiceIds={practiceIds} userId={user.id} sp={sp} alerts={alerts} multi={multi} scopeQuery={scopeQuery} />}
          {queueView === "board" && <Workboard practiceIds={practiceIds} userId={user.id} sp={sp} />}
          {queueView === "setup" && <Groups practiceIds={practiceIds} />}
          {queueView === "plans" && <PayerPlans practiceIds={practiceIds} sp={sp} isAdmin={user.role === "ADMIN"} />}
        </>
      )}
      {tab === "dashboard" && (
        <Dashboard practiceIds={practiceIds} alertCount={alerts.length} multi={multi} practiceNames={selectedNames} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- Workboard

async function Workboard({ practiceIds, userId, sp }: { practiceIds: string[]; userId: string; sp: SearchParams }) {
  const practiceId = { in: practiceIds };
  const [providers, payers, groups, staff] = await Promise.all([
    prisma.renderingProvider.findMany({ where: { practiceId, isRendering: true }, orderBy: { name: "asc" } }),
    prisma.payer.findMany({ where: { practiceId }, orderBy: { name: "asc" } }),
    prisma.billingProvider.findMany({ where: { practiceId }, orderBy: { name: "asc" } }),
    prisma.user.findMany({
      where: { practiceId, role: { in: ["ADMIN", "CREDENTIALING"] }, active: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const owner = sp.owner === "me" ? userId : sp.owner || undefined;
  const enrollments = await prisma.providerEnrollment.findMany({
    where: {
      renderingProvider: { practiceId },
      status: { not: "NOT_APPLICABLE" },
      ...(sp.provider ? { renderingProviderId: sp.provider } : {}),
      ...(owner ? { assignedToId: owner } : {}),
      groupPayerEnrollment: {
        ...(sp.payer ? { payerId: sp.payer } : {}),
        ...(sp.group ? { billingProviderId: sp.group } : {}),
      },
      ...(sp.state ? { state: sp.state } : {}),
    },
    include: {
      renderingProvider: true,
      assignedTo: true,
      groupPayerEnrollment: { include: { payer: true, billingProvider: true } },
    },
    orderBy: [{ priority: "desc" }, { statusChangedAt: "asc" }],
  });

  const now = new Date();
  const overdueOnly = sp.overdue === "1";
  const visible = enrollments.filter((e) => {
    if (!overdueOnly) return true;
    const followUpOverdue = e.followUpDate !== null && e.followUpDate < now;
    const stale = daysBetween(e.lastActivityAt ?? e.statusChangedAt, now) >= STALE_FOLLOW_UP_DAYS;
    return OPEN_ENROLLMENT_STATUSES.includes(e.status) && (followUpOverdue || stale);
  });
  const states = [...new Set(enrollments.map((e) => e.state).filter(Boolean))].sort() as string[];

  return (
    <>
      <form className="panel schedule-filters" method="get" style={{ marginBottom: "1rem" }}>
        <input type="hidden" name="tab" value="board" />
        <input type="hidden" name="view" value="board" />
        <label>
          Provider
          <select name="provider" defaultValue={sp.provider ?? ""}>
            <option value="">All providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Payer
          <select name="payer" defaultValue={sp.payer ?? ""}>
            <option value="">All payers</option>
            {payers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Group
          <select name="group" defaultValue={sp.group ?? ""}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          State
          <select name="state" defaultValue={sp.state ?? ""}>
            <option value="">All states</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Owner
          <select name="owner" defaultValue={sp.owner ?? ""}>
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-inline">
          <input type="checkbox" name="overdue" value="1" defaultChecked={overdueOnly} />
          Overdue follow-up only
        </label>
        <button className="btn secondary" type="submit">
          Apply
        </button>
        <Link className="btn ghost" href="/credentialing?tab=board&view=board">
          Clear
        </Link>
      </form>

      <div className="board">
        {BOARD_COLUMNS.map((col) => {
          const cards = visible.filter((e) => col.statuses.includes(e.status));
          return (
            <section key={col.key} className="board-col">
              <header>
                <strong>{col.label}</strong>
                <span className="pill">{cards.length}</span>
              </header>
              {cards.map((e) => {
                const days = daysBetween(e.statusChangedAt, now);
                const followUpOverdue =
                  OPEN_ENROLLMENT_STATUSES.includes(e.status) && e.followUpDate !== null && e.followUpDate < now;
                return (
                  <article key={e.id} className={`board-card${followUpOverdue ? " board-card-alert" : ""}`}>
                    <Link href={`/credentialing/enrollments/${e.id}`}>
                      <strong>{e.renderingProvider.name}</strong>
                      <div>{e.groupPayerEnrollment.payer.name}</div>
                    </Link>
                    <div className="muted">
                      {e.groupPayerEnrollment.billingProvider.name}
                      {e.state ? ` · ${e.state}` : ""}
                    </div>
                    <div className="muted">
                      {e.planTypes ?? "Plan type —"}
                      {e.groupPayerEnrollment.payer.payerCode ? ` · ID ${e.groupPayerEnrollment.payer.payerCode}` : ""}
                    </div>
                    {e.status === "FOLLOWS_PARENT" && <StatusBadge value="FOLLOWS_PARENT" />}
                    {e.blockingReason && <div className="board-card-reason">{e.blockingReason}</div>}
                    <div className="board-card-foot">
                      <span>{days}d in status</span>
                      <span>{e.assignedTo?.name ?? "Unassigned"}</span>
                    </div>
                    {followUpOverdue && <div className="board-card-reason">Follow-up overdue</div>}
                    <form action={moveEnrollment.bind(null, e.id)} className="board-card-move">
                      <select name="status" defaultValue={e.status} aria-label="Move to status">
                        {Object.entries(enrollmentStatusLabel).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <button className="btn ghost" type="submit">
                        Move
                      </button>
                    </form>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Groups

async function Groups({ practiceIds }: { practiceIds: string[] }) {
  const practiceId = { in: practiceIds };
  const [billingProviders, payers] = await Promise.all([
    prisma.billingProvider.findMany({
      where: { practiceId },
      include: {
        payerEnrollments: {
          include: { payer: { include: { parentPayer: true } }, providerEnrollments: { select: { status: true } } },
          orderBy: [{ payer: { name: "asc" } }, { planSegment: "asc" }],
        },
        practice: true,
      },
      orderBy: [{ practice: { name: "asc" } }, { name: "asc" }],
    }),
    prisma.payer.findMany({ where: { practiceId, active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="stack">
      {billingProviders.length === 0 && (
        <p className="panel muted">No groups yet — add a billing provider in Directories.</p>
      )}
      {billingProviders.map((bp) => (
        <section key={bp.id} className="panel">
          <h2>
            {bp.name} {bp.state ? `(${bp.state})` : ""} <StatusBadge value={bp.active ? "ACTIVE" : "INACTIVE"} />
            {bp.practice.name !== bp.name && <span className="muted"> · {bp.practice.name}</span>}{" "}
            <Link className="btn ghost" href={`/credentialing/groups/${bp.id}`}>
              Group file &amp; numbers
            </Link>
          </h2>
          <p className="muted">
            Type-2 NPI {bp.npi ?? "—"} · Tax ID {bp.taxId ?? "—"} · {bp.addressLine1 ?? "No address"}
            {bp.city ? `, ${bp.city}` : ""}
          </p>
          <table>
            <thead>
              <tr>
                <th>Payer</th>
                <th>Plans included</th>
                <th>Group status</th>
                <th>EDI/ERA</th>
                <th>EFT</th>
                <th>Effective</th>
                <th>Payer group ID</th>
                <th>Providers</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bp.payerEnrollments.map((e) => {
                const formId = `gpe-${e.id}`;
                const approved = e.providerEnrollments.filter((p) => ACTIVE_ENROLLMENT_STATUSES.includes(p.status)).length;
                const tracked = e.providerEnrollments.filter((p) => p.status !== "NOT_APPLICABLE").length;
                return (
                  <tr key={e.id}>
                    <td>
                      {e.payer.name}
                      <div className="muted">{planSegmentLabel[e.planSegment] ?? e.planSegment}</div>
                      {e.payer.parentPayer && <div className="muted">Follows {e.payer.parentPayer.name}</div>}
                      <form id={formId} action={updateGroupPayerEnrollment.bind(null, e.id)} />
                    </td>
                    <td>
                      <input form={formId} name="planType" defaultValue={e.planType ?? ""} placeholder="Commercial" />
                    </td>
                    <td>
                      <select form={formId} name="groupStatus" defaultValue={e.groupStatus}>
                        {Object.entries(credentialingStatusLabel).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select form={formId} name="ediStatus" defaultValue={e.ediStatus}>
                        {Object.entries(connectionStatusLabel).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select form={formId} name="eftStatus" defaultValue={e.eftStatus}>
                        {Object.entries(connectionStatusLabel).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input form={formId} name="effectiveDate" type="date" defaultValue={dateInputValue(e.effectiveDate)} />
                    </td>
                    <td>
                      <input form={formId} name="payerGroupId" defaultValue={e.payerGroupId ?? ""} />
                      <input form={formId} name="notes" type="hidden" defaultValue={e.notes ?? ""} />
                    </td>
                    <td>
                      <Link href={`/credentialing?tab=board&view=board&group=${bp.id}&payer=${e.payerId}`}>
                        {approved}/{tracked} approved
                      </Link>
                    </td>
                    <td>
                      <button form={formId} className="btn ghost" type="submit">
                        Save
                      </button>
                      <form action={bulkSetLineStatus.bind(null, e.id)} className="board-card-move">
                        <select name="status" defaultValue="" aria-label="Set every provider on this line to">
                          <option value="" disabled>
                            Set all providers…
                          </option>
                          {Object.entries(enrollmentStatusLabel).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <button className="btn ghost" type="submit">
                          Apply
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {bp.payerEnrollments.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    No payer lines yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <form className="form-grid" action={createGroupPayerEnrollment.bind(null, bp.id)} style={{ marginTop: "0.8rem" }}>
            <label>
              Add payer line
              <select name="payerId" defaultValue="" required>
                <option value="" disabled>
                  Select payer
                </option>
                {payers
                  .filter((p) => p.practiceId === bp.practiceId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.planSegment ? ` — ${planSegmentLabel[p.planSegment] ?? p.planSegment}` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label title="Used only when the payer has no plan type of its own (set under Payer names & plans)">
              Plan segment
              <select name="planSegment" defaultValue="COMMERCIAL">
                {Object.entries(planSegmentLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Plans included
              <input name="planType" placeholder="PPO, HMO, EPO" />
            </label>
            <label>
              Group status
              <select name="groupStatus" defaultValue="NOT_STARTED">
                {Object.entries(credentialingStatusLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn secondary" type="submit" style={{ alignSelf: "end" }}>
              Add line (opens a row per provider)
            </button>
          </form>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Executive dashboard

async function Dashboard({
  practiceIds,
  alertCount,
  multi,
  practiceNames,
}: {
  practiceIds: string[];
  alertCount: number;
  multi: boolean;
  practiceNames: string[];
}) {
  const practiceId = { in: practiceIds };
  const now = new Date();
  const [enrollments, providers, lines, documents] = await Promise.all([
    prisma.providerEnrollment.findMany({
      where: { renderingProvider: { practiceId }, status: { not: "NOT_APPLICABLE" } },
      include: {
        renderingProvider: { include: { practice: true } },
        groupPayerEnrollment: { include: { payer: true, billingProvider: true } },
      },
    }),
    prisma.renderingProvider.findMany({
      where: { practiceId, status: "ACTIVE", isRendering: true },
      orderBy: { name: "asc" },
    }),
    prisma.groupPayerEnrollment.findMany({
      where: { billingProvider: { practiceId } },
      include: { payer: true, billingProvider: true },
      orderBy: [{ billingProvider: { name: "asc" } }, { payer: { name: "asc" } }],
    }),
    prisma.providerDocument.findMany({
      where: { supersededAt: null, expiryDate: { not: null }, renderingProvider: { practiceId, status: "ACTIVE" } },
    }),
  ]);

  const approved = enrollments.filter((e) => ACTIVE_ENROLLMENT_STATUSES.includes(e.status)).length;
  const open = enrollments.filter((e) => OPEN_ENROLLMENT_STATUSES.includes(e.status));
  const blocked = enrollments.filter((e) => e.status === "BLOCKED").length;
  const trackedForRate = enrollments.filter((e) => e.status !== "TERMED").length;

  const byPayer = new Map<string, { open: number; blocked: number; approved: number; closed: number }>();
  for (const e of enrollments) {
    const name = e.groupPayerEnrollment.payer.name;
    const row = byPayer.get(name) ?? { open: 0, blocked: 0, approved: 0, closed: 0 };
    if (e.status === "BLOCKED") row.blocked += 1;
    else if (OPEN_ENROLLMENT_STATUSES.includes(e.status)) row.open += 1;
    else if (ACTIVE_ENROLLMENT_STATUSES.includes(e.status)) row.approved += 1;
    else row.closed += 1;
    byPayer.set(name, row);
  }

  const bottlenecks = new Map<string, { count: number; totalDays: number }>();
  for (const e of open) {
    const reason = e.blockingReason?.trim() || (e.status === "BLOCKED" ? "Blocked — reason not recorded" : "Awaiting payer");
    const row = bottlenecks.get(reason) ?? { count: 0, totalDays: 0 };
    row.count += 1;
    row.totalDays += daysBetween(e.submittedDate ?? e.createdAt, now);
    bottlenecks.set(reason, row);
  }

  const calendar = new Map<string, { documents: number; revalidations: number }>();
  const horizon = new Date(now.getFullYear(), now.getMonth() + 12, 1);
  const bump = (d: Date, key: "documents" | "revalidations") => {
    if (d > horizon) return;
    const month = d < now ? "Overdue" : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const row = calendar.get(month) ?? { documents: 0, revalidations: 0 };
    row[key] += 1;
    calendar.set(month, row);
  };
  for (const d of documents) bump(d.expiryDate!, "documents");
  for (const e of enrollments) if (e.revalidationDate) bump(e.revalidationDate, "revalidations");

  const grid = new Map(enrollments.map((e) => [`${e.renderingProviderId}:${e.groupPayerEnrollmentId}`, e]));

  const byPractice = new Map<string, { providers: Set<string>; approved: number; open: number; blocked: number; total: number }>();
  for (const e of enrollments) {
    const name = e.renderingProvider.practice.name;
    const row = byPractice.get(name) ?? { providers: new Set(), approved: 0, open: 0, blocked: 0, total: 0 };
    row.providers.add(e.renderingProviderId);
    if (e.status !== "TERMED") row.total += 1;
    if (ACTIVE_ENROLLMENT_STATUSES.includes(e.status)) row.approved += 1;
    if (OPEN_ENROLLMENT_STATUSES.includes(e.status)) row.open += 1;
    if (e.status === "BLOCKED") row.blocked += 1;
    byPractice.set(name, row);
  }

  return (
    <div className="stack">
      <section className="grid-stats">
        <div className="stat">
          <span>Active providers</span>
          <strong>{providers.length}</strong>
        </div>
        <div className="stat">
          <span>Approval rate (provider × payer)</span>
          <strong>{trackedForRate ? Math.round((approved / trackedForRate) * 100) : 0}%</strong>
        </div>
        <div className="stat">
          <span>Open applications · blocked</span>
          <strong>
            {open.length} · {blocked}
          </strong>
        </div>
        <div className="stat">
          <span>Needs attention</span>
          <strong>
            <Link href="/credentialing?tab=board&cat=URGENT">{alertCount}</Link>
          </strong>
        </div>
      </section>

      {multi && (
        <section className="panel">
          <h2>By practice</h2>
          <p className="muted">Combined view across {practiceNames.length} selected practices.</p>
          <table>
            <thead>
              <tr>
                <th>Practice</th>
                <th>Providers</th>
                <th>Approved</th>
                <th>Open</th>
                <th>Blocked</th>
                <th>Approval rate</th>
              </tr>
            </thead>
            <tbody>
              {[...byPractice.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([name, r]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{r.providers.size}</td>
                    <td>{r.approved}</td>
                    <td>{r.open}</td>
                    <td>{r.blocked}</td>
                    <td>{r.total ? Math.round((r.approved / r.total) * 100) : 0}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}

      {!multi && (
      <section className="panel">
        <h2>Provider × payer status</h2>
        <p className="muted">Live version of the Credentialing Master sheet — click any cell to open the record.</p>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                {lines.map((l) => (
                  <th key={l.id}>
                    {l.payer.name}
                    <div className="muted" style={{ textTransform: "none" }}>
                      {l.billingProvider.state ?? l.billingProvider.name}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/credentialing/providers/${p.id}`}>{p.name}</Link>
                  </td>
                  {lines.map((l) => {
                    const e = grid.get(`${p.id}:${l.id}`);
                    return (
                      <td key={l.id}>
                        {e ? (
                          <Link href={`/credentialing/enrollments/${e.id}`}>
                            <StatusBadge value={e.status} />
                          </Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      <section className="panel">
        <div className="panel-columns">
          <div className="panel-section">
            <h3>Status by payer</h3>
            <table>
              <thead>
                <tr>
                  <th>Payer</th>
                  <th>Open</th>
                  <th>Blocked</th>
                  <th>Approved</th>
                  <th>Closed / termed</th>
                </tr>
              </thead>
              <tbody>
                {[...byPayer.entries()]
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([name, r]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{r.open}</td>
                      <td>{r.blocked}</td>
                      <td>{r.approved}</td>
                      <td>{r.closed}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="panel-section">
            <h3>Bottlenecks — open applications by reason</h3>
            <table>
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Count</th>
                  <th>Avg days open</th>
                </tr>
              </thead>
              <tbody>
                {[...bottlenecks.entries()]
                  .sort((a, b) => b[1].count - a[1].count)
                  .map(([reason, r]) => (
                    <tr key={reason}>
                      <td>{reason}</td>
                      <td>{r.count}</td>
                      <td>{Math.round(r.totalDays / r.count)}</td>
                    </tr>
                  ))}
                {bottlenecks.size === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">
                      No open applications.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Upcoming expirations &amp; revalidations (next 12 months)</h2>
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Documents expiring</th>
              <th>Revalidations / recredentialing due</th>
            </tr>
          </thead>
          <tbody>
            {[...calendar.entries()]
              .sort((a, b) => (a[0] === "Overdue" ? -1 : b[0] === "Overdue" ? 1 : Date.parse(a[0]) - Date.parse(b[0])))
              .map(([month, r]) => (
                <tr key={month}>
                  <td>{month}</td>
                  <td>{r.documents}</td>
                  <td>{r.revalidations}</td>
                </tr>
              ))}
            {calendar.size === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  Nothing due in the next 12 months.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
