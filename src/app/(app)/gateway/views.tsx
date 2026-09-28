import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { requireUser } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { daysBetween, networkStatusForPayer, type NetworkStatus } from "@/lib/credentialing";
import { ageFromDob, formatDate, formatMoney, formatTime, patientName } from "@/lib/format";
import {
  CONSENTS,
  OPEN_INTAKE_STAGES,
  authStatusLabel,
  canWorkTeam,
  careStatusLabel,
  consentsSigned,
  dataEntryGaps,
  eligibilityStatusLabel,
  intakeStageLabel,
  patientSearchByLabel,
  referralAppStatusLabel,
  referralSourceTypeLabel,
  referralStatusLabel,
  schedulingGaps,
  teamStages,
  verificationGaps,
  type GatewayTeam,
} from "@/lib/gateway";
import { startIntake, takeCase } from "./actions";

type User = Awaited<ReturnType<typeof requireUser>>;

export type GatewaySearch = {
  tab?: string;
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
            OR: [{ lastName: { contains: q } }, { firstName: { contains: q } }, { mrn: { contains: q } }],
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

  return (
    <>
      <form method="get" className="panel compact-filters gw-filters">
        <input type="hidden" name="tab" value={tabKey} />
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
        <Link className="btn ghost" href={`/?tab=${tabKey}`}>
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
                  <th>Missing before hand-off</th>
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
                          return gaps.length ? <Tag tone="warn">{gaps.join(", ")}</Tag> : <Tag tone="ok">Ready</Tag>;
                        })()}
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
                <td colSpan={10} className="muted">
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

// ---------------------------------------------------------------- Pipeline board

