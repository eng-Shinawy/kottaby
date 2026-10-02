import { spawnSync } from "bun";

export const TEST_SERVER_PORT = 3099;
export const PROTECTED_APP_PORTS = [3000, 4000] as const;

export function getTestServerPortCandidates(): number[] {
  return [TEST_SERVER_PORT, 3066];
}

/**
 * Windows branch of `killListenersOnPort` — netstat + taskkill.
 * Extracted to keep per-function sonarjs cognitive complexity within budget;
 * behavior is identical to the previous inline branch.
 */
function killWindowsListeners(port: number, selfPid: string, parentPid: string): number {
  const res = spawnSync(["cmd.exe", "/c", `netstat -ano -p tcp | findstr /R /C:":${port} "`], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = res.stdout.toString().trim();
  if (!stdout) return 0;
  const lines = stdout.split(/\r?\n/);
  const pids = new Set<string>();
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 5 && parts[3] === "LISTENING") {
      const pid = parts[4];
      if (pid && pid !== "0" && pid !== selfPid && pid !== parentPid) {
        pids.add(pid);
      }
    }
  }
  for (const pid of pids) {
    spawnSync(["taskkill", "/F", "/T", "/PID", pid], { stdout: "ignore", stderr: "ignore" });
  }
  return pids.size;
}

/**
 * ss(8) fallback for environments without lsof (minimal sandboxes): parse
 * `ss -lptn` listener lines for `pid=N` tokens. The line shape is
 * `LISTEN 0 511 0.0.0.0:PORT 0.0.0.0:* users:(("name",pid=817,fd=22))` —
 * the pid list may span several comma-separated entries, all captured.
 */
function listListenerPidsViaSs(port: number, selfPid: string, parentPid: string): string[] {
  const res = spawnSync(["ss", "-lptn", `sport = :${port}`], { stdout: "pipe", stderr: "ignore" });
  const stdout = res.stdout.toString();
  if (!stdout) return [];
  return [...stdout.matchAll(/pid=(\d+)/g)].map(match => match[1]).filter(pid => pid !== selfPid && pid !== parentPid);
}

/**
 * POSIX branch of `killListenersOnPort` — lsof + kill -9, falling back to
 * ss(8) parsing when lsof is absent (the spawn fails with ENOENT and yields
 * no output — silently no-oping the whole cleanup in minimal sandboxes).
 * Extracted to keep per-function sonarjs cognitive complexity within budget;
 * behavior is identical to the previous inline branch.
 */
function killUnixListeners(port: number, selfPid: string, parentPid: string): number {
  const res = spawnSync(["lsof", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdout: "pipe", stderr: "ignore" });
  const stdout = res.stdout.toString().trim();
  const pids =
    stdout !== ""
      ? stdout.split(/\s+/).filter(pid => Boolean(pid) && pid !== selfPid && pid !== parentPid)
      : listListenerPidsViaSs(port, selfPid, parentPid);
  for (const pid of pids) {
    spawnSync(["kill", "-9", pid], { stdout: "ignore", stderr: "ignore" });
  }
  return pids.length;
}

export function killListenersOnPort(port: number): number {
  if ((PROTECTED_APP_PORTS as readonly number[]).includes(port)) {
    return 0;
  }
  try {
    const selfPid = String(process.pid);
    const parentPid = String(process.ppid);

    if (process.platform === "win32") {
      return killWindowsListeners(port, selfPid, parentPid);
    }

    return killUnixListeners(port, selfPid, parentPid);
  } catch {
    return 0;
  }
}
