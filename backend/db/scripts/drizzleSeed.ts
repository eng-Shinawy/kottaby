import { closePool } from "@/backend/db";
import { runAllSeeds } from "@/backend/db/seeds";
import { loadSeedConfig } from "@/backend/db/seeds/lib";
import { logger } from "@/backend/lib/logger";

process.env.SEED_MODE = "true";

async function runSeed(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    logger.error("Seeding is not allowed in production environment");
    process.exit(1);
  }

  const config = loadSeedConfig();

  await runAllSeeds(config);
  logger.info("Database seed completed successfully.");
}

runSeed()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    logger.error("Database seed failed:", err);
    await closePool();
    process.exit(1);
  });
