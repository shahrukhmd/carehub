import { rolesFor } from "@/lib/permissions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { SignaturePad } from "@/components/SignaturePad";
import { saveMySignature } from "./actions";

export default async function MySignaturePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requireUser(rolesFor("chart.sign"));
  const sp = await searchParams;
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, signatureImage: true, signatureUpdatedAt: true } });

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Signature on file</p>
          <h1>My signature</h1>
        </div>
      </div>
      {sp.saved && <p className="notice-ok">Signature saved. It will be applied to records you sign from now on.</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <section className="panel">
        <p>
          Draw your signature below (mouse, touch screen or stylus) or upload a scanned image. When you sign a visit, a copy of this
          signature is stamped onto the progress note and appears in box 31 of the claim form.
        </p>
        <form action={saveMySignature} className="stack">
          <SignaturePad name="signature" initial={me.signatureImage} />
          <label className="checkbox-inline">
            <input type="checkbox" name="confirm" required /> I, {me.name}, adopt this image as my electronic signature.
          </label>
          <div className="form-actions">
            <button className="btn" type="submit">
              Save signature
            </button>
          </div>
        </form>
        {me.signatureUpdatedAt && <p className="muted">Last updated {formatDate(me.signatureUpdatedAt)}</p>}
      </section>
    </div>
  );
}
