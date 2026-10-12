import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { requireUser } from "@/lib/auth";
import { daysBetween, networkStatusForPayer, type NetworkStatus } from "@/lib/credentialing";
import { ageFromDob, formatDate, formatTime, patientName } from "@/lib/format";
import {
  CONSENTS,
  authStatusLabel,
  canWorkTeam,
  careStatusLabel,
  consentsSigned,
  dataEntryGaps,
  eligibilityStatusLabel,
  intakeStageLabel,
  referralAppStatusLabel,
  referralSourceTypeLabel,
  referralStatusLabel,
  schedulingGaps,
  teamStages,
  verificationGaps,
  vobDecisionShort,
  vobDecisionTone,
  DEFAULT_CARE_STATUS,
  type BoardColumn,
  type GatewayTeam,
} from "@/lib/gateway";
import { suggestionsForCases, type RouteSuggestion } from "@/lib/vob";
import { takeCase } from "./actions";

type User = Awaited<ReturnType<typeof requireUser>>;

export type GatewaySearch = {
  view?: string;
  // VOB and Patient care boards: "table" for the grouped table; Kanban otherwise.
  layout?: string;
  q?: string;
  by?: string;
  mine?: string;
  urgent?: string;
  stage?: string;
  care?: string;
  payer?: string;
  referrer?: string;
  provider?: string;
  source?: string;
  sex?: string;
  inactive?: string;
};

const NOT_BOOKED = ["CANCELLED", "NO_SHOW"];
const AUTH_EXPIRY_WARN_DAYS = 14;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function Tag({ tone, children }: { tone: "ok" | "warn" | "bad" | "info" | "muted"; children: React.ReactNode }) {
  return <span className={`gw-tag gw-tag-${tone}`}>{children}</span>;
}

export function NetworkTag({ status }: { status: NetworkStatus | undefined }) {
  if (!status) return <Tag tone="muted">No provider</Tag>;
  if (status.network === "IN_NETWORK") return <Tag tone="ok">In network</Tag>;
  if (status.network === "PENDING") return <Tag tone="warn">Credentialing pending</Tag>;
  return <Tag tone="bad">Not credentialed</Tag>;
}

export function eligibilityTone(status: string) {
  return status === "ACTIVE" || status === "SELF_PAY" ? "ok" : status === "PENDING" ? "warn" : "bad";
}

export function authTone(status: string) {
  return status === "APPROVED" || status === "NOT_REQUIRED" ? "ok" : status === "DENIED" ? "bad" : "warn";
}

const SUGGEST_TAG: Record<RouteSuggestion["kind"], ["ok" | "warn" | "bad" | "muted", string]> = {
  TAKE_DIRECT: ["ok", "Take directly"],
  SEND_TO_VOB: ["warn", "Send to VOB"],
  DECLINE: ["bad", "Likely not accepted"],
  NOT_READY: ["muted", "Check eligibility first"],
};

export function SuggestionTag({ suggestion }: { suggestion: RouteSuggestion | undefined }) {
  if (!suggestion) return null;
  const [tone, label] = SUGGEST_TAG[suggestion.kind];
  return (
    <span title={[suggestion.headline, ...suggestion.reasons].join(" ")}>
      <Tag tone={tone}>
        {suggestion.kind === "TAKE_DIRECT" && suggestion.scope === "APPROVED_LIMITED"
          ? "Take directly · E&M + debridement"
          : suggestion.kind === "NOT_READY" && !suggestion.stats
            ? "Add insurance first"
            : label}
      </Tag>
    </span>
  );
}

export function SexMark({ sex }: { sex: string }) {
  return (
    <span className="gw-sex" aria-label={sex === "F" ? "Female" : sex === "M" ? "Male" : sex}>
      {sex === "F" ? "♀" : sex === "M" ? "♂" : "⚥"}
    </span>
  );
}

// Credentialing status of every rendering provider for each payer/segment pair, fetched once per pair.
async function networkLookup(practiceId: string, pairs: { payerId: string | null; planSegment: string | null }[]) {
  const map = new Map<string, NetworkStatus[]>();
  for (const pair of pairs) {
    if (!pair.payerId) continue;
    const key = `${pair.payerId}|${pair.planSegment ?? ""}`;
    if (!map.has(key)) map.set(key, await networkStatusForPayer(practiceId, pair.payerId, pair.planSegment));
  }
  return (payerId: string | null, planSegment: string | null, providerId: string | null) =>
    payerId && providerId
      ? map.get(`${payerId}|${planSegment ?? ""}`)?.find((n) => n.providerId === providerId)
      : undefined;
}

