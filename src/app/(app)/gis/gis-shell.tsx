import type { ReactNode } from "react";

// The GIS pages' common header and the ok / error line from a server action.
export function GisPage({ title, subtitle, sp, actions, children }: { title: string; subtitle?: string; sp: { ok?: string; error?: string }; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">GIS · field routing</p>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {actions && <div className="vw-view-links">{actions}</div>}
      </div>
      <div className="stack gis-stack">
        {sp.error && (
          <p className="gw-error" role="alert">
            {sp.error}
          </p>
        )}
        {sp.ok && (
          <p className="sc-closed" role="status">
            {sp.ok}
          </p>
        )}
        {children}
      </div>
    </>
  );
}
