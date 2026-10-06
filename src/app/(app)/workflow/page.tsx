import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/lib/format";
import { PRE_RELEASE_STATUSES } from "@/lib/claim-format";
import { getCredentialingAlerts } from "@/lib/credentialing";
import { workflowRules } from "@/lib/workflow-rules";

// The whole team workflow on one page: every step in order, who owns it, what has to be true to enter it, what
// the team does, what moves the work on, the rules in force, and how much is sitting at the step right now.
// Each step links to the queue where that work is done. The signed-in user's own steps are highlighted.

type Step = {
  n: number;
  phase: string;
  title: string;
  roles: string[];
  entry: string;
  work: string[];
  exit: string;
  rule?: string | null;
  count: number;
  countLabel: string;
  href: string;
};

export default async function WorkflowPage() {
  const user = await requireUser();
  const p = user.practiceId;
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rules = await workflowRules(p);

  const [cases, apptsToday, encs, claims, unbilled, eraPending, denials, patientBal, alerts] = await Promise.all([
    prisma.intakeCase.groupBy({ by: ["stage"], where: { practiceId: p }, _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ["status"], where: { practiceId: p, startsAt: { gte: day, lt: new Date(day.getTime() + 86_400_000) } }, _count: { _all: true } }),
    prisma.encounter.groupBy({ by: ["status"], where: { practiceId: p }, _count: { _all: true } }),
    prisma.claim.groupBy({ by: ["status"], where: { practiceId: p }, _count: { _all: true } }),
    prisma.encounter.count({ where: { practiceId: p, status: "READY_FOR_BILLING", charges: { some: {} }, claims: { none: { status: { not: "VOID" } } } } }),
    prisma.eraFile.count({ where: { practiceId: p, status: { not: "POSTED" } } }),
    prisma.claimDenial.count({ where: { practiceId: p, status: "OPEN" } }),
    prisma.claim.count({ where: { practiceId: p, balanceResponsibility: "PATIENT", status: { notIn: ["VOID", "PAID", "WRITTEN_OFF"] } } }),
    getCredentialingAlerts([p]),
  ]);
  const c = (g: { _count: { _all: number } }[], keys: string[], field: "stage" | "status") => g.filter((x) => keys.includes((x as unknown as Record<string, string>)[field])).reduce((s, x) => s + x._count._all, 0);
  const caseN = (k: string[]) => c(cases, k, "stage");
  const apptN = (k: string[]) => c(apptsToday, k, "status");
  const encN = (k: string[]) => c(encs, k, "status");
  const claimN = (k: string[]) => c(claims, k, "status");

  const steps: Step[] = [
    { n: 1, phase: "Patient Gateway", title: "Referral in & data entry", roles: ["INTAKE"], entry: "A referral, face sheet or self-referral arrives (fax, upload, phone, online).", work: ["Register or match the patient; apply the read document", "Capture referral source, services requested, insurance and member ID", "Clear the required-field gaps and verify the data", "Send consent / intake packet"], exit: "Hand off to VOB (or straight to scheduling when the payer, provider network status and services allow it).", count: caseN(["DATA_ENTRY"]), countLabel: "cases in data entry", href: "/?tab=data-entry" },
    { n: 2, phase: "Patient Gateway", title: "Eligibility & VOB", roles: ["VERIFICATION"], entry: "Case handed off from data entry.", work: ["Run eligibility (270/271) and apply benefits, copay, deductible", "Verify benefits with the payer; record the reference", "Authorization and referral where required; visits approved and window", "Check the assigned provider is in network", "Decide: approved for all services / E&M and debridement only / hold / deny"], exit: "Decision recorded → case moves to scheduling (or hold for auth / PCC referral, or closed on denial).", count: caseN(["VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL"]), countLabel: "cases with VOB / authorization", href: "/?tab=verification" },
    { n: 3, phase: "Patient Gateway", title: "Scheduling", roles: ["SCHEDULER"], entry: "VOB decision made; provider assigned; authorization on file when needed.", work: ["Book the first visit with the assigned provider at the right site", "Attach the authorization; watch the window and visit limit", "Consents received; provider brief for the clinician", "Mark the case scheduled"], exit: "Visit booked and the case closed out as scheduled.", rule: rules.bookingRequiresGateway ? "Rule on: booking needs the case at scheduling" : rules.bookingChecksCredentialing ? "Rule on: provider must be in network to book" : "Rules off: booking is advisory (Practice setup → Workflow rules)", count: caseN(["SCHEDULING"]), countLabel: "cases to schedule", href: "/?tab=scheduling" },
    { n: 4, phase: "Visit day", title: "Check-in & rooming", roles: ["FRONT_DESK", "SCHEDULER"], entry: "Visit on today's schedule.", work: ["Check the patient in; confirm demographics, insurance card, consents", "Collect the copay (from the latest eligibility answer)", "Room the patient on the flow board"], exit: "Patient checked in / in room — the chart can be started.", rule: rules.chartRequiresCheckIn ? "Rule on: chart opens only after check-in" : null, count: apptN(["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_ROOM"]), countLabel: "visits today not yet completed", href: "/flow" },
    { n: 5, phase: "Clinical", title: "Clinical visit", roles: ["CLINICIAN"], entry: "Chart started from the appointment (intake brief and VOB scope shown in the hand-off header).", work: ["Chart through the visit-type workflow: history, vitals, wounds and assessments, exam, assessment & plan, orders, treatment note", "Debridement, CTP, HBO or other procedures recorded", "Required-to-finalize documents complete"], exit: "Submit to CDS.", count: encN(["IN_PROGRESS", "CDS_QUERY"]), countLabel: "charts in progress (incl. CDS queries back)", href: "/encounters?queue=mine" },
    { n: 6, phase: "Clinical", title: "CDS review", roles: ["CDS"], entry: "Chart submitted by the clinician.", work: ["Review documentation against the finalize checklist and payer requirements", "Query the provider for anything missing or unclear", "Note for the coder (what was corrected or clarified)"], exit: "Send to coding (or query back to the provider).", count: encN(["READY_FOR_CDS"]), countLabel: "charts awaiting CDS review", href: "/encounters?queue=cds" },
    { n: 7, phase: "Clinical", title: "Coding", roles: ["CODER"], entry: "Chart sent by CDS (CDS note in the hand-off header).", work: ["Build the superbill: diagnoses (pointers A–L), procedures, modifiers, units, supplies", "Use coding assist and the code library; fees from the charge schedule", "Query CDS when the documentation needs checking"], exit: "Send for signature.", rule: rules.enforceVobScope ? "Rule on: a limited VOB blocks services outside E&M / debridement on the claim" : null, count: encN(["READY_FOR_CODING", "CODING_QUERY"]), countLabel: "charts with coding (incl. queries)", href: "/encounters?queue=coding" },
    { n: 8, phase: "Clinical", title: "Provider signature", roles: ["CLINICIAN"], entry: "Superbill complete.", work: ["Review the note and superbill", "Sign with attestation (supervising physician co-signs where required)", "Return to coding if the superbill should change"], exit: "Signed → ready for billing.", count: encN(["READY_FOR_SIGNATURE"]), countLabel: "awaiting signature", href: "/encounters?queue=signature" },
    { n: 9, phase: "Revenue cycle", title: "Generate claims", roles: ["BILLER"], entry: "Signed visits with charges and no claim.", work: ["Tick the visits and generate claims (primary; secondary after adjudication)", "Claims land in the pre-release queue with their claim checks"], exit: "Claims generated.", count: unbilled, countLabel: "signed visits without a claim", href: "/billing?tab=visits" },
    { n: 10, phase: "Revenue cycle", title: "Pre-release review", roles: ["BILLER"], entry: "Generated claims.", work: ["Fix claim edits (errors block; warnings can hold)", "Check the hand-off header: VOB scope, authorization, eligibility, provider network", "Bill selected to insurance (837P) or print paper claims"], exit: "Billed to the clearinghouse.", rule: "Payers marked 'requires visit review' block claims for visits that skipped CDS", count: claimN(PRE_RELEASE_STATUSES), countLabel: "claims in pre-release", href: "/billing/claims/release" },
    { n: 11, phase: "Revenue cycle", title: "Payer response", roles: ["BILLER"], entry: "Claim accepted by the clearinghouse.", work: ["Watch clearinghouse rejections and resubmit", "Timely-filing countdown per payer", "Payer acknowledgement / status"], exit: "Remittance arrives.", count: claimN(["SUBMITTED", "ACCEPTED", "EDI_REJECTED"]), countLabel: "claims out with payers (incl. rejections)", href: "/billing/claims?bucket=SUBMITTED" },
    { n: 12, phase: "Revenue cycle", title: "Payments & ERA posting", roles: ["BILLER"], entry: "835 remittance or a check / EFT.", work: ["Import the ERA: match claims, post payments, contractual adjustments, patient responsibility", "Record deposits and apply to claims", "Small-balance write-offs; period close"], exit: "Claims paid, partially paid, transferred to the next payer, or denied.", count: eraPending, countLabel: "remittances not fully posted", href: "/billing?tab=era" },
    { n: 13, phase: "Revenue cycle", title: "Denials & appeals", roles: ["BILLER"], entry: "Denial from the ERA or keyed from an EOB.", work: ["Work the denial by category (fix and action suggested)", "Corrected claim (7), void (8) or appeal with letter and deadline", "Track recovery"], exit: "Paid, written off, or moved to the patient.", count: denials, countLabel: "open denials", href: "/billing/denials" },
    { n: 14, phase: "Revenue cycle", title: "Patient balance", roles: ["BILLER", "FRONT_DESK"], entry: "Balance moved to the patient.", work: ["Statement batches; payment links and portal-style pay pages", "Collect at checkout; receipts", "Credit balances and refunds"], exit: "Account at zero.", count: patientBal, countLabel: "claims with a patient balance", href: "/statements" },
  ];
  const side: Step[] = [
    { n: 0, phase: "Always on", title: "Credentialing", roles: ["CREDENTIALING"], entry: "Every provider × payer line.", work: ["Enrollments, revalidations, expirations, screening", "Network status feeds the Gateway, booking, the hand-off header and claim holds"], exit: "—", count: alerts.length, countLabel: "alerts", href: "/credentialing" },
    { n: 0, phase: "Always on", title: "Holds", roles: ["CDS", "CODER", "BILLER"], entry: "Any stage.", work: ["Billing hold, hold for audit, do not bill — with a reason; released back to the stage it came from"], exit: "—", count: encN(["BILLING_HOLD", "HOLD_FOR_AUDIT", "DO_NOT_BILL"]), countLabel: "charts on hold", href: "/encounters?queue=holds" },
  ];
  const mine = (s: Step) => s.roles.includes(user.role) || user.role === "ADMIN";

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Overview</p>
          <h1>Team workflow</h1>
          <p className="muted" style={{ margin: 0 }}>
            Every step in order, who owns it, what has to be true to start it, and what moves the work on — with what is sitting at each step now. Your team&apos;s steps are highlighted.
            Rules that make a step a hard dependency are set under <Link href="/settings/practice#workflow">Practice setup → Workflow rules</Link>.
          </p>
        </div>
      </div>
      <ol className="wf-steps">
        {steps.map((s, i) => (
          <li key={s.n} className={`wf-step${mine(s) ? " wf-mine" : ""}${i > 0 && steps[i - 1].phase !== s.phase ? " wf-phase-start" : ""}`}>
            <div className="wf-num">{s.n}</div>
            <div className="wf-body">
              <div className="wf-head">
                <span className="wf-phase">{s.phase}</span>
                <h2>
                  <Link href={s.href}>{s.title}</Link>
                </h2>
                <span className="wf-roles">{s.roles.map((r) => roleLabel[r] ?? r).join(" · ")}</span>
                <Link className={`wf-count${s.count ? "" : " wf-zero"}`} href={s.href} title="Open the queue">
                  <strong>{s.count}</strong> {s.countLabel}
                </Link>
              </div>
              <div className="wf-cols">
                <div>
                  <span className="wf-label">Starts when</span>
                  <p>{s.entry}</p>
                </div>
                <div>
                  <span className="wf-label">The team</span>
                  <ul>
                    {s.work.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="wf-label">Moves on when</span>
                  <p>{s.exit}</p>
                  {s.rule && <p className="wf-rule">{s.rule}</p>}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <h2 style={{ marginTop: "0.5rem" }}>Alongside every step</h2>
      <div className="wf-side">
        {side.map((s) => (
          <section key={s.title} className={`panel wf-sidecard${mine(s) ? " wf-mine" : ""}`}>
            <div className="wf-head">
              <h2>
                <Link href={s.href}>{s.title}</Link>
              </h2>
              <span className="wf-roles">{s.roles.map((r) => roleLabel[r] ?? r).join(" · ")}</span>
              <Link className={`wf-count${s.count ? "" : " wf-zero"}`} href={s.href}>
                <strong>{s.count}</strong> {s.countLabel}
              </Link>
            </div>
            <ul>
              {s.work.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="muted">
        Communication between teams stays on the patient (message box on the case, the visit and the claim; &ldquo;waiting for your team&rdquo; on each worklist). See the <Link href="/dashboard">dashboard</Link> for the same counts as tiles.
      </p>
    </div>
  );
}
