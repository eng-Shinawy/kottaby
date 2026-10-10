/**
 * Unit suite for the performance-harness database-target guard.
 *
 * Covers the DSN parsing matrix (URL forms, unix-socket forms, scheme
 * variants, URL-encoded credentials, case and suffix tricks), parity against
 * the `pg` driver's own connection-string parser (the guard must resolve
 * exactly the database the driver would connect to), and the refusal
 * contract: exit code 2 in a real subprocess with operator output that names
 * the database and host but never the credentials.
 */

import { describe, expect, test } from "bun:test";
import { parse as parsePgConnectionString } from "pg-connection-string";
import {
  assessDatabaseTarget,
  formatDatabaseTargetRefusal,
  resolveDatabaseTarget,
  TEST_DATABASE_NAME,
} from "@/scripts/perf/lib/db-target-guard";

describe("db-target-guard: assessment contract", () => {
  test("allows a URL DSN that names the test database", () => {
    const assessment = assessDatabaseTarget("postgresql://postgres:pw@127.0.0.1:5432/kottaby_test");
    expect(assessment.allowed).toBe(true);
    expect(assessment.dbName).toBe(TEST_DATABASE_NAME);
    expect(assessment.host).toBe("127.0.0.1");
  });

  test("accepts the postgres:// scheme variant", () => {
    const assessment = assessDatabaseTarget("postgres://postgres:pw@localhost:5432/kottaby_test");
    expect(assessment.allowed).toBe(true);
    expect(assessment.dbName).toBe("kottaby_test");
  });

  test("refuses a production-shaped database name and reports the target", () => {
    const assessment = assessDatabaseTarget("postgresql://app:pw@db.internal:5432/kottaby");
    expect(assessment.allowed).toBe(false);
    expect(assessment.dbName).toBe("kottaby");
    expect(assessment.host).toBe("db.internal");
  });

  test("accepts the unix-socket space-separated form naming the test database", () => {
    const assessment = assessDatabaseTarget("/var/run/postgresql kottaby_test");
    expect(assessment.allowed).toBe(true);
    expect(assessment.dbName).toBe("kottaby_test");
    expect(assessment.host).toBe("/var/run/postgresql");
  });

  test("accepts a socket: URI naming the test database in the db query parameter", () => {
    const assessment = assessDatabaseTarget("socket:///var/run/postgres?db=kottaby_test");
    expect(assessment.allowed).toBe(true);
    expect(assessment.dbName).toBe("kottaby_test");
    expect(assessment.host).toBe("/var/run/postgres");
  });

  test("the refusal block names the database and host but never the credentials", () => {
    const dsn = "postgresql://app_user:hunter2-secret@prod-host.example.com:5432/kottaby";
    const message = formatDatabaseTargetRefusal(assessDatabaseTarget(dsn));
    expect(message).toContain("kottaby");
    expect(message).toContain("prod-host.example.com");
    expect(message).toContain(TEST_DATABASE_NAME);
    expect(message).not.toContain("hunter2-secret");
    expect(message).not.toContain("app_user");
  });

  test("the refusal block masks control bytes in a garbage-resolved name", () => {
    const assessment = assessDatabaseTarget("postgres://h/kottaby\u0007test\u000b");
    expect(assessment.allowed).toBe(false);
    const message = formatDatabaseTargetRefusal(assessment);
    expect(message).not.toContain("\u0007");
    expect(message).not.toContain("\u000b");
  });

  test("the refusal block reports an unresolvable name as such", () => {
    const message = formatDatabaseTargetRefusal(assessDatabaseTarget(""));
    expect(message).toContain("(unresolvable)");
  });
});

