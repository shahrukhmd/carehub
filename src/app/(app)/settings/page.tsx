import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { SETTINGS_GROUPS, settingsFor } from "./settings-nav";
import { SettingsHome } from "./settings-home";

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
          <p className="muted">Practice management · {sections.length} settings in {new Set(sections.map((s) => s.group)).size} groups</p>
          <h1>Settings</h1>
        </div>
      </div>
      <SettingsHome
        groups={SETTINGS_GROUPS.map((g) => ({
          ...g,
          cards: sections.filter((s) => s.group === g.key).map(({ key, href, label, description }) => ({ key, href, label, description })),
        })).filter((g) => g.cards.length > 0)}
      />
    </div>
  );
}
