import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { PATIENT_VIEW_ROLES } from "@/lib/gateway";
import { WIDGETS, parseWidgets } from "@/lib/patient-dashboard";
import { WidgetConfigurator } from "@/components/WidgetConfigurator";
import { saveDashboardWidgets } from "./actions";

export default async function DashboardWidgetsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(PATIENT_VIEW_ROLES);
  const { id } = await params;
  const patient = await prisma.patient.findFirst({ where: { id, practiceId: user.practiceId }, select: { id: true } });
  if (!patient) notFound();
  const all = Object.entries(WIDGETS).map(([key, w]) => ({ key, title: w.title, span: w.span, about: w.about }));

  return (
    <form action={saveDashboardWidgets.bind(null, patient.id)}>
      <WidgetConfigurator all={all} initial={parseWidgets(user.patientDashboard)} canCopy={user.role === "ADMIN"} cancelHref={`/patients/${patient.id}`} />
    </form>
  );
}
