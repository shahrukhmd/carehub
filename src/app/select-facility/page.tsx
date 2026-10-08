import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { roleLabel } from "@/lib/format";
import { AuthFrame } from "@/components/AuthFrame";
import { chooseFacility, logout } from "../login/actions";

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default async function SelectFacilityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.memberships.length <= 1) redirect("/");

  return (
    <AuthFrame
      title="Which facility are you working in?"
      subtitle={
        user.isMaster
          ? "Master login: credentialing boards and reports include all your practices. You can switch facility any time from the top bar."
          : "You'll only see that facility's data. You can switch any time from the top bar."
      }
      icon={
        <svg viewBox="0 0 24 24">
          <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
          <circle cx="12" cy="9.5" r="2.5" />
        </svg>
      }
      aside={
        <div className="auth-person">
          <span className="avatar avatar-xl">{initials(user.name)}</span>
          <strong>{user.name}</strong>
          <span>{roleLabel[user.role] ?? user.role}</span>
        </div>
      }
    >
      <form className="facility-choices" action={chooseFacility}>
        {user.memberships.map((m) => (
          <button key={m.practiceId} type="submit" name="practiceId" value={m.practiceId} autoFocus={m.practiceId === user.practiceId}>
            <strong>{m.practice.name}</strong>
            <small>
              {m.practice.state ? `${m.practice.state} · ` : ""}
              {roleLabel[m.role] ?? m.role}
            </small>
          </button>
        ))}
      </form>
      <form action={logout}>
        <button className="btn ghost auth-signout" type="submit">
          Sign out
        </button>
      </form>
    </AuthFrame>
  );
}
