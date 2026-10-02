import { loadSeedConfig, type SeedConfig } from "@/backend/db/seeds/lib";
import { Gender } from "@/backend/enum/users/gender.enum";
import { logger } from "@/backend/lib/logger";
import { RegistrationService } from "@/backend/services";
import type { RegistrationReturnType } from "@/backend/types";

export interface DemoUserSpec {
  fullName: string;
  email: string;
  phone: string;
  country: string;
  role: "admin" | "teacher" | "student" | "parent";
  gender?: Gender;
}

export const INITIAL_DEMO_USERS: DemoUserSpec[] = [
  {
    fullName: "Super Admin",
    email: process.env.ADMIN_EMAIL ?? "admin@draftacademy.local",
    phone: "+201000000001",
    country: "EG",
    role: "admin",
    gender: Gender.Male,
  },
  {
    fullName: "Demo Teacher",
    email: "teacher@draftacademy.local",
    phone: "+201000000002",
    country: "EG",
    role: "teacher",
    gender: Gender.Male,
  },
  {
    fullName: "Demo Parent",
    email: "parent@draftacademy.local",
    phone: "+201000000003",
    country: "EG",
    role: "parent",
    gender: Gender.Male,
  },
  {
    fullName: "Demo Student",
    email: "student@draftacademy.local",
    phone: "+201000000004",
    country: "EG",
    role: "student",
    gender: Gender.Male,
  },
];

export async function seedOrGet(config?: SeedConfig): Promise<RegistrationReturnType[]> {
  logger.info("Seeding demo users via RegistrationService...");
  const seedConfig = config ?? loadSeedConfig();
  const password = seedConfig.defaultAdminCredential;
  const locale = "en";

  const results: RegistrationReturnType[] = [];

  await INITIAL_DEMO_USERS.reduce<Promise<void>>(async (previous, userSpec) => {
    await previous;
    try {
      if (userSpec.role === "admin") {
        const user = await RegistrationService.createAdminUser(
          {
            fullName: userSpec.fullName,
            email: userSpec.email,
            phone: userSpec.phone,
            country: userSpec.country,
            password,
            gender: userSpec.gender,
            role: "admin",
          },
          locale
        );
        results.push(user);
        logger.info(`Seeded admin user: ${user.email}`);
      } else {
        const user = await RegistrationService.registerUser(
          {
            fullName: userSpec.fullName,
            email: userSpec.email,
            phone: userSpec.phone,
            country: userSpec.country,
            password,
            gender: userSpec.gender,
            role: userSpec.role,
          },
          locale
        );
        results.push(user);
        logger.info(`Seeded ${userSpec.role} user: ${user.email}`);
      }
    } catch (err) {
      // If already registered / conflict, look up or skip gracefully
      const isConflict =
        err instanceof Error &&
        (err.name === "ConflictError" || err.message.includes("already exists") || err.message.includes("23505"));

      if (isConflict) {
        logger.info(`User already exists, skipping: ${userSpec.email}`);
      } else {
        logger.error(`Failed to seed user ${userSpec.email}:`, err);
        throw err;
      }
    }
  }, Promise.resolve());

  logger.info(`Demo users seeding completed (${results.length} newly created).`);
  return results;
}

/**
 * Resolves the demo admin actor id through the registration service's
 * read-only bootstrap (the seed layer never queries repositories directly —
 * Service-Only Data Access rule). A pure lookup: no authentication, no
 * provisioning. The master seed controller calls this after the users step
 * completes and threads the result into admin-gated seeders
 * (controller-context rule in seeds/AGENTS.md).
 *
 * Throws when the users step has not produced the demo admin yet, so a
 * missing prerequisite fails fast with a named message instead of a
 * mid-seeder auth/provisioning fallback.
 */
export async function getDemoAdminActorId(): Promise<number> {
  const adminSpec = INITIAL_DEMO_USERS.find(spec => spec.role === "admin");
  if (!adminSpec) {
    throw new Error("seed-users: INITIAL_DEMO_USERS carries no admin spec — cannot resolve a gated actor");
  }

  const admin = await RegistrationService.findRegisteredUserByEmail(adminSpec.email);
  if (!admin) {
    throw new Error(`seed-users: demo admin user not found (${adminSpec.email}) — run the users seed step first`);
  }
  return admin.id;
}

/**
 * Resolves a demo user's id by role through the registration service's
 * read-only lookup (Service-Only Data Access rule — same shape as
 * `getDemoAdminActorId`). A pure lookup against the demo specs above: no
 * authentication, no provisioning. Demo seeders that need the trio's ids
 * call this instead of reaching into a sibling seeder's internals.
 *
 * Throws when the users step has not produced the requested demo user yet,
 * so a missing prerequisite fails fast with a named message.
 */
export async function resolveDemoUserId(role: "teacher" | "parent" | "student"): Promise<number> {
  const spec = INITIAL_DEMO_USERS.find(candidate => candidate.role === role);
  if (!spec) {
    throw new Error(`seed-users: INITIAL_DEMO_USERS carries no ${role} spec`);
  }
  const user = await RegistrationService.findRegisteredUserByEmail(spec.email);
  if (!user) {
    throw new Error(`seed-users: demo ${role} user not found (${spec.email}) — run the users seed step first`);
  }
  return user.id;
}
