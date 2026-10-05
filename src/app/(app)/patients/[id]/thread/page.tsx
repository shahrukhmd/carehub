import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PrintButton } from "@/components/PrintButton";
import { PatientThread } from "@/components/PatientThread";
import { THREAD_ROLES } from "@/lib/patient-thread";
import { PatientShell, loadPatientShell } from "../patient-shell";

type Search = { show?: string; threadOk?: string; threadError?: string };

const VIEWS: [string, string][] = [
  ["", "Everything"],
  ["messages", "Team messages only"],
  ["open", "Waiting for a reply"],
];

// The patient's whole thread: what the teams said to each other, with the case, visit and claim history around it.
export default async function PatientThreadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const user = await requireUser(THREAD_ROLES);
  const { id } = await params;
  const sp = await searchParams;
  const shell = await loadPatientShell(id, user);
  const show = VIEWS.some(([k]) => k === sp.show) ? (sp.show ?? "") : "";

  return (
    <PatientShell data={shell}>
      <p className="pd-back no-print">
        <Link href={`/patients/${id}`}>« Back to dashboard</Link>
      </p>
      <div className="pd-head">
        <h1>Team communication</h1>
        <PrintButton label="Print thread" className="btn secondary no-print" />
      </div>
      <nav className="view-tabs no-print" style={{ margin: "0 0 0.8rem", width: "fit-content" }}>
        {VIEWS.map(([k, l]) => (
          <Link key={k} href={`/patients/${id}/thread${k ? `?show=${k}` : ""}`} className={`view-tab${k === show ? " active" : ""}`}>
            {l}
          </Link>
        ))}
      </nav>
      <PatientThread user={user} patientId={id} back={`/patients/${id}/thread${show ? `?show=${show}` : ""}`} only={show || undefined} limit={300} notice={{ ok: sp.threadOk, error: sp.threadError }} />
    </PatientShell>
  );
}
