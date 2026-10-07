import { rolesFor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { addAvailability, removeAvailability } from "@/app/(app)/schedule/actions";
import { DAY_NAMES, formatTimeLabel } from "@/lib/schedule";

export default async function AvailabilityPage() {
  const user = await requireUser(rolesFor("settings.admin"));

  const [providers, locations, availability] = await Promise.all([
    prisma.user.findMany({
      where: { practiceId: user.practiceId, role: { in: ["CLINICIAN", "ADMIN"] } },
      orderBy: { name: "asc" },
    }),
    prisma.location.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } }),
    prisma.providerAvailability.findMany({
      where: { practiceId: user.practiceId },
      include: { provider: true, location: true },
      orderBy: [{ provider: { name: "asc" } }, { dayOfWeek: "asc" }, { startTime: "asc" }],
    }),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Scheduling</p>
          <h1>Provider availability</h1>
        </div>
      </div>

      <div className="two-col">
        <section className="panel">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Location</th>
                <th>Day</th>
                <th>Hours</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {availability.map((a) => (
                <tr key={a.id}>
                  <td>{a.provider.name}</td>
                  <td>{a.location.name}</td>
                  <td>{DAY_NAMES[a.dayOfWeek]}</td>
                  <td>
                    {formatTimeLabel(a.startTime)} – {formatTimeLabel(a.endTime)}
                  </td>
                  <td>
                    <form action={removeAvailability.bind(null, a.id)}>
                      <button className="btn ghost" type="submit">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {availability.length === 0 && (
                <tr>
                  <td colSpan={5}>No availability defined yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <form className="panel stack" action={addAvailability}>
          <h2>Add availability</h2>
          <label>
            Provider
            <select name="providerId" required>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Location
            <select name="locationId" required>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Day of week
            <select name="dayOfWeek" defaultValue="1">
              {DAY_NAMES.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start time
            <input name="startTime" type="time" defaultValue="09:00" required />
          </label>
          <label>
            End time
            <input name="endTime" type="time" defaultValue="17:00" required />
          </label>
          <button className="btn" type="submit">
            Add availability
          </button>
        </form>
      </div>
    </>
  );
}
