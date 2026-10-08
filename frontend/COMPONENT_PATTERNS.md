# Dashboard UI Component Patterns

**Last updated:** 2026-06-13  
**Status:** Phases 0–2 complete; card/header migration complete on implemented pages; typography standardized on class detail cards

This document defines the shared UI layer for Kottaby dashboard pages. All new dashboard views **must** follow these patterns.

**Related docs:**

- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — page rollout and workflow
- [AGENTS.md](AGENTS.md) — Dashboard UI Patterns (agent rules)
- [`.kiro/design-consistency-analysis.md`](.kiro/design-consistency-analysis.md) — original audit + progress
- [`.gemini/ui-consistency-analysis.md`](.gemini/ui-consistency-analysis.md) — findings + guidelines
- [`.cursor/plans/UI Pattern Analysis-d1994f10.plan.md`](.cursor/plans/UI%20Pattern%20Analysis-d1994f10.plan.md) — rollout plan + todos

---

## Architecture

```
Desktop:
DashboardLayout (pageMargin only)
  └── PageContainer (section gap — NO extra p: 2/3)
        ├── PageHeader (title, subtitle, breadcrumbs?, actions?)
        ├── MetricCard grid
        └── SectionPanel (title bar + actions)
              ├── AppDataGrid (desktop, ≥ md)
              └── *CardList (mobile, < md)

Mobile:
DashboardLayoutMobile (px: 0 — edge-to-edge)
  └── MobilePageContainer / MobileContentStack (gap only — NO horizontal px)
        ├── MobilePageHeader (always content gutter)
        ├── MobileMetricCardGrid / MobileHorizontalScrollRow (own peek-scroll padding)
        ├── MobileSectionPanel (title gutter; body inset unless contentInset={false})
        ├── MobileContentInset / MobileSectionTitleRow (ad-hoc text & controls)
        └── full-bleed heroes (internal padding only)
```

**Import from:** `@/frontend/components/ui` (desktop) / `@/frontend/mobile/components/ui` (mobile)

---

## Layout

### PageContainer

- **Purpose (desktop):** Single content wrapper inside `DashboardLayout`. Fixes double-padding with `pageMargin`.
- **Mobile:** Use `MobilePageContainer` — gap only; horizontal inset is owned by content primitives (see Architecture diagram above and `frontend/mobile/AGENTS.md`).
- **Rule:** Views must **not** add outer `p: 2`, `p: 3`, or `p: { xs: 2, md: 3 }`.
- **Spacing:** Uses `theme.layout.sectionGap` between child sections.

```tsx
<PageContainer>
  <PageHeader title={labels.pageTitle} subtitle={labels.pageSubtitle} />
  {/* sections */}
</PageContainer>
```

### PageHeader

- **Title:** `variant="headlineLg"` (use `titleVariant="headlineMd"` on mobile if needed)
- **Subtitle:** `variant="bodyLg"`
- **Actions:** Pass `FilterButton`, `PrimaryPageAction`, `ExportButton` presets
- **Breadcrumbs:** Optional `breadcrumbs` prop (see class audit `ClassAuditView`)

### SectionPanel

- **Purpose:** Bordered `Paper` with optional title bar and action slot
- **Use for:** Table sections, list sections with filter/export buttons
- **Children:** `AppDataGrid` (desktop) or card lists (mobile)
- **Desktop grid sections:** Use `DesktopSectionPanel` with `contentPadding={false}` so the data grid is flush under the title bar. The header bar keeps its own padding; only the grid body is edge-to-edge. For mixed sections (filters + grid), apply `desktopSectionContentInsetSx` to non-grid prefix content.

---

## Tables — AppDataGrid / MobileCardList

**Default:** Use owned list primitives — never hand-build MUI `Table` / `Pagination`, and never import `DataGrid` from `@mui/x-data-grid` outside the wrappers.

| Tier | Primitive | Pagination |
|------|-----------|------------|
| Desktop / shared | `AppDataGrid` / `DesktopAppDataGrid` | Required `paginationOptions` — wrapper owns footer UI |
| Mobile | `MobileCardList` + `MobileCardListItem` | Required `paginationOptions` — list owns pager UI (always shown when enabled) |
| Mobile (rare) | `MobileAppDataGrid` | Same `paginationOptions` API |

### `paginationOptions` (required)

```ts
type ListPaginationOptions =
  | false // no pager
  | { mode: "client"; pageSize?: number; pageSizeOptions?: readonly number[] }
  | {
      mode: "server";
      page: number;
      pageSize: number;
      totalCount: number;
      onPageChange: (page: number) => void;
      onPageSizeChange?: (pageSize: number) => void;
      pageSizeOptions?: readonly number[];
    };
```

