# Role-by-Role System Audit — Round 2

**Date:** 3 August 2026
**Baseline:** commit `1595474` + 76 uncommitted working-tree changes
**Previous audit:** [ROLE_FEATURE_AUDIT.md](ROLE_FEATURE_AUDIT.md) (31 July 2026)
**Status:** Findings only — nothing changed.

---

## 0. What got fixed since 31 July (verified, not assumed)

Credit where it's due — most of the last audit's red findings are genuinely closed:

| Old finding | Status now |
|---|---|
| 2.1 Purchase-order workflow unreachable | **Resolved by removal.** `procurement.py` is now vendors-only with an honest docstring: the mess self-purchases, there is no PO. `Procurement.tsx`/`Inventory.tsx` deleted. Approvals rescoped to bill corrections + menu changes. |
| 2.2 Discounts impossible | **Fixed.** Dedicated `/guest-discounts` and `/member-discounts` pages on `bookings:approve`. |
| 2.3 Kitchen dashboard `/inventory` dead links | **Fixed.** All now route to `/stock` with intake state. |
| 2.4 Security Guard shown finance they can't use | **Fixed.** Dedicated `isSecurity` board — open incidents only. |
| 2.6 `/bookings/occupancy` ungated | **Partially fixed** — see 1.2 below. |
| 2.7 `check_mass_balance` stub | **Fixed by removal,** with a documented reason. |
| Kitchen: no expiry view, no tomorrow's headcount | **Fixed.** Both on the Kitchen dashboard. |

The two that did **not** move: route-level permission guards (2.5) and one-way directives.

---

## Part 1 — Broken or incorrect (verified in code)

### 🔴 1.1 The Kitchen NCO's meal numbers are silently wrong above 100 records/day

