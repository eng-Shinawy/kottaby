# Objective Pre-Checks (capture gate)

Mechanical verification gate that runs on every capture BEFORE any image inspector is dispatched.
Image inspectors cost tokens and exist for judgment calls — they must never be spent discovering a
console error, a horizontal scrollbar, or the wrong page. Anything a script can decide, a script
decides; the rubric is reserved for what requires eyes.

## Gate checklist (per capture)

1. **Title guard** — `document.title` matches the expected page (auth-bounce detector; a stale session
   turns every later shot into a login-page screenshot).
2. **Console sweep** — `agent-browser console --level error` empty (or only known-ignored entries).
3. **Horizontal overflow** — `document.documentElement.scrollWidth <= window.innerWidth` at this viewport.
4. **Off-viewport bleed** — no element's bounding rect extends past the viewport edge (fixed/sticky excluded).
5. **A11y smoke** — no `<img>` without `alt`; no icon-only button/link without an accessible name.

## Running (bundled script)

```bash
# navigate + gate in one shot
scripts/visual-precheck.sh --url "http://localhost:6006/iframe.html?id=<story-id>&viewMode=story&globals=locale:en" \
  --settle 10 --expect-title "Storybook"

# gate the page already open in the current session (recapture loop)
scripts/visual-precheck.sh --no-nav
```

Output: one `CHECK <name> PASS|FAIL|ERROR <detail>` line per check; exit code is non-zero on any
FAIL or ERROR, so the gate composes in shell conditionals and scripts.

## Handling results

- Any FAIL is recorded as a HIGH finding with the script's output line as evidence, fixed BEFORE
  inspector dispatch; then re-capture and re-run the gate.
- Only captures with a fully green gate enter the scoring phase. A screenshot that fails the gate is
  retaken after fixing, never scored as-is.
- ERROR means the harness itself failed (CLI missing, session dead) — fix the harness, not the page.
- If the bundled script cannot run in some environment, the gate is still mandatory: run the snippets
  below manually via `agent-browser eval`. The script is convenience; the gate is the rule.

## Manual eval snippets (fallback)

Overflow:

```js
JSON.stringify({ sw: document.documentElement.scrollWidth, iw: window.innerWidth,
  overflow: document.documentElement.scrollWidth > window.innerWidth })
```

Off-viewport elements (first 10 offenders):

```js
JSON.stringify(Array.from(document.querySelectorAll("body *")).filter((el) => {
  const r = el.getBoundingClientRect();
  return getComputedStyle(el).position !== "fixed" && r.width > 0 && r.right > window.innerWidth + 1;
}).slice(0, 10).map((el) => `${el.tagName}.${String(el.className).split(" ")[0] ?? ""}`))
```

A11y smoke:

```js
JSON.stringify({
  imgsNoAlt: document.querySelectorAll("img:not([alt])").length,
  unnamedIconButtons: Array.from(document.querySelectorAll("button:not([aria-label])"))
    .filter((b) => !b.textContent.trim()).length,
})
```
