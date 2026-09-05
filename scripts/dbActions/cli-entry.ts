/**
 * DB Actions CLI entrypoint.
 *
 * Bootstraps env for non-interactive commands, then loads the interactive CLI.
 * Database destructive-action guards are enforced later in `actions.ts`.
 */
import { bootstrapDbCliEnv } from "@/scripts/dbActions/bootstrapEnv";

bootstrapDbCliEnv();

const { main } = await import("@/scripts/dbActions/cli");

main().catch((err: unknown) => {
  globalThis.console.error("Fatal:", err);
  process.exit(1);
});
