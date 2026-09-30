import type { ReactNode } from "react";

type Brand = { displayName: string | null; brandColor: string; accentColor: string; logo: string | null; supportPhone: string | null } | null;

// Branded frame for every patient page (Patient Connect settings: name, colours, logo, phone).
export function PortalShell({ brand, fallbackName, children }: { brand: Brand; fallbackName: string; children: ReactNode }) {
  const name = brand?.displayName || fallbackName;
  const style = { "--pp-brand": brand?.brandColor ?? "#171342", "--pp-accent": brand?.accentColor ?? "#4f9c60" } as React.CSSProperties;
  return (
    <div className="pp-page" style={style}>
      <header className="pp-header">
        {brand?.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logo} alt="" className="pp-logo" />
        ) : (
          <span className="pp-mark">{name.slice(0, 1)}</span>
        )}
        <strong>{name}</strong>
      </header>
      <main className="pp-main">{children}</main>
      <footer className="pp-footer">
        {brand?.supportPhone ? `Questions? Call ${brand.supportPhone}. ` : ""}Your information is sent securely and kept private.
      </footer>
    </div>
  );
}
