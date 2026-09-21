// cspell:disable
/**
 * QUALITY GATE AUTOMATION SCRIPT
 *
 * This script automates the project's quality assurance loop with stage persistence.
 * It runs sequential checks and saves progress to resume from the last failed stage.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withProcessLock } from "@/scripts/lib";

const STATE_FILE = join(process.cwd(), ".quality-gate-state.json");

type QualityStage = "BASIC_CHECKS" | "DUPLICATES";
type QualityLifecycle = "FRESH" | "NEED_CONFIRM" | "DONE";

interface QualityState {
  stage: QualityStage;
  owner: "quality-gate" | "duplicates";
  lifecycle: QualityLifecycle;
  lastRun: string;
}

const DUPLICATES_INSTRUCTIONS = `
/**
 * DUPLICATES REMEDIATION PROMPT:
 * jscpd has detected code duplication (cross-file clones).
 *
 * Fix options:
 *   1. Extract a shared scaffold — see docs/frontend/ui-shared-scaffold-pattern.md
 *   2. Extract a shared utility — see docs/frontend/duplication-elimination-patterns.md
 *   3. If the duplication is intentional (e.g. Drizzle schema column helpers,
 *      shared/locale ar/en i18n parallel translations, thin passthrough wrappers),
 *      remove the clone by restructuring, NOT by adding jscpd:ignore comments.
 *
 * Hard rules:
 *   - NEVER add jscpd:ignore comments — fix the root cause instead.
 *   - NEVER modify .jscpd.json configuration.
 *   - Zero jscpd:ignore and zero .jscpd.json changes is enforced across all phases.
 *
 * After fixing, rerun: bun quality-gate
 */
