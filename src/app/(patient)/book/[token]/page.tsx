import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatTime } from "@/lib/format";
import { bookableTypes, openSlots, slotKey } from "@/lib/connect/booking";
import { PortalShell } from "../../portal-shell";
import { bookOnline } from "./actions";

type Search = { type?: string; loc?: string; slot?: string; error?: string; more?: string };

const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

export default async function BookPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Search> }) {
  const { token } = await params;
  const sp = await searchParams;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const settings = await prisma.connectSettings.findUnique({ where: { bookingToken: token }, include: { practice: { include: { locations: { orderBy: { name: "asc" } } } } } });
  if (!settings) notFound();
  const shell = (c: React.ReactNode) => (
    <PortalShell brand={settings} fallbackName={settings.practice.name}>
      {c}
    </PortalShell>
  );
  if (!settings.bookingEnabled)
    return shell(
      <div className="pp-card pp-center">
        <h1>Online booking is not available</h1>
        <p>Please call {settings.supportPhone ?? "the office"} to schedule.</p>
      </div>
    );
  const types = await bookableTypes(settings.practiceId);
  const base = `/book/${token}`;
  const type = types.find((t) => t.code === sp.type);
  const locations = settings.practice.locations;

  if (!type)
    return shell(
      <div className="pp-card">
        <h1>Book an appointment</h1>
        {settings.bookingMessage && <p className="pp-muted">{settings.bookingMessage}</p>}
        {types.length === 0 ? (
          <p>No visit types can be booked online right now. Please call {settings.supportPhone ?? "the office"}.</p>
        ) : (
          <>
            <p>What would you like to book?</p>
            <ul className="pp-review">
              {types.map((t) => (
                <li key={t.id}>
                  <a href={`${base}?type=${encodeURIComponent(t.code)}`}>
                    <strong>{t.name}</strong>
                    <span className="pp-muted pp-small">{t.durationMin ?? 30} minutes</span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
        {settings.supportPhone && <p className="pp-muted pp-small">Urgent problem? Call {settings.supportPhone}. For emergencies call 911.</p>}
      </div>
    );

  const dur = type.durationMin ?? 30;
  if (!sp.slot) {
    const loc = locations.find((l) => l.id === sp.loc);
    const slots = await openSlots(settings.practiceId, { durationMin: dur, locationId: loc?.id, leadHours: settings.bookingLeadHours, windowDays: settings.bookingWindowDays });
    const byDay = new Map<string, typeof slots>();
    for (const s of slots) byDay.set(s.start.toDateString(), [...(byDay.get(s.start.toDateString()) ?? []), s]);
    const days = [...byDay.entries()].slice(0, sp.more ? 30 : 7);
    return shell(
      <div className="pp-card">
        <a className="pp-muted pp-small" href={base}>
          ‹ Change visit type
        </a>
        <h1>{type.name}</h1>
        {locations.length > 1 && (
          <nav className="pp-tabs">
            <a href={`${base}?type=${type.code}`} className={!loc ? "active" : ""}>
              Any location
            </a>
            {locations.map((l) => (
              <a key={l.id} href={`${base}?type=${type.code}&loc=${l.id}`} className={loc?.id === l.id ? "active" : ""}>
                {l.name}
              </a>
            ))}
          </nav>
        )}
        {days.length === 0 && <p>No open times in the next {settings.bookingWindowDays} days. Please call {settings.supportPhone ?? "the office"}.</p>}
        {days.map(([d, list]) => (
          <section key={d} className="pp-day">
            <h2>{dayLabel(list[0].start)}</h2>
            <div className="pp-slots">
              {list.slice(0, 24).map((s) => (
                <a key={slotKey(s)} className="pp-slot" href={`${base}?type=${type.code}&slot=${slotKey(s)}`}>
                  {formatTime(s.start)}
                  <span>
                    {s.providerName}
                    {locations.length > 1 && !loc ? ` · ${s.locationName}` : ""}
                  </span>
                </a>
              ))}
            </div>
          </section>
        ))}
        {!sp.more && byDay.size > 7 && (
          <a className="pp-btn pp-btn-ghost" href={`${base}?type=${type.code}${loc ? `&loc=${loc.id}` : ""}&more=1`}>
            Show later dates
          </a>
        )}
      </div>
    );
  }

  const [ms, providerId, locationId] = sp.slot.split("_");
  const start = new Date(Number(ms));
  const [prov, location] = await Promise.all([
    prisma.user.findFirst({ where: { id: providerId, memberships: { some: { practiceId: settings.practiceId } } } }),
    prisma.location.findFirst({ where: { id: locationId, practiceId: settings.practiceId } }),
  ]);
  if (!prov || !location || Number.isNaN(start.getTime())) notFound();
  return shell(
    <form action={bookOnline.bind(null, token)} className="pp-card">
      <Link className="pp-muted pp-small" href={`${base}?type=${type.code}`}>
        ‹ Pick another time
      </Link>
      <h1>Your details</h1>
      <p className="pp-appt">
        <strong>
          {type.name} · {dayLabel(start)} at {formatTime(start)}
        </strong>
        <br />
        {prov.name} · {location.name}
        {location.addressLine1 ? `, ${location.addressLine1}` : ""}
      </p>
      {sp.error && (
        <p className="pp-error" role="alert">
          {sp.error}
        </p>
      )}
      <input type="hidden" name="type" value={type.code} />
      <input type="hidden" name="slot" value={sp.slot} />
      <div className="pp-hp" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="pp-label">
        First name
        <input name="firstName" required autoComplete="given-name" className="pp-input" />
      </label>
      <label className="pp-label">
        Last name
        <input name="lastName" required autoComplete="family-name" className="pp-input" />
      </label>
      <label className="pp-label">
        Date of birth
        <input type="date" name="dob" required className="pp-input" />
      </label>
      <label className="pp-label">
        Mobile phone
        <input name="phone" type="tel" required autoComplete="tel" className="pp-input" />
      </label>
      <label className="pp-label">
        Email (optional)
        <input name="email" type="email" autoComplete="email" className="pp-input" />
      </label>
      <label className="pp-label">
        Reason for visit (optional)
        <textarea name="reason" rows={2} maxLength={300} className="pp-input" />
      </label>
      <label className="pp-radio">
        <input type="checkbox" name="consent" required /> I agree to be contacted by text and email about this appointment.
      </label>
      <button className="pp-btn" type="submit">
        {settings.bookingApproval ? "Request appointment" : "Book appointment"}
      </button>
      {settings.bookingApproval && <p className="pp-muted pp-small">The office will confirm your request by text.</p>}
    </form>
  );
}
