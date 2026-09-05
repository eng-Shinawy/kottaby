/**
 * Responsive layout rules — single source of truth for the auth shell's
 * 2-column → 1-column collapse. Kept inline (no CSS module) so the rule
 * ships with the markup and stays scoped to the auth layout.
 */
export function AuthLayoutStyles() {
  return (
    <style>{`
        .auth-shell {
          min-height: 100vh;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          position: relative;
          overflow-y: auto;
          background-color: var(--mui-palette-background-default);
        }
        .auth-brand-panel {
          display: none;
          flex-direction: column;
          justify-content: space-between;
          padding: 48px 56px;
          position: relative;
          overflow: hidden;
          isolation: isolate;
          background: linear-gradient(160deg,
            var(--mui-palette-primary-dark) 0%,
            var(--mui-palette-primary-main) 45%,
            var(--mui-palette-primary-dark) 100%);
          color: var(--mui-palette-onPrimary);
        }
        .auth-form-panel {
          position: relative;
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          background-color: var(--mui-palette-background-default);
          color: var(--mui-palette-text-primary);
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        .auth-mobile-banner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 14px 16px;
          padding-top: max(14px, env(safe-area-inset-top, 0px));
          background: linear-gradient(90deg,
            var(--mui-palette-primary-dark),
            var(--mui-palette-primary-main));
          color: var(--mui-palette-onPrimary);
        }
        @media (min-width: 900px) {
          .auth-shell { grid-template-columns: 2fr 3fr; }
          .auth-brand-panel { display: flex; }
          .auth-mobile-banner { display: none; }
        }
      `}</style>
  );
}
