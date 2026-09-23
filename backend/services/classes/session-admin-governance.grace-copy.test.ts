/**
 * Grace-constant ↔ denial-copy coupling pin (reschedule denial copy).
 *
 * The service rejects a replacement start further than
 * `RESCHEDULE_START_PAST_GRACE_MS` into the past with the localized
 * `sessionRescheduleStartInPast` copy — copy that SPELLS the same window
 * out in prose. The two live in different layers (backend constant vs
 * locale files), so this pin fails loudly if either side drifts: bump the
 * constant without the copy (or edit the copy without the constant) and
 * the denial text lies about the enforced rule.
 *
 * DB-free suite: locale barrel + constant only.
 */

import { describe, expect, test } from "bun:test";
import { RESCHEDULE_START_PAST_GRACE_MS } from "@/backend/services/classes/session-admin-governance.helpers";
import { getServerTranslations } from "@/shared/locale/server-graphql";

describe("RESCHEDULE_START_PAST_GRACE_MS ↔ sessionRescheduleStartInPast copy coupling", () => {
  test("the en and ar denial copy both name the SAME grace window the service enforces", () => {
    const graceMinutes = RESCHEDULE_START_PAST_GRACE_MS / 60_000;
    // The copy prose-quantizes the window in whole minutes — a sub-minute
    // or fractional window cannot be spelled out by the current copy shape.
    expect(Number.isInteger(graceMinutes)).toBe(true);
    expect(graceMinutes).toBeGreaterThan(0);

    for (const locale of ["en", "ar"] as const) {
      const copy = getServerTranslations(locale).errorsTranslations.sessionRescheduleStartInPast;
      expect(copy).toContain(String(graceMinutes));
    }
  });
});
