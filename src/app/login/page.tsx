import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthFrame } from "@/components/AuthFrame";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const { error } = await searchParams;

  return (
    <AuthFrame title="Welcome to CareHub" subtitle="Sign in with your CareHub account.">
      <form className="stack" action={login}>
        {error && (
          <p className="login-error">
            {error === "locked"
              ? "This account is locked after too many failed attempts. Try again later or ask an administrator to unlock it."
              : error === "ip"
                ? "Sign-in from this network is not allowed for your organization."
                : error === "terminated"
                  ? "This client account is closed. Contact your billing company."
                  : error === "code"
                    ? "The sign-in code was wrong too many times or expired. Sign in again."
                    : "Incorrect username or password."}
          </p>
        )}
        <label>
          Username or email
          <input name="username" autoComplete="username" placeholder="name@clinic.com" required autoFocus />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="btn btn-lg" type="submit">
          Sign in
        </button>
      </form>

      <div className="auth-divider">
        <span>or, for the demo</span>
      </div>
      <p className="login-hint">
        Demo accounts (password <code>carehub123</code>): maya.chen@carehub.local (clinician), priya.shah@carehub.local (front desk),
        alex.rivera@carehub.local (biller), admin@carehub.local (admin, Riverside Family Practice); admin@lakeside.local (admin, Lakeside
        Pediatrics — a separate practice, to see tenant isolation).
      </p>
      <p className="login-hint">
        New practice? <Link href="/signup">Create one</Link>
      </p>
    </AuthFrame>
  );
}
