import type { ReactNode } from "react";
import { LocaleSwitcher } from "@/frontend/components/LocaleSwitcher";
import { SiteFooter } from "@/frontend/components/SiteFooter";
import { BrandMark } from "@/frontend/views/auth/layout";

/**
 * Right form panel (~60% width, always visible) — plain
 * `background.default` (NO gradient — the form sits directly on the
 * panel). Locale switcher pinned top-right, content centered vertically.
 * On mobile (`xs`/`sm`) a slim brand banner renders above the form so the
 * brand identity is still present when the brand panel collapses away.
 */
export function AuthFormPanel({ children }: { readonly children: ReactNode }) {
  return (
    <section className="auth-form-panel">
      {/* Slim mobile brand banner (xs/sm only) */}
      <div className="auth-mobile-banner">
        <BrandMark size={28} />
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>Kottaby Academy</span>
      </div>

      {/* Top-right locale switcher */}
      <div
        style={{
          position: "absolute",
          top: 16,
          insetInlineEnd: 16,
          zIndex: 10,
        }}
      >
        <LocaleSwitcher />
      </div>

      {/* Scrollable form container */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 24px",
          width: "100%",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        {children}
      </div>

      {/* Sticky footer — pushed to bottom by flex:1 above. Copper-topped
          midnight-blue footer matches the brand panel. */}
      <SiteFooter />
    </section>
  );
}
