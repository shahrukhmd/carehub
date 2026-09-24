import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { signup } from "./actions";

export default async function SignupPage({
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
            <p className="muted">Set up a new practice</p>
          </div>
        </div>

        <form className="panel stack" action={signup}>
          {error === "email" && <p className="login-error">That email is already in use.</p>}
          <label>
            Practice name
            <input name="practiceName" placeholder="Riverside Family Practice" required />
          </label>
          <label>
            First location name
            <input name="locationName" placeholder="Main Clinic" />
          </label>
          <label>
            City
            <input name="city" />
          </label>
          <label>
            State
            <input name="state" />
          </label>
          <label>
            Your name (practice admin)
            <input name="adminName" required />
          </label>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" required />
          </label>
          <button className="btn" type="submit">
            Create practice
          </button>
        </form>

        <p className="login-hint">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
