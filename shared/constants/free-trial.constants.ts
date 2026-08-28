/**
 * Free trial session provisioning sizing constant.
 *
 * Number of free trial sessions granted once to each newly registered student.
 * Single source of truth — consumed by the student trial service at registration
 * time and by downstream booking/escrow flows that need to reference trial sizing.
 *
 * Shared-layer isolation: this module imports nothing from @/backend, @/frontend,
 * or @/app. It is safe to import from any layer.
 */
export const FREE_TRIAL_SESSION_COUNT = 1;
