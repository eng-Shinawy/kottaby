#!/usr/bin/env bun
/**
 * Browser login bootstrap for agent-driven UI verification.
 *
 * AI agents cannot receive real credentials in prompts (the AI layer redacts
 * email/password strings), which makes email+password login impossible through
 * typed form fills. This script sidesteps that by reading credentials from an
 * env file directly, performing the GraphQL `login` mutation in-process, and
 * injecting the resulting session cookies into a browser session — values never
 * appear on stdout, in argv, or in the agent's context.
 *
 * Usage:
 *   bun run scripts/browser-login.ts                      # .env, ADMIN_EMAIL / ADMIN_PASSWORD
 *   bun run scripts/browser-login.ts --env-file .env.local
 *   bun run scripts/browser-login.ts --email-key X --password-key Y   # custom env keys
 *   bun run scripts/browser-login.ts --inject           # + inject into the active agent-browser session
 *   bun run scripts/browser-login.ts --inject --session my-agent-browser-session
 *   bun run scripts/browser-login.ts --base-url http://localhost:3000
 *
 * Artifacts (git-ignored, chmod 600):
 *   .browser-auth/cookies.txt             Netscape cookie jar (curl import / manual inspection)
 *   .browser-auth/playwright.cookies.json Playwright `context.addCookies()` format
 *   .browser-auth/storageState.json       Playwright `browser.newContext({ storageState })` format
 *   .browser-auth/inject-mcp.js           Self-contained injector for Playwright MCP browser_run_code_unsafe
 *
 * agent-browser flow: the script injects cookies into a session directly.
 *   AGENT_BROWSER_SESSION=my-session bun run scripts/browser-login.ts --inject
 *   agent-browser open http://localhost:3000/dashboard           # already authenticated
 *
 * Playwright MCP flow: call browser_run_code_unsafe with
 *   { filename: "<abs path>/.browser-auth/inject-mcp.js" }
 * (MCP's code sandbox has no fs/require — the file carries the cookies itself.)
 *
 * Note: the site keeps `accessToken` in React memory only; the httpOnly
 * `refresh_token` + `session_id` cookies are what SSR auth and the client's
 * refresh flow consume, so cookie injection alone authenticates a fresh tab.
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

/** Default env key names — key names only, never secret values. */
const DEFAULT_EMAIL_KEY = "ADMIN_EMAIL";
const DEFAULT_ADMIN_SECRET_KEY = "ADMIN_PASSWORD";

interface CliOptions {
  envFile: string;
  baseUrl: string;
  emailKey: string;
  passwordKey: string;
  jarDir: string;
  inject: boolean;
  session: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    envFile: ".env",
    baseUrl: "http://localhost:3000",
    emailKey: DEFAULT_EMAIL_KEY,
    passwordKey: DEFAULT_ADMIN_SECRET_KEY,
    jarDir: ".browser-auth",
    inject: false,
    session: process.env.AGENT_BROWSER_SESSION ?? null,
  };
  const withValue = new Set(["--env-file", "--base-url", "--email-key", "--password-key", "--jar-dir", "--session"]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--inject") {
      options.inject = true;
      continue;
    }
    if (!withValue.has(flag)) {
      fail(`Unknown flag: ${flag}`);
    }
    const nextIndex = ++i;
    if (nextIndex >= argv.length) fail(`Missing value for ${flag}`);
    const value = argv[nextIndex];
    switch (flag) {
      case "--env-file":
        options.envFile = value;
        break;
      case "--base-url":
        options.baseUrl = value.replace(/\/$/, "");
        break;
      case "--email-key":
        options.emailKey = value;
        break;
      case "--password-key":
        options.passwordKey = value;
        break;
      case "--jar-dir":
        options.jarDir = value;
        break;
      case "--session":
        options.session = value;
        break;
    }
  }
  return options;
}

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function loadCredentials(options: CliOptions): { email: string; password: string } {
  const envPath = resolve(process.cwd(), options.envFile);
  const parsed = loadEnv({ path: envPath, quiet: true });
  if (parsed.error) fail(`Cannot read ${options.envFile}: ${parsed.error.message}`);
  const email = process.env[options.emailKey];
  const password = process.env[options.passwordKey];
  if (!email || !password) {
    fail(`Missing ${options.emailKey} / ${options.passwordKey} in ${options.envFile}`);
  }
  return { email, password };
}

