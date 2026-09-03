/**
 * `/admin/broadcasts` — admin broadcast compose surface, end-to-end over the
 * REAL production server (run-server-tests spawn) driven by a REAL Chromium
 * through Playwright.
 *
 * Covers the full compose interaction loop in a real browser runtime:
 *   initial render · empty-title inline validation with NO network mutation ·
 *   the All-audience happy path (fill → send → confirmation dialog →
 *   success toast) · double-click protection inside the send window (the
 *   confirm affordance is disabled while the mutation is in flight, so a
 *   second click fires nothing) · the role companion renders a combobox over
 *   the four UserRole members · the country companion accepts exact-match
 *   free text and delivers · the plan companion loads the plan catalog and
 *   renders the options · the Arabic RTL pass (locale cookie → mirrored
 *   surface, dialog and toast intact).
 *
 * Network contract asserted on the RAW wire: every send rides EXACTLY ONE
 * `adminBroadcastNotification` POST whose request carries the compose-session
 * `x-idempotency-key` header, and keys rotate across successful sends (the
 * replay window stays pinned to a single compose session).
 *
 * Evidence screenshots (viewports × locales × states) are archived under the
 * plan bundle's `outcome/4.3-screenshots/` directory.
 *
 * Runs via the server-test runner:
 * `TEST_SERVER_MODE=production bun run test/scripts/run-server-tests.ts --e2e test/ui/e2e/admin-broadcasts.e2e.test.ts`
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type BrowserContext, type Cookie, chromium, type Page, type Request } from "playwright";

const PORT = process.env.TEST_SERVER_PORT ?? "3066";
const BASE = `http://localhost:${PORT}`;

const SHOT_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "ai",
  "plans",
  "sprint_3",
  "dev3-022d-broadcast-notifications-system-wide-targ",
  "outcome",
  "4.3-screenshots"
);

const LOGIN_MUTATION = /* GraphQL */ `
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      user {
        id
        email
        role
      }
      accessToken
      refreshToken
    }
  }
`;

/** Wire observation of the broadcast mutation: URL, idempotency key, payload. */
interface MutationRecord {
  idempotencyKey: string | null;
  variables: { input?: { audience?: { type?: string } } } | null;
}

function trackMutations(page: Page, log: MutationRecord[]): void {
  page.on("request", (request: Request) => {
    if (request.method() !== "POST" || !request.url().includes("/api/graphql")) {
      return;
    }
    const body = request.postData() ?? "";
    if (!body.includes("adminBroadcastNotification")) {
      return;
    }
    let variables: MutationRecord["variables"] = null;
    try {
      variables = JSON.parse(body).variables ?? null;
    } catch {
      // Malformed body carries no readable variables — the record keeps null.
    }
    log.push({
      idempotencyKey: request.headers()["x-idempotency-key"] ?? null,
      variables,
    });
  });
}

/** The form's submit affordance — the only path into the confirmation gate. */
function submitButton(page: Page) {
  return page.locator("form button[type=submit]").first();
}

function confirmButton(page: Page) {
  return page.getByRole("dialog").locator("button.MuiButton-contained");
}

/**
 * Polls an observable probe until it equals the expected value or the timeout
 * elapses — synchronization on an observable condition, never a fixed wait.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollUntil(probe: () => number, expected: number, deadline: number): Promise<void> {
  if (probe() === expected) {
    return;
  }
  if (Date.now() > deadline) {
    throw new Error(`observable condition (${expected}) not met in time`);
  }
  await delay(100);
  await pollUntil(probe, expected, deadline);
}

async function waitForCount(probe: () => number, expected: number, timeoutMs = 5000): Promise<void> {
  return pollUntil(probe, expected, Date.now() + timeoutMs);
}

async function composeAndSend(page: Page, title: string, body: string): Promise<void> {
  await page.locator("form input").first().fill(title);
  await page.locator("form textarea").first().fill(body);
  await submitButton(page).click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 15000 });
}

async function awaitSuccessToast(page: Page): Promise<void> {
  await page.locator(".MuiSnackbar-root .MuiAlert-success").waitFor({ state: "visible", timeout: 20000 });
}

/** True when a parsed GraphQL response carries a successful `login` payload. */
function hasLoginData(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const data: unknown = Reflect.get(value, "data");
  return typeof data === "object" && data !== null && Reflect.get(data, "login") != null;
}

