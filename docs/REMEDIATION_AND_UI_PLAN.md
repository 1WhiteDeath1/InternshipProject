# Remediation & shadcn Standardization Plan

**Date:** 3 August 2026
**Inputs:** [ROLE_FEATURE_AUDIT_2026-08-03.md](ROLE_FEATURE_AUDIT_2026-08-03.md)
**Status:** Plan only — nothing implemented.

Two tracks. **Track A** fixes what's wrong. **Track B** standardizes the UI on shadcn. They're mostly independent, and three places where they overlap are called out so the work isn't done twice.

---

## Ground rules that shape both tracks

1. **There is no automated test suite.** Not for the backend, not for the frontend. Every phase below therefore ends with an explicit manual verification step through the dev preview harness (`backend/dev_server.py` + Vite autoPort). This is the single biggest risk to Track B, which touches ~40 files.
2. **Ship in role-sized slices.** Each phase should leave the app fully working for all six roles. Never land a half-migrated screen.
3. **One commit per phase**, so anything can be reverted cleanly without unpicking unrelated work.
4. **`docs/MODULES.md` and `ARCHITECTURE.md` get updated in the same commit** as the change that invalidates them — not later.

---

# TRACK A — Fixing what's broken

## Phase A0 — Housekeeping (do first, 30 min, zero risk)

Clears the ground so later phases don't trip over stale information.

| Task | Detail |
|---|---|
| Delete `src/pages/Home.tsx` | Unrouted dead file. Same class of leftover that caused the old `/inventory` dead links. |
| Refresh `ARCHITECTURE.md` | Remove `recipes`, `menu_prices`, `kitchen_deduction.py`, `recipe_costing.py`, `unit_conversion.py` — none exist. Add `directives`, `rate_card`, `mess_charge_calc.py`. |
| Fix `components.json` | `"tailwind": { "config": "postcss.config.js" }` is **wrong** — this is Tailwind v3.4 with a real `tailwind.config.js`. Point it there. **Track B depends on this**: `npx shadcn add` reads this field, and with it wrong, newly added components won't wire into the theme correctly. |

**Verify:** `npm run build` succeeds; `npx shadcn@latest add progress --dry-run` resolves the right config.

---

## Phase A1 — Stop the system counting wrong (highest value in the plan)

This is the finding where the app reports a confidently wrong number. It fixes a correctness bug and a 9-request performance problem in one change.

**Backend — new endpoint**

Add to `backend/routers/attendance.py`:

```
GET /api/attendance/daily-counts?date_from=&date_to=&meal_type=
→ [{ date, meal_type, booked, attended, no_show }]
```

- One `GROUP BY date, meal_type, status` query for the whole range. No pagination — it returns counts, not rows, so there's nothing to truncate.
- Gate on `attendance:view` (this also closes part of A3).
- Cap the range at ~90 days to keep it bounded.

**Frontend — repoint five figures**

In `src/pages/Dashboard.tsx`, the Kitchen NCO block currently makes 9 calls. Replace all of them with **one** call for `today-6 … tomorrow`, which feeds:

- "Meals Booked Today" hero tile
- "Today's Meals by Type" donut
- "Tomorrow: N booked so far"
- all 7 bars of "Weekly Meal Volume"

**Then sweep the same bug class elsewhere** — `page_size=100` used as "fetch everything":

