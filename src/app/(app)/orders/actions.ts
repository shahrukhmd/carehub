"use server";

import { rolesFor } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { faxNumberOrNull, getFaxAdapter } from "@/lib/fax";
import { saveGenerated } from "@/lib/storage";
import { ORDER_ROLES, ORDER_WRITE_ROLES, RESULT_FLAGS, afterResults, ensureOrderCatalog, newRequisition, requisitionPdf } from "@/lib/orders";
import { completeSourceTasks, createTask } from "@/lib/tasks";
import { processInterfaceMessage, receiveInterfaceMessage } from "@/lib/interfaces";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const go = (to: string, msg?: { error?: string; ok?: string }) => {
  const [path] = to.split("?");
  revalidatePath(path);
  revalidatePath("/orders");
  const q = msg?.error ? `error=${encodeURIComponent(msg.error)}` : msg?.ok ? `ok=${encodeURIComponent(msg.ok)}` : "";
  redirect(q ? `${to}${to.includes("?") ? "&" : "?"}${q}` : to);
};

async function ownOrder(practiceId: string, id: string) {
  const o = await prisma.clinicalOrder.findFirst({ where: { id, practiceId }, include: { items: true, provider: true, patient: true } });
  if (!o) redirect("/orders");
  return o;
}

export async function createOrder(fd: FormData) {
  const user = await requireUser(ORDER_WRITE_ROLES);
  await ensureOrderCatalog(user.practiceId);
  const kind = str(fd, "kind") === "IMAGING" ? "IMAGING" : "LAB";
  const patientId = str(fd, "patientId");
  const back = `/orders/new?patientId=${patientId}&kind=${kind}`;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
  if (!patient) go("/orders/new", { error: "Choose the patient." });
  const picked = await prisma.orderCatalogItem.findMany({ where: { practiceId: user.practiceId, id: { in: fd.getAll("item").map(String) } } });
  const custom = str(fd, "custom")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((l) => {
      const [code, ...rest] = l.split(/\s+[-–]\s+|\s{2,}|\t/);
      return rest.length ? { code: code.slice(0, 20), name: rest.join(" ").slice(0, 120) } : { code: "", name: l.slice(0, 120) };
    });
  if (picked.length + custom.length === 0) go(back, { error: `Pick at least one ${kind === "LAB" ? "test" : "study"}.` });
  const providerId = str(fd, "providerId") || null;
  if (providerId && !(await prisma.orderProvider.findFirst({ where: { id: providerId, practiceId: user.practiceId } }))) go(back, { error: "Unknown lab / imaging center." });
  const encounterId = str(fd, "encounterId") || null;
  const order = await prisma.clinicalOrder.create({
    data: {
      practiceId: user.practiceId,
      patientId: patient!.id,
      encounterId: encounterId && (await prisma.encounter.findFirst({ where: { id: encounterId, patientId: patient!.id } })) ? encounterId : null,
      kind,
      providerId,
      orderedById: user.id,
      requisition: newRequisition(),
      priority: ["ROUTINE", "URGENT", "STAT"].includes(str(fd, "priority")) ? str(fd, "priority") : "ROUTINE",
      diagnosisCodes: str(fd, "diagnosisCodes").toUpperCase().slice(0, 200) || null,
      clinicalNotes: str(fd, "clinicalNotes").slice(0, 1000) || null,
      fasting: fd.get("fasting") === "on" || picked.some((p) => p.fasting),
      scheduledFor: str(fd, "scheduledFor") ? new Date(`${str(fd, "scheduledFor")}T09:00:00`) : null,
      items: { create: [...picked.map((p) => ({ code: p.code, name: p.name, specimen: p.specimen })), ...custom.map((c) => ({ code: c.code, name: c.name }))] },
    },
  });
  await logAudit(user.practiceId, user.id, "CREATE_ORDER", "ClinicalOrder", order.id, `${kind} ${order.requisition}`);
  if (fd.get("sign") === "on") {
    await prisma.clinicalOrder.update({ where: { id: order.id }, data: { status: "SIGNED", signedAt: new Date() } });
  }
  go(`/orders/${order.id}`, { ok: fd.get("sign") === "on" ? "Order signed — send it to the lab or print the requisition." : "Draft saved." });
}

export async function signOrder(id: string) {
  const user = await requireUser(ORDER_WRITE_ROLES);
  const o = await ownOrder(user.practiceId, id);
  if (o.status !== "DRAFT") go(`/orders/${id}`, { error: "Only drafts can be signed." });
  await prisma.clinicalOrder.update({ where: { id }, data: { status: "SIGNED", signedAt: new Date(), orderedById: user.id } });
  await logAudit(user.practiceId, user.id, "SIGN_ORDER", "ClinicalOrder", id, o.requisition);
  go(`/orders/${id}`, { ok: "Signed." });
}

