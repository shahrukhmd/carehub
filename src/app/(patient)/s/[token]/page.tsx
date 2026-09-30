import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PortalShell } from "../../portal-shell";
import { answerSurvey } from "./actions";

// Post-visit Net Promoter Score survey.
export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const s = await prisma.surveyResponse.findUnique({ where: { token }, include: { patient: true, practice: { include: { connectSettings: true } } } });
  if (!s) notFound();
  const name = s.practice.connectSettings?.displayName || s.practice.name;
  return (
    <PortalShell brand={s.practice.connectSettings} fallbackName={s.practice.name}>
      {s.respondedAt ? (
        <div className="pp-card pp-center">
          <div className="pp-check" aria-hidden="true">
            ✓
          </div>
          <h1>Thank you for your feedback!</h1>
        </div>
      ) : (
        <form action={answerSurvey.bind(null, token)} className="pp-card">
          <h1>How was your visit, {s.patient.firstName}?</h1>
          <p>How likely are you to recommend {name} to a friend or family member?</p>
          <div className="pp-nps" role="radiogroup" aria-label="Score from 0 to 10">
            {Array.from({ length: 11 }, (_, i) => (
              <label key={i} className="pp-nps-opt">
                <input type="radio" name="score" value={i} required />
                <span>{i}</span>
              </label>
            ))}
          </div>
          <div className="pp-nps-scale pp-muted">
            <span>Not likely</span>
            <span>Very likely</span>
          </div>
          <label className="pp-label">
            Anything we could do better? (optional)
            <textarea name="comment" rows={3} className="pp-input" maxLength={1000} />
          </label>
          <button className="pp-btn" type="submit">
            Send
          </button>
        </form>
      )}
    </PortalShell>
  );
}
