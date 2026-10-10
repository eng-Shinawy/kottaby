/**
 * Seam contracts for the WebSocket stability harness: the client-socket
 * adapter shape, the identity/session and manifest-selection shapes, the
 * harness-resolved environment, the effectful io seam the orchestrator
 * drives (real wiring lives in the entrypoint; tests provide fakes), and
 * the operator-refusal error the entrypoint maps to exit code 2.
 */

import type { GateResult } from "@/scripts/perf/lib/stats";

/** One client-socket seam (the real io wraps Bun's WebSocket; tests fake it). */
export interface WsHarnessSocket {
  addOpenListener(handler: () => void): void;
  addCloseListener(handler: (code: number, reason: string) => void): void;
  addMessageListener(handler: (data: string) => void): void;
  isOpen(): boolean;
  close(code: number, reason: string): void;
}

/** A real session minted through the login mutation (cookie lives in memory only). */
export interface WsIdentitySession {
  readonly userId: number;
  readonly cookieHeader: string;
}

/** The seed-run selection the identity list comes from. */
export interface WsSeedManifestSelection {
  readonly runId: string;
  readonly wsIdentityEmails: readonly string[];
}

/** Harness-resolved environment (env-seam reads; never raw secrets in outputs). */
export interface WsLoadEnv {
  readonly databaseUrl: string;
  readonly wsUrl: string;
  readonly origin: string;
  readonly perUserCap: number;
  readonly redisUrl: string | undefined;
  readonly transport: string;
}

/** Effectful seams the orchestrator drives (the real wiring lives in the entrypoint). */
export interface WsLoadIo {
  log(message: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
  env(): WsLoadEnv;
  assertTarget(databaseUrl: string, opts: { forceFlag: boolean }): { dbName: string };
  selectManifest(runId: string | null): WsSeedManifestSelection;
  mintSession(baseUrl: string, email: string, password: string): Promise<WsIdentitySession>;
  openWebSocket(url: string, headers: Record<string, string>): WsHarnessSocket;
  publishFanout(channel: string, wire: string): Promise<void>;
  closePublisher(): Promise<void>;
  probeSidecarUp(): Promise<boolean>;
  startSidecar(): Promise<{ stop(): Promise<void> }>;
  openReport(args: Record<string, string | number | boolean>): { runId: string; runDir: string };
  writeReport(runId: string, gates: readonly GateResult[], sections: Record<string, unknown>): void;
  emitVerdict(gates: readonly GateResult[]): boolean;
}

/** Actionable operator refusal (configuration-shaped; exit 2 in the entrypoint). */
export class LoadWsRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoadWsRefusalError";
  }
}

/** Terminal outcome of one harness run. */
export interface WsRunOutcome {
  readonly passed: boolean;
  readonly runId: string;
  readonly runDir: string;
}
