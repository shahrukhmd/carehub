import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { chooseFacility } from "../login/actions";

export default async function SelectFacilityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.memberships.length <= 1) redirect("/");

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">CH</span>
          <div>
            <strong>CareHub</strong>
            <p className="muted">Welcome, {user.name}</p>
          </div>
        </div>

        <form className="panel stack" action={chooseFacility}>
          <label>
            Facility
            <select name="practiceId" defaultValue={user.practiceId} autoFocus>
              {user.memberships.map((m) => (
                <option key={m.practiceId} value={m.practiceId}>
                  {m.practice.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit">
            Continue
          </button>
          <p className="login-hint">
            {user.isMaster
              ? "Master login: credentialing boards and reports include all your practices; switch facility any time from the top bar."
              : "You can switch facility any time from the top bar without signing out."}
          </p>
        </form>
      </div>
    </div>
  );
}
