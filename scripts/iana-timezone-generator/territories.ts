import { loadCldrTimezoneTerritories } from "@/scripts/iana-timezone-generator/cldr-data";

/** Manual ISO 3166-1 alpha-2 overrides for zones missing from CLDR windowsZones. */
const EXCLUDED_TERRITORY_CODES = new Set(["IL"]);

const TERRITORY_OVERRIDES: Record<string, string | null> = {
  "Africa/Asmara": "ER",
  "America/Argentina/Buenos_Aires": "AR",
  "America/Argentina/Catamarca": "AR",
  "America/Argentina/Cordoba": "AR",
  "America/Argentina/Jujuy": "AR",
  "America/Argentina/Mendoza": "AR",
  "America/Atikokan": "CA",
  "America/Indiana/Indianapolis": "US",
  "America/Kentucky/Louisville": "US",
  "America/Nuuk": "GL",
  "Antarctica/Troll": "AQ",
  "Asia/Choibalsan": "MN",
  "Asia/Ho_Chi_Minh": "VN",
  "Asia/Kathmandu": "NP",
  "Asia/Kolkata": "IN",
  "Asia/Yangon": "MM",
  "Atlantic/Faroe": "FO",
  "Europe/Kyiv": "UA",
  "Pacific/Chuuk": "FM",
  "Pacific/Kanton": "KI",
  "Pacific/Pohnpei": "FM",
  UTC: null,
};

export function buildIanaTimezoneTerritories(ids: string[]): Record<string, string | null> {
  const cldrTerritories = loadCldrTimezoneTerritories();
  const territories: Record<string, string | null> = {};
  for (const id of ids) {
    if (id in TERRITORY_OVERRIDES) {
      territories[id] = TERRITORY_OVERRIDES[id];
      continue;
    }
    if (id.startsWith("Etc/GMT")) {
      territories[id] = null;
      continue;
    }
    const territoryCode = cldrTerritories[id] ?? null;
    territories[id] = territoryCode && EXCLUDED_TERRITORY_CODES.has(territoryCode) ? "PS" : territoryCode;
  }
  return territories;
}
