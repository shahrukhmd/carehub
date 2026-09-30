import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { saveInsurance, togglePayerActive } from "../../actions";
import { InsuranceForm } from "../insurance-form";

export default async function EditInsurancePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "BILLER", "CREDENTIALING"]);
  const { id } = await params;

  const payer = await prisma.payer.findFirst({ where: { id, practiceId: user.practiceId } });
  if (!payer) notFound();
  const otherPayers = await prisma.payer.findMany({
    where: { practiceId: user.practiceId, id: { not: payer.id } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link> · <Link href="/settings/directories?section=insurance">Directories</Link>
          </p>
          <h1>
            {payer.name} <StatusBadge value={payer.active ? "ACTIVE" : "INACTIVE"} />
          </h1>
        </div>
        <form action={togglePayerActive.bind(null, payer.id)}>
          <button className="btn secondary" type="submit">
            {payer.active ? "Deactivate" : "Reactivate"}
          </button>
        </form>
      </div>
      <InsuranceForm
        action={saveInsurance.bind(null, payer.id)}
        payer={payer}
        otherPayers={otherPayers}
        submitLabel="Save changes"
      />
    </>
  );
}