async function nextAppointments(practiceId: string, patientIds: string[]) {
  const appts = await prisma.appointment.findMany({
    where: { practiceId, patientId: { in: patientIds }, startsAt: { gte: startOfToday() }, status: { notIn: NOT_BOOKED } },
    include: { provider: true },
    orderBy: { startsAt: "asc" },
  });
  const map = new Map<string, (typeof appts)[number]>();
  for (const a of appts) if (!map.has(a.patientId)) map.set(a.patientId, a);
  return map;
}

// ---------------------------------------------------------------- Team queues

export async function TeamQueueTab({
  team,
  tabKey,
  user,
  sp,
}: {
  team: GatewayTeam;
  tabKey: string;
  user: User;
  sp: GatewaySearch;
}) {
  const stages = teamStages[team];
  const defaultStages = stages.filter((s) => s !== "SCHEDULED");
  const stageFilter = sp.stage && stages.includes(sp.stage) ? [sp.stage] : defaultStages;
  const q = sp.q?.trim();

  const where: Prisma.IntakeCaseWhereInput = {
    practiceId: user.practiceId,
    stage: { in: stageFilter },
    ...(sp.mine ? { ownerId: user.id } : {}),
    ...(sp.urgent ? { priority: "URGENT" } : {}),
    ...(sp.care ? { careStatus: sp.care } : {}),
    ...(q
      ? {
          patient: {
            OR: [{ lastName: { contains: q, mode: "insensitive" } }, { firstName: { contains: q, mode: "insensitive" } }, { mrn: { contains: q, mode: "insensitive" } }],
          },
        }
      : {}),
  };

  const cases = await prisma.intakeCase.findMany({
    where,
    include: { patient: true, payer: true, assignedProvider: true, owner: true },
    orderBy: [{ priority: "desc" }, { stageChangedAt: "asc" }],
  });
  const now = new Date();
  const network = team === "VERIFICATION" ? await networkLookup(user.practiceId, cases) : null;
  const appts = team === "SCHEDULING" ? await nextAppointments(user.practiceId, cases.map((c) => c.patientId)) : null;
  const canWork = canWorkTeam(user.role, team);
  const suggestions = team === "DATA_ENTRY" ? await suggestionsForCases(user.practiceId, cases.map((c) => ({ ...c, payerName: c.payer?.name }))) : null;

  return (
    <>
      <form method="get" className="panel compact-filters gw-filters">
        <input type="hidden" name="view" value={tabKey} />
        <input name="q" defaultValue={q} placeholder="Patient name or MRN" aria-label="Search" />
        {stages.length > 1 && (
          <select name="stage" defaultValue={sp.stage ?? ""} aria-label="Stage">
            <option value="">{team === "SCHEDULING" ? "Ready to schedule" : "All open"}</option>
            {stages.map((s) => (
              <option key={s} value={s}>
                {intakeStageLabel[s]}
              </option>
            ))}
          </select>
        )}
        {team === "SCHEDULING" && (
          <select name="care" defaultValue={sp.care ?? ""} aria-label="Care status">
            <option value="">Any care status</option>
            {Object.entries(careStatusLabel).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        )}
        <label className="checkbox-inline">
          <input type="checkbox" name="mine" value="1" defaultChecked={Boolean(sp.mine)} /> My cases
        </label>
        <label className="checkbox-inline">
          <input type="checkbox" name="urgent" value="1" defaultChecked={Boolean(sp.urgent)} /> Urgent only
        </label>
        <button className="btn secondary" type="submit">
          Filter
        </button>
        <Link className="btn ghost" href={`/?view=${tabKey}`}>
          Clear
        </Link>
      </form>

      <section className="panel gw-table">
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              {team === "DATA_ENTRY" && (
                <>
                  <th>Referral</th>
                  <th>Insurance</th>
                  <th>Checklist</th>
                  <th>Suggested route</th>
                </>
              )}
              {team === "VERIFICATION" && (
                <>
                  <th>Payer / member</th>
                  <th>Eligibility</th>
                  <th>Prior auth</th>
                  <th>Referral (PCC)</th>
                  <th>Rendering provider</th>
                </>
              )}
              {team === "SCHEDULING" && (
                <>
                  <th>Payer / auth</th>
                  <th>Consents</th>
                  <th>Referral application</th>
                  <th>Next appointment</th>
                  <th>Care status</th>
                </>
              )}
              <th>Stage</th>
              <th>Owner</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              const days = daysBetween(c.stageChangedAt, now);
              const next = appts?.get(c.patientId);
              const authExpiring =
                c.authStatus === "APPROVED" && c.authEndDate && daysBetween(now, c.authEndDate) <= AUTH_EXPIRY_WARN_DAYS;
              return (
                <tr key={c.id} className={c.priority === "URGENT" ? "gw-row-urgent" : undefined}>
                  <td>
                    <Link href={`/gateway/${c.id}`}>
                      <strong>{patientName(c.patient)}</strong>
                    </Link>
                    <div className="muted">
                      {c.patient.mrn} · {ageFromDob(c.patient.dob)}y {c.patient.sex} · DOB {formatDate(c.patient.dob)}
                    </div>
                    {c.priority === "URGENT" && <Tag tone="bad">Urgent</Tag>}
                  </td>

                  {team === "DATA_ENTRY" && (
                    <>
                      <td>
                        {c.referralSourceName ?? <span className="muted">—</span>}
                        <div className="muted">
                          {c.referralSourceType ? referralSourceTypeLabel[c.referralSourceType] : "Source type —"}
                          {c.referralDate ? ` · ${formatDate(c.referralDate)}` : ""}
                        </div>
                      </td>
                      <td>
                        {c.payer?.name ?? (c.eligibilityStatus === "SELF_PAY" ? "Self-pay" : <span className="muted">—</span>)}
                        {c.memberId && <div className="muted">{c.memberId}</div>}
                      </td>
                      <td>
                        {(() => {
                          const gaps = dataEntryGaps(c.patient, c);
                          if (c.infoRequestedAt) return <Tag tone="warn">Waiting on {c.infoRequestedFrom}</Tag>;
                          if (gaps.length) return <Tag tone="warn">{gaps.join(", ")}</Tag>;
                          return c.dataVerifiedAt ? <Tag tone="ok">Verified — ready to hand off</Tag> : <Tag tone="info">Needs manual verification</Tag>;
                        })()}
                      </td>
                      <td>
                        <SuggestionTag suggestion={suggestions?.get(c.id)} />
                      </td>
                    </>
                  )}

                  {team === "VERIFICATION" && (
                    <>
                      <td>
                        {c.payer?.name ?? "—"}
                        <div className="muted">{c.memberId ?? "No member ID"}</div>
                      </td>
                      <td>
                        <Tag tone={eligibilityTone(c.eligibilityStatus)}>{eligibilityStatusLabel[c.eligibilityStatus]}</Tag>
                        {c.verifiedAt && <div className="muted">{formatDate(c.verifiedAt)}</div>}
                      </td>
                      <td>
                        {c.authRequired === "UNKNOWN" ? (
                          <Tag tone="warn">Not determined</Tag>
                        ) : (
                          <Tag tone={authTone(c.authStatus)}>{authStatusLabel[c.authStatus]}</Tag>
                        )}
                        {c.authNumber && <div className="muted">#{c.authNumber}</div>}
                      </td>
                      <td>
                        {c.referralRequired === "UNKNOWN" ? (
                          <Tag tone="warn">Not determined</Tag>
                        ) : (
                          <Tag tone={["NOT_REQUIRED", "RECEIVED"].includes(c.referralStatus) ? "ok" : "warn"}>
                            {referralStatusLabel[c.referralStatus]}
                          </Tag>
                        )}
                      </td>
                      <td>
                        {c.assignedProvider?.name ?? <span className="muted">Unassigned</span>}
                        <div>
                          {c.assignedProvider && (
                            <NetworkTag status={network?.(c.payerId, c.planSegment, c.assignedProviderId)} />
                          )}
                        </div>
                      </td>
                    </>
                  )}

                  {team === "SCHEDULING" && (
                    <>
                      <td>
                        {c.payer?.name ?? "Self-pay"}
                        {c.vobDecision && (
                          <div>
                            <Tag tone={vobDecisionTone(c.vobDecision)}>{vobDecisionShort[c.vobDecision]}</Tag>
                          </div>
                        )}
                        <div className="muted">
                          {c.authStatus === "APPROVED"
                            ? `Auth #${c.authNumber}${c.authEndDate ? ` · thru ${formatDate(c.authEndDate)}` : ""}`
                            : authStatusLabel[c.authStatus]}
                        </div>
                        {authExpiring && <Tag tone="bad">Auth expiring</Tag>}
                      </td>
                      <td>
                        <Tag tone={consentsSigned(c) === CONSENTS.length ? "ok" : "warn"}>
                          {consentsSigned(c)}/{CONSENTS.length} signed
                        </Tag>
                      </td>
                      <td>
                        <Tag tone={["COMPLETE", "NOT_NEEDED"].includes(c.referralAppStatus) ? "ok" : "warn"}>
                          {referralAppStatusLabel[c.referralAppStatus]}
                        </Tag>
                      </td>
                      <td>
                        {next ? (
                          <>
                            {formatDate(next.startsAt)} {formatTime(next.startsAt)}
                            <div className="muted">{next.provider.name}</div>
                          </>
                        ) : (
                          <span className="muted">Not booked</span>
                        )}
                      </td>
                      <td>{c.careStatus ? careStatusLabel[c.careStatus] : <span className="muted">—</span>}</td>
                    </>
                  )}

                  <td>
                    <span className={`gw-stage gw-stage-${c.stage.toLowerCase()}`}>{intakeStageLabel[c.stage]}</span>
                    {team === "VERIFICATION" && c.vobDecision === "HOLD" && (
                      <div>
                        <Tag tone="warn">{c.stage === "VERIFICATION" ? "Hold cleared — decide" : "On hold"}</Tag>
                      </div>
                    )}
                    <div className={days > 3 && c.stage !== "SCHEDULED" ? "gw-stale" : "muted"}>{days}d in stage</div>
                  </td>
                  <td>
                    {c.owner?.name ?? <span className="muted">Unassigned</span>}
                    {canWork && c.ownerId !== user.id && (
                      <form action={takeCase.bind(null, c.id)}>
                        <button className="btn ghost gw-mini" type="submit">
                          Take
                        </button>
                      </form>
                    )}
                  </td>
                  <td>
                    <Link className="btn secondary gw-mini" href={`/gateway/${c.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })}
            {cases.length === 0 && (
              <tr>
                <td colSpan={11} className="muted">
                  Queue is clear.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- VOB and Patient care boards

// How many patients each status shows: a Kanban column keeps to a screenful; the table lists far more. Both always
// show the full count, and long-running statuses (Discharged, Unable to see) list their most recent cases first.
const BOARD_COLUMN_LIMIT = 50;
const TABLE_GROUP_LIMIT = 500;
// Table groups larger than this start collapsed, so a long Discharged list doesn't bury the open work.
const TABLE_GROUP_OPEN_MAX = 100;

export type BoardLayout = "kanban" | "table";

// A view-only board of a team's statuses: one column (Kanban) or one group (table) per stage — or, for scheduled
// patients, per patient care status. Every patient opens their case, where the status is changed. "Ready to
// schedule" and "Unable to see" appear on both the VOB and the Patient care board.
export async function StatusBoard({
  user,
  columns,
  title,
  layout,
  viewHref,
}: {
  user: User;
  columns: BoardColumn[];
  title: string;
  layout: BoardLayout;
  // The board's own address (e.g. "/?view=vob"); the layout switcher adds &layout=… to it.
  viewHref: string;
}) {
  const careWhere = (col: BoardColumn): Prisma.IntakeCaseWhereInput =>
    !col.careStatus
      ? {}
      : col.careStatus === DEFAULT_CARE_STATUS
        ? { OR: [{ careStatus: col.careStatus }, { careStatus: null }, { careStatus: { notIn: Object.keys(careStatusLabel) } }] }
        : { careStatus: col.careStatus };
  const where = (col: BoardColumn): Prisma.IntakeCaseWhereInput => ({ practiceId: user.practiceId, stage: col.stage, ...careWhere(col) });

  const filled = await Promise.all(
    columns.map(async (col) => {
      const [cases, total] = await Promise.all([
        prisma.intakeCase.findMany({
          where: where(col),
          include: { patient: true, payer: true, owner: true },
          // Open work oldest-first (what has waited longest); finished statuses newest-first.
          orderBy:
            col.careStatus === "DISCHARGED" || col.stage === "UNABLE_TO_SEE"
              ? [{ stageChangedAt: "desc" }]
              : [{ priority: "desc" }, { stageChangedAt: "asc" }],
          take: layout === "table" ? TABLE_GROUP_LIMIT : BOARD_COLUMN_LIMIT,
        }),
        prisma.intakeCase.count({ where: where(col) }),
      ]);
      return { col, cases, total };
    })
  );
  const now = new Date();
  // What's holding a case up: the open checklist items, or why the patient can't be seen.
  const notes = (c: (typeof filled)[number]["cases"][number]) =>
    c.stage === "UNABLE_TO_SEE"
      ? c.closedReason
        ? [c.closedReason]
        : []
      : ["VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL"].includes(c.stage)
        ? verificationGaps(c)
        : c.stage === "SCHEDULING"
          ? schedulingGaps(c)
          : [];

  return (
    <section className="status-board-wrap" aria-label={title}>
      <div className="status-board-bar">
        <p className="muted status-board-hint">Click a patient to open the case; the status is changed there.</p>
        <nav className="view-switch" aria-label="Layout">
          <Link href={viewHref} className={layout === "kanban" ? "active" : undefined} aria-current={layout === "kanban" ? "page" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="5" height="16" rx="1.5" />
              <rect x="10" y="4" width="5" height="11" rx="1.5" />
              <rect x="17" y="4" width="4" height="7" rx="1.5" />
            </svg>
            Kanban
          </Link>
          <Link href={`${viewHref}&layout=table`} className={layout === "table" ? "active" : undefined} aria-current={layout === "table" ? "page" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Table
          </Link>
        </nav>
      </div>

      {layout === "kanban" ? (
        <div className="board gw-board status-board">
          {filled.map(({ col, cases, total }) => (
            <section key={col.key} className="board-col" style={{ "--col-tone": col.tone } as React.CSSProperties}>
              <header>
                <strong>{col.label}</strong>
                <span className="pill">{total}</span>
              </header>
              {cases.length === 0 && <p className="muted status-board-empty">Nothing here</p>}
              {cases.map((c) => {
                const holdUps = notes(c);
                return (
                  <Link key={c.id} href={`/gateway/${c.id}`} className={`board-card${c.priority === "URGENT" ? " board-card-alert" : ""}`}>
                    <strong>{patientName(c.patient)}</strong>
                    <div>{c.payer?.name ?? "No insurance yet"}</div>
                    <div className="muted">
                      {c.patient.mrn} · {c.referralSourceName ?? "No referral source"}
                    </div>
                    {holdUps.length > 0 && <div className="board-card-reason">{holdUps.join(" · ")}</div>}
                    <div className="board-card-foot">
                      <span>{daysBetween(c.stageChangedAt, now)}d in status</span>
                      <span>{c.owner?.name ?? "Unassigned"}</span>
                    </div>
                  </Link>
                );
              })}
              {total > cases.length && <p className="muted status-board-more">Showing the latest {cases.length} of {total}</p>}
            </section>
          ))}
        </div>
      ) : (
        <div className="status-table">
          {filled.map(({ col, cases, total }) => (
            <details key={col.key} className="status-table-group" style={{ "--col-tone": col.tone } as React.CSSProperties} open={total > 0 && total <= TABLE_GROUP_OPEN_MAX}>
              <summary>
                <svg className="status-table-chev" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
                <strong>{col.label}</strong>
                <span className="status-table-count">
                  {total} {total === 1 ? "patient" : "patients"}
                </span>
              </summary>
              {cases.length === 0 ? (
                <p className="muted status-table-empty">No patients in this status.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Patient</th>
                        <th>Insurance</th>
                        <th>Referral source</th>
                        <th>Waiting on</th>
                        <th>In status</th>
                        <th>Owner</th>
                        <th aria-label="Open" />
                      </tr>
                    </thead>
                    <tbody>
                      {cases.map((c) => {
                        const holdUps = notes(c);
                        return (
                          <tr key={c.id}>
                            <td>
                              <Link href={`/gateway/${c.id}`} className="status-table-patient">
                                {patientName(c.patient)}
                              </Link>
                              <div className="muted">
                                {c.patient.mrn}
                                {c.patient.dob ? ` · ${ageFromDob(c.patient.dob)}y` : ""}
                                {c.patient.sex ? ` ${c.patient.sex}` : ""}
                              </div>
                              {c.priority === "URGENT" && <Tag tone="bad">Urgent</Tag>}
                            </td>
                            <td>{c.payer?.name ?? <span className="muted">No insurance yet</span>}</td>
                            <td>{c.referralSourceName ?? <span className="muted">—</span>}</td>
                            <td>{holdUps.length ? <span className="status-table-hold">{holdUps.join(" · ")}</span> : <span className="muted">—</span>}</td>
                            <td>{daysBetween(c.stageChangedAt, now)}d</td>
                            <td>{c.owner?.name ?? <span className="muted">Unassigned</span>}</td>
                            <td>
                              <Link className="btn secondary gw-mini" href={`/gateway/${c.id}`}>
                                Open
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {total > cases.length && <p className="muted status-table-more">Showing the latest {cases.length} of {total}.</p>}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