describe("db-target-guard: DSN boundary matrix", () => {
  test("refuses every non-test name shape", () => {
    const refused = [
      "postgres://host/",
      "postgres://host",
      "postgres://u:p@host",
      "",
      "   ",
      "postgresql://u:p@127.0.0.1:5432/kottaby_test ",
      " postgres://u:p@h/kottaby_test",
      "POSTGRES://host/KOTTABY_TEST",
      "postgresql://u:p@h:5432/kottaby_test_extra",
      "postgres://h/kottaby-test",
      "postgresql://u:p@prod-host/kottaby",
      "postgres://h/kottaby%2Ftest",
      "postgresql://u:p@ep-x.neon.tech/neondb?sslmode=require",
      "/var/run/postgresql",
      "/var/run/postgresql kottaby",
      "/var/run/postgresql  kottaby_test",
      "socket:///var/run/postgres",
      "host=localhost dbname=kottaby_test",
    ];
    for (const dsn of refused) {
      expect(assessDatabaseTarget(dsn).allowed).toBe(false);
    }
  });

  test("resolves the exact names the refusal reports for the trick shapes", () => {
    expect(assessDatabaseTarget("postgresql://u:p@127.0.0.1:5432/kottaby_test ").dbName).toBe("kottaby_test ");
    expect(assessDatabaseTarget("POSTGRES://host/KOTTABY_TEST").dbName).toBe("KOTTABY_TEST");
    expect(assessDatabaseTarget("postgresql://u:p@h:5432/kottaby_test_extra").dbName).toBe("kottaby_test_extra");
    expect(assessDatabaseTarget("postgres://h/kottaby%2Ftest").dbName).toBe("kottaby%2Ftest");
    expect(assessDatabaseTarget("postgres://host/").dbName).toBeNull();
  });

  test("allows every legitimate test-target shape", () => {
    const allowed = [
      "postgresql://postgres:p%40ssw0rd@127.0.0.1:5432/kottaby_test",
      "postgresql://u:p@ss@127.0.0.1:5432/kottaby_test",
      "postgres://[::1]:5432/kottaby_test",
      "postgres://h/kottaby%5Ftest",
      "postgres://u:p@h/kottaby_test?connect_timeout=5&application_name=perf",
      "postgres://u:p@h/kottaby_test?host=127.0.0.1",
      "postgres://%2fvar%2frun%2fpostgresql@h/kottaby_test",
      "postgres://u:p@h/kottaby_test\n",
    ];
    for (const dsn of allowed) {
      expect(assessDatabaseTarget(dsn).allowed).toBe(true);
    }
  });

  test("the URL-encoded-@ password case never leaks the password through the refusal", () => {
    const dsn = "postgresql://postgres:p%40ssw0rd@127.0.0.1:5432/kottaby_test_extra";
    const message = formatDatabaseTargetRefusal(assessDatabaseTarget(dsn));
    expect(message).not.toContain("p%40ssw0rd");
    expect(message).not.toContain("ssw0rd");
    expect(message).toContain("kottaby_test_extra");
  });

  test("an IPv6 host resolves to its bracket-stripped form", () => {
    const target = resolveDatabaseTarget("postgres://[::1]:5432/kottaby_test");
    expect(target.host).toBe("::1");
    expect(target.dbName).toBe("kottaby_test");
  });

  test("rapid-fire assessments over a mixed pool stay stable (no hidden state)", () => {
    const pool = [
      "postgresql://postgres:pw@127.0.0.1:5432/kottaby_test",
      "postgresql://app:pw@prod-host/kottaby",
      "",
      "/var/run/postgresql kottaby_test",
      "postgres://h/kottaby%5Ftest",
      "POSTGRES://host/KOTTABY_TEST",
    ];
    const expected = pool.map(dsn => assessDatabaseTarget(dsn).allowed);
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < pool.length; i++) {
        expect(assessDatabaseTarget(pool[i]).allowed).toBe(expected[i]);
      }
    }
  });
});

/** Fragments and characters the chaos generator composes DSN-like garbage from. */
const FUZZ_FRAGMENTS = [
  "postgres://",
  "postgresql://",
  "socket://",
  "/",
  "user:pass@",
  "u@h:5432/",
  "h/",
  "kottaby_test",
  "kottaby",
  "KOTTABY_TEST",
  "kottaby%5Ftest",
  "?db=kottaby_test",
  "?host=x",
  "?connect_timeout=5",
  "%40",
  "%2F",
  " ",
  ":",
  "@",
  "/",
  "?",
  "=",
  "&",
  "%",
  "//",
];
const FUZZ_CHAR_POOL = ":/@?=&%._-0123abcXYZ \n";

/** Deterministic LCG so the chaos cases are reproducible run-to-run. */
function createSeededRandom(seed: number): () => number {
  let state = seed % 4294967296;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Builds one random DSN-ish string: either fragment-composed or pure character soup. */
function buildFuzzCase(random: () => number): string {
  if (random() < 0.5) {
    const count = 1 + Math.floor(random() * 4);
    let out = "";
    for (let i = 0; i < count; i++) {
      out += FUZZ_FRAGMENTS[Math.floor(random() * FUZZ_FRAGMENTS.length)];
    }
    return out;
  }
  const length = Math.floor(random() * 30);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += FUZZ_CHAR_POOL[Math.floor(random() * FUZZ_CHAR_POOL.length)];
  }
  return out;
}

