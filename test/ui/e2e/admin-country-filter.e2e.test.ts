/**
 * Admin country-filter round-trip E2E — the directory's country filter as a
 * REAL admin drives it, in a REAL browser against the REAL GraphQL API.
 *
 * The suite covers the shareable-URL contract the country-filter family was
 * built around (issue-230 follow-ups):
 *
 *   1. DIRECT URL — a seeded `?country=EG` renders the applied-filter chip
 *      with the dataset's flag + localized name, and the results honor the
 *      filter: the Egypt fixture student is visible, the United States
 *      fixture student is not.
 *   2. UI SELECTION — picking مصر in the toolbar's CountrySelector rewrites
 *      the URL to `?country=EG` (the mirror effect) and paints the same
 *      chip: the round-trip URL → state → URL closes.
 *   3. CHIP DISMISSAL — removing the chip drops the URL param, so a
 *      chip-deletion stays shareable exactly like a toolbar edit.
 *
 * Fixtures (per-run, unique):
 *   - an ADMIN row inserted through the entity-setup helpers with a REAL
 *     bcrypt hash (the login service verifies hashes — the shared stub hash
 *     can never log in), because the directory is admin-gated;
 *   - two STUDENTS registered over the REAL register mutation with country
 *     `EG` / `US` — the same write path the product uses, so the rows carry
 *     canonical (country, country_code) pairs.
 *
 * Every user-facing string comes from the compile-time translation bundle
 * (`getDefaultTranslations()`, the app's default locale `ar`) or the shared
 * country dataset — no hardcoded copy (test/ui/AGENTS.md).
 *
 * TRANSPORT NOTES (bun + playwright-core quirk): Playwright's APIRequest
 * (`context.request`) mis-records every response URL as a relative path in
 * this runtime, so any Set-Cookie response crashes its cookie parser
 * (`ERR_INVALID_URL`). The suite therefore: registers students over Bun's
 * native fetch (the returned id is all it needs — registration's own auth
 * cookies are irrelevant), and signs the admin in through the REAL login
 * form UI — stronger coverage anyway: the browser mints and stores the
 * session cookies exactly like a human login.
 *
 * RUNS VIA the dedicated runner (spawns the test server on the runner's default :3066, owns the
 * 5-minute E2E timeout, exports TEST_SERVER_PORT):
 *   bun run test:ui:e2e:country-filter
 * The suite owns only the browser: chromium.launch() here, closed in
 * afterAll. Base URL: http://localhost:${TEST_SERVER_PORT}.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { hash } from "bcryptjs";
import { type Browser, type BrowserContext, chromium } from "playwright";
import { db } from "@/backend/db";
import { createTestAdmin, createTestUser } from "@/backend/db/test/entity-setup";
import { COUNTRIES } from "@/shared/constants/countries";
import { getDefaultTranslations } from "@/shared/locale/server";
import { countUsersByIds, deleteSessionsByParticipantUserIds, deleteUsersByIds } from "@/test/helpers/db-cleanup";

const PORT = process.env.TEST_SERVER_PORT ?? "3066";
const BASE = `http://localhost:${PORT}`;
const SHOT_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "ai",
  "plans",
  "issue_230",
  "no_country_selector_component",
  "outcome",
  "e2e-screenshots"
);

/** Per-run fixture identity — every run owns exactly its own rows. */
const RUN = `cty-e2e-${Date.now().toString(36)}`;
const ADMIN_EMAIL = `${RUN}-admin@test.local`;
/** The per-run fixture credential — never a real account's secret. */
const ADMIN_PASSWORD = `${RUN}-Adm!nP@ss0rd`;
const ADMIN_PHONE = `+2012${Date.now().toString().slice(-8)}`;

const EG_STUDENT = {
  fullName: `${RUN} Egypt Student`,
  email: `${RUN}-eg@test.local`,
  phone: `+2010${Date.now().toString().slice(-8)}`,
  password: `${RUN}-Eg!P@ss0rd`,
};
const US_STUDENT = {
  fullName: `${RUN} United States Student`,
  email: `${RUN}-us@test.local`,
  phone: `+2011${Date.now().toString().slice(-8)}`,
  password: `${RUN}-Us!P@ss0rd`,
};

/**
 * Translation-driven copy: the default-locale bundle + the shared country
 * dataset (the chip composes `${filters.country}: ${flag} ${name}`).
 */
const LABELS = getDefaultTranslations().adminUsersTranslations;
const FILTERS = LABELS.filters;
const AUTH = getDefaultTranslations().authTranslations;
const EG_CHIP_LABEL = `${FILTERS.country}: ${COUNTRIES.EG.flag} ${COUNTRIES.EG.ar}`;
const US_CHIP_LABEL = `${FILTERS.country}: ${COUNTRIES.US.flag} ${COUNTRIES.US.ar}`;

/** Teardown worklist for rows the flow created. */
let adminUserId = 0;
let egStudentId = 0;
let usStudentId = 0;

let browser: Browser;

beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  browser = await chromium.launch();
});

afterAll(async () => {
  const createdIds = [adminUserId, egStudentId, usStudentId].filter(id => id > 0);
  if (createdIds.length > 0) {
    // The login/registration flows mint session rows keyed by participant.
    await deleteSessionsByParticipantUserIds(createdIds);
    await deleteUsersByIds(createdIds);
  }
  const residue = await countUsersByIds(createdIds);
  if (residue !== 0) {
    throw new Error("e2e teardown: fixture user rows survived cleanup");
  }
  await browser?.close();
});

