/**
 * Tajweed Curriculum Seeder — provisions the starter Tajweed curriculum
 * lessons on the seeded "Tajweed & Tilawa" plan.
 *
 * Consumes LessonService exclusively (zero raw DB imports): reads via
 * `listForPlan` and writes via `createLesson`, so every seeded row inherits
 * the service's validation and audit rules (exactly one Create audit row per
 * new lesson, minted atomically with the insert).
 *
 * Idempotent via (planId, title) matching: the plan's existing lessons are
 * re-read from a fresh listing on every pass and only missing titles are
 * created, so sequential re-runs create nothing. Concurrent runs may still
 * duplicate a title: `lessons` carries no (plan_id, title) unique constraint
 * (the service's duplicate-title check is look-before-create, not a
 * database guarantee) — a dev-seeding-only limitation shared with the plans
 * seeder.
 *
 * Actor attribution: lesson mutations are admin-gated (the service re-asserts
 * the acting admin against the `users` table before any write), so the actor
 * id is REQUIRED and supplied by the master seed controller
 * (`seeds/index.ts`) via controller-context threading after the users step
 * has provisioned the demo admin — this seeder never authenticates or
 * provisions users itself (single-domain rule in seeds/AGENTS.md). The
 * Tajweed plan identity is likewise threaded in by the controller from the
 * plans seeding result — this seeder never queries seed data.
 */

import { logger } from "@/backend/lib/logger";
import { LessonService } from "@/backend/services/classes/lesson.service";
import type { DBTransaction, LessonReturnType } from "@/backend/types";

const STARTER_TAJWEED_LESSON_TITLES: readonly string[] = ["Al-Madd", "An-Noon as-Sakinah", "Al-Qalqalah"];

/**
 * Creates a missing starter lesson via the service, inheriting its
 * validation and audit rules (exactly one Create audit row minted with the
 * insert).
 */
async function createMissingLesson(
  planId: number,
  title: string,
  actorId: number,
  locale: string,
  tx?: DBTransaction
): Promise<LessonReturnType> {
  const created = await LessonService.createLesson({ planId, title }, actorId, locale, tx);
  logger.info(`Seeded new lesson "${created.title}" (ID: ${created.id})`);
  return created;
}

export async function seedOrGet(
  locale = "en",
  adminActorId: number,
  tajweedPlanId: number,
  tx?: DBTransaction
): Promise<LessonReturnType[]> {
  logger.info("Seeding starter Tajweed curriculum via LessonService...");

  const actorId = adminActorId;

  const existingLessons = await LessonService.listForPlan(tajweedPlanId, locale, tx);
  const existingByTitle = new Map(existingLessons.map(lesson => [lesson.title ?? "", lesson]));

  const results: LessonReturnType[] = [];

  await STARTER_TAJWEED_LESSON_TITLES.reduce<Promise<void>>(async (previous, title) => {
    await previous;
    const existing = existingByTitle.get(title);
    const lesson = existing ?? (await createMissingLesson(tajweedPlanId, title, actorId, locale, tx));
    results.push(lesson);
  }, Promise.resolve());

  return results;
}
