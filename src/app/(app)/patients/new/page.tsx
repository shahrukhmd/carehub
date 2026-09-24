import { createPatient } from "@/app/actions";
import { requireUser } from "@/lib/auth";

export default async function NewPatientPage() {
  await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);
  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Registration</p>
          <h1>New patient</h1>
        </div>
      </div>
      <form className="panel stack" action={createPatient}>
        <div className="form-grid">
          <label>
            First name
            <input name="firstName" required />
          </label>
          <label>
            Last name
            <input name="lastName" required />
          </label>
          <label>
            Date of birth
            <input name="dob" type="date" required />
          </label>
          <label>
            Sex
            <select name="sex" defaultValue="F">
              <option value="F">Female</option>
              <option value="M">Male</option>
              <option value="X">Unspecified</option>
            </select>
          </label>
          <label>
            Phone
            <input name="phone" />
          </label>
          <label>
            Email
            <input name="email" type="email" />
          </label>
          <label>
            Address
            <input name="addressLine1" />
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
            ZIP
            <input name="zip" />
          </label>
          <label>
            Primary payer
            <input name="payerName" placeholder="Horizon Blue Cross" />
          </label>
          <label>
            Member ID
            <input name="memberId" />
          </label>
        </div>
        <button className="btn" type="submit">
          Create chart
        </button>
      </form>
    </>
  );
}