/** Never echo secrets in messages — scrub emails from GraphQL error text. */
function sanitize(message: string, secrets: readonly string[]): string {
  let out = message;
  for (const secret of secrets) {
    out = out.split(secret).join("<redacted>");
  }
  return out;
}

interface ParsedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires: number; // epoch seconds; -1 = session cookie
}

function parseSetCookie(header: string, defaultDomain: string): ParsedCookie {
  const parts = header.split(";").map(part => part.trim());
  const [nameValue, ...attrs] = parts;
  const eq = nameValue.indexOf("=");
  const cookie: ParsedCookie = {
    name: nameValue.slice(0, eq),
    value: nameValue.slice(eq + 1),
    domain: defaultDomain,
    path: "/",
    secure: false,
    httpOnly: false,
    expires: -1,
  };
  for (const attr of attrs) {
    const [rawKey, ...rest] = attr.split("=");
    const key = rawKey.toLowerCase();
    const attrValue = rest.join("=");
    if (key === "domain") cookie.domain = attrValue.replace(/^\./, "");
    else if (key === "path") cookie.path = attrValue || "/";
    else if (key === "secure") cookie.secure = true;
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "max-age") cookie.expires = Math.floor(Date.now() / 1000) + Number(attrValue);
    else if (key === "expires") cookie.expires = Math.floor(new Date(attrValue).getTime() / 1000);
  }
  return cookie;
}

function toNetscapeJar(cookies: readonly ParsedCookie[], defaultDomain: string): string {
  const lines = cookies.map(cookie => {
    const hostOnly = cookie.domain === defaultDomain ? "FALSE" : "TRUE";
    const domain = hostOnly === "TRUE" ? `.${cookie.domain}` : cookie.domain;
    const secure = cookie.secure ? "TRUE" : "FALSE";
    const expires = cookie.expires < 0 ? 0 : cookie.expires;
    return [domain, hostOnly, cookie.path, secure, expires, cookie.name, cookie.value].join("\t");
  });
  return `# Netscape HTTP Cookie File — generated by scripts/browser-login.ts\n${lines.join("\n")}\n`;
}

interface LoginUser {
  id: string | null;
  role: string | null;
  fullName: string | null;
}

interface LoginBody {
  errors?: { message: string }[];
  data?: { login?: { user?: LoginUser | null } | null };
}

function isLoginBody(value: unknown): value is LoginBody {
  if (typeof value !== "object" || value === null) return false;
  if (!("errors" in value)) return true;
  const errors: unknown = value.errors;
  if (!Array.isArray(errors)) return false;
  const list: readonly unknown[] = errors;
  return list.every(e => typeof e === "object" && e !== null && "message" in e && typeof e.message === "string");
}

