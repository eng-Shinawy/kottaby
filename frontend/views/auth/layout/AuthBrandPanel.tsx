"use client";

import { BookMotif, BrandMark } from "@/frontend/views/auth/layout";
import { Auth, useAppTranslation } from "@/shared/locale";

/**
 * Left brand panel (md+ only) — full-height midnight-blue gradient panel
 * with decorative tessellation/glow overlays, brand wordmark, marketing
 * pitch, and trust badges. Hidden on `xs`/`sm` via `.auth-brand-panel` CSS
 * (see `AuthLayoutStyles`). All user-facing strings come from
 * `useAppTranslation(Auth)`; the "Kottaby Academy" brand name is exempt
 * from i18n per AGENTS.md (brand identity, not translated).
 */
export function AuthBrandPanel() {
  const t = useAppTranslation(Auth);

  return (
    <aside className="auth-brand-panel">
      <BrandPanelOverlays />

      {/* === Top: Brand wordmark === */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 12 }}>
        <BrandMark />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.1 }}>
            Kottaby Academy
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              opacity: 0.75,
            }}
          >
            {t.brandTagline}
          </span>
        </div>
      </div>

      {/* === Middle: Marketing pitch + decorative book motif === */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 440 }}>
        <BookMotif />
        {/* This decorative marketing headline rendered as a bare
            <h2> BEFORE the form's <h1>, inverting the document outline on
            every auth page. Same look as a paragraph — the form title
            stays the page's single top-level heading. */}
        <p
          style={{
            margin: "32px 0 16px",
            fontFamily: "inherit",
            fontSize: 32,
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
          }}
        >
          {t.brandPitchTitle}
        </p>
        <p
          style={{
            margin: 0,
            fontSize: 16,
            lineHeight: 1.6,
            opacity: 0.85,
            maxWidth: 380,
          }}
        >
          {t.brandPitchBody}
        </p>
      </div>

      {/* === Bottom: Trust badges === */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: 24,
          fontSize: 13,
          opacity: 0.75,
          flexWrap: "wrap",
        }}
      >
        <TrustItem label={t.trustVerifiedShuyukh} />
        <TrustItem label={t.trustQiraat} />
        <TrustItem label={t.trustSecurePrivate} />
      </div>
    </aside>
  );
}

/** Decorative brand-panel overlays — absolute-positioned, non-interactive. */
function BrandPanelOverlays() {
  return (
    <>
      {/* Decorative Islamic geometric tessellation overlay (khatam
          suggested via two overlapping rotated grids). Pure CSS — no
          external SVG asset. Low opacity so it doesn't compete. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.12,
          pointerEvents: "none",
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent, transparent 28px, var(--mui-palette-secondary-light) 28px, var(--mui-palette-secondary-light) 30px), repeating-linear-gradient(-45deg, transparent, transparent 28px, var(--mui-palette-secondary-light) 28px, var(--mui-palette-secondary-light) 30px)",
        }}
      />
      {/* Copper radial glow accent (top-right) */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "-20%",
          right: "-20%",
          width: "70%",
          height: "70%",
          background: "radial-gradient(circle, var(--mui-palette-secondary-main) 0%, transparent 65%)",
          opacity: 0.25,
          pointerEvents: "none",
        }}
      />
      {/* Secondary glow bottom-left for depth */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          bottom: "-25%",
          left: "-15%",
          width: "60%",
          height: "60%",
          background: "radial-gradient(circle, var(--mui-palette-primary-light) 0%, transparent 70%)",
          opacity: 0.2,
          pointerEvents: "none",
        }}
      />
    </>
  );
}

/** Trust badge — small inline dot + label. */
function TrustItem({ label }: { readonly label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: "var(--mui-palette-secondary-light)",
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
