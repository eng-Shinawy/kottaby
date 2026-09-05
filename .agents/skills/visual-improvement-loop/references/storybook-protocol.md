# Storybook Protocol for Visual Loops

Visual scoring works best from Storybook, not the dev server — isolation eliminates shell noise, mocked data, auth drift, and network flakiness. Storybook on `localhost:6006`.

## When stories are missing → create them

Delegate to a coder subagent. Prompt must require:

1. Follow existing repo story conventions: find existing `*.stories.tsx` files and copy their structure, titles/args/decorator setup; read `.storybook/main.ts` + `.storybook/preview.tsx` to inherit global decorators (theme, locale, RTL) instead of reinventing.
2. Placement: `<Name>.stories.tsx` next to the component (or wherever repo convention actually puts them — verify with existing stories instead of assuming).
3. Apollo mocks: same convention as the repo's test layer uses (`MockedProvider` + generated typed documents; replicate the mock-production pattern from the matching component tests in `test/ui/components/`).
4. Zustand stores: seed via decorator components that set initial state on mount and `reset()` on unmount, so stories never leak state between stories.
5. i18n: components must use their normal `useAppTranslation` path — the stories must work in BOTH EN and AR via the preview's locale global (`globals=locale:en|ar`); no hardcoded strings.
6. Fake data in stories is allowed and expected (obviously-fake but realistic names) — stories are fixture surfaces by design. Production code never ships fixture data.
7. Cover the states needed by the loop: empty, preselected/filled, expanded (carryover/modal), error (field-level + domain-level band), mobile meaningful composition when the component has responsive branches.

## Verify

- `bun run scripts/health/sub-loop.ts <each .stories.tsx> --lifecycle codescene` exit 0.
- Every story renders: open `iframe.html?id=<story-id>&viewMode=story` via agent-browser, snapshot check for expected content, `console --level error` clean. Allow hot-reload a few seconds before declaring 404.

## Capture URLs from stories

Story ids are kebab-slugs like `views-dashboard-accounting-credits-creditadjustform--carryover-expanded`. Grab them from the stories files' `title:` or the Storybook manager URL; prefer `iframe.html?id=<id>&viewMode=story&globals=locale:en` for EN captures (needed for fair comparison against EN prototype mockups) and `locale:ar` when verifying RTL.

## Keep stories and implementation in sync

When a fix wave changes component structure/props, the same fixer must update the stories — stories get stale fast and stale stories corrupt the next loop's conclusions.