`;

/**
 * Opt-in inter-stage settle delay (ms) for memory-constrained sandboxes.
 *
 * BASIC_CHECKS runs the heavy native checkers back-to-back (tsgo, then
 * oxlint's tsgolint, each multi-GB). Inside a small cgroup the previous
 * checker's reclaimed page cache is still charged to the cgroup when the
 * next one starts allocating, which can OOM-kill tsgolint even though both
 * checkers pass standalone. Setting e.g. QUALITY_GATE_SETTLE_MS=45000 adds
 * a short pause between the heavy commands so the kernel can reclaim;
 * the default of 0 keeps CI behavior identical (CI runners have ample RAM
 * and never need the pause).
 */
const INTER_STAGE_SETTLE_MS = Number(process.env.QUALITY_GATE_SETTLE_MS ?? "0");

function settle(): Promise<void> {
  return INTER_STAGE_SETTLE_MS > 0
    ? new Promise(resolve => setTimeout(resolve, INTER_STAGE_SETTLE_MS))
    : Promise.resolve();
}

async function runCommand(command: string, args: string[]): Promise<{ success: boolean; output: string }> {
  console.log(`\n> Running: ${command} ${args.join(" ")}`);

  return new Promise(resolve => {
    const child = spawn(command, args, { shell: false, stdio: ["inherit", "pipe", "pipe"] });
    let output = "";

    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      process.stdout.write(chunk);
    });

    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      process.stderr.write(chunk);
    });

    child.on("close", code => {
      resolve({ success: code === 0, output });
    });

    child.on("error", err => {
      resolve({ success: false, output: err.message });
    });
  });
}

function isQualityState(val: unknown): val is QualityState {
  return typeof val === "object" && val !== null;
}

function getState(): QualityState {
  if (existsSync(STATE_FILE)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      if (isQualityState(parsed)) {
        if (!parsed.lifecycle) parsed.lifecycle = "FRESH";
        return parsed;
      }
    } catch {
      return { stage: "BASIC_CHECKS", owner: "quality-gate", lifecycle: "FRESH", lastRun: new Date().toISOString() };
    }
  }
  return { stage: "BASIC_CHECKS", owner: "quality-gate", lifecycle: "FRESH", lastRun: new Date().toISOString() };
}

function saveState(stage: QualityStage, owner: QualityState["owner"], lifecycle: QualityLifecycle): void {
  writeFileSync(STATE_FILE, JSON.stringify({ stage, owner, lifecycle, lastRun: new Date().toISOString() }, null, 2));
}

/** Clear the quality-gate state file ONLY. Never clear any cache files. */
function clearState(): void {
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
}

async function performStage(stage: QualityStage): Promise<boolean> {
  switch (stage) {
    case "BASIC_CHECKS": {
      const tsgo = await runCommand("bun", ["tsgo"]);
      if (!tsgo.success) return false;
      await settle();
      const oxlint = await runCommand("bun", ["oxlint"]);
      if (!oxlint.success) return false;
      const biome = await runCommand("bun", ["biome:check"]);
      if (!biome.success) return false;
      const unused = await runCommand("bun", ["check:unused"]);
      if (!unused.success) return false;
      const lint = await runCommand("bun", ["lint:type-aware"]);
      return lint.success;
    }
    case "DUPLICATES": {
      const check = await runCommand("bun", ["check:duplicates"]);
      if (!check.success) {
        console.warn("⚠️ Code duplication (cross-file clones) detected by jscpd.");
        console.log("\x1b[36m%s\x1b[0m", DUPLICATES_INSTRUCTIONS);
        return false;
      }
      return true;
    }
  }
  throw new Error(`Unhandled case in performStage`);
}

const STAGES: QualityStage[] = ["BASIC_CHECKS", "DUPLICATES"];

async function recoverOwnership(state: QualityState): Promise<void> {
  console.log(`\n🔍 Checking if "${state.owner}" issues are resolved...`);
  let resolved = false;

  if (state.owner === "duplicates") {
    const check = await runCommand("bun", ["check:duplicates"]);
    if (check.success) resolved = true;
  }

  if (resolved) {
    console.log(`✅ Recovery check passed. Reclaiming ownership for "quality-gate".`);
    state.owner = "quality-gate";
    saveState(state.stage, "quality-gate", "NEED_CONFIRM");
  } else {
    console.error(`\n🛑 State is still owned by "${state.owner}". Resolve issues in that tool first.`);
    process.exit(1);
  }
}

async function executeStages(startIndex: number, lifecycle: QualityLifecycle): Promise<void> {
  async function executeFromIndex(index: number): Promise<void> {
    if (index >= STAGES.length) return;

    const currentStage = STAGES[index];
    saveState(currentStage, "quality-gate", lifecycle);

    const success = await performStage(currentStage);
    if (!success) {
      let owner: QualityState["owner"] = "quality-gate";
      if (currentStage === "DUPLICATES") owner = "duplicates";

      saveState(currentStage, owner, "NEED_CONFIRM");
      console.error(`\n❌ Stage ${currentStage} failed. Fix the issues and rerun.`);
      process.exit(1);
    }

    return executeFromIndex(index + 1);
  }

  await executeFromIndex(startIndex);
}

async function runQualityGate(): Promise<void> {
  const isFresh = process.argv.includes("--fresh");
  if (isFresh) {
    console.log("🧹 Fresh start requested. Clearing state (caches are preserved)...");
    clearState();
  }

  let state = getState();

  if (state.lifecycle === "DONE" && !isFresh) {
    console.log("🔄 Quality gate was previously DONE. Starting a new FRESH round...");
    state = { stage: "BASIC_CHECKS", owner: "quality-gate", lifecycle: "FRESH", lastRun: new Date().toISOString() };
    saveState("BASIC_CHECKS", "quality-gate", "FRESH");
  }

  console.log(`🚀 Quality Gate: Stage=${state.stage}, Owner=${state.owner}, Lifecycle=${state.lifecycle}`);

  if (state.owner !== "quality-gate") {
    await recoverOwnership(state);
  }

  const startIndex = STAGES.indexOf(state.stage);
  await executeStages(startIndex, state.lifecycle);

  saveState("BASIC_CHECKS", "quality-gate", "DONE");
  console.log("\n✨✨ ALL QUALITY GATES PASSED! ✨✨");
  console.log("Lifecycle state: DONE (Empirically verified)");
}
// Timeout logic
const timeoutArg = process.argv.find(arg => arg.startsWith("--timeout="));
const timeoutMs = timeoutArg ? Number.parseInt(timeoutArg.split("=")[1], 10) : 0;

let timeoutId: NodeJS.Timeout | undefined;
if (timeoutMs > 0) {
  timeoutId = setTimeout(() => {
    console.error(`\n🛑 Quality gate timed out after ${timeoutMs}ms.`);
    process.exit(1);
  }, timeoutMs);
}

try {
  await withProcessLock("quality-gate", async () => {
    await runQualityGate();
  });
  if (timeoutId) clearTimeout(timeoutId);
  process.exit(0);
} catch (err: unknown) {
  if (timeoutId) clearTimeout(timeoutId);
  console.error(err);
  process.exit(1);
}
