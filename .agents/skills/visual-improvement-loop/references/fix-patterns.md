# Fix-Pattern Playbook

Finding → canonical fix mapping for fix waves. Fixers pick the recipe matching their finding and follow
it — converging on the same shapes across waves instead of inventing per-wave solutions. If no row
matches the finding, say so in the wave report: that gap is a playbook candidate for the evolution log.

| Finding pattern | Usual root cause | Canonical fix | Watch-outs |
|---|---|---|---|
| Horizontal overflow at viewport W | Fixed pixel width on container or child | Replace `width: <px>` with `maxWidth`/`width: "100%"`; `minWidth: 0` on flex/grid children; grid `minmax(0, 1fr)` | Check parents first — overflow is usually inherited |
| Cramped mobile dialog/modal | Desktop-sized Dialog on small screens | `fullScreen` below `theme.breakpoints.down("sm")`, or bottom-sheet composition; sticky footer actions with safe-area padding | Keep the desktop layout untouched |
| Too many competing primary buttons | No action hierarchy decided | ONE contained primary per view; rest `variant="outlined"`/`text`; destructive → `color="error"` | Applies per visible view, not per page |
| Missing/weak summary or status banner | Info buried in body copy | Alert-style surface above the fold: icon + title + one supporting line; tone via `theme.palette.<tone>` tokens | Banner summarizes, never duplicates, the content below |
| Inconsistent spacing | Per-element ad-hoc margins | Parent stack `gap` with theme spacing scale; drop per-child margins; consistent card padding | Prefer fixing the container over each child |
| DataGrid feels crowded/sparse | Default density for the context | `density` prop, hide low-value columns at breakpoints, keep the actions column pinned last | Keep column headers i18n-driven |
| Blank area while loading | No async state design | Skeletons matching the final layout's shape; spinner only for tiny inline regions | Skeleton ≠ spinner; match the real layout |
| Empty list looks broken | No empty state | Composed empty state: icon + heading + one-line guidance + single CTA | Never ship a bare empty table/grid |
| Errors only in console/toast | No error surface | Domain-error band (`Alert severity="error"`) for operations; field-level `helperText` for inputs | Map domain errors via translation functions, never raw messages |
| Mobile form unreadable | Desktop grid kept on mobile | Single-column stacking, label-above-input, full-width inputs, sticky action footer | Test at 390px first, not after desktop |
| Text hierarchy flat | Same variant/weight everywhere | MUI variant scale only (`h6/subtitle1/body2/caption`); weight contrast via `sx={{ fontWeight }}` | No ad-hoc `fontSize` px values |
| Ad-hoc colors in sx | Hex literals / hardcoded palette strings | Theme tokens only: `theme.palette.*` (use theme callback form) | Hex in a diff = automatic wave rejection |
| RTL layout breaks in Arabic | Physical `left`/`right` props | Logical props: `marginInlineStart`, `paddingInlineEnd`, `insetInlineStart`, etc. | Re-check with `globals=locale:ar` capture |
| Hardcoded copy in JSX | String literals in components | All user-visible text via `useAppTranslation` keys with typed interpolation | Includes aria-labels and dialog titles |
| Card/elevation inconsistency | Mixed shadow treatments per card | One card treatment per surface family (hairline border + consistent shadow) | Fix the family, not the instance |
| Numbers/dates formatted ad hoc | Inline `toLocaleString`/`Intl` calls | The project's shared formatters/locale helpers | Date/currency formatting is centralized |

## Convergence rule

When two findings on different screens share a root cause in a shared primitive (grid, container,
toolbar), escalate to the orchestrator as a CROSS-FILE decision — one fix in the primitive, not
local patches per screen.
