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
  formatDate,
  planSegmentLabel,
  providerDocumentTypeLabel,
} from "@/lib/format";
import { STALE_FOLLOW_UP_DAYS, daysBetween, getCredentialingAlerts } from "@/lib/credentialing";
import { CREDENTIALING_ROLES, credentialingPractices, selectedPracticeIds } from "@/lib/scope";
import { GridTab, ProviderViewTab } from "./grid-tabs";
import {
  bulkSetLineStatus,
  createGroupPayerEnrollment,
  moveEnrollment,
  syncCredentialing,
  updateGroupPayerEnrollment,
} from "./actions";

type SearchParams = Record<string, string | undefined>;

const TABS = [
  { key: "grid", label: "Status grid" },
  { key: "provider", label: "Provider view" },
  { key: "board", label: "Workboard" },
  { key: "attention", label: "Needs attention" },
  { key: "numbers", label: "Provider numbers" },
  { key: "dashboard", label: "Dashboard" },
  { key: "groups", label: "Payer lines setup" },
  { key: "providers", label: "Provider files" },
];

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
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "grid";
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
            {t.key === "attention" && alerts.length > 0 ? ` (${alerts.length})` : ""}
          </Link>
        ))}
      </nav>

      {tab === "grid" && <GridTab practiceIds={practiceIds} sp={sp} multi={multi} />}
      {tab === "provider" && <ProviderViewTab practiceIds={practiceIds} sp={sp} multi={multi} />}
      {tab === "board" && <Workboard practiceIds={practiceIds} userId={user.id} sp={sp} />}
      {tab === "attention" && (
        <NeedsAttention alerts={alerts} userId={user.id} mine={sp.mine === "1"} multi={multi} scopeQuery={scopeQuery} />
      )}
      {tab === "groups" && <Groups practiceIds={practiceIds} />}
      {tab === "providers" && <Providers practiceIds={practiceIds} multi={multi} />}
      {tab === "numbers" && <ProviderNumbers practiceIds={practiceIds} q={sp.q ?? ""} multi={multi} />}
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
        <Link className="btn ghost" href="/credentialing?tab=board">
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

// ---------------------------------------------------------------- Needs attention

