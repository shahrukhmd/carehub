import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPendingSession } from "@/lib/auth";
import { resendCode, verifyCode } from "../actions";
import { AuthFrame } from "@/components/AuthFrame";

// Second factor: the six-digit code emailed after the password was accepted.
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ error?: string; left?: string; sent?: string }> }) {
  const pending = await getPendingSession();
  if (!pending) redirect("/login");
  const sp = await searchParams;
  // Test mode: no email provider is connected, so the code sits in the message log; show it here.
  const settings = await prisma.connectSettings.findUnique({ where: { practiceId: pending.user.practiceId }, select: { emailProvider: true } });
  const testMode = (settings?.emailProvider ?? "MOCK") === "MOCK";
  const last = testMode
    ? await prisma.messageLog.findFirst({ where: { practiceId: pending.user.practiceId, to: pending.user.email, subject: "Your CareHub sign-in code" }, orderBy: { createdAt: "desc" }, select: { body: true } })
    : null;
  const testCode = last?.body.match(/code is (\d{6})/)?.[1];

  return (
    <AuthFrame title="Check your email">

        <form className="stack" action={verifyCode}>
          <p className="muted">
            We emailed a six-digit code to <strong>{pending.user.email}</strong>. Enter it to finish signing in.
          </p>
          {sp.error && <p className="login-error">That code is not right{sp.left ? ` — ${sp.left} attempt${sp.left === "1" ? "" : "s"} left` : ""}.</p>}
          {sp.sent && <p className="notice-ok">A new code was sent.</p>}
          <label>
            Sign-in code
            <input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required autoFocus />
          </label>
          <button className="btn" type="submit">
            Continue
          </button>
        </form>
        <form action={resendCode}>
          <button className="btn ghost" type="submit">
            Send a new code
          </button>
        </form>
        {testMode && (
          <p className="login-hint">
            Test mode — no email provider is connected, so the code is shown here: <code>{testCode ?? "not issued yet"}</code>. Connect email under
            Settings → Patient Connect to send real codes.
          </p>
        )}
    </AuthFrame>
  );
}