async function login(options: CliOptions, email: string, password: string): Promise<ParsedCookie[]> {
  // Kottaby's login mutation takes email/password as top-level args (no input
  // wrapper) — mirrors `loginMutationDocument` in
  // `frontend/graphql/sharedDocuments/auth/auth.documents.ts`.
  const response = await fetch(`${options.baseUrl}/api/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query:
        "mutation($email: String!, $password: String!){ login(email: $email, password: $password){ user { id role fullName } } }",
      variables: { email, password },
    }),
  });
  const rawBody: unknown = await response.json();
  if (!isLoginBody(rawBody)) {
    fail("Login mutation returned an unexpected response shape.");
  }
  const body = rawBody;
  if (body.errors?.length) {
    fail(`Login mutation failed: ${sanitize(body.errors.map(e => e.message).join("; "), [email, password])}`);
  }
  const user = body.data?.login?.user;
  if (!user) fail("Login mutation returned no user — check the credentials in the env file.");

  const setCookieHeaders = response.headers.getSetCookie();
  if (setCookieHeaders.length === 0) {
    fail("Login succeeded but the response set no cookies — nothing to inject.");
  }
  const cookies = setCookieHeaders.map(header => parseSetCookie(header, new URL(options.baseUrl).hostname));
  console.log(
    `✓ Logged in as ${user.fullName ?? "(unnamed)"} (role: ${user.role ?? "unknown"}, id: ${user.id}); captured cookies: ${cookies.map(c => c.name).join(", ")}`
  );
  return cookies;
}

function writeArtifacts(
  options: CliOptions,
  cookies: ParsedCookie[]
): { playwrightPath: string; storageStatePath: string; mcpBridgePath: string } {
  const dir = resolve(process.cwd(), options.jarDir);
  mkdirSync(dir, { recursive: true });

  const jarPath = resolve(dir, "cookies.txt");
  const playwrightPath = resolve(dir, "playwright.cookies.json");
  const storageStatePath = resolve(dir, "storageState.json");
  const domain = new URL(options.baseUrl).hostname;

  writeFileSync(jarPath, toNetscapeJar(cookies, domain), { mode: 0o600 });
  chmodSync(jarPath, 0o600);
  const playwrightCookies = cookies.map(cookie => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: "Lax" as const,
    ...(cookie.expires > 0 ? { expires: cookie.expires } : {}),
  }));
  writeFileSync(playwrightPath, JSON.stringify(playwrightCookies, null, 2), { mode: 0o600 });
  chmodSync(playwrightPath, 0o600);
  // Canonical Playwright format — usable directly as `browser.newContext({ storageState })`.
  const storageState = { cookies: playwrightCookies, origins: [] };
  writeFileSync(storageStatePath, JSON.stringify(storageState, null, 2), { mode: 0o600 });
  chmodSync(storageStatePath, 0o600);
  // Playwright MCP: the run-code sandbox has no fs/require/import, so write a
  // self-runnable injector with the cookies baked in (values never leave disk).
  const dashboardUrl = `${options.baseUrl}/dashboard`;
  const mcpBridgePath = resolve(dir, "inject-mcp.js");
  const bridgeCode = `async (page) => {\n  await page.context().addCookies(${JSON.stringify(playwrightCookies)});\n  await page.goto(${JSON.stringify(dashboardUrl)}, { waitUntil: 'networkidle' });\n  return { url: page.url(), title: await page.title() };\n}\n`;
  writeFileSync(mcpBridgePath, bridgeCode, { mode: 0o600 });
  chmodSync(mcpBridgePath, 0o600);
  console.log(`✓ Cookie artifacts written (mode 600, git-ignored):`);
  console.log(`  - ${jarPath}`);
  console.log(`  - ${playwrightPath}`);
  console.log(`  - ${storageStatePath}`);
  console.log(`  - ${mcpBridgePath}`);
  return { playwrightPath, storageStatePath, mcpBridgePath };
}

async function runAgentBrowser(args: readonly string[], session: string | null): Promise<string> {
  const proc = Bun.spawn(["agent-browser", ...args], {
    env: session === null ? process.env : { ...process.env, AGENT_BROWSER_SESSION: session },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    fail((stderr || stdout).trim() || `agent-browser ${args.join(" ")} failed (exit ${exitCode})`);
  }
  return stdout;
}

async function injectIntoAgentBrowser(
  cookies: readonly ParsedCookie[],
  baseUrl: string,
  session: string | null
): Promise<void> {
  const injections = cookies.map(cookie => {
    const args = ["cookies", "set", cookie.name, cookie.value, "--url", baseUrl];
    if (cookie.httpOnly) args.push("--httpOnly");
    if (cookie.secure) args.push("--secure");
    if (cookie.expires > 0) args.push("--expires", String(cookie.expires));
    return runAgentBrowser(args, session);
  });
  await Promise.all(injections);
  const sessionNote = session === null ? "" : ` "${session}"`;
  console.log(
    `✓ ${cookies.length} cookies injected into agent-browser session${sessionNote} — any page on this origin is now authenticated.`
  );
}

function printUsage(storageStatePath: string, mcpBridgePath: string, baseUrl: string): void {
  console.log(`
Playwright MCP: call browser_run_code_unsafe with:
  { "filename": "${mcpBridgePath}" }
The file self-contains the cookies (nothing to paste) and returns the landed URL/title.

Playwright library (scripts/tests — canonical storageState):
  const context = await browser.newContext({ storageState: '${storageStatePath}' });
  const page = await context.newPage();
  await page.goto('${baseUrl}/dashboard');
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { email, password } = loadCredentials(options);
  const cookies = await login(options, email, password);
  const { storageStatePath, mcpBridgePath } = writeArtifacts(options, cookies);
  if (options.inject) await injectIntoAgentBrowser(cookies, options.baseUrl, options.session);
  printUsage(storageStatePath, mcpBridgePath, options.baseUrl);
}

await main();
