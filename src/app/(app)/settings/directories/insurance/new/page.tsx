import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { saveInsurance } from "../../actions";
import { InsuranceForm } from "../insurance-form";

export default async function NewInsurancePage() {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "BILLER", "CREDENTIALING"]);
  const otherPayers = await prisma.payer.findMany({
    where: { practiceId: user.practiceId },
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
          <h1>Add insurance</h1>
        </div>
      </div>
      <InsuranceForm action={saveInsurance.bind(null, null)} otherPayers={otherPayers} submitLabel="Add insurance" />
    </>
  );
}
