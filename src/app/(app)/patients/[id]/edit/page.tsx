import Link from "next/link";
import { notFound } from "next/navigation";
import { updatePatient } from "@/app/actions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { PATIENT_EDIT_ROLES } from "@/lib/gateway";
import {
  employmentStatusLabel,
  ethnicityLabel,
  maritalStatusLabel,
  patientName,
  raceLabel,
  smokingStatusLabel,
} from "@/lib/format";

function dateInputValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(PATIENT_EDIT_ROLES);
  const { id } = await params;

  const patient = await prisma.patient.findFirst({
    where: { id, practiceId: user.practiceId },
    include: { insurances: { where: { isPrimary: true }, include: { payer: true } } },
  });
  if (!patient) notFound();

  const primaryInsurance = patient.insurances[0];

  const [payers, physicians] = await Promise.all([
    prisma.payer.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { name: "asc" } }),
    prisma.renderingProvider.findMany({
      where: { practiceId: user.practiceId, isReferring: true, status: "ACTIVE" },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Registration</p>
          <h1>Edit {patientName(patient)}</h1>
        </div>
        <Link className="btn secondary" href={`/patients/${patient.id}`}>
          Cancel
        </Link>
      </div>
      <form className="panel stack" action={updatePatient.bind(null, patient.id)}>
        <div className="form-grid">
          <label>
            First name
            <input name="firstName" defaultValue={patient.firstName} required />
          </label>
          <label>
            Last name
            <input name="lastName" defaultValue={patient.lastName} required />
          </label>
          <label>
            Date of birth
            <input name="dob" type="date" defaultValue={dateInputValue(patient.dob)} required />
          </label>
          <label>
            Sex
            <select name="sex" defaultValue={patient.sex}>
              <option value="F">Female</option>
              <option value="M">Male</option>
              <option value="X">Unspecified</option>
            </select>
          </label>
          <label>
            Phone
            <input name="phone" defaultValue={patient.phone ?? ""} />
          </label>
          <label>
            Email
            <input name="email" type="email" defaultValue={patient.email ?? ""} />
          </label>
          <label>
            Address
            <input name="addressLine1" defaultValue={patient.addressLine1 ?? ""} />
          </label>
          <label>
            City
            <input name="city" defaultValue={patient.city ?? ""} />
          </label>
          <label>
            State
            <input name="state" defaultValue={patient.state ?? ""} />
          </label>
          <label>
            ZIP
            <input name="zip" defaultValue={patient.zip ?? ""} />
          </label>
          <label>
            Primary payer
            <select name="payerId" defaultValue={primaryInsurance?.payerId ?? ""}>
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
            <input name="memberId" defaultValue={primaryInsurance?.memberId ?? ""} />
          </label>
          <label>
            Plan name
            <input name="planName" defaultValue={primaryInsurance?.planName ?? ""} />
          </label>
          <label>
            Referring physician
            <select name="referringPhysicianId" defaultValue={patient.referringPhysicianId ?? ""}>
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
            <select name="race" defaultValue={patient.race ?? ""}>
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
            <select name="ethnicity" defaultValue={patient.ethnicity ?? ""}>
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
            <select name="maritalStatus" defaultValue={patient.maritalStatus ?? ""}>
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
            <select name="employmentStatus" defaultValue={patient.employmentStatus ?? ""}>
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
            <select name="smokingStatus" defaultValue={patient.smokingStatus ?? ""}>
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
            <input name="emergencyContactName" defaultValue={patient.emergencyContactName ?? ""} />
          </label>
          <label>
            Phone
            <input name="emergencyContactPhone" defaultValue={patient.emergencyContactPhone ?? ""} />
          </label>
          <label>
            Relationship
            <input
              name="emergencyContactRelationship"
              defaultValue={patient.emergencyContactRelationship ?? ""}
              placeholder="Spouse, parent, ..."
            />
          </label>
        </div>

        <h2>Guarantor contact</h2>
        <p className="muted">
          To bill this account under another patient&apos;s account instead, use the guarantor account link on the
          patient chart.
        </p>
        <div className="form-grid">
          <label>
            Name
            <input name="guarantorName" defaultValue={patient.guarantorName ?? ""} />
          </label>
          <label>
            Relationship to patient
            <input name="guarantorRelationship" defaultValue={patient.guarantorRelationship ?? ""} placeholder="Self, parent, ..." />
          </label>
          <label>
            Phone
            <input name="guarantorPhone" defaultValue={patient.guarantorPhone ?? ""} />
          </label>
        </div>

        <button className="btn" type="submit">
          Save changes
        </button>
      </form>
    </>
  );
}
