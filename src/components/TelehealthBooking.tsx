"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PatientPicker } from "@/components/PatientPicker";
import type { TelehealthBookingProvider } from "@/lib/telehealth-server";
import { BLOCK_MIN, STATE_NAMES, WINDOW_STATUS_LABEL, blockLabel, buildBlocks, dateInZone, timeInZone, windowSummary, zoneLabel } from "@/lib/telehealth";

type Patient = { id: string; name: string; mrn: string; state?: string | null };

// Booking a Telehealth Initial Wound Care visit: the doctor is chosen first, then one of that doctor's availability
// windows, the state the patient will be in (licence check), a free 20-minute block and the notes. The server
// re-checks every rule before it reserves.
export function TelehealthBooking({
  providers,
  states,
  action,
  initialPatient,
  defaults,
  returnTo,
  canSetup,
}: {
  providers: TelehealthBookingProvider[];
  states: string[];
  action: (formData: FormData) => void | Promise<void>;
  initialPatient: Patient | null;
  defaults: { providerId?: string; windowId?: string; state?: string; block?: string; notes?: string; error?: string };
  returnTo?: string;
  canSetup: boolean;
}) {
  const [patient, setPatient] = useState<Patient | null>(initialPatient);
  const [providerId, setProviderId] = useState(defaults.providerId && providers.some((p) => p.id === defaults.providerId) ? defaults.providerId : (providers[0]?.id ?? ""));
  const provider = providers.find((p) => p.id === providerId) ?? null;
  const [windowId, setWindowId] = useState(defaults.windowId ?? "");
  const window = provider?.windows.find((w) => w.id === windowId) ?? null;
  const [state, setState] = useState(defaults.state ?? initialPatient?.state ?? "");
  const [block, setBlock] = useState(defaults.block ?? "");
  const [notes, setNotes] = useState(defaults.notes ?? "");

  const blocks = useMemo(() => (window && provider ? buildBlocks(window, window.reservations, provider) : []), [window, provider]);
  const licensed = !state || !provider || provider.licenses.includes(state);
  const chosen = blocks.find((b) => b.startsAt === block && b.isSelectable) ?? null;

  const pickProvider = (id: string) => {
    setProviderId(id);
    setWindowId("");
    setBlock("");
  };
  const pickWindow = (id: string) => {
    setWindowId(id);
    setBlock("");
  };

  return (
    <form className="stack th-booking" action={action}>
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <input type="hidden" name="providerId" value={providerId} />
      <input type="hidden" name="availabilityId" value={windowId} />
      <input type="hidden" name="blockStart" value={chosen?.startsAt ?? ""} />
      <p className="muted sc-note">
        Telehealth visits are {BLOCK_MIN}-minute blocks inside the doctor&apos;s online hours.{" "}
        {canSetup && <Link href="/schedule/telehealth">Doctors &amp; availability</Link>}
      </p>
      {defaults.error && (
        <div className="gw-error" role="alert">
          {defaults.error}
        </div>
      )}
      <label>
        Patient
        <PatientPicker initial={patient} onChoose={(p) => { setPatient(p); if (!state && p.state) setState(p.state); }} />
      </label>

      {providers.length === 0 ? (
        <p className="gw-missing">
          No telehealth doctors yet.{canSetup ? " Add doctors and their online hours under Doctors & availability." : " Ask an admin to set up telehealth doctors."}
        </p>
      ) : (
        <>
          <div className="form-grid">
            <label>
              Doctor
              <select value={providerId} onChange={(e) => pickProvider(e.target.value)} required>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.suffix === "Dr." ? `Dr. ${p.name}` : `${p.name} (${p.suffix})`}
                    {p.specialty ? ` · ${p.specialty}` : ""}
                  </option>
                ))}
              </select>
              {provider && <span className="muted cn-small">Licensed in: {provider.licenses.length ? provider.licenses.join(", ") : "no states on file"}</span>}
            </label>
            <label>
              Availability window
              <select value={windowId} onChange={(e) => pickWindow(e.target.value)} required>
                <option value="">— Pick a window —</option>
                {provider?.windows.map((w) => {
                  const s = windowSummary(w, w.reservations);
                  return (
                    <option key={w.id} value={w.id} disabled={s.status === "FULL"}>
                      {dateInZone(w.startsAt, w.timezone)} · {timeInZone(w.startsAt, w.timezone)}–{timeInZone(w.endsAt, w.timezone)} {zoneLabel(w.timezone)} · {WINDOW_STATUS_LABEL[s.status]}
                      {s.status !== "FULL" ? ` (${s.availableMin} min free)` : ""}
                    </option>
                  );
                })}
              </select>
              {provider && provider.windows.length === 0 && <span className="gw-missing cn-small">No online hours in the next 30 days for this doctor.</span>}
            </label>
            <label>
              Patient&apos;s state at the visit
              <select name="stateCode" value={state} onChange={(e) => setState(e.target.value)} required>
                <option value="">— Pick a state —</option>
                {states.map((s) => (
                  <option key={s} value={s}>
                    {s} · {STATE_NAMES[s] ?? s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Notes <span className="muted cn-small">({notes.length}/150)</span>
              <input name="notes" value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 150))} maxLength={150} required placeholder="Patient / visit context" />
            </label>
          </div>

          {!licensed && provider && (
            <div className="th-warn" role="alert">
              <strong>
                {provider.suffix === "Dr." ? "Dr. " : ""}
                {provider.name} is not licensed in {STATE_NAMES[state] ?? state}.
              </strong>
              <label className="checkbox-inline">
                <input type="checkbox" name="acceptLicense" /> Book anyway
              </label>
            </div>
          )}

          {window && (
            <div className="stack">
              <span className="muted cn-small">
                Time blocks ({zoneLabel(window.timezone)}) — booked, break and past blocks can&apos;t be chosen.
              </span>
              <div className="th-blocks" role="radiogroup" aria-label="Time block">
                {blocks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={b.startsAt === block}
                    disabled={!b.isSelectable}
                    className={`th-block${b.startsAt === block ? " active" : ""}${b.isBooked ? " booked" : b.isBreak ? " break" : b.isPast ? " past" : ""}`}
                    onClick={() => setBlock(b.startsAt)}
                  >
                    {blockLabel(b)}
                  </button>
                ))}
                {blocks.length === 0 && <span className="muted">This window is shorter than one block.</span>}
              </div>
            </div>
          )}

          <button className="btn" type="submit" disabled={!window || !chosen || !state || !notes.trim()}>
            Reserve {chosen ? `· ${chosen.label} ${zoneLabel(window!.timezone)}` : ""}
          </button>
        </>
      )}
    </form>
  );
}
