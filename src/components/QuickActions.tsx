import Link from "next/link";

// Patient "Quick Actions" menu shared by the chart and the gateway case page.
export function QuickActions({
  patientId,
  caseId,
  latestEncounterId,
  canEdit,
  canSchedule,
  canBill,
}: {
  patientId: string;
  caseId?: string | null;
  latestEncounterId?: string | null;
  canEdit: boolean;
  canSchedule: boolean;
  canBill: boolean;
}) {
  const items: { href: string; label: string }[] = [
    { href: `/patients/${patientId}`, label: "Patient dashboard" },
    ...(canEdit ? [{ href: `/patients/${patientId}/edit`, label: "Edit patient details" }] : []),
    { href: `/patients/${patientId}/insurance`, label: "Insurance, authorizations & eligibility" },
    { href: `/patients/${patientId}/scans`, label: "Scans" },
    ...(caseId ? [{ href: `/gateway/${caseId}`, label: "Patient Gateway case" }] : []),
    { href: `/patients/${patientId}/face-sheet`, label: "Patient demographics report (face sheet)" },
    ...(caseId ? [{ href: `/gateway/${caseId}/report`, label: "Patient authorization report" }] : []),
    ...(latestEncounterId ? [{ href: `/encounters/${latestEncounterId}/print`, label: "Latest visit report" }] : []),
    ...(canSchedule ? [{ href: `/schedule?patientId=${patientId}`, label: "Book appointment" }] : []),
    ...(canBill ? [{ href: `/patients/${patientId}/claims`, label: "Claims" }] : []),
    ...(canBill ? [{ href: `/patients/${patientId}/statement`, label: "Patient statement" }] : []),
  ];

  return (
    <details className="quick-actions">
      <summary>Quick actions</summary>
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href}>{item.label}</Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