function NeedsAttention({
  alerts,
  userId,
  mine,
  multi,
  scopeQuery,
}: {
  alerts: Awaited<ReturnType<typeof getCredentialingAlerts>>;
  userId: string;
  mine: boolean;
  multi: boolean;
  scopeQuery: string;
}) {
  const shown = mine ? alerts.filter((a) => a.assignedToId === userId) : alerts;
  const kinds = [
    { key: "SCREENING", label: "Exclusion screening (30-day cycle)" },
    { key: "DOCUMENT", label: "Expiring documents" },
    { key: "FOLLOW_UP", label: "Follow-ups due" },
    { key: "STALE", label: `No activity in ${STALE_FOLLOW_UP_DAYS}+ days` },
    { key: "REVALIDATION", label: "Revalidation / recredentialing" },
  ];

  return (
    <section className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
        <h2 style={{ margin: 0 }}>Needs attention</h2>
        <nav className="view-tabs">
          <Link className={`view-tab${mine ? "" : " active"}`} href={`/credentialing?tab=attention${scopeQuery}`}>
            Everything
          </Link>
          <Link className={`view-tab${mine ? " active" : ""}`} href={`/credentialing?tab=attention&mine=1${scopeQuery}`}>
            Assigned to me
          </Link>
        </nav>
      </div>
      {shown.length === 0 && <p className="muted">Nothing needs attention right now.</p>}
      {kinds.map((k) => {
        const items = shown.filter((a) => a.kind === k.key);
        if (items.length === 0) return null;
        return (
          <div key={k.key} className="panel-section">
            <h3>
              {k.label} ({items.length})
            </h3>
            <table>
              <tbody>
                {items.map((a) => (
                  <tr key={a.key}>
                    <td style={{ width: "6rem" }}>
                      <span className={`badge ${a.severity === "high" ? "badge-denied" : "badge-submitted"}`}>
                        {a.severity === "high" ? "Urgent" : "Soon"}
                      </span>
                    </td>
                    <td>
                      <Link href={a.href}>{a.title}</Link>
                      <div className="muted">
                        {multi ? `${a.practiceName} · ` : ""}
                        {a.detail}
                      </div>
                    </td>
                    <td className="muted" style={{ width: "8rem" }}>
                      {a.dueDate ? formatDate(a.dueDate) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
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
            {bp.practice.name !== bp.name && <span className="muted"> · {bp.practice.name}</span>}
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
                      <Link href={`/credentialing?tab=board&group=${bp.id}&payer=${e.payerId}`}>
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
                    </option>
                  ))}
              </select>
            </label>
            <label>
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

// ---------------------------------------------------------------- Providers

async function Providers({ practiceIds, multi }: { practiceIds: string[]; multi: boolean }) {
  const practiceId = { in: practiceIds };
  const now = new Date();
  const providers = await prisma.renderingProvider.findMany({
    where: { practiceId, isRendering: true },
    include: {
      practice: true,
      enrollments: { select: { status: true } },
      documents: { where: { supersededAt: null }, orderBy: { expiryDate: "asc" } },
      verificationChecks: { orderBy: { checkedAt: "desc" } },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return (
    <section className="panel">
      <h2>Provider credentialing files</h2>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            {multi && <th>Practice</th>}
            <th>NPI</th>
            <th>Enrollments</th>
            <th>Documents on file</th>
            <th>Next expiry</th>
            <th>Last OIG / SAM screen</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => {
            const approved = p.enrollments.filter((e) => ACTIVE_ENROLLMENT_STATUSES.includes(e.status)).length;
            const open = p.enrollments.filter((e) => OPEN_ENROLLMENT_STATUSES.includes(e.status)).length;
            const nextExpiry = p.documents.find((d) => d.expiryDate);
            const lastOig = p.verificationChecks.find((c) => c.source === "OIG_LEIE");
            const lastSam = p.verificationChecks.find((c) => c.source === "SAM");
            return (
              <tr key={p.id}>
                <td>
                  <Link href={`/credentialing/providers/${p.id}`}>
                    {p.name}
                    {p.credential ? `, ${p.credential}` : ""}
                  </Link>
                </td>
                {multi && <td>{p.practice.name}</td>}
                <td>{p.npi ?? "—"}</td>
                <td>
                  {approved} approved · {open} open
                </td>
                <td>{p.documents.length}</td>
                <td>
                  {nextExpiry?.expiryDate ? (
                    <>
                      {providerDocumentTypeLabel[nextExpiry.type]} {formatDate(nextExpiry.expiryDate)}
                      {daysBetween(now, nextExpiry.expiryDate) <= 90 && (
                        <div className="muted">in {daysBetween(now, nextExpiry.expiryDate)} days</div>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {lastOig ? formatDate(lastOig.checkedAt) : "Never"} / {lastSam ? formatDate(lastSam.checkedAt) : "Never"}
                </td>
                <td>
                  <StatusBadge value={p.status} />
                </td>
              </tr>
            );
          })}
          {providers.length === 0 && (
            <tr>
              <td colSpan={multi ? 8 : 7} className="muted">
                No rendering providers yet — add them in Directories.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------- Provider-number directory

async function ProviderNumbers({ practiceIds, q, multi }: { practiceIds: string[]; q: string; multi: boolean }) {
  const practiceId = { in: practiceIds };
  const rows = await prisma.providerEnrollment.findMany({
    where: {
      renderingProvider: { practiceId },
      status: { in: ACTIVE_ENROLLMENT_STATUSES },
    },
    include: {
      renderingProvider: { include: { practice: true } },
      groupPayerEnrollment: { include: { payer: true, billingProvider: true } },
    },
    orderBy: [{ renderingProvider: { name: "asc" } }],
  });
  const needle = q.toLowerCase();
  const shown = needle
    ? rows.filter((r) =>
        [r.renderingProvider.name, r.renderingProvider.npi, r.groupPayerEnrollment.payer.name, r.payerProviderId]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(needle))
      )
    : rows;

  return (
    <section className="panel">
      <h2>Provider-number directory</h2>
      <p className="muted">
        Every payer where a provider is actively enrolled, with the payer-assigned number (PTAN, provider ID) —
        the single place billing and eligibility look this up.
      </p>
      <form method="get" className="schedule-filters">
        <input type="hidden" name="tab" value="numbers" />
        {multi && <input type="hidden" name="p" value={practiceIds.join(",")} />}
        <label>
          Search provider, NPI, payer or number
          <input name="q" defaultValue={q} />
        </label>
        <button className="btn secondary" type="submit">
          Search
        </button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            {multi && <th>Practice</th>}
            <th>Payer</th>
            <th>Group / state</th>
            <th>Payer provider #</th>
            <th>Effective</th>
            <th>Term</th>
            <th>Approval letter</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/credentialing/enrollments/${r.id}`}>{r.renderingProvider.name}</Link>
                <div className="muted">NPI {r.renderingProvider.npi ?? "—"}</div>
              </td>
              {multi && <td>{r.renderingProvider.practice.name}</td>}
              <td>
                {r.groupPayerEnrollment.payer.name}
                <div className="muted">{planSegmentLabel[r.groupPayerEnrollment.planSegment]}</div>
                {r.status === "FOLLOWS_PARENT" && <div className="muted">Follows parent payer</div>}
              </td>
              <td>
                {r.groupPayerEnrollment.billingProvider.name}
                {r.state ? ` · ${r.state}` : ""}
              </td>
              <td>{r.payerProviderId ?? <span className="muted">Not captured</span>}</td>
              <td>{r.effectiveDate ? formatDate(r.effectiveDate) : "—"}</td>
              <td>{r.termDate ? formatDate(r.termDate) : "—"}</td>
              <td>
                {r.approvalLetterPath ? (
                  <a href={`/api/files/approval/${r.id}`} target="_blank" rel="noreferrer">
                    View
                  </a>
                ) : (
                  <span className="muted">Not uploaded</span>
                )}
              </td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={multi ? 8 : 7} className="muted">
                No active enrollments match.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
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
            <Link href="/credentialing?tab=attention">{alertCount}</Link>
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
