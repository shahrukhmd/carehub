import type { ReactNode } from "react";
import Image from "next/image";
import loginIllustration from "../../assets/login-security.png";
import loginShape from "../../assets/shap-login.png";

// The card every screen before the app uses (sign-in, second factor, password change, facility choice, signup):
// one white card on the page background with two soft brand shapes behind it. Left: the logo and the sign-in
// illustration (or the page's own content); right: heading, subtitle and the controls. On a phone the left column
// drops away.
export function AuthFrame({ title, subtitle, aside, icon, children }: { title: string; subtitle?: ReactNode; aside?: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="login-shell">
      {/* The shapes hang off the card's corners (not the window), so the picture holds at any zoom or screen size. */}
      <div className="auth-stage">
        <Image className="auth-blob auth-blob-blue" src={loginShape} alt="" aria-hidden="true" priority />
        <span className="auth-blob auth-blob-coral" aria-hidden="true" />
        <div className="auth-card">
          <div className="auth-aside">
            <div className="auth-logo">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" fill="currentColor" />
                </svg>
              </span>
              <strong>CareHub</strong>
            </div>
            <div className="auth-aside-body">
              {aside ?? <Image className="auth-illustration" src={loginIllustration} alt="" sizes="(max-width: 860px) 0px, 380px" priority />}
            </div>
          </div>
          <div className="auth-main">
            {icon && <span className="auth-icon" aria-hidden="true">{icon}</span>}
            <h1>{title}</h1>
            {subtitle && <p className="auth-subtitle">{subtitle}</p>}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
