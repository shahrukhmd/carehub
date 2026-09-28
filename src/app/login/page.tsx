import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
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
    <div className="login-shell">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">CH</span>
          <div>
            <strong>CareHub</strong>
            <p className="muted">Integrated EHR &amp; PM</p>
          </div>
        </div>

        <form className="panel stack" action={login}>
          {error && <p className="login-error">Incorrect username or password.</p>}
          <label>
            Username or email
            <input name="username" autoComplete="username" required autoFocus />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="btn" type="submit">
            Sign in
          </button>
        </form>

        <p className="login-hint">
          Demo accounts (password <code>carehub123</code>): maya.chen@carehub.local (clinician),
          priya.shah@carehub.local (front desk), alex.rivera@carehub.local (biller),
          admin@carehub.local (admin, Riverside Family Practice); admin@lakeside.local (admin, Lakeside
          Pediatrics — a separate practice, to see tenant isolation).
        </p>
        <p className="login-hint">
          New practice? <Link href="/signup">Create one</Link>
        </p>
      </div>
    </div>
  );
}
