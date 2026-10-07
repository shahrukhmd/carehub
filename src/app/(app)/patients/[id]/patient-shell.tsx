import { parseCustomValues, showCustomValue } from "@/lib/custom-fields";
import { requireChartAccess } from "@/lib/privacy";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ageFromDob, formatDate, patientAccountStatusLabel, patientName } from "@/lib/format";
import { PATIENT_EDIT_ROLES } from "@/lib/gateway";
import { addressLine, parseAddress, phoneTypeLabel } from "@/lib/patient-fields";
import { QuickActions } from "@/components/QuickActions";
import { PatientTabs } from "@/components/PatientTabs";
import { can, allowed, roleOf, type Overrides, type Subject, rolesFor } from "@/lib/permissions";
import { StatusBadge } from "@/components/StatusBadge";
import { PatientAlerts } from "@/components/PatientAlerts";
import { setPatientStatus, startEncounter } from "@/app/actions";

const START_ROLES = rolesFor("chart.start");
const FORM_STATUS: Record<string, string> = {
  SENT: "Forms sent — not opened",
  OPENED: "Forms opened",
  IN_PROGRESS: "Forms in progress",
  COMPLETED: "Forms completed",
  EXPIRED: "Form link expired",
  CANCELLED: "Form request cancelled",
};

// Everything the patient summary column needs. Loaded by each patient page so the page renders in one pass.
export async function loadPatientShell(patientId: string, user: { id: string; practiceId: string; role: string; overrides?: Overrides | null }) {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId }, include: { referringPhysician: true } });
  if (!patient) notFound();
  // A restricted chart stops here for anyone outside the care team until they give a reason.
  const access = await requireChartAccess(user, patientId, `/patients/${patientId}`);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const ids = [patient.woundCarePhysicianId, patient.primaryCarePhysicianId].filter((v): v is string => Boolean(v));
  const [customFields, providers, todayVisit, latestEncounter, intake, formRequest] = await Promise.all([
    patient.customFields ? prisma.customField.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }) : [],
    ids.length ? prisma.renderingProvider.findMany({ where: { id: { in: ids }, practiceId: user.practiceId } }) : [],
    prisma.appointment.findFirst({
      where: { patientId, practiceId: user.practiceId, startsAt: { gte: dayStart, lt: dayEnd }, status: { notIn: ["CANCELLED", "NO_SHOW", "COMPLETED"] } },
      orderBy: { startsAt: "asc" },
      include: { encounter: { select: { id: true } } },
    }),
    prisma.encounter.findFirst({ where: { patientId, practiceId: user.practiceId }, orderBy: { date: "desc" }, select: { id: true } }),
    prisma.intakeCase.findFirst({ where: { patientId, practiceId: user.practiceId }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.intakeRequest.findFirst({ where: { patientId, practiceId: user.practiceId }, orderBy: { createdAt: "desc" }, select: { status: true, createdAt: true } }),
  ]);
  return {
    patient,
    woundCare: providers.find((p) => p.id === patient.woundCarePhysicianId) ?? null,
    primaryCare: providers.find((p) => p.id === patient.primaryCarePhysicianId) ?? null,
    todayVisit,
    latestEncounterId: latestEncounter?.id ?? null,
    caseId: intake?.id ?? null,
    formRequest,
    role: { role: user.role, overrides: user.overrides ?? null } as Subject,
    viewerId: user.id,
    practiceId: user.practiceId,
    access,
    // The practice's custom fields this patient has an answer for.
    custom: customFields.map((f) => ({ label: f.label, value: showCustomValue(f, parseCustomValues(patient.customFields)[f.key]) })).filter((c) => c.value),
  };
}

export type PatientShellData = Awaited<ReturnType<typeof loadPatientShell>>;

function Provider({ label, p }: { label: string; p: { name: string; credential?: string | null; phone: string | null; fax: string | null } | null }) {
  if (!p) return null;
  return (
    <div className="pd-block">
      <h4>{label}</h4>
      <p>
        {p.name}
        {p.credential ? `, ${p.credential}` : ""}
      </p>
      {(p.phone || p.fax) && <p className="muted">{[p.phone ? `Phone: ${p.phone}` : "", p.fax ? `Fax: ${p.fax}` : ""].filter(Boolean).join("   ")}</p>}
    </div>
  );
}

