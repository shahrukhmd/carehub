import Link from "next/link";
import { createPatient } from "@/app/actions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDate, patientName } from "@/lib/format";
import { parseExtraction } from "@/lib/patient-docs";
import { buildRegistrationDraft } from "@/lib/registration-prefill";
import { PatientForm, type ReadDocument } from "@/components/PatientForm";

export default async function NewPatientPage({ searchParams }: { searchParams: Promise<{ error?: string; docs?: string }> }) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN", "INTAKE"]);
  const { error, docs } = await searchParams;
  const ids = (docs ?? "").split(",").filter((s) => /^[a-z0-9]{10,40}$/.test(s)).slice(0, 40);

  const [payers, providers, locations, accounts, read] = await Promise.all([
    prisma.payer.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.renderingProvider.findMany({
      where: { practiceId: user.practiceId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, npi: true, isReferring: true, isRendering: true, isSupervising: true },
    }),
    prisma.location.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.patient.findMany({
      where: { practiceId: user.practiceId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, mrn: true },
    }),
    // Documents already read for this registration: still unlinked, in this practice.
    ids.length ? prisma.patientDocument.findMany({ where: { id: { in: ids }, practiceId: user.practiceId, patientId: null }, orderBy: { createdAt: "asc" } }) : [],
  ]);

  const built = read.length ? buildRegistrationDraft(read, { payers, providers }) : null;
  const documents: ReadDocument[] = read.map((d) => {
    const ex = parseExtraction(d.extraction);
    return {
      id: d.id,
      name: d.name,
      originalName: d.originalName,
      docType: d.docType,
      status: d.status,
      readMethod: d.readMethod,
      pageCount: d.pageCount,
      error: d.error,
      found: ex ? Object.values(ex.fields).filter((f) => f?.value).length : 0,
      summary: ex?.notes ?? null,
    };
  });

  // The same name and date of birth usually means the patient is already registered.
  const draft = built?.draft;
  const duplicate =
    draft?.firstName && draft.lastName && draft.dob
      ? await prisma.patient.findFirst({
          where: { practiceId: user.practiceId, firstName: { equals: draft.firstName }, lastName: { equals: draft.lastName }, dob: { gte: new Date(draft.dob.getTime() - 43_200_000), lte: new Date(draft.dob.getTime() + 43_200_000) } },
          select: { id: true, firstName: true, lastName: true, mrn: true, dob: true },
        })
      : null;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Registration</p>
          <h1>Add patient</h1>
        </div>
      </div>
      {duplicate && (
        <p className="gw-error" role="alert">
          {patientName(duplicate)} ({duplicate.mrn}, born {formatDate(duplicate.dob)}) is already registered with this name and date of birth.{" "}
          <Link href={`/patients/${duplicate.id}/scans?add=1`}>Open their chart to add these documents instead</Link>, or continue below to register a separate patient.
        </p>
      )}
      <PatientForm
        action={createPatient}
        patient={draft ?? null}
        documents={documents}
        review={built ? { filled: built.filled, names: built.names, notes: built.notes, conflicts: built.conflicts } : undefined}
        locations={locations}
        providers={providers}
        payers={payers}
        accounts={accounts}
        cancelHref="/patients"
        error={error}
      />
    </>
  );
}
