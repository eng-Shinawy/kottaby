import { readFileSync } from "node:fs";
import {
  CLDR_AR_TERRITORIES_PATH,
  CLDR_AR_TIMEZONES_PATH,
  CLDR_WINDOWS_ZONES_PATH,
} from "@/scripts/iana-timezone-generator/paths";

export type CldrZoneNode = {
  readonly exemplarCity?: string;
  readonly short?: { readonly standard?: string };
  readonly long?: { readonly standard?: string };
};

export type CldrZoneTree = Record<string, unknown>;

type CldrZoneTreeData = {
  readonly main: { readonly ar: { readonly dates: { readonly timeZoneNames: { readonly zone: CldrZoneTree } } } };
};

type CldrTerritoriesData = {
  readonly main: {
    readonly ar: { readonly localeDisplayNames: { readonly territories: Record<string, string> } };
  };
};

type CldrWindowsZonesData = {
  readonly supplemental: {
    readonly windowsZones: {
      readonly mapTimezones: ReadonlyArray<{
        readonly mapZone: { readonly _type: string; readonly _territory: string };
      }>;
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v): v is string => typeof v === "string");
}

function isCldrZoneNode(value: unknown): value is CldrZoneNode {
  if (!isRecord(value)) return false;
  if (value.exemplarCity !== undefined && typeof value.exemplarCity !== "string") return false;
  return true;
}

function isCldrZoneTreeData(data: unknown): data is CldrZoneTreeData {
  if (!isRecord(data)) return false;
  const mainData = data.main;
  if (!isRecord(mainData)) return false;
  const ar = mainData.ar;
  if (!isRecord(ar)) return false;
  const dates = ar.dates;
  if (!isRecord(dates)) return false;
  const timeZoneNames = dates.timeZoneNames;
  if (!isRecord(timeZoneNames)) return false;
  return isRecord(timeZoneNames.zone);
}

function isCldrTerritoriesData(data: unknown): data is CldrTerritoriesData {
  if (!isRecord(data)) return false;
  const mainData = data.main;
  if (!isRecord(mainData)) return false;
  const ar = mainData.ar;
  if (!isRecord(ar)) return false;
  const localeDisplayNames = ar.localeDisplayNames;
  if (!isRecord(localeDisplayNames)) return false;
  return isStringRecord(localeDisplayNames.territories);
}

function isCldrWindowsZonesData(data: unknown): data is CldrWindowsZonesData {
  if (!isRecord(data)) return false;
  const supplemental = data.supplemental;
  if (!isRecord(supplemental)) return false;
  const windowsZones = supplemental.windowsZones;
  if (!isRecord(windowsZones)) return false;
  const mapTimezones = windowsZones.mapTimezones;
  if (!Array.isArray(mapTimezones)) return false;
  return mapTimezones.every(entry => {
    if (!isRecord(entry)) return false;
    const mapZone = entry.mapZone;
    if (!isRecord(mapZone)) return false;
    const { _type, _territory } = mapZone;
    return typeof _type === "string" && typeof _territory === "string";
  });
}

export function loadCldrZoneTree(): CldrZoneTree {
  const parsed: unknown = JSON.parse(readFileSync(CLDR_AR_TIMEZONES_PATH, "utf8"));
  if (!isCldrZoneTreeData(parsed)) {
    throw new Error("Invalid CLDR timezone names data structure");
  }
  return parsed.main.ar.dates.timeZoneNames.zone;
}

export function loadCldrTerritories(): Record<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(CLDR_AR_TERRITORIES_PATH, "utf8"));
  if (!isCldrTerritoriesData(parsed)) {
    throw new Error("Invalid CLDR territories data structure");
  }
  return parsed.main.ar.localeDisplayNames.territories;
}

export function loadCldrTimezoneTerritories(): Record<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(CLDR_WINDOWS_ZONES_PATH, "utf8"));
  if (!isCldrWindowsZonesData(parsed)) {
    throw new Error("Invalid CLDR windows zones data structure");
  }
  const territories: Record<string, string> = {};
  for (const entry of parsed.supplemental.windowsZones.mapTimezones) {
    const { _type, _territory } = entry.mapZone;
    if (_territory === "001" || _territory === "ZZ") {
      continue;
    }
    for (const timezoneId of _type.split(" ")) {
      if (!territories[timezoneId]) {
        territories[timezoneId] = _territory;
      }
    }
  }
  return territories;
}

export function walkCldrPath(root: CldrZoneTree, segments: readonly string[]): CldrZoneNode | null {
  let node: unknown = root;
  for (const segment of segments) {
    if (!isRecord(node) || !(segment in node)) {
      return null;
    }
    node = node[segment];
  }
  return isCldrZoneNode(node) ? node : null;
}
