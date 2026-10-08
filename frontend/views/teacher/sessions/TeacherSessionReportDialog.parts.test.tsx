/**
 * AssignmentBlock Surah/Juz picker tests (colocated, bun:test).
 *
 * The repo has no DOM component-test layer (no happy-dom/jsdom, no DOM
 * testing utilities), so the MUI Autocomplete boundary is replaced with a
 * render-through test double via `mock.module` (same mechanism as the
 * CountrySelector suite) and the block is rendered to static markup with
 * react-dom/server. The double forwards the block's own
 * options/groupBy/getOptionLabel/value/onChange/renderInput output plus a
 * grouped listbox mirroring MUI's consecutive-group rendering, so the
 * assertions below exercise the real component code paths.
 *
 * The submit-payload arm rides the REAL `buildSubmitPayload` (the pure
 * builder the dialog submits through), so the vocabulary guard is asserted
 * on the production path, not on a test double.
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/teacher/sessions/TeacherSessionReportDialog.parts.test.tsx —
 * pure unit tier, no server boot, no DB (static-markup render via
 * react-dom/server).
 */

import { expect, mock, test } from "bun:test";
import { Rating, Stack, TextField, Typography } from "@mui/material";
import { type HTMLAttributes, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import type { HomeWorkBlockInput } from "@/backend/types";
import { buildSubmitPayload } from "@/frontend/views/teacher/sessions/teacherSessionReportDialog.helpers";
import { getTranslations } from "@/shared/locale/server";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

// ---------------------------------------------------------------------------
// Test double: a render-through stand-in for MUI's Autocomplete

interface StubRenderInputParams {
  id: string;
  disabled: boolean;
  fullWidth: boolean;
  size: "small" | undefined;
  slotProps: {
    htmlInput: {
      id: string;
      value: string;
      role: string;
      "aria-expanded": boolean;
      autoComplete: string;
      onBlur: (event: unknown) => void;
      onChange: (event: unknown) => void;
    };
  };
}

interface CapturedAutocompleteProps {
  fullWidth?: boolean;
  size?: "small";
  options: readonly SurahJuzRef[];
  groupBy: ((option: SurahJuzRef) => string) | undefined;
  // Captured `string` (MUI only ever passes real options at runtime) so the
  // hostile probes below can call it without unsafe casts.
  getOptionLabel: (option: string) => string;
  value: SurahJuzRef | null;
  onChange: (event: unknown, value: SurahJuzRef | null) => void;
  renderInput: (params: StubRenderInputParams) => ReactNode;
  filterOptions: ((options: readonly SurahJuzRef[], state: { inputValue: string }) => SurahJuzRef[]) | undefined;
}

let lastStubProps: CapturedAutocompleteProps | null = null;
let lastRenderInputParams: StubRenderInputParams | null = null;

function currentStubProps(): CapturedAutocompleteProps {
  if (lastStubProps === null) {
    throw new Error("the Autocomplete double was never rendered");
  }
  return lastStubProps;
}

function currentRenderInputParams(): StubRenderInputParams {
  if (lastRenderInputParams === null) {
    throw new Error("renderInput params were never captured");
  }
  return lastRenderInputParams;
}

// camelCase on purpose: this is a render-through test double, not a React
// component, so the react(globals) module-capture rule must not treat its
// module-level capture variables as component state.
function stubAutocomplete(stubProps: CapturedAutocompleteProps): ReactNode {
  lastStubProps = stubProps;
  const { options, groupBy, getOptionLabel, value, renderInput } = stubProps;
  const inputValue = value === null ? "" : getOptionLabel(value);
  const params: StubRenderInputParams = {
    id: "surah-juz-picker-stub",
    disabled: false,
    fullWidth: true,
    size: stubProps.size,
    slotProps: {
      htmlInput: {
        id: "surah-juz-picker-stub-input",
        value: inputValue,
        role: "combobox",
        "aria-expanded": false,
        autoComplete: "off",
        onBlur: () => {},
        onChange: () => {},
      },
    },
  };
  lastRenderInputParams = params;
  const inputElement = renderInput(params);
  if (!isValidElement(inputElement)) {
    throw new Error("renderInput must return a single React element");
  }
  // Grouped listbox mirroring MUI's consecutive-group rendering: a new
  // section opens whenever groupBy changes walking down the option list.
  const groups: Array<{ heading: string; rows: ReactNode[] }> = [];
  // MUI hands each listbox row its ARIA props (role/aria-selected) as an
  // attribute bundle, not as literals on the element — the double forwards
  // the same shape (the CountrySelector double does the identical spread).
  const rowFor = (option: SurahJuzRef): ReactNode => {
    const rowProps: HTMLAttributes<HTMLLIElement> = {
      role: "option",
      "aria-selected": option === value,
    };
    return (
      <li key={option} {...rowProps}>
        {getOptionLabel(option)}
      </li>
    );
  };
  options.forEach(option => {
    const heading = groupBy ? groupBy(option) : "";
    const bucket = groups[groups.length - 1];
    if (bucket?.heading !== heading) {
      groups.push({ heading, rows: [rowFor(option)] });
      return;
    }
    bucket.rows.push(rowFor(option));
  });
  return (
    <div data-testid="stub-autocomplete-root">
      {inputElement}
      <div data-testid="stub-listbox">
        {groups.map(group => (
          <div key={group.heading} data-testid="stub-group">
            <div data-testid="stub-group-heading">{group.heading}</div>
            <ul>{group.rows}</ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// The module-under-test import MUST trail its mock.module registration (bun
// evaluates the module registry in import order — the same ordering contract
// the CountrySelector suite documents).
void mock.module("@mui/material", () => ({
  Autocomplete: stubAutocomplete,
  Rating,
  Stack,
  TextField,
  Typography,
}));

import { AssignmentBlock } from "@/frontend/views/teacher/sessions/TeacherSessionReportDialog.parts";

// ---------------------------------------------------------------------------
// Translation-backed expectations (never hardcoded copy) + harness

const en = getTranslations("en").sessionsTranslations;
const ar = getTranslations("ar").sessionsTranslations;

const VALID_BLOCK: HomeWorkBlockInput = { fromAyah: 1, toAyah: 7, surahJuz: SurahJuzRef.SurahAlBaqarah };

interface RenderOverrides {
  readonly block?: HomeWorkBlockInput | null;
  readonly onChange?: (block: HomeWorkBlockInput | null) => void;
}

function renderBlock(t: SessionsLabels, overrides: RenderOverrides = {}): string {
  return renderToStaticMarkup(
    <AssignmentBlock
      title={t.jadidSectionTitle}
      fromAyahLabel={t.fromAyahLabel}
      toAyahLabel={t.toAyahLabel}
      surahJuzPickerLabel={t.surahJuzPickerLabel}
      surahJuzSurahGroupLabel={t.surahJuzSurahGroupLabel}
      surahJuzJuzGroupLabel={t.surahJuzJuzGroupLabel}
      block={overrides.block ?? null}
      onChange={overrides.onChange ?? (() => {})}
      t={t}
    />
  );
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// Tier 1 — render, grouped option surface, clear/pick contract

test("renders the picker with the floating label and the two group headings", () => {
  const markup = renderBlock(en);
  expect(markup).toContain(en.surahJuzPickerLabel);
  expect(countOccurrences(markup, 'data-testid="stub-group-heading"')).toBe(2);
  expect(countOccurrences(markup, en.surahJuzSurahGroupLabel)).toBe(1);
  expect(countOccurrences(markup, en.surahJuzJuzGroupLabel)).toBe(1);
  // Mushaf order: the surah section opens before the juz section.
  const surahHeadingAt = markup.indexOf(`data-testid="stub-group-heading">${en.surahJuzSurahGroupLabel}<`);
  const juzHeadingAt = markup.indexOf(`data-testid="stub-group-heading">${en.surahJuzJuzGroupLabel}<`);
  expect(surahHeadingAt).toBeGreaterThan(-1);
  expect(juzHeadingAt).toBeGreaterThan(surahHeadingAt);
});

test("options are the full 144-member vocabulary — 114 surahs + 30 juzs, rendered as 144 rows", () => {
  const markup = renderBlock(en);
  const { options, groupBy } = currentStubProps();
  if (groupBy === undefined) {
    throw new Error("the picker must group its options");
  }
  expect(options).toHaveLength(144);
  expect(options).toEqual(Object.values(SurahJuzRef));
  const surahCount = options.filter(option => groupBy(option) === en.surahJuzSurahGroupLabel).length;
  const juzCount = options.filter(option => groupBy(option) === en.surahJuzJuzGroupLabel).length;
  expect(surahCount).toBe(114);
  expect(juzCount).toBe(30);
  expect(countOccurrences(markup, 'role="option"')).toBe(144);
});

test("clearing emits a null block; picking sets the block with the base span preserved", () => {
  const emitted: Array<HomeWorkBlockInput | null> = [];
  const onChange = (block: HomeWorkBlockInput | null) => {
    emitted.push(block);
  };
  renderBlock(en, { onChange });
  const autocompleteOnChange = currentStubProps().onChange;
  autocompleteOnChange({}, null);
  autocompleteOnChange({}, SurahJuzRef.SurahAnNas);
  expect(emitted).toEqual([null, { fromAyah: 0, toAyah: 0, surahJuz: SurahJuzRef.SurahAnNas }]);

  emitted.length = 0;
  renderBlock(en, { block: { fromAyah: 5, toAyah: 9, surahJuz: SurahJuzRef.SurahAlBaqarah }, onChange });
  currentStubProps().onChange({}, SurahJuzRef.Juz3);
  expect(emitted).toEqual([{ fromAyah: 5, toAyah: 9, surahJuz: SurahJuzRef.Juz3 }]);
});

test("controlled value wiring: the picked member shows its label with exactly one selected row", () => {
  const markup = renderBlock(en, { block: VALID_BLOCK });
  expect(currentStubProps().value).toBe(SurahJuzRef.SurahAlBaqarah);
  expect(currentRenderInputParams().slotProps.htmlInput.value).toBe(en.surahJuzLabel(SurahJuzRef.SurahAlBaqarah));
  expect(countOccurrences(markup, 'aria-selected="true"')).toBe(1);

  renderBlock(en);
  expect(currentStubProps().value).toBeNull();
  expect(currentRenderInputParams().slotProps.htmlInput.value).toBe("");
  expect(renderBlock(en)).not.toContain('aria-selected="true"');
});

// ---------------------------------------------------------------------------
// Tier 2 — label fallback edges + Arabic (RTL locale) rendering

test("empty and unknown refs ride raw through the label fallback (never throws)", () => {
  renderBlock(en);
  const getOptionLabel = currentStubProps().getOptionLabel;
  expect(getOptionLabel("")).toBe("");
  expect(getOptionLabel("juz_31")).toBe("juz_31");
  expect(getOptionLabel("surah_an_nuh")).toBe("surah_an_nuh");
  expect(getOptionLabel("JUZ_1")).toBe("JUZ_1");
  expect(getOptionLabel(" juz_1")).toBe(" juz_1");
});

test("the Arabic render carries the Arabic group headings, labels, and juz digits", () => {
  const markup = renderBlock(ar);
  expect(markup).toContain(ar.surahJuzPickerLabel);
  expect(countOccurrences(markup, 'data-testid="stub-group-heading"')).toBe(2);
  // Scoped to the heading element: the Arabic picker label "السورة / الجزء"
  // contains "السور" as a substring, so a bare markup count would over-count.
  expect(countOccurrences(markup, `data-testid="stub-group-heading">${ar.surahJuzSurahGroupLabel}<`)).toBe(1);
  expect(countOccurrences(markup, `data-testid="stub-group-heading">${ar.surahJuzJuzGroupLabel}<`)).toBe(1);
  expect(markup).toContain(ar.surahJuzLabel(SurahJuzRef.SurahAlFatihah));
  expect(markup).toContain(ar.surahJuzLabel(SurahJuzRef.Juz30));
  expect(countOccurrences(markup, 'role="option"')).toBe(144);
});

// ---------------------------------------------------------------------------
// Tier 3 — rapid re-render churn, filter contract, memo posture

test("rapid block re-renders stay crash-free and each frame captures its own value", () => {
  const frames: Array<HomeWorkBlockInput | null> = [
    null,
    { fromAyah: 1, toAyah: 7, surahJuz: SurahJuzRef.SurahAlBaqarah },
    { fromAyah: 281, toAyah: 286, surahJuz: SurahJuzRef.Juz30 },
    null,
  ];
  for (let index = 0; index < 60; index += 1) {
    const block = frames[index % frames.length];
    renderBlock(en, { block });
    const expectedValue = block?.surahJuz ?? null;
    expect(currentStubProps().value).toBe(expectedValue);
    expect(currentRenderInputParams().slotProps.htmlInput.value).toBe(
      expectedValue === null ? "" : en.surahJuzLabel(expectedValue)
    );
  }
});

test("typing narrows by localized label — the block overrides no MUI filtering", () => {
  renderBlock(en);
  // The component passes no filterOptions, so MUI's default filter drives
  // the searchability: a case-insensitive substring over getOptionLabel.
  expect(currentStubProps().filterOptions).toBeUndefined();
  const { options, getOptionLabel } = currentStubProps();
  const narrow = (inputValue: string) =>
    options.filter(option => getOptionLabel(option).toLowerCase().includes(inputValue.toLowerCase()));
  expect(narrow("fātihah")).toEqual([SurahJuzRef.SurahAlFatihah]);
  expect(narrow("juz 3")).toContain(SurahJuzRef.Juz3);
  expect(narrow("juz 3")).toContain(SurahJuzRef.Juz30);
  expect(narrow("zzzz-no-match")).toEqual([]);
});

test("the memo wrapper is retained on the exported block", () => {
  expect(typeof AssignmentBlock.type).toBe("function");
  expect(AssignmentBlock.type.name).toBe("AssignmentBlock");
});

// ---------------------------------------------------------------------------
// Tier 4 — closed dataset, hostile values never reach the submit payload

test("options are exactly the closed dataset — no injection surface", () => {
  renderBlock(en);
  const options = currentStubProps().options;
  expect(options).toHaveLength(144);
  const members = new Set<string>(Object.values(SurahJuzRef));
  for (const hostileKey of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"]) {
    expect(members.has(hostileKey)).toBe(false);
  }
  for (const option of options) {
    expect(members.has(option)).toBe(true);
  }
});

test("a hostile surahJuz in the block renders raw but never reaches the submit payload", () => {
  // The suite's single deliberate type-erosion point: a REAL typed block
  // with a non-member ref written on via Object.assign (no cast, no any) —
  // the same forge seam the conversions suite documents.
  const hostileJadid: HomeWorkBlockInput = { fromAyah: 1, toAyah: 7, surahJuz: SurahJuzRef.SurahAlBaqarah };
  Object.assign(hostileJadid, { surahJuz: "juz_31" });
  renderBlock(en, { block: hostileJadid });
  // The raw ref rides into the visible input (fail-visible), but the
  // pre-submit vocabulary guard drops the whole block from the payload.
  expect(currentRenderInputParams().slotProps.htmlInput.value).toBe("juz_31");
  const dropped = buildSubmitPayload({
    teacherNotes: "Steady recitation.",
    studentRatingByTeacher: null,
    jadid: hostileJadid,
  });
  expect(dropped.homework).toBeUndefined();

  const hostileMadi: HomeWorkBlockInput = { fromAyah: 281, toAyah: 286, surahJuz: SurahJuzRef.Juz30 };
  Object.assign(hostileMadi, { surahJuz: "surah_an_nuh" });
  const keptJadid = buildSubmitPayload({
    teacherNotes: "Steady recitation.",
    studentRatingByTeacher: null,
    jadid: VALID_BLOCK,
    madi: hostileMadi,
  });
  expect(keptJadid.homework).toEqual({ jadid: VALID_BLOCK });
});