- **Client:** parent passes full `rows`; primitive slices / pages internally.
- **Server:** parent owns page in Zustand; pass one page of rows + `totalCount` + `onPageChange`. Prefer `buildServerPaginationOptions(...)`. If the ViewModel already has server paging, mobile **must** use `mode: "server"` — never fake `client` on a server-sliced page.
- **Do not** pass `slots.pagination`, `hideFooter`, `paginationMode`, or flat MUI pagination props.
- **Mobile:** do not render sibling `MobilePaginationControls` next to a list — fold into `paginationOptions`. Every row shell uses `MobileCardListItem`. Pager remains visible when `paginationOptions !== false` (even one page / few rows).
- **Desktop ad-hoc card lists** (e.g. complaints) may keep sibling `DesktopPaginationControls` when intentional.
### Wrapper features

- Themed headers (`palette.table.header`)
- Owned pagination UI via `paginationOptions`
- Empty state overlay (`emptyMessage` prop)
- Loading overlay (`loading` prop)
- `disableRowSelectionOnClick` by default

### Mobile strategy

- **Desktop:** `*AppDataGrid` inside `SectionPanel`
- **Mobile:** `MobileCardList` + `MobileCardListItem` — do not force DataGrid on small screens; do not hand-roll `rows.map` for entity collections

---

## Cards

### BaseCard

Low-level wrapper enforcing `theme.layout.radius.card`, `theme.layout.cardPadding`, `theme.palette.border.light`, `theme.palette.shadow.card`.

Use for all class detail and audit section cards (e.g. `ClassInfoCard`, `MetadataCard`, `RegisteredStudentsSection` shell). Override with `sx={{ p: 0 }}` when the card has a custom header bar or table body.

### MetricCard

Use for all stat/metric displays. Variants: `default | error | highlight | danger | compact`. Optional `animated` for dashboard home.

```tsx
<MetricCard icon={Icon} label="Total Students" value={1284} variant="default" />
```

**Do not create** new per-feature metric card components.

Dashboard home uses [`MetricCardGrid`](frontend/views/dashboard/reports/components/MetricCardGrid.tsx) wrapping shared `MetricCard` with `animated`. Class admin live metrics use shared `MetricCard` in [`LivePerformanceGrid`](frontend/views/dashboard/classes/components/LivePerformanceGrid.tsx).

---

## Status badges

Use shared [`StatusBadge`](frontend/components/ui/state/StatusBadge.tsx):

```tsx
<StatusBadge category="studentAccount" status={row.accountStatus} label={label} />
<StatusBadge category="classSession" status="active" label={labels.active} />
<StatusBadge category="sessionTracking" status={row.status} label={label} icon={<BlockOutlined />} />
```

### Categories

| Category          | Use case                       | Palette mapping                                            |
| ----------------- | ------------------------------ | ---------------------------------------------------------- |
| `studentAccount`  | Student directory              | `palette.status.active / .pending / .blocked`              |
| `classSession`    | Schedule alerts session status | active → active, upcoming → pending, missed → blocked      |
| `classStatus`     | Dashboard schedule overview    | scheduled → confirmed, in_progress → active, etc.          |
| `sessionTracking` | Status tracking rows           | regular, suspended_pending, on_leave, pending_verification |
| `trackingStatus`  | Reschedule tracking            | rescheduled, pending_leave                                 |
| `session`         | Direct `palette.status` key    | Pass status key directly                                   |
| `enrollment`      | Enrollment labels              | `palette.status.active / .pending / .cancelled`            |

**Do not** use inline `Chip` with hardcoded colors for status display.

---

## Action buttons

Use presets from `@/frontend/components/ui`:

| Component           | Use case                                 |
| ------------------- | ---------------------------------------- |
| `PrimaryPageAction` | Contained page actions (Add, New Report) |
| `FilterButton`      | Outlined filter triggers                 |
| `ExportButton`      | Outlined export/download                 |

Table cell actions (approve/reject, join session) may use compact `Button` with `borderRadius: 1.5` until a `CompactTableAction` preset is added.

---

## Date navigation

Use shared [`DateNavigator`](frontend/components/ui/filter/DateNavigator.tsx) from `@/frontend/components/ui`:

```tsx
<DateNavigator
  dateValue={filterDate}
  todayLabel={labels.dateFilter.today}
  previousDayLabel={labels.dateFilter.previousDay}
  nextDayLabel={labels.dateFilter.nextDay}
  dateLabel={labels.dateFilter.dateLabel}
  onDateChange={setFilterDate}
/>
```

### Props

| Prop                | Type       | Use case                                        |
| ------------------- | ---------- | ----------------------------------------------- |
| `dateValue`         | `string`   | Current date in `yyyy-MM-dd` format             |
| `todayLabel`        | `string`   | Label for the "Today" quick-jump button         |
| `previousDayLabel`  | `string`   | Tooltip for the previous-day chevron button      |
| `nextDayLabel`      | `string`   | Tooltip for the next-day chevron button         |
| `dateLabel`         | `string?`  | Label displayed on the `AppDatePicker` field    |
| `onDateChange`      | `function` | Callback with new `yyyy-MM-dd` string            |

