import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ProviderForm } from "@/components/ProviderForm";
import { lookupNpi, saveProvider } from "../../actions";
import { providerFormOptions } from "../provider-form-data";

export default async function NewProviderPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const user = await requireUser(rolesFor("settings.providers"));
  const fromCredentialing = (await searchParams).from === "credentialing";
  const options = await providerFormOptions(user.practiceId);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            {fromCredentialing ? (
              <Link href="/credentialing">« Credentialing</Link>
            ) : (
              <>
                <Link href="/settings">Settings</Link> · <Link href="/settings/directories?section=providers">Directories</Link>
              </>
            )}
          </p>
          <h1>Add provider</h1>
        </div>
      </div>
      <ProviderForm
        action={saveProvider.bind(null, null)}
        lookupNpi={lookupNpi}
        users={options.users}
        supervisors={options.supervisors}
        groupNames={options.groupNames}
        bdOwners={options.bdOwners}
        submitLabel="Add provider"
        cancelHref={fromCredentialing ? "/credentialing" : "/settings/directories?section=providers"}
        from={fromCredentialing ? "credentialing" : undefined}
      />
    </>
  );
}