export async function sendOrder(id: string, fd: FormData) {
  const user = await requireUser(ORDER_ROLES);
  const o = await ownOrder(user.practiceId, id);
  if (!["SIGNED", "SENT"].includes(o.status)) go(`/orders/${id}`, { error: "Sign the order before sending it." });
  const method = str(fd, "method") || o.provider?.sendMethod || "PRINT";
  const pdf = await requisitionPdf(o.id, user.practiceId);
  // Keep a copy of the requisition in the patient's documents.
  const stored = await saveGenerated(user.practiceId, pdf, ".pdf");
  const doc = await prisma.patientDocument.create({
    data: {
      practiceId: user.practiceId,
      patientId: o.patientId,
      name: `${new Date().toISOString().slice(0, 10)} ${o.kind === "LAB" ? "Lab" : "Imaging"} requisition ${o.requisition} - ${o.patient.lastName}, ${o.patient.firstName}.pdf`.slice(0, 180),
      originalName: `Requisition ${o.requisition}.pdf`,
      filePath: stored.filePath,
      mimeType: "application/pdf",
      sizeBytes: stored.sizeBytes,
      docType: "ORDERS",
      status: "APPLIED",
      uploadedById: user.id,
    },
  });
  if (method === "ELECTRONIC") go(`/orders/${id}`, { error: "No electronic lab interface is connected yet — fax or print the requisition instead." });
  if (method === "FAX") {
    const number = faxNumberOrNull(str(fd, "fax") || o.provider?.fax);
    if (!number) go(`/orders/${id}`, { error: "Enter the lab's 10-digit fax number." });
    const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId } });
    const r = await getFaxAdapter(settings?.faxProvider).send({ to: number!, recipientName: o.provider?.name ?? null, pages: 1, title: `Requisition ${o.requisition}` });
    const fax = await prisma.fax.create({
      data: { practiceId: user.practiceId, direction: "OUTBOUND", status: r.status, faxNumber: number!, recipientName: o.provider?.name ?? "Lab", pages: 1, contentType: `${o.kind === "LAB" ? "Lab" : "Imaging"} order ${o.requisition}`, patientId: o.patientId, encounterId: o.encounterId, documentId: doc.id, error: r.error ?? null, providerRef: r.providerRef ?? null, userId: user.id, sentAt: new Date() },
    });
    if (r.status !== "SUCCESS") go(`/orders/${id}`, { error: `Fax failed: ${r.error ?? "unknown error"}` });
    await prisma.clinicalOrder.update({ where: { id }, data: { status: "SENT", sentVia: "FAX", sentAt: new Date(), faxId: fax.id } });
  } else {
    await prisma.clinicalOrder.update({ where: { id }, data: { status: "SENT", sentVia: "PRINT", sentAt: new Date() } });
  }
  await logAudit(user.practiceId, user.id, "SEND_ORDER", "ClinicalOrder", id, `${o.requisition} via ${method}`);
  go(`/orders/${id}`, { ok: method === "FAX" ? `Faxed to ${o.provider?.name ?? "the lab"}.` : "Marked as given to the patient — print the requisition." });
}

export async function recordCollection(id: string, fd: FormData) {
  const user = await requireUser(ORDER_ROLES);
  await ownOrder(user.practiceId, id);
  const at = str(fd, "collectedAt") ? new Date(str(fd, "collectedAt")) : new Date();
  await prisma.clinicalOrder.update({ where: { id }, data: { collectedAt: Number.isNaN(at.getTime()) ? new Date() : at, collectedBy: str(fd, "collectedBy").slice(0, 60) || user.name } });
  go(`/orders/${id}`, { ok: "Specimen collection recorded." });
}

// Results are clinical data: entered by the clinical team only (the front office can order and print).
const RESULT_ROLES = rolesFor("results.enter");

