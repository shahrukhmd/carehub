import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PASSWORD_ERRORS, PASSWORD_MIN } from "@/lib/organization";
import { changePassword, logout } from "../actions";


// A forced password change: after an administrator reset, on first sign-in, or when the password is older
// than the organization's policy allows. Nothing else in CareHub opens until it is done.
export default async function ForcedPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getCurrentUser({ allowPasswordChange: true });
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect("/");
  const sp = await searchParams;

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">CH</span>
          <div>
            <strong>CareHub</strong>
            <p className="muted">Choose a new password</p>
          </div>
        </div>
        <form className="panel stack" action={changePassword}>
          <p className="muted">Your password was reset or has expired. Set a new one to continue, {user.name.split(" ")[0]}.</p>
          {sp.error && <p className="login-error">{PASSWORD_ERRORS[sp.error] ?? "Could not change the password."}</p>}
          <label>
            Current (temporary) password
            <input name="current" type="password" autoComplete="current-password" required autoFocus />
          </label>
          <label>
            New password
            <input name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required />
          </label>
          <label>
            New password again
            <input name="confirm" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required />
          </label>
          <button className="btn" type="submit">
            Save and continue
          </button>
        </form>
        <form action={logout}>
          <button className="btn ghost" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