### Date utilities

Date shift/parse helpers live in `@/frontend/utils/scheduleFilterDate`:

- `shiftScheduleFilterDate(date, offset)` — add/subtract days
- `getTodayScheduleFilterDate()` — today as `yyyy-MM-dd`
- `isScheduleFilterDateToday(date)` — check if a date is today
- `parseScheduleFilterDate(date)` — parse `yyyy-MM-dd` to `Date | null`

### Usage pattern

Wire the `DateNavigator` to a Zustand store `filterDate` field so a single value drives both the navigator UI and the GraphQL query variables (same pattern as `AdminDashboardContainer`).

**Do not** hand-build date picker + prev/next button rows. Always use `DateNavigator`.

---

## Forms

Form inputs **must** use MUI Material floating/notched labels (`label` on `TextField` / Autocomplete, or `InputLabel` + `Select`). Never render a separate label above the control.

```tsx
import { TextField, FormControl, InputLabel, Select, MenuItem } from "@mui/material";
import { outlinedInputSx, timeInputOutlinedSx, AppTimePicker } from "@/frontend/components/ui/form";

<TextField label="Full name" required error={!!error} helperText={error} sx={outlinedInputSx} />

{/* displayEmpty + empty-value placeholder REQUIRES InputLabel shrink, or label overlaps the placeholder */}
<FormControl fullWidth required sx={outlinedInputSx}>
  <InputLabel id="class-type-label">
    Class type
  </InputLabel>
  <Select labelId="class-type-label" label="Class type" value={value} displayEmpty onChange={onChange}>
    <MenuItem value="" disabled>
      Select class type
    </MenuItem>
    <MenuItem value="group">Group</MenuItem>
  </Select>
</FormControl>

<AppTimePicker
  label="Default start time"
  slotProps={{ textField: { fullWidth: true, sx: timeInputOutlinedSx } }}
/>
```

Reference implementations: `TimezoneSelect`, `CountrySelect`, `CurrencySelect`, `PhoneInput`.

`PhoneInput` is the two-slot phone field: a country-picker flag button plus a borderless calling-code prefix in the start adornment, and the national number as the main input. The flag/dial-code adornment is built in (no `startAdornment`), `aria-invalid` is computed internally from the error state, and the value contract is E.164 — full `+{callingCode}{national}` when valid, a partial `+{prefix}` while typing, `null` when empty — emitted through `onChangeAction`. Bind it to React Hook Form via `PhoneFormField` (`name` + `control`, optional `rules`); the admin dialogs bind it as a controlled field (`value: string | null`, `onChangeAction`).

### Available styles

| Export                    | Use case                                          |
| ------------------------- | ------------------------------------------------- |
| `outlinedInputSx`         | Outlined inputs with `borderRadius: 3` (preferred)|
| `timeInputOutlinedSx`     | TimePicker outlined variant (preferred)           |
| `standardInputSx`         | Legacy underline inputs (avoid for new fields)    |
| `timeInputStandardSx`     | Legacy TimePicker standard variant                |
| `durationBoxSx(isMobile)` | Custom duration input container                   |
| `labelSx`                 | Non-input section/stat labels only — **not** form fields |
| `AppDatePicker`           | MUI DatePicker with Arabic localization           |
| `AppTimePicker`           | MUI TimePicker with Arabic localization           |

**Note on Date & Time Pickers**: Always use `AppDatePicker` or `AppTimePicker` from `@/frontend/components/ui/form` rather than manually configuring MUI pickers and `LocalizationProvider`. Pass `label` (or `slotProps.textField.label`) so the picker shows a Material floating label.

---

## Typography

Use theme variants — avoid hardcoded `fontFamily` / `fontSize` in `sx`:

| Element       | Variant                                         |
| ------------- | ----------------------------------------------- |
| Page title    | `headlineLg` via `PageHeader`                   |
| Section title | `titleLg` via `SectionPanel`                    |
| Metric label  | `labelUppercase`                                |
| Body text     | `bodyMd` / `bodyLg`                             |
| Table headers | `labelUppercase` (via DataGrid theme overrides) |

---

## Theme tokens

Defined in [`frontend/providers/theme/types.ts`](frontend/providers/theme/types.ts):

```typescript
theme.layout.radius.card      // 3
theme.layout.radius.button    // 2
theme.layout.radius.badge     // 3
theme.layout.sectionGap       // 1.5rem
theme.layout.cardPadding      // 1.5rem
theme.typography.labelUppercase
theme.palette.table.header.background / .text
theme.palette.shadow.card
theme.palette.border.light
```

