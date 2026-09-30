import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { ProviderForm } from "@/components/ProviderForm";
import { lookupNpi, saveProvider, toggleProviderActive } from "../../actions";
import { providerFormOptions, splitDisplayName } from "../provider-form-data";

export default async function EditProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["ADMIN", "CREDENTIALING", "FRONT_DESK"]);
  const { id } = await params;

  const provider = await prisma.renderingProvider.findFirst({ where: { id, practiceId: user.practiceId } });
  if (!provider) notFound();

  const options = await providerFormOptions(user.practiceId, provider.id, provider.userId);
  const names = provider.firstName
    ? { firstName: provider.firstName, middleName: provider.middleName ?? "", lastName: provider.lastName ?? "" }
    : splitDisplayName(provider.name);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link> · <Link href="/settings/directories?section=providers">Directories</Link>
          </p>
          <h1>
            {provider.name}
            {provider.credential ? `, ${provider.credential}` : ""} <StatusBadge value={provider.status} />
          </h1>
        </div>
        <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
          {provider.isRendering && ["ADMIN", "CREDENTIALING"].includes(user.role) && (
            <Link className="btn secondary" href={`/credentialing/providers/${provider.id}`}>
              Credentialing file
            </Link>
          )}
          <form action={toggleProviderActive.bind(null, provider.id)}>
            <button className="btn secondary" type="submit">
              {provider.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
            </button>
          </form>
        </div>
      </div>
      <ProviderForm
        action={saveProvider.bind(null, provider.id)}
        lookupNpi={lookupNpi}
        initial={{ ...provider, ...names }}
        users={options.users}
        supervisors={options.supervisors}
        groupNames={options.groupNames}
        submitLabel="Save changes"
        cancelHref="/settings/directories?section=providers"
      />
    </>
  );
}
