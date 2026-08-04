# UI Conventions

shadcn/ui is fully installed (60 components in `src/components/ui/`, `components.json` correctly wired to `tailwind.config.js`) but was inconsistently adopted — most screens hand-roll primitives that already exist. This is the standard to converge on as screens are touched. Don't do a big-bang rewrite of a page you're not otherwise changing; when you touch a screen for any reason, bring it in line with these rules.

## Rules

1. **No raw HTML form elements.** `<button>` → `Button` (pick a `variant`); `<select>` → `Select`, or `Combobox` (`src/components/ui/combobox.tsx`) when the list is long, searched, or server-paginated; `<input>` → `Input`, wrapped in `Field` when it needs a label/error/description; `<table>` → `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableCell`.

2. **No native browser dialogs.** No `window.prompt`, `window.confirm`, or `alert`. Use `ConfirmDialog` (`src/components/ConfirmDialog.tsx`) for confirm-with-optional-reason flows — it already supports `reasonLabel` / `reasonRequired` / `reasonMinLength`. For anything more complex, build on `Dialog`.

3. **Charts go through `ChartContainer`.** `src/components/ui/chart.tsx` exports `ChartContainer` / `ChartTooltip` / `ChartTooltipContent` / `ChartConfig`. See `StockOverviewWidget.tsx` and `Attendants.tsx` for the reference usage — both already do this correctly. Never hand-write `darkMode ? '#hex' : '#hex'` per-component; that logic already lives in the theme.

4. **Chart colors are CSS variables, never hex literals.** The base palette is `--chart-1` through `--chart-5` (`src/index.css`, defined for both light and dark). Where a color is *semantic* — occupied-room red, vacant-room green, a specific meal type — define a named domain token (e.g. `--status-occupied`, `--meal-breakfast`) alongside the base palette rather than reusing `--chart-N` by position or falling back to a hex. Semantic meaning must survive the migration to tokens; don't flatten it away for the sake of using the numbered palette.

5. **Empty and loading states are components, not ad-hoc markup.** Use `Empty` (`src/components/ui/empty.tsx`) for "nothing here yet" states instead of a bare `<p>`. Use `Skeleton` for loading placeholders instead of a hand-rolled pulsing div (see `StatValue` in `Dashboard.tsx` for the pattern this replaces).

6. **Lists that can exceed one page use `Pagination`**, not a fixed `page_size` fetch treated as "everything." See `CLAUDE.md`'s note on the `page_size=100` truncation class of bug — a list screen with no pagination control is how that bug hides.

7. **The sidebar is `Sidebar`/`SidebarMenu`, not hand-rolled state.** `src/components/ui/sidebar.tsx` + `use-sidebar.ts` provide collapse (cookie-persisted), a mobile drawer with focus-trapping, and `SidebarMenuBadge`. Don't reimplement any of this in `Layout.tsx`.

8. **Global search is `Command`/`CommandDialog`**, not a page-local search input, when the search spans modules.

## Reference implementations (copy these, don't re-derive)

| Need | Look at |
|---|---|
| Chart with tooltip/legend | `src/components/dashboard/StockOverviewWidget.tsx`, `src/pages/Attendants.tsx` |
| Confirm + reason dialog | `src/components/ConfirmDialog.tsx`, and its usage in `src/pages/Approvals.tsx` |
| Searchable server-backed select | `src/components/ui/combobox.tsx`, wired in `src/pages/StockManagement.tsx`'s vendor field |

## Sequencing note

When migrating a page for consistency's sake (not because you're fixing a bug in it), do read-only/reference screens first (Reports, AuditLog, Alerts) and money-handling screens last (Checkout, BillPrint, MessBilling) — a visual regression on a bill print is a real-world problem, not a cosmetic one.
