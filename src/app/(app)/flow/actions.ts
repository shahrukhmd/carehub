"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { stopBlock } from "@/lib/patient-alerts";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { FLOW_ROLES, recordFlow } from "@/lib/flow";

const STEP: Record<string, string> = { arrive: "CHECKED_IN", room: "IN_ROOM", out: "COMPLETED", noshow: "NO_SHOW", back: "SCHEDULED" };

// Front-desk moves on the flow board. Once the chart is started, only rooming and check-out change the appointment.
export async function flowStep(appointmentId: string, step: string, fd: FormData) {
  const user = await requireUser(FLOW_ROLES);
  const status = STEP[step];
  if (!status) return;
  const appt = await prisma.appointment.findFirst({ where: { id: appointmentId, practiceId: user.practiceId }, include: { encounter: { select: { id: true } } } });
  if (!appt) return;
  if (appt.encounter && !["room", "out"].includes(step)) return;
  if (step === "back" && appt.status !== "NO_SHOW") return;
  if (step === "arrive") {
    const stop = await stopBlock(user.practiceId, appt.patientId, "checkin", user.id);
    if (stop) redirect(`/flow?error=${encodeURIComponent(stop)}&alertPatient=${appt.patientId}`);
  }
  const room = step === "room" ? String(fd.get("room") ?? "").trim().slice(0, 40) || appt.room : appt.room;
  await prisma.appointment.update({ where: { id: appt.id }, data: { status: appt.encounter && step === "room" ? appt.status : status, room } });
  await recordFlow(appt.id, status, user.id, step === "room" ? room : null);
  await logAudit(user.practiceId, user.id, "FLOW_" + step.toUpperCase(), "Appointment", appt.id, room ? `room ${room}` : status);
  revalidatePath("/flow");
  revalidatePath("/schedule");
}
