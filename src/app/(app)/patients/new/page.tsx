import Link from "next/link";
import { createPatient } from "@/app/actions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  employmentStatusLabel,
  ethnicityLabel,
  maritalStatusLabel,
  raceLabel,
  smokingStatusLabel,
} from "@/lib/format";

export default async function NewPatientPage() {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);

  const [payers, physicians, patients] = await Promise.all([
    prisma.payer.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { name: "asc" } }),
    prisma.referringPhysician.findMany({
      where: { practiceId: user.practiceId, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.patient.findMany({
      where: { practiceId: user.practiceId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, mrn: true },
    }),
  ]);

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
            <select name="payerId" defaultValue="">
              <option value="">Self-pay</option>
              {payers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Member ID
            <input name="memberId" />
          </label>
          <label>
            Referring physician
            <select name="referringPhysicianId" defaultValue="">
              <option value="">—</option>
              {physicians.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <h2>Demographics</h2>
        <div className="form-grid">
          <label>
            Race
            <select name="race" defaultValue="">
              <option value="">—</option>
              {Object.entries(raceLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ethnicity
            <select name="ethnicity" defaultValue="">
              <option value="">—</option>
              {Object.entries(ethnicityLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Marital status
            <select name="maritalStatus" defaultValue="">
              <option value="">—</option>
              {Object.entries(maritalStatusLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Employment status
            <select name="employmentStatus" defaultValue="">
              <option value="">—</option>
              {Object.entries(employmentStatusLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Smoking status
            <select name="smokingStatus" defaultValue="">
              <option value="">—</option>
              {Object.entries(smokingStatusLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <h2>Emergency contact</h2>
        <div className="form-grid">
          <label>
            Name
            <input name="emergencyContactName" />
          </label>
          <label>
            Phone
            <input name="emergencyContactPhone" />
          </label>
          <label>
            Relationship
            <input name="emergencyContactRelationship" placeholder="Spouse, parent, ..." />
          </label>
        </div>

        <h2>Guarantor</h2>
        <p className="muted">
          Link to an existing patient (e.g. a parent) to combine this account&apos;s billing statements onto theirs,
          or leave unlinked and fill in the guarantor contact directly.
        </p>
        <div className="form-grid">
          <label>
            Guarantor account (existing patient)
            <select name="guarantorPatientId" defaultValue="">
              <option value="">— None, use fields below —</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.lastName}, {p.firstName} ({p.mrn})
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input name="guarantorName" placeholder="Defaults to patient if left blank" />
          </label>
          <label>
            Relationship to patient
            <input name="guarantorRelationship" placeholder="Self, parent, ..." />
          </label>
          <label>
            Phone
            <input name="guarantorPhone" />
          </label>
        </div>

        <p className="muted">
          Payer or referring physician missing? <Link href="/directories">Add it to Directories</Link> first.
        </p>
        <button className="btn" type="submit">
          Create chart
        </button>
      </form>
    </>
  );
}