/**
 * Registers a student through the REAL register mutation (the product write
 * path) over Bun's native fetch — Playwright's APIRequest cannot parse
 * Set-Cookie responses in this runtime, and only the returned id matters
 * here: the browser session this suite drives belongs to the admin.
 */
async function registerStudent(student: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  country: string;
}): Promise<number> {
  const response = await fetch(`${BASE}/api/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "mutation RegisterUser($input: RegisterUserInput!) { registerUser(input: $input) { id email role } }",
      variables: {
        input: {
          fullName: student.fullName,
          email: student.email,
          phone: student.phone,
          password: student.password,
          country: student.country,
          role: "Student",
          preferredRecitation: "HAFS_AN_ASIM",
          gender: null,
        },
      },
    }),
  });
  const body: unknown = await response.json();
  // Narrowed with `in` guards (the wire response is untyped JSON — the `in`
  // operator narrows `object & Record<"data", unknown>` without assertions).
  const rawId: unknown = typeof body === "object" && body !== null && "data" in body ? body.data : undefined;
  const registerUser: unknown =
    typeof rawId === "object" && rawId !== null && "registerUser" in rawId ? rawId.registerUser : undefined;
  const nestedId: unknown =
    typeof registerUser === "object" && registerUser !== null && "id" in registerUser ? registerUser.id : undefined;
  const id = typeof nestedId === "number" && Number.isInteger(nestedId) && nestedId > 0 ? nestedId : 0;
  expect(id).toBeGreaterThan(0);
  return id;
}

test("country filter round-trip — direct URL, UI selection, chip dismissal", async () => {
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // ── Fixtures: admin row (real hash) + two wire-registered students ─────
  const adminHash = await hash(ADMIN_PASSWORD, 12);
  await db.transaction(async tx => {
    const adminUser = await createTestUser(tx, {
      role: "admin",
      email: ADMIN_EMAIL,
      fullName: `Country E2E Admin ${RUN}`,
      phone: ADMIN_PHONE,
      passwordHash: adminHash,
    });
    await createTestAdmin(tx, adminUser.id);
    adminUserId = adminUser.id;
  });

  egStudentId = await registerStudent({ ...EG_STUDENT, country: "EG" });
  usStudentId = await registerStudent({ ...US_STUDENT, country: "US" });

  // Sign in through the REAL login form — the browser mints and stores the
  // session cookies exactly like a human login (SameSite=Strict cookies then
  // ride every navigation in this context).
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  // Role-scoped, not getByLabel: the required label carries a visually-added
  // asterisk (aria-hidden) and the password field's show/hide toggle carries
  // an aria-label that CONTAINS the field label — getByLabel either
  // substring-collides with the toggle or exact-misses the asterisk. The
  // inputs are the only textboxes with these accessible names.
  await page.getByRole("textbox", { name: AUTH.loginEmail }).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: AUTH.loginPassword }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: AUTH.loginSubmit }).click();
  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 60_000 });

  // ── 1. DIRECT URL: seeded ?country=EG → chip + honoring results ────────
  await page.goto(`${BASE}/admin/users?country=EG`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const egChip = page.getByRole("button", { name: EG_CHIP_LABEL });
  await egChip.waitFor({ state: "visible", timeout: 60_000 });
  await page.screenshot({ path: join(SHOT_DIR, "01-direct-url-chip.png") });

  // The Egypt fixture is inside the filtered results; the US one is not.
  // The shared test database holds dozens of Egypt rows from other suites,
  // and the default sort does not put the freshest fixture on page 1 — so
  // the fixture is located through the directory's own SEARCH field (the
  // two filters compose), then the absence of the US fixture is asserted
  // on the settled result. 120s: a cold Turbopack dev server's first
  // GraphQL result can trail the (client-rendered) chip by a wide margin.
  const searchBox = page.getByRole("textbox", { name: FILTERS.search });
  await searchBox.waitFor({ state: "visible", timeout: 60_000 });
  await searchBox.fill(EG_STUDENT.fullName);
  const egCell = page.getByText(EG_STUDENT.fullName).first();
  await egCell.waitFor({ state: "visible", timeout: 120_000 });
  // (bun:test expect — presence via waitFor, absence via a settled count.)
  expect(await page.getByText(US_STUDENT.fullName).count()).toBe(0);

  // ── 2. UI SELECTION: picking مصر rewrites the URL (?country=EG) ────────
  await page.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const countryBox = page.getByRole("combobox", { name: FILTERS.country });
  await countryBox.waitFor({ state: "visible", timeout: 60_000 });
  await countryBox.click();
  await countryBox.fill(COUNTRIES.EG.ar);
  await page.getByRole("option", { name: COUNTRIES.EG.ar }).click();
  await page.waitForURL(/[?&]country=EG/, { timeout: 30_000 });
  await page.getByRole("button", { name: EG_CHIP_LABEL }).waitFor({ state: "visible", timeout: 30_000 });
  await page.screenshot({ path: join(SHOT_DIR, "02-ui-selection-round-trip.png") });

  // ── 3. CHIP DISMISSAL: the URL param drops with the chip ───────────────
  await page.getByRole("button", { name: EG_CHIP_LABEL }).locator("svg.MuiChip-deleteIcon").click();
  await page.waitForURL(url => !url.searchParams.has("country"), { timeout: 30_000 });
  expect(await page.getByRole("button", { name: EG_CHIP_LABEL }).count()).toBe(0);
  // The other vocabulary stays resolvable — a US seed paints its own chip.
  await page.goto(`${BASE}/admin/users?country=US`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: US_CHIP_LABEL }).waitFor({ state: "visible", timeout: 120_000 });
  await page.screenshot({ path: join(SHOT_DIR, "03-chip-dismissed-us-seed.png") });

  await context.close();
});
