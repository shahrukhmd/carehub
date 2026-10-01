import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DocumentFields } from "@/components/DocumentForm";
import { TypedSignature } from "@/components/TypedSignature";
import { displayValue, parseFields, typedSignature, withClinic, type FieldDef } from "@/lib/chart-forms";
import { formatDate, formatTime } from "@/lib/format";
import { isPortalVerified, loadPortalRequest, portalState } from "@/lib/connect/portal";
import { packetTemplates, parseAnswers } from "@/lib/connect/submit";
import { PortalShell } from "../../portal-shell";
import { saveStep, submitPacket, verifyDob } from "./actions";

export default async function PatientFormsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ s?: string; error?: string; msg?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const r = await loadPortalRequest(token);
  if (!r) notFound();
  const brand = r.practice.connectSettings;
  const shell = (children: React.ReactNode) => (
    <PortalShell brand={brand} fallbackName={r.practice.name}>
      {children}
    </PortalShell>
  );
  const state = portalState(r);

  if (state === "completed") {
    // Shared check-in tablet: go back to the kiosk start so the next patient never sees this one's session.
    const kiosk = r.kioskLinkId ? await prisma.kioskLink.findUnique({ where: { id: r.kioskLinkId } }) : null;
    return shell(
      <div className="pp-card pp-center">
        {kiosk && <meta httpEquiv="refresh" content={`15;url=/k/${kiosk.token}`} />}
        <div className="pp-check" aria-hidden="true">
          ✓
        </div>
        <h1>Thank you{r.patient ? `, ${r.patient.firstName}` : ""}!</h1>
        <p>We received your forms ({r.packet.name}){r.completedAt ? ` on ${formatDate(r.completedAt)}` : ""}. Our team will review them{r.appointment ? " before your visit" : ""}.</p>
        {r.appointment && (
          <p className="pp-muted">
            Your appointment: {formatDate(r.appointment.startsAt)} at {formatTime(r.appointment.startsAt)} · {r.appointment.location.name}
          </p>
        )}
        {kiosk ? (
          <>
            <p className="pp-muted">Please return the device to the front desk.</p>
            <a className="pp-btn pp-btn-ghost" href={`/k/${kiosk.token}`}>
              Start next check-in
            </a>
          </>
        ) : (
          <p className="pp-muted">You can close this page.</p>
        )}
      </div>
    );
  }
  if (state !== "open")
    return shell(
      <div className="pp-card pp-center">
        <h1>This link is no longer active</h1>
        <p>{state === "expired" ? "The link has expired." : "These forms were withdrawn."} Please contact the office for a new link.</p>
      </div>
    );

  const verified = await isPortalVerified(r);
  if (!verified) {
    if (!r.patient) notFound();
    const locked = sp.error === "locked" || (r.lockedUntil && r.lockedUntil > new Date());
    return shell(
      <form action={verifyDob.bind(null, token)} className="pp-card">
        <h1>Hi {r.patient.firstName}</h1>
        <p>
          Please complete your <strong>{r.packet.name}</strong>
          {r.appointment ? ` before your visit on ${formatDate(r.appointment.startsAt)}` : ""}. To protect your privacy, enter your date of birth to continue.
        </p>
        {sp.error === "dob" && !locked && (
          <p className="pp-error" role="alert">
            That date of birth doesn&apos;t match our records. Please try again.
          </p>
        )}
        {locked && (
          <p className="pp-error" role="alert">
            Too many attempts. For your security, please wait 15 minutes and try again, or call the office.
          </p>
        )}
        <label className="pp-label">
          Date of birth
          <input type="date" name="dob" required disabled={Boolean(locked)} className="pp-input" />
        </label>
        <button className="pp-btn" type="submit" disabled={Boolean(locked)}>
          Continue
        </button>
      </form>
    );
  }

  const templates = await packetTemplates(r.practiceId, r.packet.templateKeys);
  const answers = parseAnswers(r.answers);
  const total = templates.length;
  const step = Math.min(Math.max(Number(sp.s ?? r.currentStep) || 0, 0), total);
  const progress = Math.round((step / (total + 1)) * 100);

  // ---- Review & submit ----
  if (step >= total) {
    return shell(
      <div className="pp-card">
        <Progress value={100} label={`Review — ${total} of ${total} forms done`} />
        <h1>Review &amp; submit</h1>
        <p className="pp-muted">Check your answers. Tap a form to change it.</p>
        <ol className="pp-review">
          {templates.map((t, i) => {
            const values = answers[t.key] ?? {};
            const shown = parseFields(t.fields)
              .filter((f: FieldDef) => !["heading", "note", "score"].includes(f.type))
              .map((f) => [f.label, displayValue(f, values[f.id])] as const)
              .filter(([, v]) => v);
            return (
              <li key={t.key}>
                <a href={`/p/${token}?s=${i}`}>
                  <span>
                    <strong>{t.name}</strong> <span className="pp-edit">Edit</span>
                  </span>
                  <span className="pp-muted pp-small">{shown.length ? shown.slice(0, 3).map(([l, v]) => `${l}: ${v}`).join(" · ") : "Not started"}</span>
                </a>
              </li>
            );
          })}
        </ol>
        <form action={submitPacket.bind(null, token)}>
          <button className="pp-btn" type="submit">
            Submit my forms
          </button>
        </form>
      </div>
    );
  }

  const t = templates[step];
  const fields = withClinic(parseFields(t.fields), brand?.displayName || r.practice.name);
  const values = answers[t.key] ?? {};
  const plain = fields.filter((f) => f.type !== "signature" && f.type !== "file");
  return shell(
    <form action={saveStep.bind(null, token, step)} className="pp-card">
      <Progress value={progress} label={`Form ${step + 1} of ${total}`} />
      <h1>{t.name}</h1>
      {step === 0 && brand?.welcomeText && <p className="pp-muted">{brand.welcomeText}</p>}
      {sp.error === "missing" && (
        <p className="pp-error" role="alert">
          Please complete: {sp.msg}
        </p>
      )}
      {sp.error === "upload" && (
        <p className="pp-error" role="alert">
          The file couldn&apos;t be uploaded ({sp.msg}). Please use a photo (JPG or PNG) or PDF under 10 MB.
        </p>
      )}
      {/* Regular questions, then photos and signatures in field order. */}
      {fields.map((f, i) => {
        if (f.type === "file") {
          const has = Boolean(values[f.id]);
          return (
            <label key={f.id} className="pp-label pp-file">
              <span>
                {f.label}
                {f.required && <span className="df-req"> *</span>}
              </span>
              {f.help && <span className="pp-muted">{f.help}</span>}
              {has && <span className="pp-ok">✓ Uploaded — choose another to replace it</span>}
              <input type="file" name={`f_${f.id}`} accept="image/*,application/pdf" capture="environment" className="pp-input" />
            </label>
          );
        }
        if (f.type === "signature") {
          const signed = typedSignature(values[f.id]);
          return (
            <div key={f.id} className="pp-label">
              <span>
                {f.label}
                {f.required && <span className="df-req"> *</span>}
              </span>
              <TypedSignature name={`f_${f.id}`} initial={signed?.name} signedAt={signed ? `${formatDate(signed.at)} ${formatTime(signed.at)}` : null} />
            </div>
          );
        }
        // Group consecutive plain fields into one DocumentFields block.
        const prev = fields[i - 1];
        if (prev && prev.type !== "signature" && prev.type !== "file") return null;
        const run: FieldDef[] = [];
        for (let j = i; j < fields.length && fields[j].type !== "signature" && fields[j].type !== "file"; j++) run.push(fields[j]);
        return <DocumentFields key={f.id} fields={run} values={values} idPrefix={`pp-${t.key}`} />;
      })}
      {plain.length === 0 && fields.length === 0 && <p className="pp-muted">Nothing to fill in on this form.</p>}
      <div className="pp-nav">
        {step > 0 ? (
          <a className="pp-btn pp-btn-ghost" href={`/p/${token}?s=${step - 1}`}>
            ‹ Back
          </a>
        ) : (
          <span />
        )}
        <button className="pp-btn" type="submit">
          {step === total - 1 ? "Save & review" : "Save & continue ›"}
        </button>
      </div>
      <p className="pp-muted pp-small">Your answers are saved as you go — you can come back to this link any time before it expires ({formatDate(r.expiresAt)}).</p>
    </form>
  );
}

function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div className="pp-progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="pp-progress-bar" style={{ width: `${value}%` }} />
      <span>{label}</span>
    </div>
  );
}
