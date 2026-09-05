/**
 * darkOutlinedContrastSx — unit tier (QA round 2, axe serious follow-up).
 *
 * The notifications view's outlined primary buttons (pager previous/next,
 * MarkAllButton, the row mark-read action) lift their text and border to
 * `palette.primary.light` in DARK mode only: the default outlined variant
 * paints `primary.main` (#3D6BA0) on the dark feed canvas at ~3.3:1 — below
 * the WCAG AA 4.5:1 text threshold. Light mode already clears AA with
 * `primary.main` (#1E3A5F) by a wide margin, so the helper must stay a no-op
 * there. In dark mode the `&.Mui-disabled` state keeps the theme's disabled
 * tokens — the lift would otherwise win over MUI's `.Mui-disabled` rule and
 * a disabled outlined button would look enabled.
 *
 * Pure unit tier (the `notifications-static-scan.test.ts` precedent): no
 * server, no DOM — the helper is a synchronous theme → sx-fragment function,
 * so both color schemes are exercised through `createAppTheme` directly (the
 * single-mode legacy shape `TestWrapper` renders).
 */

import { describe, expect, test } from "bun:test";
import { createAppTheme } from "@/frontend/providers/theme/theme";
import { darkOutlinedContrastSx } from "@/frontend/views/notifications/utils";

describe("darkOutlinedContrastSx (notifications outlined-button contrast lift)", () => {
  test("light mode returns an EMPTY fragment — default outlined styling already clears AA", () => {
    expect(darkOutlinedContrastSx(createAppTheme("light"))).toEqual({});
  });

  test("dark mode lifts color AND borderColor to palette.primary.light (theme token, not a hardcoded hex)", () => {
    const darkTheme = createAppTheme("dark");

    expect(darkOutlinedContrastSx(darkTheme)).toEqual({
      color: darkTheme.palette.primary.light,
      borderColor: darkTheme.palette.primary.light,
      // Disabled state keeps the theme's disabled tokens — the sx lift would
      // otherwise win over MUI's `.Mui-disabled` rule.
      "&.Mui-disabled": {
        color: darkTheme.palette.action.disabled,
        borderColor: darkTheme.palette.action.disabledBackground,
      },
    });
  });
});