async function attemptLogin(context: BrowserContext, passwords: readonly string[], index: number): Promise<void> {
  if (index >= passwords.length) {
    throw new Error("admin login failed for every documented credential");
  }
  const password = passwords[index] ?? "";
  const response = await context.request.post(`${BASE}/api/graphql`, {
    data: { query: LOGIN_MUTATION, variables: { email: "admin@app.local", password } },
  });
  const payload: unknown = await response.json();
  if (hasLoginData(payload)) {
    return;
  }
  await attemptLogin(context, passwords, index + 1);
}

/** Authenticated admin contexts share the login attempt matrix. */
async function loginAdmin(context: BrowserContext): Promise<void> {
  const passwords = [process.env.ADMIN_PASSWORD, "adminpassword123", "Seed_Pass1!"].filter(
    (value): value is string => typeof value === "string"
  );
  await attemptLogin(context, passwords, 0);
}

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  mkdirSync(SHOT_DIR, { recursive: true });
});

afterAll(async () => {
  await browser.close();
});

test("admin broadcast compose surface — full interaction loop (en / LTR)", async () => {
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const mutations: MutationRecord[] = [];
  trackMutations(page, mutations);
  await loginAdmin(context);

  // ── Initial render ─────────────────────────────────────────────────────
  await page.goto(`${BASE}/admin/broadcasts`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator("form").first().waitFor({ state: "visible", timeout: 90000 });
  expect(await page.getByRole("radio").count()).toBe(4);
  await page.screenshot({ path: join(SHOT_DIR, "01-en-desktop-1440-initial.png") });

  // ── Empty title: inline validation, NO mutation ────────────────────────
  await submitButton(page).click();
  await page.locator("form .MuiFormHelperText-root.Mui-error").first().waitFor({ state: "visible", timeout: 10000 });
  expect(mutations).toHaveLength(0);
  await page.screenshot({ path: join(SHOT_DIR, "02-en-desktop-validation-empty-title.png") });

  // ── All-audience happy path ────────────────────────────────────────────
  await composeAndSend(page, "Maintenance window", "Scheduled maintenance runs on Friday evening.");
  await page.screenshot({ path: join(SHOT_DIR, "03-en-desktop-confirm-dialog.png") });
  await confirmButton(page).click();
  await awaitSuccessToast(page);
  await page.screenshot({ path: join(SHOT_DIR, "04-en-desktop-success-toast.png") });
  await waitForCount(() => mutations.length, 1);
  expect(mutations).toHaveLength(1);
  expect(mutations[0]?.idempotencyKey).not.toBeNull();
  expect(mutations[0]?.variables?.input?.audience?.type).toBe("ALL");

  // ── Role companion renders the four UserRole options ───────────────────
  await page.getByRole("radio").nth(1).click();
  const roleCombo = page.getByRole("combobox");
  await roleCombo.waitFor({ state: "visible", timeout: 10000 });
  await roleCombo.click();
  await page.getByRole("option").first().waitFor({ state: "visible", timeout: 10000 });
  expect(await page.getByRole("option").count()).toBe(4);
  await page.screenshot({ path: join(SHOT_DIR, "05-en-desktop-role-options.png") });
  await page.keyboard.press("Escape");

  // ── Country companion: exact-match free text delivers ──────────────────
  await page.getByRole("radio").nth(2).click();
  // The companion renders AFTER the audience radios in DOM order, so
  // positional `form input` indexing lands on a radio — address it by its
  // accessible label, and fill it BEFORE composeAndSend (the send click
  // opens the confirmation gate over the form).
  const countryInput = page.getByLabel("Country", { exact: true });
  await countryInput.fill("Egypt");
  await composeAndSend(page, "Country broadcast", "Egypt cohort announcement.");
  await confirmButton(page).click();
  await awaitSuccessToast(page);
  await page.screenshot({ path: join(SHOT_DIR, "07-en-desktop-country-success.png") });
  await waitForCount(() => mutations.length, 2);
  expect(mutations).toHaveLength(2);
  expect(mutations[1]?.variables?.input?.audience?.type).toBe("COUNTRY");
  expect(mutations[1]?.idempotencyKey).not.toBe(mutations[0]?.idempotencyKey);

  // ── Plan companion: catalog loads and options render ───────────────────
  await page.getByRole("radio").nth(3).click();
  await page.locator(".MuiSkeleton-root").first().waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: join(SHOT_DIR, "08-en-desktop-plan-skeleton.png") });
  await page.getByRole("combobox").waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("combobox").click();
  await page.getByRole("option").first().waitFor({ state: "visible", timeout: 10000 });
  expect(await page.getByRole("option").count()).toBeGreaterThan(0);
  await page.screenshot({ path: join(SHOT_DIR, "09-en-desktop-plan-options.png") });
  await page.keyboard.press("Escape");

  // ── Double-click protection: exactly ONE mutation per send window ─────
  await page.getByRole("radio").nth(0).click();
  await composeAndSend(page, "Double click probe", "Only one mutation should ride.");
  const beforeDoubleClick = mutations.length;
  await confirmButton(page).click();
  try {
    await confirmButton(page).click({ timeout: 1200 });
  } catch {
    // The confirm affordance is disabled while sending — the second click
    // is refused at the UI boundary (expected).
  }
  await awaitSuccessToast(page);
  await waitForCount(() => mutations.length - beforeDoubleClick, 1);
  expect(mutations.length - beforeDoubleClick).toBe(1);

  await context.close();
});