| Location | Fix |
|---|---|
| `Dashboard.tsx` → `/mess-billing/bills?page_size=100` (Clerk's Outstanding total) | Add `GET /mess-billing/bills/outstanding-summary` returning totals, or paginate through |
| `StockManagement.tsx:439` → `/procurement/vendors?page_size=100` | Make the vendor picker a searchable `Combobox` that queries the server (**merges with Track B, Phase B4**) |
| `OccupancyWidget.tsx` → `/bookings/rooms?page_size=200` | Bounded by physical room count — acceptable, but add a code comment saying so, so the next reader doesn't "fix" it |

**Guard against regression:** add a short note to `ARCHITECTURE.md` — *"list endpoints cap `page_size` at 100; never treat a single page as the full set. Aggregate server-side instead."*

**Verify:** seed >100 attendance rows for one day, confirm the tile matches a direct DB count. Confirm the Kitchen dashboard now issues 1 attendance request, not 9 (browser network panel).

---

## Phase A2 — Lock the branding endpoint (15 min, do immediately)

`backend/routers/branding.py` currently has **no authentication at all**, and its `password: str` binds as a **query parameter** — so the shared password lands in server logs and browser history.

1. Add `Depends(get_current_user)` to `PUT`.
2. Add `check_permission(user, "branding", "edit")` — Manager and Deputy already hold `branding: "VE"`, so no RBAC change needed.
3. Move `password` into the request body, **or drop it entirely** — RBAC now covers the authorization, and the second factor is redundant. Recommend dropping it; if kept for break-glass reasons, it must be in the body.
4. Add `log_audit(...)` — this is currently the only mutating endpoint in the app with no audit trail.
5. Leave `GET` unauthenticated — the login screen needs the logo before a token exists. Confirm it returns no secrets.

**Verify:** `PUT` without a token → 401. As Clerk → 403. As Manager → 200 and an audit row appears.

---

## Phase A3 — Close the read-side permission gaps

Every **write** path is already correctly gated. This is reads only.

**A3.1 — The three missed siblings of the `/occupancy` fix** (trivial, do with A2)

Add `check_permission(current_user, "bookings", "view")` to:
- `GET /bookings/rooms/{room_id}/calendar` — leaks guest name, **phone**, rank
- `GET /bookings/availability` — guest name, rank
- `GET /bookings/calendar-summary` — guest name, rank

**A3.2 — The wider sweep**

| Router | Endpoints | Gate on |
|---|---|---|
| `mess_billing` | `/bills`, `/guest-charges`, `/room-lease-dispatch`, `/bills/{id}/diet-invoice` | `mess_billing:view` |
| `billing` | `/invoices/{id}/print-data`, `/payments/{id}/receipt-data`, `/dashboard-stats` | `billing:view` **or** `clerk_desk:view` (match the `/desk` pattern) |
| `security` | `/logs`, `/incidents` | `security:view` |
| `attendance` | `""`, `/lookup`, `/attendees`, `/leaves`, `/summary` | `attendance:view` |

**Watch for breakage** — some of these are consumed cross-module. Before landing, grep each endpoint's frontend callers and confirm every calling role holds the new permission. Two known cases to check: the Kitchen NCO's dashboard calls `/attendance` (holds `attendance:VCE` ✓), and `BillPrint`/`MessBillPrint` call the print-data endpoints from Clerk Desk (holds `clerk_desk:view` ✓).

**Leave alone:** `inventory/*`, `tariffs`, `rate_card`, `womens_bloc_rates` GETs. These are reference data, and gating them would break the rate lookups that booking and billing screens legitimately need.

**Verify:** log in as Security Guard, hit each endpoint directly → 403. Then walk all six roles through their normal screens and confirm nothing 403s that shouldn't.

---

## Phase A4 — Small logic fixes

| Fix | Detail |
|---|---|
| **Vendor edit** | No role holds `procurement:edit`, so `PUT /vendors/{id}` is unreachable by everyone. **Decide:** grant Kitchen NCO `procurement: "VCE"` and add an edit affordance to the vendor list, **or** delete the endpoint. Recommend granting — a mistyped vendor name is currently permanent. |
| **Hall double-booking** | In `events.py`, before create and update: query for an existing non-cancelled event with the same `hall_name` on the same `event_date`; return 409 with the conflicting event's title. ~10 lines. |
| **Capacity vs. headcount** | `capacity` and `headcount` are both stored and never compared. Warn (don't block) when `headcount > capacity` — the Deputy may have a legitimate reason. |
| **Generic ops dashboard** | `Dashboard.tsx:503` shows "Bills To Settle" reading **"All collected ✓"** when the billing data was never fetched. Either hide the tile when `canSeeDesk` is false, or delete the fallback board entirely — no built-in role reaches it today. |

---

## Phase A5 — Replace the four native `prompt()` calls

These collect **audit-log reason text** — the most valuable free text in the system — through the browser's grey box. In a packaged desktop build the host webview may suppress it entirely, in which case the reason returns `null` and the action silently aborts.

Build one `<ReasonDialog>` alongside the existing `ConfirmDialog.tsx` (which already exists specifically to replace native dialogs — its own comment explains why). Then replace:

- `Approvals.tsx:83` — bill-correction rejection
- `Approvals.tsx:111` — menu-change rejection
- `Attendance.tsx:89` — backdated attendance correction
- `Members.tsx:128` — member status change

Add a minimum length (~10 chars) so "asdf" can't reach the audit log.

**Merges with Track B, Phase B3** — build this on shadcn `Dialog` + `Textarea` + `Field` and it's done once.

---

## Phase A6 — Route-level authorization

The one structural item from the previous audit that never moved. Sidebar hides nav items; routes render for anyone who types the URL.

1. `<RequirePermission module="..." action="...">` wrapper component reading the same `hasPermission` used by the sidebar.
2. A proper `/no-access` screen (shadcn `Empty` component — installed, currently unused).
3. Wrap every route in `App.tsx` with its module's permission, sourced from the same table `Layout.tsx` already uses for nav filtering.

**Do this after A3, not before** — with the backend gaps still open, a route guard would create a false sense of coverage.

**Refactor worth doing here:** the nav table in `Layout.tsx` and the route table in `App.tsx` both encode "which permission does this path need." Extract one shared `routeConfig` and drive both from it, so they can never drift.

---

## Phase A7 — Role gaps, ordered by value ÷ effort

| # | Item | Effort | Note |
|---|---|---|---|
| 1 | **Clerk shift cash tile** | ~30 min | `/billing/dashboard-stats` already returns `payment_methods_today`, and the Clerk dashboard **already fetches it into state and never renders it**. Pure render work. |
| 2 | Daily granularity in Income & Cost | Small | `BillingReports.tsx` offers only `month \| year`; add `day` |
| 3 | **Alert routing by module → role** | Medium | Filter the existing feed: inventory/kitchen → Kitchen NCO, billing → Clerk, bookings → Booking NCO, procurement anomalies → Manager. Also grant Kitchen NCO `alerts:view`. |
| 4 | **Booking NCO shift briefing** | Medium | Replace the room-grid landing with arrivals / room-readiness / overstays / unassigned housekeeping |
| 5 | **Two-way directives** | Medium | Add a request→Manager channel reusing the Approvals inbox. Structural gap: the Manager's job is approvals and there's no inbound channel. |
| 6 | Housekeeping assignment loop | Medium | Status exists; assign + mark-done doesn't |
| 7 | **Period close / locked books** | Large | A `PeriodClose` table + a guard on every mutating billing endpoint. Biggest missing control for an auditable mess — but it touches every money path, so it goes last. |

---

## Phase A8 — Performance (do last; nothing here is user-visible today)

| Item | Fix |
|---|---|
| Per-day query loops — `reports.py:122,140,181` and `anomaly_engine._daily_spend_per_active_booking` | Collapse each into one `GROUP BY date(...)` query. Up to 90 round trips → 1. |
| `/billing/desk` N+1 | Unbounded fetch + `_running_balance_payload()` per booking. Batch the unbilled-items and invoice lookups. On the Clerk's hottest path. |
| No dashboard auto-refresh | Add a shared `useAutoRefresh(fetcher, 30_000)` hook, applied to all dashboards. Kitchen already polls at 20s; Bookings polls; dashboards don't. |

---

# TRACK B — shadcn standardization

## Where things actually stand

**60 shadcn components are installed. Most have never been imported.**

| Component | Consumers | Reality |
|---|---|---|
| `ui/chart` | 2 | `StockOverviewWidget` + `Attendants` do it right — **use these as the reference** |
| `ui/sidebar` + `use-sidebar` | **0** | `Layout.tsx` hand-rolls the whole sidebar |
| `ui/command` | **0** | This is why there's no global search |
| `ui/empty` | **0** | Empty states are ad-hoc `<p>` tags |
| `ui/pagination` | **0** | Nothing paginates in the UI — directly causes the `page_size=100` bugs in A1 |
| `ui/form`, `field`, `item`, `breadcrumb`, `kbd`, `spinner`, `hover-card`, `progress` | **0** each | Installed, unused |

And the raw-HTML count across pages/components:

- **39 raw `<select>`** ← biggest single inconsistency; these render as unstyled OS dropdowns and ignore dark mode
- **68 raw `<button>`**
- **8 raw `<input>`**, **6 raw `<table>`**
- **21 hardcoded hex colors** in charts

The theme layer is **already correct** — `--chart-1` … `--chart-5` are defined for both light and dark in `src/index.css`. The charts just bypass them.

> **The framing that matters:** this isn't "add shadcn." shadcn is already installed and configured. It's *"start using what's already there."* That makes this much lower-risk than it looks — no new dependencies, no design decisions, just replacing hand-rolled things with their existing equivalents.

---

## Phase B0 — Prerequisites

1. Fix `components.json` (from A0) — **blocking**, `shadcn add` misbehaves without it.
2. Add the missing pieces: `npx shadcn@latest add combobox toggle-group` (most others are already present).
3. **Write `docs/UI_CONVENTIONS.md` before touching any screen.** One page: use `Button` not `<button>`; use `Select` not `<select>`; chart colors come from `--chart-N` only, never a hex; empty states use `Empty`; loading uses `Skeleton`. Without this the migration will drift halfway through.

---

## Phase B1 — Charts and analytics (biggest visual payoff)

**Ten files import recharts directly.** Two already use `ChartContainer` correctly; eight do it by hand, including manual dark-mode logic like `darkMode ? '#374151' : '#E5E7EB'` recomputed in every file.

Migrate to `ChartContainer` / `ChartTooltip` / `ChartTooltipContent` / `ChartConfig`:

| File | Chart |
|---|---|
| `Dashboard.tsx` | Weekly meal bars + meal-type donut |
| `RoomStatusDonut.tsx` | Room status donut |
| `OccupancyWidget.tsx` | Occupancy pie |
| `RevenueWidget.tsx` | Revenue sparkline |
| `CostRevenueSankeyWidget.tsx` | Sankey — **hand-rolled SVG, migrate last and carefully** |
| `Reports.tsx`, `StockManagement.tsx`, `bookings/DashboardTab.tsx` | Assorted |

What this buys, concretely:

- Delete all 21 hardcoded hexes → semantic tokens
- Delete the per-file `darkMode ? ... : ...` blocks — `ChartContainer` handles theming through CSS variables automatically
- Consistent tooltips, legends and spacing across every chart in the app
- One shared `ChartConfig` per domain (meal types, room statuses, duty types) instead of five divergent color maps

**Semantic colors must survive the migration.** Occupied rooms are red and vacant are green for a *reason* — don't flatten these into `chart-1..5` by rote. Extend the CSS variables with domain tokens (`--status-occupied`, `--status-vacant`, `--meal-breakfast`, …) and reference those in the `ChartConfig`.

**Verify:** screenshot every chart in light and dark before and after. This is the phase most likely to silently change meaning.

---

## Phase B2 — The sidebar

`ui/sidebar.tsx` and `use-sidebar.ts` are installed and unused. `Layout.tsx` (331 lines) hand-rolls: collapse state, mobile drawer, backdrop, transform classes, per-item active styling, badge positioning for both collapsed and expanded states.

Migrate to `SidebarProvider` / `Sidebar` / `SidebarMenu` / `SidebarMenuItem` / `SidebarMenuBadge` / `SidebarTrigger`.

Wins beyond consistency:
- Collapse state persists across reloads (cookie-backed) — currently resets every navigation
- Mobile drawer, backdrop and focus-trapping come for free; the hand-rolled version has no focus trap (an accessibility gap)
- `SidebarMenuBadge` replaces the duplicated collapsed/expanded badge markup
- Keyboard shortcut (`Cmd/Ctrl+B`) included

**Do this in the same commit as A6's `routeConfig` extraction** — both rewrite the nav table, and doing them separately means writing it twice.

**Also fix here (audit finding):** quick actions are `hidden sm:flex` — they vanish on phones, which is exactly where the front desk needs "New Booking". Move them into a `DropdownMenu` on small screens instead of hiding them.

---

## Phase B3 — Forms, inputs and dialogs

**The 39 raw `<select>` elements are the single biggest visual inconsistency in the app.** They render as native OS dropdowns — wrong font, wrong radius, wrong colors, and they ignore dark mode entirely. Replace with shadcn `Select`; where the list is long or searchable (vendors, members, guests, rooms) use `Combobox` instead, which also fixes the vendor-truncation bug from A1.

Then:
- 68 raw `<button>` → `Button` with the right `variant`. Many are legitimately custom list-row buttons — those become `Item`, not `Button`.
- 8 raw `<input>` → `Input`, wrapped in `Field` for label + error + description
- Adopt `Form` (react-hook-form + zod — **both already dependencies**) on the heavy forms first: `RoomBookingForm`, member create, stock intake
- Build the `ReasonDialog` from **A5** here on `Dialog` + `Textarea` + `Field`

**Sequence by risk:** start with read-only screens (Reports, AuditLog, Alerts), finish with money screens (Checkout, BillPrint, MessBilling). A styling regression on a bill print is a real-world problem, not a cosmetic one.

---

## Phase B4 — Tables, lists and pagination

- 6 raw `<table>` → shadcn `Table`
- **Adopt `Pagination` — nothing in the UI paginates today.** This is the *user-facing* half of the A1 bug: the backend caps at 100 and the UI has no way to ask for page 2. Wire it into Members, Guests, Bookings list, Invoices, Vendors, Attendance.
- Replace ad-hoc `{items.length === 0 && <p>No data</p>}` with `Empty` — consistent icon + message + call-to-action
- Replace ad-hoc loading states with `Skeleton` (the `StatValue` helper in `Dashboard.tsx` already hand-rolls one)

---

## Phase B5 — Global search (`Command`)

`cmdk` is a dependency, `ui/command.tsx` is installed, and neither is used. This closes an audit finding and is the highest-visibility ease-of-use win in either track.

- `CommandDialog` on `Cmd/Ctrl+K`, mounted in `Layout`
- Search across guests, members, rooms, bookings, invoices — **filtered by the user's permissions**, so a Security Guard's search never returns guest names (depends on A3 being done first)
- Include navigation commands ("Go to Kitchen", "New Booking")
- Backend: one `GET /api/search?q=` that fans out across modules the caller can actually see, rather than five client-side calls

---

## Phase B6 — Cards, blocks and polish

- Standardize the hand-rolled `HeroTile` / `SectionCard` in `Dashboard.tsx` into shared `components/dashboard/StatTile.tsx` + `SectionCard.tsx`, used by all five role dashboards
- `Breadcrumb` replaces the hand-built breadcrumb in the `Layout` header
- `Kbd` to display shortcuts once B5 lands
- **Images:** there's no image handling convention at all today. Add `Avatar` for user/member photos (the header currently renders a letter in a coloured circle by hand) and `AspectRatio` for the branding logo and any receipt-scan previews, so uploaded images can't break layout.
- Consider shadcn **blocks** for the two overloaded screens — `StockManagement.tsx` (947 lines) and `Kitchen.tsx` (686 lines). Both mix daily operations with configuration. A dashboard block layout is a natural seam to split "do the work now" from "set things up."

---

# Sequencing

**Do Track A first through A3.** Those are correctness and security — a wrong meal count and an unauthenticated branding endpoint outrank any amount of visual consistency.

```
Week 1   A0 → A1 → A2 → A3          correctness + security
Week 2   A4 → A5 → B0 → B1          logic fixes, then charts
Week 3   B2 + A6 (same commit) → B3  sidebar + routes, then forms
Week 4   B4 → B5 → A7(1,2,3)         tables/pagination, search, quick role wins
Later    A7(4-7) → A8 → B6           bigger features, perf, polish
```

## The three overlaps — do these once, not twice

| Overlap | Merge |
|---|---|
| A5 reason dialogs ↔ B3 forms | Build `ReasonDialog` on shadcn primitives the first time |
| A6 route guards ↔ B2 sidebar | Both rewrite the nav table — extract one shared `routeConfig` and land them together |
| A1 vendor truncation ↔ B3/B4 | The searchable `Combobox` + `Pagination` *is* the fix, not a separate change |

## Verification, given there are no tests

Per phase, before committing:

1. `npm run build` and `npm run lint` clean
2. Log in as **all six roles** and walk each one's primary screen — this is the only real safety net
3. For Track B phases: screenshot in **light and dark** before and after
4. For A1/A3: verify against direct DB counts, and confirm the expected 403s actually 403

**Worth considering before Track B:** even a thin Playwright smoke test — log in as each role, load each landing screen, assert no console errors — would de-risk a 40-file UI migration far more than the time it costs. Right now every regression is caught by a human clicking, or not at all.
