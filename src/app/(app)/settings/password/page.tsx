import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PASSWORD_ERRORS, PASSWORD_MIN } from "@/lib/organization";
import { changePassword } from "@/app/login/actions";
import { SettingsNav } from "../settings-nav";

// Every signed-in user can change their own password here.
export default async function PasswordSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>My password</h1>
        </div>
      </div>
      <SettingsNav current="password" role={user.role} />
      <section className="panel" style={{ maxWidth: "32rem" }}>
        {sp.saved && <p className="notice-ok">Password changed. Your other sessions were signed out.</p>}
        {sp.error && (
          <p className="gw-error" role="alert">
            {PASSWORD_ERRORS[sp.error] ?? "Could not change the password."}
          </p>
        )}
        <form className="stack" action={changePassword}>
          <input type="hidden" name="back" value="settings" />
          <label>
            Current password
            <input name="current" type="password" autoComplete="current-password" required />
          </label>
          <label>
            New password
            <input name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required />
          </label>
          <label>
            New password again
            <input name="confirm" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required />
          </label>
          <p className="muted cn-small">
            At least {PASSWORD_MIN} characters with letters and a number.
            {user.passwordChangedAt ? ` Last changed ${user.passwordChangedAt.toLocaleDateString("en-US")}.` : ""}
          </p>
          <button className="btn" type="submit">
            Change password
          </button>
        </form>
      </section>
    </>
  );
}