export async function enterResults(id: string, fd: FormData) {
  const user = await requireUser(RESULT_ROLES);
  const o = await ownOrder(user.practiceId, id);
  let n = 0;
  for (const it of o.items) {
    const value = str(fd, `value_${it.id}`);
    const report = str(fd, `report_${it.id}`);
    if (!value && !report) continue;
    const flag = RESULT_FLAGS[str(fd, `flag_${it.id}`)] ? str(fd, `flag_${it.id}`) : "NORMAL";
    await prisma.clinicalResult.create({
      data: { orderId: o.id, code: it.code || null, name: it.name, value: value.slice(0, 200) || null, unit: str(fd, `unit_${it.id}`).slice(0, 30) || null, referenceRange: str(fd, `range_${it.id}`).slice(0, 60) || null, flag, reportText: report.slice(0, 20000) || null, source: "MANUAL" },
    });
    await prisma.clinicalOrderItem.update({ where: { id: it.id }, data: { status: "RESULTED" } });
    n++;
  }
  const docId = str(fd, "documentId");
  if (docId) {
    const doc = await prisma.patientDocument.findFirst({ where: { id: docId, patientId: o.patientId, practiceId: user.practiceId } });
    if (doc) {
      await prisma.clinicalResult.create({ data: { orderId: o.id, name: `Report: ${doc.name}`.slice(0, 200), documentId: doc.id, source: "DOCUMENT", flag: str(fd, "docFlag") === "ABNORMAL" ? "ABNORMAL" : "NORMAL" } });
      n++;
    }
  }
  if (!n) go(`/orders/${id}`, { error: "Enter at least one result or attach the report." });
  await afterResults(o.id, user.id);
  await logAudit(user.practiceId, user.id, "ENTER_RESULTS", "ClinicalOrder", id, `${n} results`);
  go(`/orders/${id}`, { ok: `${n} result${n === 1 ? "" : "s"} filed — sent to the ordering provider to review.` });
}

export async function reviewResults(id: string, fd: FormData) {
  const user = await requireUser(ORDER_WRITE_ROLES);
  const o = await ownOrder(user.practiceId, id);
  const note = str(fd, "note").slice(0, 500) || null;
  await prisma.clinicalResult.updateMany({ where: { orderId: o.id, reviewedAt: null }, data: { reviewedAt: new Date(), reviewedById: user.id, reviewNote: note } });
  await prisma.clinicalOrder.update({ where: { id: o.id }, data: { status: o.items.some((i) => i.status === "ORDERED") ? "PARTIAL" : "REVIEWED" } });
  await completeSourceTasks(user.practiceId, "ORDER_RESULT", o.id, user.id);
  if (fd.get("notify") === "on") {
    await createTask({
      practiceId: user.practiceId,
      type: "CALLBACK",
      title: `Call ${o.patient.firstName} ${o.patient.lastName} with ${o.kind === "LAB" ? "lab" : "imaging"} results`,
      body: note ?? "Results reviewed — please let the patient know.",
      patientId: o.patientId,
      assignedRole: "FRONT_DESK",
      createdById: user.id,
      link: `/orders/${o.id}`,
    });
  }
  await logAudit(user.practiceId, user.id, "REVIEW_RESULTS", "ClinicalOrder", id, note ?? "reviewed");
  go(`/orders/${id}`, { ok: fd.get("notify") === "on" ? "Reviewed — a call-back task went to the front desk." : "Results reviewed and signed off." });
}

export async function cancelOrder(id: string, fd: FormData) {
  const user = await requireUser(ORDER_WRITE_ROLES);
  await ownOrder(user.practiceId, id);
  await prisma.clinicalOrder.update({ where: { id }, data: { status: "CANCELLED", cancelledReason: str(fd, "reason").slice(0, 200) || "Cancelled" } });
  await completeSourceTasks(user.practiceId, "ORDER_RESULT", id, user.id);
  go(`/orders/${id}`, { ok: "Order cancelled." });
}

export async function importResultsFile(fd: FormData) {
  const user = await requireUser(RESULT_ROLES);
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) go("/orders?view=import", { error: "Choose an HL7 results file." });
  if ((file as File).size > 5_000_000) go("/orders?view=import", { error: "The file is larger than 5 MB." });
  try {
    const r = await receiveInterfaceMessage(user.practiceId, await (file as File).text(), { channel: "FILE", userId: user.id });
    go(r.status === "FILED" ? "/orders?view=review" : "/orders?view=inbox", r.status === "FILED" ? { ok: r.message.detail ?? "Results filed." } : { error: r.message.detail ?? r.status });
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith("NEXT_")) throw err;
    go("/orders?view=import", { error: (err as Error).message });
  }
}

// ---- Interface inbox: messages that could not be filed automatically ----

async function ownMessage(practiceId: string, id: string) {
  const m = await prisma.interfaceMessage.findFirst({ where: { id, practiceId } });
  if (!m) go("/orders?view=inbox", { error: "Message not found." });
  return m!;
}

