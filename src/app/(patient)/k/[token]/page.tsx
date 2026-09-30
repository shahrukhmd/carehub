import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PortalShell } from "../../portal-shell";
import { startKiosk } from "../../p/[token]/actions";

// Walk-in self-registration (QR code at the front desk).
export default async function KioskPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const k = await prisma.kioskLink.findUnique({ where: { token }, include: { packet: true, practice: { include: { connectSettings: true } } } });
  if (!k) notFound();
  return (
    <PortalShell brand={k.practice.connectSettings} fallbackName={k.practice.name}>
      <form action={startKiosk.bind(null, token)} className="pp-card pp-center">
        <h1>Welcome!</h1>
        {k.active ? (
          <>
            <p>Please fill in your {k.packet.name.toLowerCase()} on this device. It takes about 10 minutes.</p>
            <button className="pp-btn" type="submit">
              Start check-in
            </button>
          </>
        ) : (
          <p>Online check-in is not available right now. Please see the front desk.</p>
        )}
      </form>
    </PortalShell>
  );
}
