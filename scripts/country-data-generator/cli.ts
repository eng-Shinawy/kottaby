#!/usr/bin/env bun
/**
 * Generates the shared ISO 3166-1 alpha-2 country dataset (codes, English and
 * Arabic names, regional-indicator flag emoji) from CLDR territory names.
 * Run: bun run generate:countries
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  buildCountryDataset,
  buildSharedCountriesFile,
  CLDR_AR_TERRITORIES_PATH,
  CLDR_EN_TERRITORIES_PATH,
  loadCldrArTerritories,
  loadCldrEnTerritories,
  SHARED_COUNTRIES_OUTPUT,
} from "@/scripts/country-data-generator";

async function main(): Promise<void> {
  if (!existsSync(CLDR_AR_TERRITORIES_PATH) || !existsSync(CLDR_EN_TERRITORIES_PATH)) {
    throw new Error("CLDR data not found. Run: bun add -d cldr-localenames-full");
  }

  const arTerritories = loadCldrArTerritories();
  const enTerritories = loadCldrEnTerritories();
  const dataset = buildCountryDataset(enTerritories, arTerritories);

  await mkdir(dirname(SHARED_COUNTRIES_OUTPUT), { recursive: true });
  await writeFile(SHARED_COUNTRIES_OUTPUT, buildSharedCountriesFile(dataset), "utf8");

  console.log(`Generated ${dataset.length} countries:`);
  console.log(`  ${SHARED_COUNTRIES_OUTPUT}`);
}

await main();
