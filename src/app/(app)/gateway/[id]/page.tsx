import Link from "next/link";
import { uploadPatientDocuments } from "../documents/actions";
import { DOC_STATUS, DOC_TYPES } from "@/lib/patient-docs";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { QuickActions } from "@/components/QuickActions";
import { PatientFormsPanel } from "../../connect/patient-forms-panel";
import { networkStatusForPayer } from "@/lib/credentialing";
import { ageFromDob, enrollmentStatusLabel, formatDate, formatTime, patientName, planSegmentLabel } from "@/lib/format";
import {
  CONSENTS,
  GATEWAY_ROLES,
  PATIENT_EDIT_ROLES,
  authStatusLabel,
  canWorkTeam,
  careStatusLabel,
  dataEntryGaps,
  eligibilityStatusLabel,
  intakeStageLabel,
  referralAppStatusLabel,
  referralSourceTypeLabel,
  referralStatusLabel,
  schedulingGaps,
  teamForStage,
  verificationGaps,
  yesNoUnknownLabel,
} from "@/lib/gateway";
import {
  addIntakeNote,
  moveCase,
  saveAuthorization,
  savePccReferral,
  saveReferral,
  saveScheduling,
  saveVerification,
  takeCase,
} from "../actions";
import { NetworkTag, SexMark, Tag, authTone, eligibilityTone } from "../views";

