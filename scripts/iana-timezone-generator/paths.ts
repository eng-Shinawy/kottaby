import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
export const SHARED_IDS_OUTPUT = join(ROOT, "shared/constants/iana-timezones.ts");
export const SHARED_LABELS_OUTPUT = join(ROOT, "shared/constants/iana-timezone-labels.ts");
export const SHARED_TERRITORIES_OUTPUT = join(ROOT, "shared/constants/iana-timezone-territories.ts");
export const SHARED_ENUM_OUTPUT = join(ROOT, "shared/constants/iana-timezone.enum.ts");

export const CLDR_AR_TIMEZONES_PATH = join(ROOT, "node_modules/cldr-dates-full/main/ar/timeZoneNames.json");
export const CLDR_AR_TERRITORIES_PATH = join(ROOT, "node_modules/cldr-localenames-full/main/ar/territories.json");
export const CLDR_WINDOWS_ZONES_PATH = join(ROOT, "node_modules/cldr-core/supplemental/windowsZones.json");
