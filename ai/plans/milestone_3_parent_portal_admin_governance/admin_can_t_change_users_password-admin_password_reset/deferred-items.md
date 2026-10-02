# Deferred Items Ledger

**Feature:** Admin Change User Password (with Reset-on-Login)
**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
**Created:** 2026-09-30

---

## Purpose

Tracks work deliberately carved out of this ticket (GitHub issue #228). D1..D6 are scope decisions recorded in `specs.md` Scope and `plan.md` D1-D9 whose expansion is future-scope, not a blocker for this plan. Every row below is in a non-blocking state and does not block the final gate.

## Ledger Table

| ID | Deferred Item | Source | Target | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | Email/OTP-based self-service password reset delivery (mail templates + delivery route) | specs.md Scope (Out of scope) | future mail-reset ticket | ⚪ Deferred (accepted) | specs.md Scope | No mail/OTP infrastructure exists — there is no forgot-password flow and the login "Forgot password?" link is a dead `href="#"` (`frontend/views/auth/login/LoginForm.tsx:47-49`); #228 ships the admin-set path only |
| D2 | Session/token revocation on password change | specs.md Scope (Out of scope) | future server-side session-store ticket | ⚪ Deferred (accepted) | `backend/services/auth/auth.service.ts:236-240` | No server-side session store exists, so existing tokens cannot be revoked; the REQ-005 gate blocks *requests*, not *tokens* — tokens stay valid until expiry |
| D3 | Rate limiting / abuse throttling on the admin password mutation | specs.md Scope (Out of scope) | the rate-limit/abuse ticket | ⚪ Deferred (accepted) | specs.md Scope | No admin-write limiter exists today; `adminSetUserPassword` relies on the established admin scope + service `assertActorAdminActive` gate only |
| D4 | Enabling the dashboard profile `ChangePasswordCard` as the self-service surface | specs.md Scope (Out of scope) | separate profile/self-service UX ticket | ⚪ Deferred (accepted) | `frontend/views/dashboard/profile/cards/ChangePasswordCard.tsx:20-21` | The card is an inert placeholder reading "Password changes are not enabled yet" (`shared/locale/en/dashboard/index.ts:67`); the forced flow owns its own `/change-password` page and does not touch the card |
| D5 | Stricter policy forbidding an admin from resetting another admin's password | specs.md Scope (Out of scope) | security-policy ticket | ⚪ Deferred (accepted) | specs.md Assumptions | Admins are trusted today (`assertActorAdminActive` checks only that the actor is an active admin, not the target's role); REQ-008 keeps the `FORBIDDEN` denial for non-admins only |
| D6 | Directory row-level "password reset pending" chip | specs.md REQ-004.3 | UX-polish pass | ⚪ Deferred (accepted) | specs.md REQ-004.3 | The detail page SHALL show the flag (`AdminUserDetail.mustChangePassword` + fragment selection, REQ-004.3/REQ-009.5); the directory row indicator is a MAY and is deferred to keep the row contract stable |

## Status Values

- ✅ Done · ⏳ Not started (carry-forward queue) · ⚪ Deferred (accepted scope-level deferral, non-blocking) · 🔄 In Progress
- The two blocking states (the red-cross "Blocked" glyph and the yellow-warning "Partial" glyph) are intentionally written as words here so the final-gate glyph grep has ZERO false positives: any such glyph appearing in this file is a REAL blocker.

## Enforcement

Final gate: grep this ledger for the red-cross or yellow-warning glyphs — expected count is exactly 0. All current rows are ⚪ — zero blockers at plan-authoring time.