`GET /api/attendance` caps at `page_size: Query(25, ge=1, le=100)` ([attendance.py:104](../backend/routers/attendance.py#L104)).

The Kitchen dashboard drives **five** figures off that endpoint at `page_size=100`, unpaginated ([Dashboard.tsx:193-213](../src/pages/Dashboard.tsx#L193)):

- "Meals Booked Today" hero tile
- "Today's Meals by Type" donut
- "Tomorrow: N booked so far"
- all 7 bars of "Weekly Meal Volume"

A mess with 40 dining members eating 3 meals produces 120 rows/day. Every one of those numbers **silently truncates at 100 and reads low** — no error, no indicator. The Kitchen NCO plans purchasing off a number that under-reports as the mess grows.

There is no aggregate endpoint to use instead: `/attendance/summary` is per-member man-days for billing, not a daily headcount.

**Change needed:** add `GET /attendance/daily-counts?date_from=&date_to=` returning grouped counts, and point all five figures at it. Fixes the correctness bug and 1.3 at the same time.

### 🔴 1.2 The `/occupancy` PII fix wasn't applied to its three siblings

`/bookings/occupancy` was correctly gated on `bookings:view` ([bookings.py:1480](../backend/routers/bookings.py#L1480)). Three sibling endpoints return the **same class of data** and are still login-only:

| Endpoint | Exposes |
|---|---|
| `GET /bookings/rooms/{room_id}/calendar` | guest_name, **phone**, rank |
| `GET /bookings/availability` | guest_name, rank |
| `GET /bookings/calendar-summary` | guest_name, rank |

Any authenticated user — including a Security Guard, whose entire grant is `security:VC` — can enumerate guest names, ranks and phone numbers.

### 🔴 1.3 Wider pattern: financial and PII reads are login-only across five routers

The project's own standard (CLAUDE.md) is that reads carrying PII or financial data must be permission-gated. These aren't:

| Router | Endpoints | Data |
|---|---|---|
| `mess_billing` | `/bills`, `/guest-charges`, `/room-lease-dispatch`, `/bills/{id}/diet-invoice` | member name, rank, **service number**, amounts owed |
| `billing` | `/invoices/{id}/print-data`, `/payments/{id}/receipt-data`, `/dashboard-stats` | full bill, guest phone, revenue totals — and `{invoice_id}` is directly enumerable |
| `security` | `/logs`, `/incidents` | incident reports readable by every role |
| `attendance` | `""`, `/lookup`, `/attendees`, `/leaves` | member names, who ate what, leave records |
| `bookings` | the three in 1.2 | guest PII |

Every **write** path is correctly gated — this is a read-side gap only. The inventory/tariffs/rate-card GETs are defensible as reference data; the five above are not.

### 🔴 1.4 The branding endpoint is unauthenticated and takes a password in the URL

```python
@router.put("")
async def update_branding(data: BrandingConfig, password: str):
```
([branding.py](../backend/routers/branding.py))

No `Depends(get_current_user)` — no login required at all. And because `password: str` is a bare scalar on a request that already has a body model, FastAPI binds it as a **query parameter**: `PUT /api/branding?password=...`. That puts the shared branding password into access logs, browser history, and any proxy in front of the app.

**Change needed:** `Depends(get_current_user)` + `check_permission(user, "branding", "edit")`, and move the password into the body (or drop it — RBAC already covers this).

### 🟠 1.5 Vendors can be created but never edited — by anyone

`PUT /procurement/vendors/{id}` requires `procurement:edit`. Grepping `_ROLE_PERMISSIONS`: Manager `"V"`, Deputy `"V"`, Kitchen NCO `"VC"`. **No role holds `procurement:edit`.** The endpoint is unreachable, and there is no edit UI either — `StockManagement.tsx` only POSTs new vendors.

Practical effect: a mistyped vendor name is permanent, and a vendor can never be deactivated except through Import/Export. Either grant Kitchen NCO `"VCE"` or delete the endpoint.

### 🟠 1.6 Vendor dropdown truncates at 100

`api.get('/procurement/vendors?page_size=100')` ([StockManagement.tsx:439](../src/pages/StockManagement.tsx#L439)) with no pagination. Vendor 101 onward cannot be selected during stock intake. Same class of bug as 1.1 — a `page_size=100` treated as "all".

### 🟠 1.7 Clerk's "Outstanding to Collect" truncates at 100 bills

`api.get('/mess-billing/bills?page_size=100')` ([Dashboard.tsx:176](../src/pages/Dashboard.tsx#L176)) feeds the Clerk's headline outstanding figure. A month-end run for >100 members under-reports the money owed. This is the number the Clerk works from.

### 🟠 1.8 Routes are still completely unguarded

Unchanged from the last audit. [App.tsx:51-85](../src/App.tsx#L51) has no permission wrapper on any route; only the sidebar filters ([Layout.tsx:153](../src/components/Layout.tsx#L153)). Typing `/users` or `/audit-log` renders the page for anyone. The backend blocks the data so nothing leaks, but the user gets a broken page and error toasts instead of a clean "no access" screen.

**Change needed:** a `<RequirePermission module= action=>` route wrapper + a proper 403 page.

### 🟡 1.9 Four screens still use native `prompt()`

`ConfirmDialog.tsx` exists specifically because native dialogs "block the UI thread, can't be styled" — its own comment. Yet raw `prompt()` survives in:

- [Approvals.tsx:83](../src/pages/Approvals.tsx#L83) and [:111](../src/pages/Approvals.tsx#L111) — bill-correction and menu rejection reasons
- [Attendance.tsx:89](../src/pages/Attendance.tsx#L89) — backdated attendance correction reason
- [Members.tsx:128](../src/pages/Members.tsx#L128) — member status-change reason

All four are **audit-logged reason fields** — the highest-value text in the system, collected through the ugliest, least reliable input available. In a packaged desktop build (`packaging/installer.iss`) `window.prompt` may be suppressed by the host webview, in which case the reason returns null and the action silently aborts.

### 🟡 1.10 The generic operations dashboard reports a false "All collected ✓"

The fallback board at [Dashboard.tsx:503](../src/pages/Dashboard.tsx#L503) shows a "Bills To Settle" tile, but `/billing/desk` is only fetched when the user holds `billing:view` or `clerk_desk:view` ([:157](../src/pages/Dashboard.tsx#L157)). For any role without those, the list stays empty and the tile confidently reports **"All collected"**.

No built-in role reaches this board today (Booking NCO is bounced to `/bookings`), so it's dormant — but it's a live trap for the first cloned custom role. Either hide the tile when the data wasn't fetched, or delete the fallback board.

### 🟡 1.11 Dead file: `src/pages/Home.tsx`

Not imported anywhere. Same class of leftover that produced the `/inventory` dead links in the last audit.

### 🟡 1.12 CLAUDE.md is stale and will mislead contributors

It documents routers `recipes` and `menu_prices` and services `kitchen_deduction.py`, `recipe_costing.py`, `unit_conversion.py` — **none of which exist**. It omits `directives`, `rate_card`, and `mess_charge_calc.py`. Since CLAUDE.md is the file agents and new contributors read first, this actively misdirects.

---

## Part 2 — Role-by-role gaps

### Manager
| Missing | Why it matters |
|---|---|
| **Alert routing** | Still one global feed. Manager sees low-stock noise that belongs to the Kitchen NCO — who has no `alerts:view` at all and gets it via dashboard tiles instead. Route by module → role. |
| **Exception report** | Nothing surfaces "3 bills discounted this week", "2 guests overstayed". Oversight requires going looking. |
| **Staff-activity summary** | Audit Log is raw rows. No "who did what today". |
| **Period close** | Confirmed absent — no lock flag anywhere in `billing.py`/`mess_billing.py`. Last year's books are still editable. For a mess answerable to an audit board, this is the most consequential missing control in the system. |

### Deputy Manager
| Missing | Why it matters |
|---|---|
| **Hall double-booking check** | Still absent — [events.py:180](../backend/routers/events.py#L180) openly comments "no automated capacity/conflict check". Two events can be booked into the same hall on the same date. A date+hall overlap query is ~10 lines. |
| **Headcount vs. capacity validation** | `capacity` and `headcount` are both stored; nothing compares them. |
| **No kitchen visibility** | Deputy owns events end-to-end but has no `kitchen` permission, so can't see whether prep for their own event is on track. |
| **Can't send directives** | `directives: "V"` only. An acting Manager can't instruct anyone. |

### Clerk
| Missing | Why it matters |
|---|---|
| **End-of-shift cash summary** | `/billing/dashboard-stats` **already returns `payment_methods_today`** and the Clerk dashboard already fetches it — then never renders it. The data for a "cash / card / transfer, ready to hand over" tile is sitting in state unused. Cheapest high-value win in the audit. |
| **Daily granularity in Income & Cost** | `BillingReports.tsx` only offers `month | year`. A Clerk closing a shift can't get today. |
| **Receipt reprint history** | No "reprint Tuesday's receipt" path. |
| **Partial-payment plans** | Payments record, but no promised-date/instalment concept. |

### Kitchen NCO
| Missing | Why it matters |
|---|---|
| **Trustworthy meal counts** | See 1.1 — their primary planning numbers are wrong at scale. |
| **Alerts access** | Low-stock/expiry alerts are generated *for them* and delivered to the Manager. Compensated by dashboard tiles, but the alert feed itself remains inaccessible. |
| **Waste entry on the main path** | `WasteLog` exists and feeds the Manager's cost report, but recording waste isn't a prominent kitchen action — so the cost figure is only as good as an inconvenient habit. |
| **Theoretical vs. actual cost variance** | Procurement spend and mess income are both tracked; the *gap* is the single most useful kitchen number and nothing trends it. |

### Booking NCO
| Missing | Why it matters |
|---|---|
| **A shift briefing** | Lands on Bookings' Dashboard tab — a room grid, not "who's arriving, are their rooms ready, who hasn't shown". |
| **Returning-guest lookup** | No `guests:view` by design, so "has this officer stayed before?" is unanswerable at the desk. |
| **Housekeeping loop** | Can see rooms needing housekeeping; can't assign or mark done. |
| **Overstay prompt** | Overdue departures render on dashboards; the person who must chase them gets no alert. |

### Security Guard
| Missing | Why it matters |
|---|---|
| **Shift handover** | No "what happened last shift". |
| **Visitor/vehicle log** | Incident reports exist; routine gate logging doesn't — the actual minute-to-minute job. |

---

## Part 3 — Efficiency (measurable, not stylistic)

### 3.1 Kitchen dashboard: 9 HTTP requests for meal counts
[Dashboard.tsx:203-213](../src/pages/Dashboard.tsx#L203) fires **seven sequential-ish `/attendance` calls** — one per day — purely to draw a 7-bar chart, plus two more for today and tomorrow. The code comment admits the reason is the `page_size` cap. One grouped-count endpoint replaces all nine and fixes 1.1.

### 3.2 Reports: per-day query loops
[reports.py:122](../backend/routers/reports.py#L122), [:140](../backend/routers/reports.py#L140), [:181](../backend/routers/reports.py#L181) each loop day-by-day issuing separate queries — up to 90 round trips per chart. `anomaly_engine.py:_daily_spend_per_active_booking` does the same (2 queries × 90 days = 180). SQLite handles it locally, but each is one `GROUP BY date(...)` away from being a single query.

### 3.3 `/billing/desk` is unbounded with a per-booking fan-out
[billing.py:454](../backend/routers/billing.py#L454) loads **every** checked-in booking and **every** open invoice with no limit, then calls `_running_balance_payload()` per booking — which itself runs `_gather_unbilled_items()` plus an invoice query each time. Correct, but N+1 that grows with occupancy, and it's on the Clerk's hottest path.

### 3.4 Manager dashboard: 8 uncoordinated calls, no refresh
Five widgets each fetch independently (~8 requests), and **nothing on any dashboard polls**. Only the alert/directive badges refresh (30s). Two people working the same queue see divergent data until a manual reload. Kitchen page polls at 20s; Bookings polls — the dashboards don't.

### 3.5 `page_size=100` used as "fetch everything" in at least four places
Findings 1.1, 1.6, 1.7 plus `OccupancyWidget`'s `/bookings/rooms?page_size=200`. This is a recurring idiom worth a lint rule or a shared `fetchAll()` helper — every instance is a silent-truncation bug waiting for the mess to grow.

---

## Part 4 — Usability

- **Quick actions vanish on mobile.** Still `hidden sm:flex` ([Layout.tsx:282](../src/components/Layout.tsx#L282)). "New Booking" disappears exactly where a phone-carrying front desk needs it most.
- **No global search.** No `cmdk`/CommandDialog anywhere despite `cmdk` being a dependency. Finding a guest, member, room or bill requires knowing the module first. Every comparable PMS (Opera, Cloudbeds, eZee) puts one search box in the header — it is the single biggest ease-of-use gap.
- **No keyboard shortcuts** for high-frequency actions.
- **Two screens still carry too much.** `StockManagement.tsx` (947 lines, up from 860) and `Kitchen.tsx` (686 lines, 4 tabs) both mix daily operations with configuration. The Kitchen NCO running lunch service is one tab from menu pricing.
- **Directives are still one-way.** Manager → role, acknowledge only. No reply, no upward request. Since the Manager's whole job here is approvals, having **no inbound request channel** is structural: an urgent purchase or a member dispute has to be walked down the corridor. Reusing the Approvals inbox for a "raise a request" flow would close it.
- **No typed confirmation on large money actions** — nothing distinguishes writing off Rs 500 from Rs 500,000.

---

## Part 5 — Compared to established systems

What SAM does **better** than typical hotel PMS software: permission-by-job rather than by seniority; the audit trail with before/after JSON on every mutation; receipt OCR for stock intake; and rate cards that read through the same getters the pricing engine uses, so what a Manager sees is provably what a guest is charged. That last one is rarer than it sounds.

Where it's behind, and the gap is a real one for this deployment:

| Standard elsewhere | Here | Note |
|---|---|---|
| Night audit / period close | Absent (Part 2) | Universal in PMS. Highest-value missing control. |
| Global search | Absent | Universal. |
| Shift cashier report | Data exists, not rendered | Universal at any front desk. |
| Resource double-booking guard | Absent for halls | Rooms are guarded; halls aren't. |
| Route-level authorization | Menu-only | Standard. |
| Housekeeping assignment loop | Status only | Standard. |

Where SAM should **not** copy hotel software — worth stating so it isn't "fixed" by mistake: no channel manager, no OTA sync, no dynamic pricing, no loyalty program. The rate card is set by policy, not demand, and the guest list is a closed roster. The self-purchase model replacing purchase orders is likewise correct for a mess and should stay.

---

## Part 6 — Suggested order

**Fix first (correctness / security):**

| # | Fix | Effort |
|---|---|---|
| 1.1 | Daily-counts endpoint; repoint the 5 Kitchen figures | Small |
| 1.4 | Authenticate branding PUT; password out of the query string | Trivial |
| 1.2 | Gate the three booking-calendar endpoints | Trivial |
| 1.3 | Gate mess_billing / billing / security / attendance reads | Small |
| 1.7, 1.6 | Paginate or aggregate the two truncating fetches | Small |
| 1.5 | Grant `procurement:edit` or delete the endpoint | Trivial |
| 1.8 | Route permission wrapper + 403 page | Medium |
| 1.9 | Replace 4 × `prompt()` with `ConfirmDialog` | Small |
| 1.11, 1.12 | Delete `Home.tsx`; refresh CLAUDE.md | Trivial |

**Then (role gaps, ordered by value/effort):**

1. Clerk shift cash tile — data already fetched, purely a render (**~30 min**)
2. Hall conflict check — one overlap query
3. Alert routing by module → role
4. Booking NCO shift briefing
5. Two-way directives / request-to-Manager
6. Period close with a locked-books flag
7. Global search

**Then the smart layer:** meal forecasting (needs 1.1 first) → cost-variance trend → overstay prediction → guest recognition.

---

## One thing worth saying plainly

The last audit's headline was "the backend is ahead of the frontend." That's been closed — impressively, and mostly by *deleting* the speculative PO workflow rather than wiring it up, which was the right call.

The headline this round is different: **the system's numbers are quietly less reliable than its permissions.** The RBAC design remains excellent. But `page_size=100` is being used as "everything" in at least four places, and in the Kitchen NCO's case it corrupts the exact figure they use to decide what to buy. A wrong number that looks right is worse than a missing feature, because nobody goes looking for it.