export async function BoardTab({ user }: { user: User }) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const cases = await prisma.intakeCase.findMany({
    where: {
      practiceId: user.practiceId,
      OR: [{ stage: { in: OPEN_INTAKE_STAGES } }, { stage: "SCHEDULED", stageChangedAt: { gte: since } }],
    },
    include: { patient: true, payer: true, owner: true },
    orderBy: [{ priority: "desc" }, { stageChangedAt: "asc" }],
  });
  const now = new Date();

  return (
    <div className="board gw-board">
      {[...OPEN_INTAKE_STAGES, "SCHEDULED"].map((stage) => {
        const cards = cases.filter((c) => c.stage === stage);
        return (
          <section key={stage} className="board-col">
            <header>
              <strong>{intakeStageLabel[stage]}</strong>
              <span className="pill">{cards.length}</span>
            </header>
            {cards.map((c) => {
              const gaps =
                stage === "DATA_ENTRY"
                  ? dataEntryGaps(c.patient, c)
                  : ["VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL"].includes(stage)
                    ? verificationGaps(c)
                    : stage === "SCHEDULING"
                      ? schedulingGaps(c)
                      : [];
              return (
                <article key={c.id} className={`board-card${c.priority === "URGENT" ? " board-card-alert" : ""}`}>
                  <Link href={`/gateway/${c.id}`}>
                    <strong>{patientName(c.patient)}</strong>
                    <div>{c.payer?.name ?? "No insurance yet"}</div>
                  </Link>
                  <div className="muted">
                    {c.patient.mrn} · {c.referralSourceName ?? "No referral source"}
                  </div>
                  {gaps.length > 0 && <div className="board-card-reason">{gaps.join(" · ")}</div>}
                  {stage === "SCHEDULED" && c.careStatus && <div className="muted">{careStatusLabel[c.careStatus]}</div>}
                  <div className="board-card-foot">
                    <span>{daysBetween(c.stageChangedAt, now)}d in stage</span>
                    <span>{c.owner?.name ?? "Unassigned"}</span>
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Patient registry

function parseDob(value: string) {
  const us = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const [y, m, d] = us ? [us[3], us[1], us[2]] : iso ? [iso[1], iso[2], iso[3]] : [];
  if (!y) return null;
  const start = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(start.getTime())) return null;
  // Dates of birth are stored as UTC midnight.
  return { gte: start, lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export async function RegistryTab({ user, sp }: { user: User; sp: GatewaySearch }) {
  const q = sp.q?.trim() ?? "";
  const by = sp.by && sp.by in patientSearchByLabel ? sp.by : "lastName";

  const and: Prisma.PatientWhereInput[] = [{ practiceId: user.practiceId }];
  if (!sp.inactive) and.push({ status: { notIn: ["INACTIVE", "DECEASED"] } });
  if (q) {
    if (by === "dob") {
      const range = parseDob(q);
      and.push(range ? { dob: { gte: range.gte, lt: range.lt } } : { id: "__none__" });
    } else if (by === "memberId") {
      and.push({ insurances: { some: { memberId: { contains: q } } } });
    } else if (by === "phone") {
      and.push({ phone: { contains: q.replace(/[^\d-]/g, "") || q } });
    } else {
      and.push({ [by]: { contains: q } });
    }
  }
  if (sp.sex) and.push({ sex: sp.sex });
  if (sp.referrer) and.push({ referringPhysicianId: sp.referrer });
  if (sp.payer) and.push({ insurances: { some: { payerId: sp.payer } } });
  const caseFilter: Prisma.IntakeCaseWhereInput = {
    ...(sp.stage && sp.stage !== "NONE" ? { stage: sp.stage } : {}),
    ...(sp.care ? { careStatus: sp.care } : {}),
    ...(sp.provider ? { assignedProviderId: sp.provider } : {}),
    ...(sp.source ? { referralSourceType: sp.source } : {}),
  };
  if (sp.stage === "NONE") and.push({ intakeCases: { none: {} } });
  else if (Object.keys(caseFilter).length) and.push({ intakeCases: { some: caseFilter } });

  const [patients, payers, referrers, providers] = await Promise.all([
    prisma.patient.findMany({
      where: { AND: and },
      include: {
        insurances: { include: { payer: true } },
        referringPhysician: true,
        intakeCases: { orderBy: { createdAt: "desc" }, take: 1, include: { assignedProvider: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 200,
    }),
    prisma.payer.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { name: "asc" } }),
    prisma.renderingProvider.findMany({
      where: { practiceId: user.practiceId, isReferring: true },
      orderBy: { name: "asc" },
    }),
    prisma.renderingProvider.findMany({
      where: { practiceId: user.practiceId, isRendering: true, status: "ACTIVE" },
      orderBy: { name: "asc" },
    }),
  ]);
  const canEdit = ["ADMIN", "FRONT_DESK", "INTAKE", "VERIFICATION"].includes(user.role);
  const canIntake = canWorkTeam(user.role, "DATA_ENTRY");

  return (
    <>
      <form method="get" className="panel gw-search">
        <input type="hidden" name="tab" value="registry" />
        <div className="gw-search-main">
          <label>
            Search by
            <select name="by" defaultValue={by}>
              {Object.entries(patientSearchByLabel).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="gw-search-q">
            Search
            <input name="q" defaultValue={q} placeholder="e.g. Vasquez · CH-100241 · 04/12/1978 · 555-0142" />
          </label>
          <button className="btn" type="submit">
            Search
          </button>
          <Link className="btn ghost" href="/?tab=registry">
            Clear
          </Link>
        </div>
        <details className="gw-more-filters" open={Boolean(sp.stage || sp.care || sp.payer || sp.referrer || sp.provider || sp.source || sp.sex)}>
          <summary>More filters</summary>
          <div className="gw-filter-grid">
            <label>
              Gateway stage
              <select name="stage" defaultValue={sp.stage ?? ""}>
                <option value="">Any</option>
                {Object.entries(intakeStageLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
                <option value="NONE">No gateway case</option>
              </select>
            </label>
            <label>
              Care status
              <select name="care" defaultValue={sp.care ?? ""}>
                <option value="">Any</option>
                {Object.entries(careStatusLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Insurance
              <select name="payer" defaultValue={sp.payer ?? ""}>
                <option value="">Any</option>
                {payers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Referring physician
              <select name="referrer" defaultValue={sp.referrer ?? ""}>
                <option value="">Any</option>
                {referrers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rendering provider
              <select name="provider" defaultValue={sp.provider ?? ""}>
                <option value="">Any</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Referral source
              <select name="source" defaultValue={sp.source ?? ""}>
                <option value="">Any</option>
                {Object.entries(referralSourceTypeLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sex
              <select name="sex" defaultValue={sp.sex ?? ""}>
                <option value="">Any</option>
                <option value="F">Female</option>
                <option value="M">Male</option>
                <option value="X">Other</option>
              </select>
            </label>
          </div>
        </details>
        <label className="checkbox-inline">
          <input type="checkbox" name="inactive" value="1" defaultChecked={Boolean(sp.inactive)} /> Show inactive patients
        </label>
      </form>

      <section className="panel gw-table">
        <p className="muted" style={{ margin: "0 0 0.5rem" }}>
          {patients.length === 200 ? "Showing first 200 matches — refine the search" : `${patients.length} patient(s)`}
        </p>
        <table>
          <thead>
            <tr>
              <th />
              <th>Patient</th>
              <th>Phone</th>
              <th>Insurance</th>
              <th>Referral</th>
              <th>Gateway</th>
              <th>Account</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {patients.map((p) => {
              const c = p.intakeCases[0];
              const primary = p.insurances.find((i) => i.isPrimary) ?? p.insurances[0];
              return (
                <tr key={p.id}>
                  <td>
                    <SexMark sex={p.sex} />
                  </td>
                  <td>
                    <Link href={`/patients/${p.id}`}>
                      <strong>{patientName(p)}</strong>
                    </Link>
                    <div className="muted">
                      [{p.mrn}] {p.sex} | {ageFromDob(p.dob)}y | {formatDate(p.dob)}
                    </div>
                  </td>
                  <td>{p.phone ?? <span className="muted">—</span>}</td>
                  <td>
                    {primary?.payer.name ?? "Self-pay"}
                    {primary && <div className="muted">{primary.memberId}</div>}
                  </td>
                  <td>
                    {p.referringPhysician?.name ?? <span className="muted">—</span>}
                    {c?.referralDate && <div className="muted">Referred {formatDate(c.referralDate)}</div>}
                  </td>
                  <td>
                    {c ? (
                      <>
                        <Link href={`/gateway/${c.id}`} className={`gw-stage gw-stage-${c.stage.toLowerCase()}`}>
                          {intakeStageLabel[c.stage]}
                        </Link>
                        {c.careStatus && <div className="muted">{careStatusLabel[c.careStatus]}</div>}
                        {c.assignedProvider && <div className="muted">{c.assignedProvider.name}</div>}
                      </>
                    ) : (
                      <span className="muted">No case</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge value={p.status} />
                  </td>
                  <td className="gw-actions">
                    <Link className="btn secondary gw-mini" href={`/patients/${p.id}`}>
                      Chart
                    </Link>
                    {canEdit && (
                      <Link className="btn secondary gw-mini" href={`/patients/${p.id}/edit`}>
                        Edit
                      </Link>
                    )}
                    {!c && canIntake && (
                      <form action={startIntake.bind(null, p.id)}>
                        <button className="btn ghost gw-mini" type="submit">
                          Start intake
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {patients.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No patients match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Today (front desk + provider briefs)

export async function TodayTab({ user }: { user: User }) {
  const start = startOfToday();
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const soon = new Date(Date.now() + AUTH_EXPIRY_WARN_DAYS * 24 * 60 * 60 * 1000);

  const [todayAppts, patientCount, openCharts, claims, expiringAuths] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        practiceId: user.practiceId,
        startsAt: { gte: start, lt: end },
        ...(user.role === "CLINICIAN" ? { providerId: user.id } : {}),
      },
      include: {
        provider: true,
        patient: { include: { intakeCases: { orderBy: { createdAt: "desc" }, take: 1, include: { payer: true } } } },
      },
      orderBy: { startsAt: "asc" },
    }),
    prisma.patient.count({ where: { practiceId: user.practiceId, status: "ACTIVE" } }),
    prisma.encounter.count({ where: { practiceId: user.practiceId, status: { in: ["IN_PROGRESS", "CDS_QUERY", "READY_FOR_SIGNATURE"] } } }),
    prisma.claim.findMany({ where: { practiceId: user.practiceId, status: { not: "VOID" } }, select: { billedCents: true, paidCents: true } }),
    prisma.intakeCase.findMany({
      where: { practiceId: user.practiceId, authStatus: "APPROVED", authEndDate: { gte: start, lte: soon } },
      include: { patient: true },
      orderBy: { authEndDate: "asc" },
    }),
  ]);
  const billed = claims.reduce((s, c) => s + c.billedCents, 0);
  const paid = claims.reduce((s, c) => s + c.paidCents, 0);

  return (
    <>
      <section className="grid-stats">
        <div className="stat">
          <span>Today&apos;s visits</span>
          <strong>{todayAppts.length}</strong>
        </div>
        <div className="stat">
          <span>Active patients</span>
          <strong>{patientCount}</strong>
        </div>
        <div className="stat">
          <span>Unsigned charts</span>
          <strong>{openCharts}</strong>
        </div>
        <div className="stat">
          <span>AR (billed / paid)</span>
          <strong>
            {formatMoney(billed)} / {formatMoney(paid)}
          </strong>
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <h2>{user.role === "CLINICIAN" ? "My patients today" : "Front-desk board"} · provider briefs</h2>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Patient</th>
                <th>Coverage</th>
                <th>Brief for the provider</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {todayAppts.map((appt) => {
                const c = appt.patient.intakeCases[0];
                return (
                  <tr key={appt.id}>
                    <td>{formatTime(appt.startsAt)}</td>
                    <td>
                      <Link href={`/patients/${appt.patientId}`}>{patientName(appt.patient)}</Link>
                      <div className="muted">
                        {appt.provider.name}
                        {appt.reason ? ` · ${appt.reason}` : ""}
                      </div>
                    </td>
                    <td>
                      {c ? (
                        <>
                          {c.payer?.name ?? "Self-pay"}
                          <div>
                            <Tag tone={eligibilityTone(c.eligibilityStatus)}>{eligibilityStatusLabel[c.eligibilityStatus]}</Tag>
                          </div>
                          {c.authNumber && <div className="muted">Auth #{c.authNumber}</div>}
                        </>
                      ) : (
                        <span className="muted">No gateway case</span>
                      )}
                    </td>
                    <td className="gw-brief">{c?.providerBrief ?? <span className="muted">—</span>}</td>
                    <td>
                      <StatusBadge value={appt.status} />
                    </td>
                  </tr>
                );
              })}
              {todayAppts.length === 0 && (
                <tr>
                  <td colSpan={5}>No visits on the board. Book from Schedule.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="panel">
          <h2>Authorizations expiring in {AUTH_EXPIRY_WARN_DAYS} days</h2>
          {expiringAuths.length === 0 && <p className="muted">None.</p>}
          <ul>
            {expiringAuths.map((c) => (
              <li key={c.id}>
                <Link href={`/gateway/${c.id}`}>{patientName(c.patient)}</Link> — #{c.authNumber} ends{" "}
                {formatDate(c.authEndDate!)}
              </li>
            ))}
          </ul>
          <h2>Work queues</h2>
          <p>
            <Link href="/encounters">{openCharts} charts open with providers</Link>
          </p>
          <p>
            <Link href="/billing">Revenue cycle work queues</Link>
          </p>
        </section>
      </div>
    </>
  );
}
