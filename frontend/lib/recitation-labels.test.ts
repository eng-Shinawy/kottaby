import { describe, expect, test } from "bun:test";
import { RecitationReading } from "@/frontend/graphql/generated/gql/graphql";
import { getRecitationDescription, getRecitationLabel } from "@/frontend/lib/recitation-labels";
import { getDefaultTranslations, loadAllTranslations } from "@/shared/locale/server";
import type { RecitationLabels } from "@/shared/locale/types/recitation";

/**
 * Test mock translation labels dictionary.
 * Each property has a unique identifiable string value to ensure accurate mapping.
 */
const mockLabels: RecitationLabels = {
  selectTitle: "Select Title",
  selectHelper: "Select Helper",
  selectDescription: "Select Description",
  hafsAnAsim: "Label: Hafs 'an 'Asim",
  warshAnNafi: "Label: Warsh 'an Nafi'",
  qalunAnNafi: "Label: Qalun 'an Nafi'",
  alDuriAnAbiAmr: "Label: Al-Duri 'an 'Abu 'Amr",
  alSusiAnAbiAmr: "Label: Al-Susi 'an 'Abu 'Amr",
  khalafAnHamzah: "Label: Khalaf 'an Hamzah",
  khalladAnAsim: "Label: Khallad 'an 'Asim",
  shubahAnAsim: "Label: Shu'bah 'an 'Asim",
  alBazziAnIbnKathir: "Label: Al-Bazzi 'an Ibn Kathir",
  qunbulAnIbnKathir: "Label: Qunbul 'an Ibn Kathir",
  hafsAnAsimDesc: "Desc: Hafs 'an 'Asim",
  warshAnNafiDesc: "Desc: Warsh 'an Nafi'",
  qalunAnNafiDesc: "Desc: Qalun 'an Nafi'",
  alDuriAnAbiAmrDesc: "Desc: Al-Duri 'an 'Abu 'Amr",
  alSusiAnAbiAmrDesc: "Desc: Al-Susi 'an 'Abu 'Amr",
  khalafAnHamzahDesc: "Desc: Khalaf 'an Hamzah",
  khalladAnAsimDesc: "Desc: Khallad 'an 'Asim",
  shubahAnAsimDesc: "Desc: Shu'bah 'an 'Asim",
  alBazziAnIbnKathirDesc: "Desc: Al-Bazzi 'an Ibn Kathir",
  qunbulAnIbnKathirDesc: "Desc: Qunbul 'an Ibn Kathir",
  mostPopular: "Most Popular",
  invalidRecitation: "Invalid Recitation",
};

/** Hostile payload container explicitly typed as Record and mutated via Object.assign to avoid oxlint warnings. */
const unknownReadingHostile: Record<string, RecitationReading> = {
  value: RecitationReading.HafsAnAsim,
};
Object.assign(unknownReadingHostile, { value: "UNKNOWN_READING" });

describe("getRecitationLabel", () => {
  const expectedMappings: ReadonlyArray<readonly [RecitationReading, keyof RecitationLabels]> = [
    [RecitationReading.HafsAnAsim, "hafsAnAsim"],
    [RecitationReading.WarshAnNafi, "warshAnNafi"],
    [RecitationReading.QalunAnNafi, "qalunAnNafi"],
    [RecitationReading.AlDuriAnAbiAmr, "alDuriAnAbiAmr"],
    [RecitationReading.AlSusiAnAbiAmr, "alSusiAnAbiAmr"],
    [RecitationReading.KhalafAnHamzah, "khalafAnHamzah"],
    [RecitationReading.KhalladAnAsim, "khalladAnAsim"],
    [RecitationReading.ShubahAnAsim, "shubahAnAsim"],
    [RecitationReading.AlBazziAnIbnKathir, "alBazziAnIbnKathir"],
    [RecitationReading.QunbulAnIbnKathir, "qunbulAnIbnKathir"],
  ];

  test.each(expectedMappings)("maps %s enum value to corresponding translation property %s", (reading, labelKey) => {
    const result = getRecitationLabel(reading, mockLabels);
    expect(result).toBe(mockLabels[labelKey]);
  });

  test("covers all values defined in RecitationReading enum", () => {
    const enumValues = Object.values(RecitationReading);
    expect(expectedMappings).toHaveLength(enumValues.length);
  });

  test("returns the input string as fallback for unknown reading enum/string", () => {
    const result = getRecitationLabel(unknownReadingHostile.value, mockLabels);
    expect(result).toBe("UNKNOWN_READING");
  });
});

describe("getRecitationDescription", () => {
  const expectedMappings: ReadonlyArray<readonly [RecitationReading, keyof RecitationLabels]> = [
    [RecitationReading.HafsAnAsim, "hafsAnAsimDesc"],
    [RecitationReading.WarshAnNafi, "warshAnNafiDesc"],
    [RecitationReading.QalunAnNafi, "qalunAnNafiDesc"],
    [RecitationReading.AlDuriAnAbiAmr, "alDuriAnAbiAmrDesc"],
    [RecitationReading.AlSusiAnAbiAmr, "alSusiAnAbiAmrDesc"],
    [RecitationReading.KhalafAnHamzah, "khalafAnHamzahDesc"],
    [RecitationReading.KhalladAnAsim, "khalladAnAsimDesc"],
    [RecitationReading.ShubahAnAsim, "shubahAnAsimDesc"],
    [RecitationReading.AlBazziAnIbnKathir, "alBazziAnIbnKathirDesc"],
    [RecitationReading.QunbulAnIbnKathir, "qunbulAnIbnKathirDesc"],
  ];

  test.each(expectedMappings)("maps %s enum value to corresponding description property %s", (reading, descKey) => {
    const result = getRecitationDescription(reading, mockLabels);
    expect(result).toBe(mockLabels[descKey]);
  });

  test("covers all values defined in RecitationReading enum", () => {
    const enumValues = Object.values(RecitationReading);
    expect(expectedMappings).toHaveLength(enumValues.length);
  });

  test("returns empty string as fallback for unknown reading enum/string", () => {
    const result = getRecitationDescription(unknownReadingHostile.value, mockLabels);
    expect(result).toBe("");
  });
});

describe("recitation labels integration with real locale translations", () => {
  const locales = [
    { code: "en", labels: getDefaultTranslations().recitationTranslations },
    { code: "ar", labels: loadAllTranslations("ar").recitationTranslations },
  ];

  for (const { code, labels } of locales) {
    test(`resolves non-empty labels and descriptions for locale ${code}`, () => {
      for (const reading of Object.values(RecitationReading)) {
        const label = getRecitationLabel(reading, labels);
        const desc = getRecitationDescription(reading, labels);

        expect(label).toBeTruthy();
        expect(typeof label).toBe("string");
        expect(desc).toBeTruthy();
        expect(typeof desc).toBe("string");
      }
    });
  }
});