// Patient pages share this frame: a summary column on the left, the page on the right.
export function PatientShell({ data, children }: { data: PatientShellData; children: React.ReactNode }) {
  const { patient: p, role } = data;
  const secondary = parseAddress(p.secondaryAddress);
  const current = p.currentAddress === "SECONDARY" && addressLine(secondary) ? secondary : { line1: p.addressLine1 ?? undefined, line2: p.addressLine2 ?? undefined, city: p.city ?? undefined, state: p.state ?? undefined, zip: p.zip ?? undefined };
  const street = [current.line1, current.line2].filter(Boolean).join(", ");
  const cityLine = [current.city, [current.state, current.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const canStart = allowed(role, START_ROLES);

  return (
    <div className="pd-shell">
      <aside className="pd-side no-print">
        <div className="pd-top">
          {p.photoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="pd-photo" src={`/api/files/patientphoto/${p.id}`} alt="" />
          ) : (
            <div className="pd-photo pd-glyph" aria-hidden="true">
              {p.sex === "F" ? "♀" : p.sex === "M" ? "♂" : "⚲"}
            </div>
          )}
          <div className="pd-top-actions">
            {data.todayVisit && canStart ? (
              <form action={startEncounter.bind(null, data.todayVisit.id)}>
                <button className="btn" type="submit">
                  {data.todayVisit.encounter ? "Open today's visit" : "Start encounter"}
                </button>
              </form>
            ) : (
              <Link className="btn" href={`/schedule?patientId=${p.id}`}>
                Schedule visit
              </Link>
            )}
            <QuickActions
              patientId={p.id}
              caseId={data.caseId}
              latestEncounterId={data.latestEncounterId}
              canEdit={allowed(role, PATIENT_EDIT_ROLES)}
              canSchedule={can(role, "schedule.view")}
              canBill={can(role, "payments.take")}
            />
          </div>
        </div>
        <h2 className="pd-name">
          {patientName(p)}
          {p.preferredName ? <span className="muted"> “{p.preferredName}”</span> : null}
        </h2>
        <p className="pd-line">
          {ageFromDob(p.dob)}y | {formatDate(p.dob)} | {p.sex} <StatusBadge value={p.status} />
        </p>
        {p.interpreterNeeded && <p className="gw-tag gw-tag-warn">Interpreter needed{p.preferredLanguage ? ` · ${p.preferredLanguage}` : ""}</p>}
        {p.restricted && (
          <p className="gw-tag gw-tag-bad" title={data.access === "EMERGENCY" ? "You opened this chart with emergency access; it is recorded and reviewed" : "Only the care team and administrators can open this chart"}>
            Restricted chart{data.access === "EMERGENCY" ? " · emergency access" : ""}
          </p>
        )}

        <PatientAlerts practiceId={data.practiceId} patientId={p.id} placement="chart" userId={data.viewerId} />

        <div className="pd-block">
          <h4>Patient medical record number</h4>
          <p>{p.mrn}</p>
        </div>
        <div className="pd-block">
          <h4>Address</h4>
          <p className="muted pd-sub">{p.currentAddress === "SECONDARY" ? "Secondary" : "Primary"}</p>
          {street || cityLine ? (
            <p>
              {street}
              {street && cityLine ? <br /> : null}
              {cityLine}
            </p>
          ) : (
            <p className="muted">Not on file</p>
          )}
        </div>
        <div className="pd-block">
          <h4>Phone</h4>
          {p.phone ? (
            <>
              <p className="muted pd-sub">{phoneTypeLabel[p.phoneType ?? ""] ?? "Primary"}</p>
              <p>{p.phone}</p>
            </>
          ) : (
            <p className="muted">Not on file</p>
          )}
          {p.phone2 && (
            <>
              <p className="muted pd-sub">{phoneTypeLabel[p.phone2Type ?? ""] ?? "Secondary"}</p>
              <p>{p.phone2}</p>
            </>
          )}
        </div>
        <div className="pd-block">
          <h4>Text reminders</h4>
          <p>
            {p.textConsent === "YES" ? "Consented" : p.textConsent === "NO" ? "Declined — do not text" : <span className="muted">Consent not recorded</span>}
          </p>
        </div>
        <div className="pd-block">
          <h4>Email</h4>
          <p>{p.noEmail ? "No email" : (p.email ?? <span className="muted">Not on file</span>)}</p>
        </div>
        <Provider label="Wound care physician" p={data.woundCare} />
        <Provider label="Primary care physician" p={data.primaryCare} />
        <Provider label="Referring physician" p={p.referringPhysician} />
        {p.pharmacyName && (
          <div className="pd-block">
            <h4>Pharmacy</h4>
            <p>{p.pharmacyName}</p>
            {(p.pharmacyPhone || p.pharmacyFax) && (
              <p className="muted">{[p.pharmacyPhone ? `Phone: ${p.pharmacyPhone}` : "", p.pharmacyFax ? `Fax: ${p.pharmacyFax}` : ""].filter(Boolean).join("   ")}</p>
            )}
          </div>
        )}
        <div className="pd-block">
          <h4>Patient forms status</h4>
          <p>{data.formRequest ? `${FORM_STATUS[data.formRequest.status] ?? data.formRequest.status} · ${formatDate(data.formRequest.createdAt)}` : "No forms sent"}</p>
        </div>
        {(p.homeHealthCompany || p.homeHealthNurse) && (
          <div className="pd-block">
            <h4>Home health information</h4>
            {p.homeHealthCompany && (
              <>
                <p className="muted pd-sub">Home health company</p>
                <p>{p.homeHealthCompany}</p>
              </>
            )}
            {p.homeHealthNurse && (
              <>
                <p className="muted pd-sub">Home health nurse</p>
                <p>{p.homeHealthNurse}</p>
              </>
            )}
          </div>
        )}
        {p.emergencyContactName && (
          <div className="pd-block">
            <h4>Emergency contact</h4>
            <p>
              {p.emergencyContactName}
              {p.emergencyContactRelationship ? ` (${p.emergencyContactRelationship})` : ""}
            </p>
            {p.emergencyContactPhone && <p className="muted">Phone: {p.emergencyContactPhone}</p>}
          </div>
        )}
        {data.custom.length > 0 && (
          <div className="pd-block">
            <h4>Additional information</h4>
            {data.custom.map((c) => (
              <p key={c.label}>
                <span className="muted">{c.label}:</span> {c.value}
              </p>
            ))}
          </div>
        )}
        {p.registrationNotes && (
          <div className="pd-block">
            <h4>Notes</h4>
            <p className="pd-notes">{p.registrationNotes}</p>
          </div>
        )}
        <form action={setPatientStatus.bind(null, p.id)} className="pd-status">
          <select name="status" defaultValue={p.status} aria-label="Account status">
            {Object.entries(patientAccountStatusLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="btn secondary gw-mini" type="submit">
            Update status
          </button>
        </form>
      </aside>
      <div className="pd-main">
        <PatientTabs
          patientId={p.id}
          tabs={[
            { href: `/patients/${p.id}`, label: "Dashboard" },
            ...(can(role, "patients.scans") ? [{ href: `/patients/${p.id}/insurance`, label: "Insurance & eligibility" }, { href: `/patients/${p.id}/scans`, label: "Documents" }] : []),
            ...(can(role, "careplan.edit") || roleOf(role) === "CLINICIAN" ? [{ href: `/patients/${p.id}/care-plan`, label: "Care plan" }] : []),
            ...(ageFromDob(p.dob) < 20 && can(role, "chart.view") ? [{ href: `/patients/${p.id}/growth`, label: "Growth" }] : []),
            ...(can(role, "payments.take") ? [{ href: `/patients/${p.id}/claims`, label: "Claims & balance" }] : []),
            ...(can(role, "patients.alerts") ? [{ href: `/patients/${p.id}/alerts`, label: "Alerts" }] : []),
            { href: `/patients/${p.id}/thread`, label: "Communication" },
            { href: `/patients/${p.id}/privacy`, label: "Privacy" },
          ]}
        />
        {children}
      </div>
    </div>
  );
}
