import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ProviderForm } from "@/components/ProviderForm";
import { lookupNpi, saveProvider } from "../../actions";
import { providerFormOptions } from "../provider-form-data";

export default async function NewProviderPage() {
  const user = await requireUser(["ADMIN", "CREDENTIALING", "FRONT_DESK"]);
  const options = await providerFormOptions(user.practiceId);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link> · <Link href="/settings/directories?section=providers">Directories</Link>
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
        submitLabel="Add provider"
        cancelHref="/settings/directories?section=providers"
      />
    </>
  );
}
