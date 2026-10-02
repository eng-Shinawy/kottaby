import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

export const SHARED_COUNTRIES_OUTPUT = join(ROOT, "shared/constants/countries.ts");

export const CLDR_AR_TERRITORIES_PATH = join(ROOT, "node_modules/cldr-localenames-full/main/ar/territories.json");
export const CLDR_EN_TERRITORIES_PATH = join(ROOT, "node_modules/cldr-localenames-full/main/en/territories.json");
