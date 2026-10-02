import { requireChartAccess } from "@/lib/privacy";
import { notFound } from "next/navigation";
import { updatePatient } from "@/app/actions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { PATIENT_EDIT_ROLES } from "@/lib/gateway";
import { patientName } from "@/lib/format";
import { PatientForm } from "@/components/PatientForm";

export default async function EditPatientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser(PATIENT_EDIT_ROLES);
  const { id } = await params;
  await requireChartAccess(user, id, `/patients/${id}/edit`);
  const { error } = await searchParams;

  const patient = await prisma.patient.findFirst({ where: { id, practiceId: user.practiceId }, include: { insurances: true } });
  if (!patient) notFound();

  const [payers, providers, locations] = await Promise.all([
    prisma.payer.findMany({
      where: { practiceId: user.practiceId, OR: [{ active: true }, { id: { in: patient.insurances.map((i) => i.payerId) } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.renderingProvider.findMany({
      where: { practiceId: user.practiceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isReferring: true, isRendering: true, isSupervising: true, status: true },
    }),
    // An inactive site stays offered only where this patient already uses it.
    prisma.location.findMany({
      where: { practiceId: user.practiceId, OR: [{ active: true }, { id: { in: [patient.siteOfServiceId, patient.careCenterId].filter((v): v is string => Boolean(v)) } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const customFields = await prisma.customField.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  // Inactive providers stay available only where this patient already uses them.
  const used = [patient.woundCarePhysicianId, patient.primaryCarePhysicianId, patient.supervisingPhysicianId, patient.referringPhysicianId];
  const offered = providers.filter((p) => p.status === "ACTIVE" || used.includes(p.id));

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Registration</p>
          <h1>Edit {patientName(patient)}</h1>
        </div>
      </div>
      <PatientForm
        action={updatePatient.bind(null, patient.id)}
        patient={patient}
        locations={locations}
        providers={offered}
        payers={payers}
        customFields={customFields}
        cancelHref={`/patients/${patient.id}`}
        error={error}
      />
    </>
  );
}