DataGrid overrides: `MuiDataGrid` in theme `components`.

---

## Page migration checklist

When building or refactoring a dashboard page:

- [ ] Desktop: wrap content in `PageContainer` (no extra outer padding — avoids double-padding with `pageMargin`)
- [ ] Mobile: `MobilePageContainer` / `MobileContentStack` without horizontal px; use gutter primitives for content
- [ ] Add `PageHeader` / `MobilePageHeader` with title + subtitle + actions
- [ ] Use `MetricCard` for stat rows
- [ ] Use `SectionPanel` for table/list sections
- [ ] Desktop table → feature `*DataGrid` wrapping `AppDataGrid` / `DesktopAppDataGrid` with `paginationOptions`
- [ ] Mobile list → `MobileCardList` + `MobileCardListItem` with `paginationOptions` — no sibling mobile pagers; server ViewModels use `buildServerPaginationOptions`
- [ ] Status cells → shared `StatusBadge`
- [ ] Pass i18n `noEntries` / `noClasses` to DataGrid `emptyMessage`
- [ ] Wire real pagination (no decorative prev/next buttons)
- [ ] Person pickers → tier `userSelect` Autocomplete (`TeacherAutocompleteDesktop` / `StudentAutocompleteMobile` / …) — never inline MUI Autocomplete + directory `useQuery` in views

### Person / audience Autocomplete (userSelect)

Kottaby is **permission-based**. Person pickers are keyed by **audience** (`teacher` | `student` | `parent` | `staff` | `user`), not RBAC roles.

| Layer | Responsibility |
|-------|----------------|
| Common | `AudienceAutocomplete` engine, audience facades, hooks, `userAutocompleteStore` (options cache only), types/utils |
| Desktop / mobile | Compose common facade + **locked** platform styles — **no re-exports**, **no viewport branching** |
| Page store / RHF | **Selection only** (`PersonOption \| null` or id) |

**Rules:**

- Desktop views import from `@/frontend/desktop/components/ui/input/userSelect`
- Mobile views import from `@/frontend/mobile/components/ui/input/userSelect`
- Never import `TeacherAutocomplete` / peers from common in views
- Never call `teachersQueryDocument` / `studentsDirectoryQueryDocument` / `parentsDirectoryQueryDocument` / `staffDirectoryQueryDocument` from views for pickers — hooks own that
- Shared common UI that needs a picker (e.g. `ScheduleFilters`) takes a **slot** `ReactNode` from the tier parent
- Empty search returns up to 20 results; debounce 300ms; options cached in `userAutocompleteStore` (LRU, in-memory)

### Migrated pages (2026-06-13)

| Route                           | PageContainer | PageHeader | MetricCard                | AppDataGrid                |
| ------------------------------- | ------------- | ---------- | ------------------------- | -------------------------- |
| `/dashboard`                    | Yes           | —          | Yes (MetricCardGrid)      | ScheduleOverviewDataGrid   |
| `/students`                     | Yes           | Yes        | Yes                       | StudentDirectoryDataGrid   |
| `/schedule/alerts`              | Yes           | Yes        | Yes                       | AcademicScheduleDataGrid   |
| `/schedule/tracking/status`     | Yes           | Yes        | Yes                       | StatusTrackingDataGrid     |
| `/schedule/tracking/reschedule` | Yes           | Yes        | Yes                       | RescheduleTrackingDataGrid |
| `/classes/[id]/audit`           | Yes           | Yes        | —                         | — (embedded table)         |
| `/classes/[id]`                 | Yes           | Yes        | Yes (LivePerformanceGrid) | —                          |
| /classes/new                  | Yes           | Yes        | —                         | —                          |
| /parents                      | Yes           | Yes        | Yes                       | ParentsDataGrid            |

---

## Remaining work

1. Add RTL `localeText` to `AppDataGrid` when Arabic DataGrid labels are needed
2. ESLint custom rules (mobile/desktop isolation — see "Mobile/Desktop Isolation" section below; implemented in Phase 0)

---

## Mobile/Desktop Isolation

See [`.agents/instructions/mobile-desktop.instructions.md`](../.agents/instructions/mobile-desktop.instructions.md) for the full ESLint-enforced rules, directory structure, ViewModel pattern, switcher pattern, and primitive catalog.

Cross-references:
- `frontend/mobile/AGENTS.md` — Mobile* primitives (3 behavioral categories)
- `frontend/desktop/AGENTS.md` — tier-paired `.desktop.*` variants only
- `frontend/views/AGENTS.md` — switcher/Container/ViewModel relocation home
- `frontend/components/ui/AGENTS.md` — viewport-agnostic primitives layer rules
- `frontend/views/AGENTS.md` — ViewModel hook conventions