describe("db-target-guard: chaos / driver-parser parity", () => {
  test("250 seeded fuzz cases resolve exactly the database the pg driver would connect to", () => {
    const random = createSeededRandom(20261009);
    for (let i = 0; i < 250; i++) {
      const candidate = buildFuzzCase(random);
      const mine = resolveDatabaseTarget(candidate).dbName;
      let realThrew = false;
      let real: string | null | undefined = null;
      try {
        real = parsePgConnectionString(candidate).database;
      } catch {
        realThrew = true;
      }
      if (realThrew) {
        expect(assessDatabaseTarget(candidate).allowed).toBe(false);
      } else {
        const normalized = real === undefined || real === null || real.length === 0 ? null : real;
        expect(mine).toBe(normalized);
      }
    }
  });

  test("malformed DSNs are refused, never crash the resolver", () => {
    const garbage = [":::", "://x", "postgres://", "postgres://:@/", "%", "%%%", "postgres://h/🎁"];
    for (const dsn of garbage) {
      const target = resolveDatabaseTarget(dsn);
      expect(target).toBeDefined();
      expect(assessDatabaseTarget(dsn).allowed).toBe(false);
    }
  });
});

/**
 * Refusal contract: exit code 2 + credential-silent operator output, proven
 * in a real subprocess so the process exit itself is under test.
 */
const GUARD_DRIVER_SCRIPT = `
const mod = await import(process.env.GUARD_MODULE);
const result = mod.assertTestDatabaseTarget(process.env.GUARD_DSN ?? "", {
  forceFlag: process.env.GUARD_FORCE === "1",
});
console.log("GUARD_RESULT:allowed:" + result.dbName);
`;