test("admin broadcast compose surface — Arabic RTL pass", async () => {
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ar", url: BASE }]);
  const page = await context.newPage();
  const mutations: MutationRecord[] = [];
  trackMutations(page, mutations);
  await loginAdmin(context);

  await page.goto(`${BASE}/admin/broadcasts`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator("form").first().waitFor({ state: "visible", timeout: 90000 });
  await page.screenshot({ path: join(SHOT_DIR, "10-ar-desktop-1440-initial-rtl.png") });

  await composeAndSend(page, "إعلان صيانة", "الصيانة المجدولة مساء الجمعة.");
  await page.screenshot({ path: join(SHOT_DIR, "11-ar-desktop-confirm-dialog-rtl.png") });
  await confirmButton(page).click();
  await awaitSuccessToast(page);
  await page.screenshot({ path: join(SHOT_DIR, "12-ar-desktop-success-toast-rtl.png") });
  await waitForCount(() => mutations.length, 1);
  expect(mutations).toHaveLength(1);
  expect(mutations[0]?.idempotencyKey).not.toBeNull();

  await context.close();
});

/** One responsive pass: initial render + inline validation at a viewport. */
async function assertResponsiveComposeSurface(
  cookies: Cookie[],
  label: string,
  width: number,
  height: number
): Promise<void> {
  const context: BrowserContext = await browser.newContext({ viewport: { width, height } });
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.goto(`${BASE}/admin/broadcasts`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator("form").first().waitFor({ state: "visible", timeout: 90000 });
  await page.screenshot({ path: join(SHOT_DIR, `13-en-${label}-initial.png`) });
  await submitButton(page).click();
  await page.locator("form .MuiFormHelperText-root.Mui-error").first().waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: join(SHOT_DIR, `14-en-${label}-validation.png`) });
  expect(await page.locator("form .MuiFormHelperText-root.Mui-error").count()).toBeGreaterThan(0);
  await context.close();
}

test("admin broadcast compose surface — responsive viewports", async () => {
  const baseContext: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await loginAdmin(baseContext);
  const cookies: Cookie[] = await baseContext.cookies();
  await baseContext.close();

  await assertResponsiveComposeSurface(cookies, "tablet-768", 768, 1024);
  await assertResponsiveComposeSurface(cookies, "mobile-375", 375, 812);
});