// File the message on a chosen order (by order id from the suggestions, or a typed requisition number).
export async function linkInterfaceMessage(id: string, fd: FormData) {
  const user = await requireUser(RESULT_ROLES);
  const m = await ownMessage(user.practiceId, id);
  if (m.status === "FILED" || m.status === "DISCARDED") go("/orders?view=inbox", { error: "This message was already handled." });
  const orderId = str(fd, "orderId");
  const req = str(fd, "requisition").toUpperCase();
  const order = orderId ? await prisma.clinicalOrder.findFirst({ where: { id: orderId, practiceId: user.practiceId } }) : req ? await prisma.clinicalOrder.findFirst({ where: { practiceId: user.practiceId, requisition: req } }) : null;
  if (!order) go("/orders?view=inbox", { error: req ? `No order with requisition ${req}.` : "Pick an order or type a requisition number." });
  if (order!.status === "CANCELLED") go("/orders?view=inbox", { error: "That order was cancelled." });
  const r = await processInterfaceMessage(m.id, user.id, order!.requisition);
  await logAudit(user.practiceId, user.id, "LINK_INTERFACE_MESSAGE", "ClinicalOrder", order!.id, `${r.filed} results from message ${m.controlId ?? m.id}`);
  go(r.status === "FILED" ? `/orders/${order!.id}` : "/orders?view=inbox", r.status === "FILED" ? { ok: r.message.detail ?? "Filed." } : { error: r.message.detail ?? r.status });
}

// Try again as received (after the order was created or the requisition corrected).
export async function replayInterfaceMessage(id: string) {
  const user = await requireUser(RESULT_ROLES);
  const m = await ownMessage(user.practiceId, id);
  if (m.status === "FILED") go("/orders?view=inbox", { error: "Already filed; replaying would duplicate the results." });
  const r = await processInterfaceMessage(m.id, user.id);
  go("/orders?view=inbox", r.status === "FILED" ? { ok: r.message.detail ?? "Filed." } : { error: r.message.detail ?? r.status });
}

export async function discardInterfaceMessage(id: string, fd: FormData) {
  const user = await requireUser(RESULT_ROLES);
  const m = await ownMessage(user.practiceId, id);
  const reason = str(fd, "reason").slice(0, 200);
  if (!reason) go("/orders?view=inbox", { error: "Say why the message is being discarded (it stays in the log)." });
  await prisma.interfaceMessage.update({ where: { id: m.id }, data: { status: "DISCARDED", detail: `Discarded by ${user.name}: ${reason}` } });
  await logAudit(user.practiceId, user.id, "DISCARD_INTERFACE_MESSAGE", "InterfaceMessage", m.id, reason);
  go("/orders?view=inbox", { ok: "Message discarded (kept in the log)." });
}

// ---- Settings: labs, imaging centers & catalog ----

export async function saveOrderProvider(id: string, fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const name = str(fd, "name").slice(0, 120);
  if (!name) go("/settings/orders", { error: "Name the lab or imaging center." });
  const data = {
    kind: str(fd, "kind") === "IMAGING" ? "IMAGING" : "LAB",
    name,
    phone: str(fd, "phone").slice(0, 20) || null,
    fax: str(fd, "fax").slice(0, 20) || null,
    accountNumber: str(fd, "accountNumber").slice(0, 40) || null,
    sendMethod: ["FAX", "PRINT", "ELECTRONIC"].includes(str(fd, "sendMethod")) ? str(fd, "sendMethod") : "FAX",
    active: fd.get("active") !== "off",
  };
  if (id === "new") await prisma.orderProvider.create({ data: { ...data, practiceId: user.practiceId } });
  else await prisma.orderProvider.updateMany({ where: { id, practiceId: user.practiceId }, data });
  go("/settings/orders", { ok: "Saved." });
}

export async function addCatalogItem(fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const name = str(fd, "name").slice(0, 120);
  if (!name) go("/settings/orders", { error: "Name the test or study." });
  await prisma.orderCatalogItem.create({
    data: { practiceId: user.practiceId, kind: str(fd, "kind") === "IMAGING" ? "IMAGING" : "LAB", code: str(fd, "code").slice(0, 20), name, category: str(fd, "category").slice(0, 40) || null, specimen: str(fd, "specimen").slice(0, 60) || null, fasting: fd.get("fasting") === "on" },
  });
  go("/settings/orders", { ok: "Added to the catalog." });
}

export async function toggleCatalogItem(id: string) {
  const user = await requireUser(rolesFor("settings.admin"));
  const it = await prisma.orderCatalogItem.findFirst({ where: { id, practiceId: user.practiceId } });
  if (it) await prisma.orderCatalogItem.update({ where: { id }, data: { active: !it.active } });
  go("/settings/orders");
}
