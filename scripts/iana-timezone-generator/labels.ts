import {
  type CldrZoneTree,
  loadCldrTerritories,
  loadCldrZoneTree,
  walkCldrPath,
} from "@/scripts/iana-timezone-generator/cldr-data";

const REGION_LABELS_AR: Record<string, string> = {
  Africa: "أفريقيا",
  America: "أمريكا",
  Antarctica: "أنتاركتيكا",
  Arctic: "القطب الشمالي",
  Asia: "آسيا",
  Atlantic: "الأطلسي",
  Australia: "أستراليا",
  Europe: "أوروبا",
  Indian: "المحيط الهندي",
  Pacific: "المحيط الهادئ",
  Etc: "إلخ",
  UTC: "UTC",
};

/** CLDR uses legacy city keys for some renamed IANA zones. */
const CITY_ALIASES: Record<string, string> = {
  Asmara: "Asmera",
  Nuuk: "Godthab",
  Ho_Chi_Minh: "Saigon",
  Kolkata: "Calcutta",
  Kathmandu: "Katmandu",
  Yangon: "Rangoon",
  Kyiv: "Kiev",
  Chuuk: "Truk",
  Pohnpei: "Ponape",
  Kanton: "Enderbury",
  Faroe: "Faeroe",
  Choibalsan: "Ulaanbaatar",
};

/** IANA path segments mapped to CLDR territory codes for Arabic subdivision labels. */
const SEGMENT_TERRITORY: Record<string, string> = {
  Argentina: "AR",
};

/** Static Arabic labels for path segments without CLDR exemplarCity entries. */
const SEGMENT_STATIC_AR: Record<string, string> = {
  Indiana: "إنديانا",
  Kentucky: "كنتاكي",
  North_Dakota: "داكوتا الشمالية",
  Atikokan: "أتيكوكان",
};

export type IanaTimezoneLabels = {
  readonly en: string;
  readonly ar: string;
};

function humanizeSegment(segment: string): string {
  return segment.replace(/_/g, " ");
}

function resolveSegmentLabel(
  segment: string,
  isLast: boolean,
  region: string,
  cldrZones: CldrZoneTree,
  territories: Record<string, string>
): string {
  if (SEGMENT_STATIC_AR[segment]) {
    return SEGMENT_STATIC_AR[segment];
  }

  const territoryCode = SEGMENT_TERRITORY[segment];
  if (territoryCode && territories[territoryCode]) {
    return territories[territoryCode];
  }

  if (isLast) {
    const alias = CITY_ALIASES[segment] ?? segment;
    const flatNode = walkCldrPath(cldrZones, [region, alias]);
    if (flatNode?.exemplarCity) {
      return flatNode.exemplarCity;
    }
  }

  return humanizeSegment(segment);
}

function buildArabicPathLabel(ianaId: string, cldrZones: CldrZoneTree, territories: Record<string, string>): string {
  if (ianaId === "UTC") {
    const utcNode = walkCldrPath(cldrZones, ["Etc", "UTC"]);
    return utcNode?.short?.standard ?? "UTC";
  }

  const segments = ianaId.split("/");
  const region = segments[0];
  const regionAr = REGION_LABELS_AR[region] ?? region;

  if (segments.length === 1) {
    return regionAr;
  }

  const locationSegments = segments.slice(1);
  const arLocationParts: string[] = [];

  for (let index = 0; index < locationSegments.length; index++) {
    const segment = locationSegments[index];
    const pathToHere = [region, ...locationSegments.slice(0, index + 1)];
    const node = walkCldrPath(cldrZones, pathToHere);

    if (node?.exemplarCity) {
      arLocationParts.push(node.exemplarCity);
      continue;
    }

    if (index === locationSegments.length - 1) {
      const alias = CITY_ALIASES[segment] ?? segment;
      const flatNode = walkCldrPath(cldrZones, [region, alias]);
      if (flatNode?.exemplarCity) {
        arLocationParts.push(flatNode.exemplarCity);
        continue;
      }
    }

    arLocationParts.push(
      resolveSegmentLabel(segment, index === locationSegments.length - 1, region, cldrZones, territories)
    );
  }

  return [regionAr, ...arLocationParts].join("/");
}

export function buildIanaTimezoneLabels(ids: string[]): Record<string, IanaTimezoneLabels> {
  const cldrZones = loadCldrZoneTree();
  const territories = loadCldrTerritories();
  const labels: Record<string, IanaTimezoneLabels> = {};

  for (const id of ids) {
    labels[id] = {
      en: id,
      ar: buildArabicPathLabel(id, cldrZones, territories),
    };
  }

  return labels;
}