function d(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function money(cents: number | null | undefined) {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
}

function Options({ labels }: { labels: Record<string, string> }) {
  return (
    <>
      {Object.entries(labels).map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </>
  );
}

const STEPS = [
  { team: "DATA_ENTRY" as const, title: "Data entry", detail: "Demographics & referral source" },
  { team: "VERIFICATION" as const, title: "Verification", detail: "EVBV · prior auth · PCC referral" },
  { team: "SCHEDULING" as const, title: "Scheduling", detail: "Consents · PCP · appointment" },
];

export default async function IntakeCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; docApplied?: string }>;
}) {
  const user = await requireUser(GATEWAY_ROLES);
  const { id } = await params;
  const { error, docApplied } = await searchParams;
  const c = await prisma.intakeCase.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      patient: {
        include: {
          insurances: { include: { payer: true } },
          referringPhysician: true,
          encounters: { orderBy: { date: "desc" }, take: 1, select: { id: true } },
        },
      },
      payer: true,
      assignedProvider: true,
      owner: true,
      activities: { include: { user: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!c) notFound();
  const patient = c.patient;
  const documents = await prisma.patientDocument.findMany({
    where: { practiceId: user.practiceId, patientId: patient.id },
    orderBy: { createdAt: "desc" },
  });

  const [payers, referrers, providers, upcoming, network] = await Promise.all([
    prisma.payer.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { name: "asc" } }),
    prisma.renderingProvider.findMany({
      where: { practiceId: user.practiceId, isReferring: true, status: "ACTIVE" },
      orderBy: { name: "asc" },
    }),
    prisma.renderingProvider.findMany({
      where: { practiceId: user.practiceId, isRendering: true, status: "ACTIVE" },
      orderBy: { name: "asc" },
    }),
    prisma.appointment.findMany({
      where: {
        patientId: patient.id,
        practiceId: user.practiceId,
        startsAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      include: { provider: true, location: true },
      orderBy: { startsAt: "asc" },
    }),
    c.payerId ? networkStatusForPayer(user.practiceId, c.payerId, c.planSegment) : Promise.resolve([]),
  ]);

  const currentTeam = teamForStage(c.stage);
  const canTeam1 = canWorkTeam(user.role, "DATA_ENTRY");
  const canTeam2 = canWorkTeam(user.role, "VERIFICATION");
  const canTeam3 = canWorkTeam(user.role, "SCHEDULING");
  const closed = c.stage === "CLOSED";
  const t1Gaps = dataEntryGaps(patient, c);
  const t2Gaps = verificationGaps(c);
  const t3Gaps = schedulingGaps(c);
  const assignedNetwork = network.find((n) => n.providerId === c.assignedProviderId);
  const needsOverride =
    Boolean(c.payerId && c.assignedProviderId) && c.eligibilityStatus !== "SELF_PAY" && assignedNetwork?.network !== "IN_NETWORK";
  const schedulingOpen = ["SCHEDULING", "SCHEDULED"].includes(c.stage);
  const stepIndex = closed ? -1 : STEPS.findIndex((s) => s.team === currentTeam);
  const primary = patient.insurances.find((i) => i.isPrimary) ?? patient.insurances[0];

  return (
    <div className="gw-case">
      <aside className="gw-side panel">
        <div className="gw-side-head">
          <SexMark sex={patient.sex} />
          <QuickActions
            patientId={patient.id}
            caseId={c.id}
            latestEncounterId={patient.encounters[0]?.id}
            canEdit={PATIENT_EDIT_ROLES.includes(user.role)}
            canSchedule={["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER"].includes(user.role)}
            canBill={["ADMIN", "BILLER", "FRONT_DESK"].includes(user.role)}
          />
        </div>
        <h2 className="gw-side-name">
          [{patient.mrn}] {patientName(patient).toUpperCase()}
        </h2>
        <p className="muted">
          {ageFromDob(patient.dob)}y | {formatDate(patient.dob)} | {patient.sex}
        </p>
        <dl className="gw-side-list">
          <dt>Address</dt>
          <dd>
            {patient.addressLine1 ?? "—"}
            <br />
            {[patient.city, patient.state, patient.zip].filter(Boolean).join(", ")}
          </dd>
          <dt>Phone</dt>
          <dd>{patient.phone ?? "—"}</dd>
          <dt>Primary insurance</dt>
          <dd>
            {primary ? `${primary.payer.name} · ${primary.memberId}` : "Self-pay"}
          </dd>
          <dt>Rendering provider</dt>
          <dd>{c.assignedProvider?.name ?? "Not assigned"}</dd>
          <dt>Referring physician</dt>
          <dd>{patient.referringPhysician?.name ?? "—"}</dd>
          <dt>Care status</dt>
          <dd>{c.careStatus ? careStatusLabel[c.careStatus] : "—"}</dd>
          <dt>Case owner</dt>
          <dd>
            {c.owner?.name ?? "Unassigned"}
            {currentTeam && canWorkTeam(user.role, currentTeam) && c.ownerId !== user.id && (
              <form action={takeCase.bind(null, c.id)}>
                <button className="btn ghost gw-mini" type="submit">
                  Take case
                </button>
              </form>
            )}
          </dd>
        </dl>
      </aside>

      <div className="stack">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <p className="muted">
              <Link href="/">« Patient Gateway</Link> · Case opened {formatDate(c.createdAt)}
            </p>
            <h1>
              {patientName(patient)}{" "}
              <span className={`gw-stage gw-stage-${c.stage.toLowerCase()}`}>{intakeStageLabel[c.stage]}</span>{" "}
              {c.priority === "URGENT" && <Tag tone="bad">Urgent</Tag>}
            </h1>
          </div>
        </div>

        {error && (
          <p className="gw-error" role="alert">
            {error}
          </p>
        )}

        <ol className="gw-stepper">
          {STEPS.map((s, i) => (
            <li
              key={s.team}
              className={i < stepIndex || c.stage === "SCHEDULED" ? "done" : i === stepIndex ? "current" : undefined}
            >
              <strong>
                {i + 1}. {s.title}
              </strong>
              <span>{s.detail}</span>
            </li>
          ))}
        </ol>

        {closed && (
          <section className="panel gw-handoff">
            <p>
              <strong>Closed:</strong> {c.closedReason}
            </p>
            {canTeam1 && (
              <form action={moveCase.bind(null, c.id, "REOPEN")}>
                <button className="btn secondary" type="submit">
                  Reopen case
                </button>
              </form>
            )}
          </section>
        )}

        {/* ---------------- Hand-off bar for the team that owns the current stage ---------------- */}
        {c.stage === "DATA_ENTRY" && canTeam1 && (
          <section className="panel gw-handoff">
            <div>
              <strong>Hand off to verification</strong>
              {t1Gaps.length ? <p className="muted">Still missing: {t1Gaps.join(", ")}</p> : <p className="muted">Everything Team 2 needs is entered.</p>}
            </div>
            <form action={moveCase.bind(null, c.id, "SEND_TO_VERIFICATION")}>
              <button className="btn" type="submit" disabled={t1Gaps.length > 0}>
                Send to verification →
              </button>
            </form>
          </section>
        )}

        {["VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL"].includes(c.stage) && canTeam2 && (
          <section className="panel gw-handoff">
            <div>
              <strong>Approve for service</strong>
              {t2Gaps.length ? <p className="muted">Open items: {t2Gaps.join(", ")}</p> : <p className="muted">Verification is complete.</p>}
            </div>
            <form action={moveCase.bind(null, c.id, "APPROVE_FOR_SERVICE")} className="gw-handoff-form">
              {needsOverride && t2Gaps.length === 0 && (
                <label>
                  <span>
                    Provider is not credentialed with this payer — document the override <span className="req">*</span>
                  </span>
                  <input name="override" required placeholder="e.g. single-case agreement approved by payer, ref #…" />
                </label>
              )}
              <button className="btn" type="submit" disabled={t2Gaps.length > 0 || c.stage !== "VERIFICATION"}>
                Approve → scheduling
              </button>
            </form>
            <details className="gw-inline-form">
              <summary>Return to data entry</summary>
              <form action={moveCase.bind(null, c.id, "RETURN_TO_DATA_ENTRY")}>
                <input name="note" required placeholder="What needs correcting?" />
                <button className="btn secondary" type="submit">
                  Return
                </button>
              </form>
            </details>
          </section>
        )}

        {c.stage === "SCHEDULING" && canTeam3 && (
          <section className="panel gw-handoff">
            <div>
              <strong>Schedule the patient</strong>
              <p className="muted">
                {t3Gaps.length ? `Open items: ${t3Gaps.join(", ")}` : "Consents and referral application complete."}
                {upcoming.length === 0 ? " · No appointment booked yet." : ""}
              </p>
            </div>
            <Link className="btn secondary" href={`/schedule?patientId=${patient.id}&returnTo=/gateway/${c.id}${c.assignedProvider?.userId ? `&bookWith=${c.assignedProvider.userId}` : ""}`}>
              Book appointment
            </Link>
            <form action={moveCase.bind(null, c.id, "MARK_SCHEDULED")}>
              <button className="btn" type="submit" disabled={t3Gaps.length > 0 || upcoming.length === 0}>
                Mark scheduled ✓
              </button>
            </form>
            <details className="gw-inline-form">
              <summary>Return to verification</summary>
              <form action={moveCase.bind(null, c.id, "RETURN_TO_VERIFICATION")}>
                <input name="note" required placeholder="What needs re-verifying?" />
                <button className="btn secondary" type="submit">
                  Return
                </button>
              </form>
            </details>
          </section>
        )}

        {docApplied && <p className="notice-ok">Document details were applied to the patient and this case.</p>}

        {/* ---------------- Patient documents ---------------- */}
        <section className="panel">
          <div className="gw-section-head">
            <h2>Patient documents ({documents.length})</h2>
            <Link className="muted" href="/gateway/documents">
              All documents
            </Link>
          </div>
          {documents.length > 0 && (
            <ul className="pd-list">
              {documents.map((d) => (
                <li key={d.id}>
                  <Link href={`/gateway/documents/${d.id}`}>{d.name}</Link>
                  <span className="muted">
                    {DOC_TYPES[d.docType] ?? d.docType} · {formatDate(d.createdAt)}
                  </span>
                  <span className={`gw-tag gw-tag-${d.status === "APPLIED" ? "ok" : d.status === "FAILED" ? "bad" : d.status === "READ" ? "warn" : "info"}`}>
                    {DOC_STATUS[d.status] ?? d.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canWorkTeam(user.role, "DATA_ENTRY") && (
            <form action={uploadPatientDocuments} className="vw-inline pd-case-upload">
              <input type="hidden" name="caseId" value={c.id} />
              <input type="file" name="files" multiple required accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" aria-label="Documents to upload" />
              <button className="btn secondary gw-mini" type="submit">
                Upload &amp; read
              </button>
            </form>
          )}
        </section>

        <PatientFormsPanel practiceId={user.practiceId} patientId={patient.id} role={user.role} back={`/gateway/${c.id}`} />

        {/* ---------------- Team 1 ---------------- */}
        <section className="panel">
          <div className="gw-section-head">
            <h2>1 · Registration &amp; referral source</h2>
            {PATIENT_EDIT_ROLES.includes(user.role) && (
              <Link className="btn secondary gw-mini" href={`/patients/${patient.id}/edit`}>
                Edit demographics &amp; insurance
              </Link>
            )}
          </div>
          <div className="gw-facts">
            <div>
              <span>Name</span>
              {patientName(patient)}
            </div>
            <div>
              <span>DOB / sex</span>
              {formatDate(patient.dob)} · {patient.sex}
            </div>
            <div>
              <span>Phone</span>
              {patient.phone ?? <em className="gw-missing">missing</em>}
            </div>
            <div>
              <span>Address</span>
              {patient.addressLine1 && patient.city && patient.zip ? (
                `${patient.addressLine1}, ${patient.city} ${patient.state ?? ""} ${patient.zip}`
              ) : (
                <em className="gw-missing">incomplete</em>
              )}
            </div>
            <div>
              <span>Insurance on file</span>
              {patient.insurances.length
                ? patient.insurances.map((i) => `${i.payer.name} (${i.memberId})`).join("; ")
                : "None"}
            </div>
            <div>
              <span>Emergency contact</span>
              {patient.emergencyContactName ?? "—"}
            </div>
          </div>
          <form action={saveReferral.bind(null, c.id)}>
            <fieldset disabled={!canTeam1 || closed} className="gw-fieldset">
              <div className="form-grid gw-grid-3">
                <label>
                  Referral date
                  <input type="date" name="referralDate" defaultValue={d(c.referralDate)} />
                </label>
                <label>
                  <span>
                    Referral source type <span className="req">*</span>
                  </span>
                  <select name="referralSourceType" defaultValue={c.referralSourceType ?? ""}>
                    <option value="">—</option>
                    <Options labels={referralSourceTypeLabel} />
                  </select>
                </label>
                <label>
                  <span>
                    Referral source name <span className="req">*</span>
                  </span>
                  <input name="referralSourceName" defaultValue={c.referralSourceName ?? ""} placeholder="Facility / office name" />
                </label>
                <label>
                  Referring physician
                  <select name="referringPhysicianId" defaultValue={patient.referringPhysicianId ?? ""}>
                    <option value="">—</option>
                    {referrers.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {r.credential ? `, ${r.credential}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Contact name
                  <input name="referralContactName" defaultValue={c.referralContactName ?? ""} />
                </label>
                <label>
                  Contact phone
                  <input name="referralContactPhone" type="tel" defaultValue={c.referralContactPhone ?? ""} />
                </label>
                <label>
                  Contact fax
                  <input name="referralContactFax" type="tel" defaultValue={c.referralContactFax ?? ""} />
                </label>
                <label>
                  Priority
                  <select name="priority" defaultValue={c.priority}>
                    <option value="NORMAL">Normal</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </label>
                <label className="gw-span-3">
                  Services requested / reason for referral
                  <input name="servicesRequested" defaultValue={c.servicesRequested ?? ""} placeholder="e.g. wound care, venous ulcer L leg" />
                </label>
                <label className="gw-span-3">
                  Referral notes
                  <textarea name="referralNotes" defaultValue={c.referralNotes ?? ""} />
                </label>
              </div>
              {canTeam1 && !closed && (
                <div className="form-actions">
                  <button className="btn" type="submit">
                    Save referral
                  </button>
                </div>
              )}
            </fieldset>
          </form>
        </section>

        {/* ---------------- Team 2 ---------------- */}
        <section className="panel">
          <div className="gw-section-head">
            <h2>2 · Eligibility &amp; benefits (EVBV)</h2>
            <Tag tone={eligibilityTone(c.eligibilityStatus)}>{eligibilityStatusLabel[c.eligibilityStatus]}</Tag>
          </div>
          <form action={saveVerification.bind(null, c.id)}>
            <fieldset disabled={!canTeam2 || closed || c.stage === "DATA_ENTRY"} className="gw-fieldset">
              {c.stage === "DATA_ENTRY" && <p className="muted">Opens once data entry hands the case off.</p>}
              <div className="form-grid gw-grid-3">
                <label>
                  Insurance payer
                  <select name="payerId" defaultValue={c.payerId ?? ""}>
                    <option value="">— None / self-pay —</option>
                    {payers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Plan segment
                  <select name="planSegment" defaultValue={c.planSegment ?? ""}>
                    <option value="">Any / not specified</option>
                    <Options labels={planSegmentLabel} />
                  </select>
                </label>
                <label>
                  Member / policy ID
                  <input name="memberId" defaultValue={c.memberId ?? ""} />
                </label>
                <label>
                  Eligibility
                  <select name="eligibilityStatus" defaultValue={c.eligibilityStatus}>
                    <Options labels={eligibilityStatusLabel} />
                  </select>
                </label>
                <label>
                  Coverage effective
                  <input type="date" name="coverageEffectiveDate" defaultValue={d(c.coverageEffectiveDate)} />
                </label>
                <label>
                  Coverage termination
                  <input type="date" name="coverageTermDate" defaultValue={d(c.coverageTermDate)} />
                </label>
                <label>
                  Copay ($)
                  <input name="copay" inputMode="decimal" defaultValue={money(c.copayCents)} />
                </label>
                <label>
                  Deductible ($)
                  <input name="deductible" inputMode="decimal" defaultValue={money(c.deductibleCents)} />
                </label>
                <label>
                  Deductible met ($)
                  <input name="deductibleMet" inputMode="decimal" defaultValue={money(c.deductibleMetCents)} />
                </label>
                <label>
                  Coinsurance / % patient
                  <input name="coinsurancePercent" type="number" min="0" max="100" defaultValue={c.coinsurancePercent ?? ""} />
                </label>
                <label>
                  Out-of-pocket remaining ($)
                  <input name="outOfPocketRemaining" inputMode="decimal" defaultValue={money(c.outOfPocketRemainingCents)} />
                </label>
                <label>
                  Verification date
                  <input type="date" name="verifiedAt" defaultValue={d(c.verifiedAt)} />
                </label>
                <label>
                  Verified with
                  <input name="verifiedWith" defaultValue={c.verifiedWith ?? ""} placeholder="Portal / rep name" />
                </label>
                <label>
                  Call / reference #
                  <input name="verificationReference" defaultValue={c.verificationReference ?? ""} />
                </label>
                <label>
                  Rendering provider
                  <select name="assignedProviderId" defaultValue={c.assignedProviderId ?? ""}>
                    <option value="">—</option>
                    {providers.map((p) => {
                      const n = network.find((x) => x.providerId === p.id);
                      const suffix = !c.payerId
                        ? ""
                        : n?.network === "IN_NETWORK"
                          ? " ✓ in network"
                          : n?.network === "PENDING"
                            ? " … pending"
                            : " ✗ not credentialed";
                      return (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {suffix}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label>
                  Prior authorization required?
                  <select name="authRequired" defaultValue={c.authRequired}>
                    <Options labels={yesNoUnknownLabel} />
                  </select>
                </label>
                <label>
                  Referral required (PCC)?
                  <select name="referralRequired" defaultValue={c.referralRequired}>
                    <Options labels={yesNoUnknownLabel} />
                  </select>
                </label>
                <label className="gw-span-3">
                  Benefits notes
                  <textarea name="benefitsNotes" defaultValue={c.benefitsNotes ?? ""} placeholder="Visit limits, carve-outs, DME coverage…" />
                </label>
              </div>
              {canTeam2 && !closed && c.stage !== "DATA_ENTRY" && (
                <div className="form-actions">
                  <button className="btn" type="submit">
                    Save verification
                  </button>
                </div>
              )}
            </fieldset>
          </form>

          <div className="gw-subpanels">
            <div className="gw-subpanel">
              <div className="gw-section-head">
                <h3>Prior authorization</h3>
                {c.authRequired === "YES" ? (
                  <Tag tone={authTone(c.authStatus)}>{authStatusLabel[c.authStatus]}</Tag>
                ) : (
                  <Tag tone="muted">{c.authRequired === "NO" ? "Not required" : "Not determined"}</Tag>
                )}
              </div>
              {c.authRequired === "YES" ? (
                <form action={saveAuthorization.bind(null, c.id)}>
                  <fieldset disabled={!canTeam2 || closed} className="gw-fieldset">
                    <div className="form-grid">
                      <label>
                        Auth status
                        <select name="authStatus" defaultValue={c.authStatus === "NOT_REQUIRED" ? "TO_SUBMIT" : c.authStatus}>
                          {Object.entries(authStatusLabel)
                            .filter(([k]) => k !== "NOT_REQUIRED")
                            .map(([k, l]) => (
                              <option key={k} value={k}>
                                {l}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Auth number
                        <input name="authNumber" defaultValue={c.authNumber ?? ""} />
                      </label>
                      <label>
                        Submitted on
                        <input type="date" name="authSubmittedAt" defaultValue={d(c.authSubmittedAt)} />
                      </label>
                      <label>
                        Visits / units approved
                        <input name="authVisitsApproved" type="number" min="0" defaultValue={c.authVisitsApproved ?? ""} />
                      </label>
                      <label>
                        Valid from
                        <input type="date" name="authStartDate" defaultValue={d(c.authStartDate)} />
                      </label>
                      <label>
                        Valid through
                        <input type="date" name="authEndDate" defaultValue={d(c.authEndDate)} />
                      </label>
                      <label style={{ gridColumn: "1 / -1" }}>
                        Auth notes
                        <textarea name="authNotes" defaultValue={c.authNotes ?? ""} />
                      </label>
                    </div>
                    {canTeam2 && !closed && (
                      <div className="form-actions">
                        <button className="btn secondary" type="submit">
                          Save authorization
                        </button>
                      </div>
                    )}
                  </fieldset>
                </form>
              ) : (
                <p className="muted">Set “Prior authorization required?” to Yes to track a request.</p>
              )}
            </div>

            <div className="gw-subpanel">
              <div className="gw-section-head">
                <h3>Referral via PCC team</h3>
                {c.referralRequired === "YES" ? (
                  <Tag tone={c.referralStatus === "RECEIVED" ? "ok" : "warn"}>{referralStatusLabel[c.referralStatus]}</Tag>
                ) : (
                  <Tag tone="muted">{c.referralRequired === "NO" ? "Not required" : "Not determined"}</Tag>
                )}
              </div>
              {c.referralRequired === "YES" ? (
                <form action={savePccReferral.bind(null, c.id)}>
                  <fieldset disabled={!canTeam2 || closed} className="gw-fieldset">
                    <div className="form-grid">
                      <label>
                        Referral status
                        <select name="referralStatus" defaultValue={c.referralStatus === "NOT_REQUIRED" ? "TO_SEND" : c.referralStatus}>
                          {Object.entries(referralStatusLabel)
                            .filter(([k]) => k !== "NOT_REQUIRED")
                            .map(([k, l]) => (
                              <option key={k} value={k}>
                                {l}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Referral number
                        <input name="referralNumber" defaultValue={c.referralNumber ?? ""} />
                      </label>
                      <label style={{ gridColumn: "1 / -1" }}>
                        Details for the PCC team
                        <textarea
                          name="pccNotes"
                          defaultValue={c.pccNotes ?? ""}
                          placeholder="PCP name/fax, services & dates needed, diagnosis, payer requirements…"
                        />
                      </label>
                    </div>
                    {c.pccSentAt && <p className="muted">Sent to PCC {formatDate(c.pccSentAt)}</p>}
                    {canTeam2 && !closed && (
                      <div className="form-actions">
                        <button className="btn secondary" type="submit">
                          Save referral
                        </button>
                      </div>
                    )}
                  </fieldset>
                </form>
              ) : (
                <p className="muted">Set “Referral required (PCC)?” to Yes to forward this case to the PCC team.</p>
              )}
            </div>
          </div>

          <div className="gw-subpanel">
            <div className="gw-section-head">
              <h3>Credentialing check {c.payer ? `· ${c.payer.name}` : ""}</h3>
              {c.assignedProvider && <NetworkTag status={assignedNetwork} />}
            </div>
            {!c.payerId ? (
              <p className="muted">Select the payer to see which providers are credentialed with it.</p>
            ) : network.length === 0 ? (
              <p className="muted">No rendering providers set up in credentialing for this practice.</p>
            ) : (
              <table className="gw-network">
                <thead>
                  <tr>
                    <th>Rendering provider</th>
                    <th>Network</th>
                    <th>Enrollment status</th>
                    <th>Plan segment</th>
                    <th>Effective</th>
                  </tr>
                </thead>
                <tbody>
                  {network.map((n) => (
                    <tr key={n.providerId} className={n.providerId === c.assignedProviderId ? "gw-row-selected" : undefined}>
                      <td>
                        {n.providerName}
                        {n.credential ? `, ${n.credential}` : ""}
                        {n.providerId === c.assignedProviderId && <Tag tone="info">Assigned</Tag>}
                      </td>
                      <td>
                        <NetworkTag status={n} />
                      </td>
                      <td>
                        {n.enrollmentId ? (
                          <Link href={`/credentialing/enrollments/${n.enrollmentId}`}>
                            {enrollmentStatusLabel[n.status ?? ""] ?? n.status}
                          </Link>
                        ) : (
                          <span className="muted">No enrollment line</span>
                        )}
                      </td>
                      <td>{n.planSegment ? planSegmentLabel[n.planSegment] : "—"}</td>
                      <td>{n.effectiveDate ? formatDate(n.effectiveDate) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {c.networkOverrideNote && (
              <p className="muted">
                <strong>Network override:</strong> {c.networkOverrideNote}
              </p>
            )}
          </div>
        </section>

        {/* ---------------- Team 3 ---------------- */}
        <section className="panel">
          <div className="gw-section-head">
            <h2>3 · Scheduling &amp; ongoing status</h2>
            {c.careStatus && <Tag tone="info">{careStatusLabel[c.careStatus]}</Tag>}
          </div>
          {!schedulingOpen ? (
            <p className="muted">Opens once verification approves the patient for service.</p>
          ) : (
            <form action={saveScheduling.bind(null, c.id)}>
              <fieldset disabled={!canTeam3 || closed} className="gw-fieldset">
                <div className="gw-consents">
                  <strong>Consent signatures</strong>
                  {CONSENTS.map((x) => (
                    <label key={x.key} className="checkbox-inline">
                      <input type="checkbox" name={x.key} defaultChecked={c[x.key]} /> {x.label}
                    </label>
                  ))}
                  {c.consentsCompletedAt && <span className="muted">All signed {formatDate(c.consentsCompletedAt)}</span>}
                </div>
                <div className="form-grid gw-grid-3">
                  <label>
                    PCP name
                    <input name="pcpName" defaultValue={c.pcpName ?? ""} />
                  </label>
                  <label>
                    PCP phone
                    <input name="pcpPhone" type="tel" defaultValue={c.pcpPhone ?? ""} />
                  </label>
                  <label>
                    PCP fax
                    <input name="pcpFax" type="tel" defaultValue={c.pcpFax ?? ""} />
                  </label>
                  <label>
                    Referral application (with PCP)
                    <select name="referralAppStatus" defaultValue={c.referralAppStatus}>
                      <Options labels={referralAppStatusLabel} />
                    </select>
                  </label>
                  <label>
                    Patient status
                    <select name="careStatus" defaultValue={c.careStatus ?? ""}>
                      <option value="">—</option>
                      <Options labels={careStatusLabel} />
                    </select>
                  </label>
                  <span />
                  <label className="gw-span-3">
                    Brief for the provider (shown on the day&apos;s schedule)
                    <textarea
                      name="providerBrief"
                      defaultValue={c.providerBrief ?? ""}
                      placeholder="Reason for visit, auth limits, mobility/transport, caregiver, what to bring…"
                    />
                  </label>
                </div>
                {canTeam3 && !closed && (
                  <div className="form-actions">
                    <button className="btn" type="submit">
                      Save scheduling
                    </button>
                  </div>
                )}
              </fieldset>
            </form>
          )}
          <h3>Upcoming appointments</h3>
          {upcoming.length === 0 ? (
            <p className="muted">None booked.</p>
          ) : (
            <ul>
              {upcoming.map((a) => (
                <li key={a.id}>
                  {formatDate(a.startsAt)} {formatTime(a.startsAt)} — {a.provider.name} · {a.location.name} ({a.status.toLowerCase()})
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------------- Activity ---------------- */}
        <section className="panel">
          <h2>Activity</h2>
          <form action={addIntakeNote.bind(null, c.id)} className="gw-note-form">
            <input name="note" required placeholder="Add a note for the other teams…" />
            <button className="btn secondary" type="submit">
              Add note
            </button>
          </form>
          <ul className="gw-timeline">
            {c.activities.map((a) => (
              <li key={a.id}>
                <span className="muted">
                  {formatDate(a.createdAt)} {formatTime(a.createdAt)} · {a.user?.name ?? "System"} · {intakeStageLabel[a.stage]}
                </span>
                <div>{a.note ?? a.action.replaceAll("_", " ").toLowerCase()}</div>
              </li>
            ))}
          </ul>
          {!closed && currentTeam && canWorkTeam(user.role, currentTeam) && (
            <details className="gw-inline-form">
              <summary>Close case (not eligible, declined, unable to reach…)</summary>
              <form action={moveCase.bind(null, c.id, "CLOSE")}>
                <input name="note" required placeholder="Reason" />
                <button className="btn secondary" type="submit">
                  Close case
                </button>
              </form>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