interface GuardSubprocessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runGuardSubprocess(
  dsn: string,
  options: {
    forceFlag?: boolean;
    stdin?: { kind: "pipe"; input: string } | { kind: "closed" };
    dbProvider?: string | { kind: "unset" };
  } = {}
): Promise<GuardSubprocessResult> {
  const stdinMode: "pipe" | "ignore" =
    options.stdin?.kind === "pipe" || options.stdin === undefined ? "pipe" : "ignore";
  // DB_PROVIDER is pinned per test: the provider refusal must be exercised
  // deliberately, never as an accident of the invoking shell's environment.
  const env: Record<string, string | undefined> = { ...process.env };
  if (typeof options.dbProvider === "string") {
    env.DB_PROVIDER = options.dbProvider;
  } else if (options.dbProvider?.kind === "unset") {
    delete env.DB_PROVIDER;
  } else {
    env.DB_PROVIDER = "postgres";
  }
  const proc = Bun.spawn([process.execPath, "-e", GUARD_DRIVER_SCRIPT], {
    env: {
      ...env,
      GUARD_MODULE: `${import.meta.dir}/db-target-guard`,
      GUARD_DSN: dsn,
      GUARD_FORCE: options.forceFlag === true ? "1" : "0",
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: stdinMode,
  });
  if (options.stdin?.kind === "pipe") {
    const stdin = proc.stdin;
    if (stdin !== undefined) {
      await stdin.write(options.stdin.input);
      await stdin.end();
    }
  }
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("db-target-guard: refusal is exit-2 and credential-silent", () => {
  test("a production-shaped DSN exits 2 naming the database and host only", async () => {
    const result = await runGuardSubprocess("postgresql://app_user:hunter2-secret@prod-host.example.com:5432/kottaby");
    const output = `${result.stdout}${result.stderr}`;
    expect(result.exitCode).toBe(2);
    expect(output).toContain("kottaby");
    expect(output).toContain("prod-host.example.com");
    expect(output).not.toContain("GUARD_RESULT");
    expect(output).not.toContain("hunter2-secret");
    expect(output).not.toContain("app_user");
  });

  test("an empty connection string exits 2 as unresolvable", async () => {
    const result = await runGuardSubprocess("");
    expect(result.exitCode).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain("(unresolvable)");
  });

  test("the test-database DSN is allowed in a real process (exit 0)", async () => {
    const result = await runGuardSubprocess("postgresql://postgres:pw@127.0.0.1:5432/kottaby_test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`GUARD_RESULT:allowed:${TEST_DATABASE_NAME}`);
  });

  const BYPASS_SHAPES: [string, string][] = [
    ["trailing-space name", "postgresql://u:p@h/kottaby_test "],
    ["suffixed name", "postgresql://u:p@h/kottaby_test_extra"],
    ["uppercase name", "POSTGRES://h/KOTTABY_TEST"],
    ["dashed name", "postgres://h/kottaby-test"],
    ["double-space unix form", "/var/run/postgresql  kottaby_test"],
  ];

  test.each(BYPASS_SHAPES)("no bypass shape (%s) reaches exit 0 without the force flag", async (_label, dsn) => {
    const result = await runGuardSubprocess(dsn);
    expect(result.exitCode).toBe(2);
  });

  test("the force flag plus an exact typed confirmation continues (exit 0)", async () => {
    const result = await runGuardSubprocess("postgresql://app_user:hunter2-secret@prod-host/kottaby_prod_shaped", {
      forceFlag: true,
      stdin: { kind: "pipe", input: "kottaby_prod_shaped\n" },
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("GUARD_RESULT:allowed:kottaby_prod_shaped");
    expect(output).toContain("kottaby_prod_shaped");
    expect(output).not.toContain("hunter2-secret");
    expect(output).not.toContain("app_user");
  });

  test("the force flag with a wrong typed confirmation still exits 2", async () => {
    const result = await runGuardSubprocess("postgresql://u:p@prod-host/kottaby_prod_shaped", {
      forceFlag: true,
      stdin: { kind: "pipe", input: "kottaby_test\n" },
    });
    expect(result.exitCode).toBe(2);
    expect(`${result.stdout}${result.stderr}`).not.toContain("GUARD_RESULT");
  });

  test("the force flag with a closed stdin still exits 2 (fail-closed)", async () => {
    const result = await runGuardSubprocess("postgresql://u:p@prod-host/kottaby_prod_shaped", {
      forceFlag: true,
      stdin: { kind: "closed" },
    });
    expect(result.exitCode).toBe(2);
  });

  test("the force flag never overrides an unresolvable connection string", async () => {
    const result = await runGuardSubprocess("", {
      forceFlag: true,
      stdin: { kind: "pipe", input: "kottaby_test\n" },
    });
    expect(result.exitCode).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain("(unresolvable)");
  });
});

describe("db-target-guard: non-postgres DB_PROVIDER refusal", () => {
  const TEST_DSN = "postgresql://postgres:pw@127.0.0.1:5432/kottaby_test";

  test("a pglite DB_PROVIDER exits 2 — the guard would be moot (DATABASE_URL ignored)", async () => {
    const result = await runGuardSubprocess(TEST_DSN, { dbProvider: "pglite" });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.exitCode).toBe(2);
    expect(output).toContain("DB_PROVIDER");
    expect(output).toContain("pglite");
    expect(output).not.toContain("GUARD_RESULT");
  });

  test("the force flag plus a typed confirmation never overrides the provider refusal", async () => {
    const result = await runGuardSubprocess(TEST_DSN, {
      dbProvider: "pglite",
      forceFlag: true,
      stdin: { kind: "pipe", input: "kottaby_test\n" },
    });
    expect(result.exitCode).toBe(2);
    expect(`${result.stdout}${result.stderr}`).not.toContain("GUARD_RESULT");
  });

  test("an explicitly postgres DB_PROVIDER is allowed (exit 0)", async () => {
    const result = await runGuardSubprocess(TEST_DSN, { dbProvider: "postgres" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`GUARD_RESULT:allowed:${TEST_DATABASE_NAME}`);
  });

  test("an unset DB_PROVIDER keeps the historical default behavior (exit 0)", async () => {
    const result = await runGuardSubprocess(TEST_DSN, { dbProvider: { kind: "unset" } });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`GUARD_RESULT:allowed:${TEST_DATABASE_NAME}`);
  });

  test("the provider comparison is case-insensitive like the client's own check", async () => {
    const result = await runGuardSubprocess(TEST_DSN, { dbProvider: "PGLITE" });
    expect(result.exitCode).toBe(2);
  });
});
