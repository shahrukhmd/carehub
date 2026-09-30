import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { SettingsNav, settingsFor } from "./settings-nav";

export default async function SettingsHomePage() {
  const user = await requireUser();
  const sections = settingsFor(user.role);
  if (sections.length === 0) redirect("/");
  // Only one section for this role: go straight there.
  if (sections.length === 1) redirect(sections[0].href);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Practice management</p>
          <h1>Settings</h1>
        </div>
      </div>
      <SettingsNav current="" role={user.role} />
      <div className="st-cards">
        {sections.map((s) => (
          <Link key={s.key} href={s.href} className="panel st-card">
            <strong>{s.label}</strong>
            <span className="muted">{s.description}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
