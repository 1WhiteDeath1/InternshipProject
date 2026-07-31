# Role-by-Role System Audit — What Each Person Gets, What's Broken, What's Missing

**Date:** 31 July 2026
**Scope:** All five operating roles (Manager, Deputy Manager, Clerk, Kitchen NCO, Booking NCO) plus Security Guard
**Status:** Findings only — nothing has been changed.

---

## How to read this

This report is in six parts:

1. **What each role sees today** — the honest picture
2. **Things that are actually broken** — confirmed dead ends, verified in code
3. **Things each role is missing** — features their job needs but the app doesn't give them
4. **Opportunities to make the system smart** — where the app could think for itself
5. **Ease of use** — friction that slows people down
6. **A suggested order to fix things in**

Every finding in Part 2 was verified by reading the actual code, not guessed. File paths and line numbers are given so anything can be checked.

**The short version:** the permission design is genuinely excellent — better thought through than most systems of this size. But three important capabilities have been *given* to roles on paper and then have **no button anywhere in the app** to actually use them. The biggest is purchase orders: the entire buying workflow exists in the backend, works, and is unreachable.

---

## Part 1 — What each role actually sees today

### The permission model (the good news first)

Access is granted by **job, not by seniority**. A Manager is not "everyone's screens, read-only" — they get oversight and approvals and none of the day-to-day transaction screens. This is a deliberate, well-documented decision in [access.py:7-15](../backend/migrations/access.py#L7) and it's the right call. It keeps each person's screen short and stops seniors from accidentally doing juniors' work.

The six built-in roles are **code-managed** — edited in `_ROLE_PERMISSIONS` and re-applied on every startup. Hand-editing a built-in role in the Roles page gets silently reverted on restart.

### Role-by-role summary

| Role | Home screen | Menu items they see | Core job |
|---|---|---|---|
| **Manager** | Dashboard (4 widgets) | Approvals, Users, Roles, Audit Log, Alerts, Directives, Tariffs, Reports, Import/Export, Settings, Guests, Members, Events | Oversight, approvals, policy, admin |
| **Deputy Manager** | Dashboard (4 widgets) | Approvals, Directives, Tariffs, Reports, Settings, Events | Acting-manager oversight + owns Events |
| **Clerk** | Dashboard (4 money tiles) | Billing, Clerk Desk, Income & Cost, Members, Mess Billing, Events, Directives, Tariffs | All money, end to end |
| **Kitchen NCO** | Dashboard (5 tiles + 4 panels) | Inventory & Procurement, Members, Attendance, Kitchen, Events, Directives, Bookings | Food, stock, mess roster |
| **Booking NCO** | **Bookings** (no dashboard) | Bookings, Attendants, Members, Tariffs, Directives | Front desk |
| **Security Guard** | Dashboard (generic) | Security, Guests, Members, Attendants, Directives | Incidents and logs |

### What each dashboard actually shows

- **Manager / Deputy** — Revenue, Cost-vs-Revenue flow, Occupancy, Events. Four widgets, deliberately minimal.
- **Clerk** — Four number tiles only: Today's Collections, Month's Collections, Outstanding, Bills Pending. No charts, no lists. Very fast to read.
- **Kitchen NCO** — The richest board: Meals Booked, Special Orders, Orders in Kitchen, Orders Overdue, Low Stock, plus a weekly volume chart, a meal-type donut, the live kitchen queue, and a low-stock list.
- **Booking NCO** — **No dashboard at all.** Sent straight to Bookings, which has its own Dashboard tab.
- **Security Guard** — Falls through to a generic "operations" board (see the bug in Part 2).

---

## Part 2 — Things that are actually broken

These are confirmed, not theoretical. Each one was traced through the code.

### 🔴 2.1 The entire purchase-order workflow is unreachable

**This is the single biggest finding.**

The Kitchen NCO is granted `procurement: view + create` — they are meant to raise purchase orders. The Manager and Deputy are granted `procurement: approve` — they're meant to sign off on spending. The backend for all of this exists and works.

But the **only** screen in the whole app that creates a purchase order, adds a vendor, or runs a three-way match is [`src/pages/Procurement.tsx`](../src/pages/Procurement.tsx) — **525 lines that are never imported and have no route**. It is not in [App.tsx](../src/App.tsx). Nothing links to it. It cannot be opened.

What this means in practice:

- **Kitchen NCO cannot raise a purchase order.** Their `procurement: create` permission does nothing.
- **Vendors cannot be added or edited** anywhere except the Import/Export screen.
- **Three-way match** (PO vs delivery vs invoice) — a real fraud control — is unreachable.
- **The Manager's Approvals inbox will always show zero POs**, because no PO can ever be created. The Approvals screen queries `/procurement/purchase-orders?status=draft` and that list can only ever be empty.
- The sidebar says **"Inventory & Procurement"** but the page it opens (`/stock`) has only three tabs — Dashboard & Analytics, Daily Stock Intake, Current Stock. There is no procurement in it.

The Manager's most important power — approving spending — is connected to nothing.

> **Note:** `src/pages/Inventory.tsx` (322 lines) is dead in the same way — superseded by `StockManagement.tsx`. That one is harmless duplication. `Procurement.tsx` is not, because nothing replaced it.

### 🔴 2.2 Nobody can apply a discount or issue a complimentary bill

Discount authority was deliberately moved from the Clerk to the Manager — the Manager is now the *sole* person who can discount a bill. That's a sound policy decision.

But the two conditions needed to show the discount button can never both be true at once:

- The button renders only when `allowPayments && canDiscount` ([BillPrint.tsx:484](../src/components/BillPrint.tsx#L484))
- `canDiscount` requires `clerk_desk: approve` — **only the Manager has this**
- `allowPayments` is only set on Clerk Desk → Checkout and Mess-Only, both of which require `clerk_desk: view` — **the Manager does not have this**

So the Clerk can reach the screen but the button is hidden from them; the Manager has the right but cannot reach the screen. The Clerk Desk menu item doesn't even appear in the Manager's sidebar.

**Result: discounts and complimentary bills are impossible in the running app.** The backend endpoint works fine and is correctly guarded — there's just no way to press the button.

### 🔴 2.3 The Kitchen NCO's dashboard has three dead links

The Kitchen NCO's "Low Stock Items" tile, the "Inventory →" link, and every row in the low-stock list all navigate to `/inventory` ([Dashboard.tsx:339, 402, 406](../src/pages/Dashboard.tsx#L339)).

**`/inventory` is not a route.** The real path is `/stock`. All three land on the Not Found page.

This hits the Kitchen NCO on their main screen, on the tile most likely to be urgent. Almost certainly a leftover from when `Inventory.tsx` was routed.

### 🟠 2.4 The Security Guard's dashboard shows them things they can't use

The Security Guard has no billing, no bookings, and no clerk-desk access, so they fall through to the generic operations dashboard ([Dashboard.tsx:421](../src/pages/Dashboard.tsx#L421)). That board shows them:

- Rooms Occupied / Arrivals / Departures — all linking to `/bookings`, which they cannot use
- **"Bills To Settle"** — linking to `/clerk-desk`, which they cannot use

Worse, the bills figure is *silently wrong*. The billing data is only fetched if the user has billing or clerk-desk permission, so for a Security Guard the list stays empty and the tile confidently reports **"All collected ✓"** regardless of how much money is actually outstanding.

A guard needs a shift log, open incidents, and who's on the premises. They get a broken finance summary instead.

### 🟠 2.5 No permission checks on routes — only on menu items

The sidebar hides menu items a role can't use ([Layout.tsx:137](../src/components/Layout.tsx#L137)), but the routes themselves are completely open ([App.tsx:49-81](../src/App.tsx#L49)). Any logged-in user can type `/users` or `/audit-log` into the address bar and the page will render.

The backend correctly blocks the data, so **nothing leaks** — but the user gets a broken-looking page with error toasts instead of a clean "you don't have access to this" message. This also causes the confusing dead-ends in 2.3 and 2.4.

### 🟡 2.6 Guest names are readable by any logged-in user

`/bookings/occupancy` is guarded only by "are you logged in" ([bookings.py:1408](../backend/routers/bookings.py#L1408)) — not by any permission. It returns guest names, room numbers, and arrival/departure lists.

The project's own standard ([CLAUDE.md](../CLAUDE.md)) says reads carrying PII should be permission-gated. This one isn't. It's why the Security Guard's dashboard loads at all.

### 🟡 2.7 A stock-fraud check exists but does nothing

`check_mass_balance()` in [anomaly_engine.py:136](../backend/services/anomaly_engine.py#L136) is a stub that always returns zero. It's still wired into the checks that run. It's advertised as a control and delivers nothing — either build it or remove it so nobody relies on it.

---

## Part 3 — What each role is missing

### Manager

| Missing | Why it matters |
|---|---|
| **A way to actually approve spending** | See 2.1 — the Approvals inbox is permanently empty |
| **A way to apply a discount** | See 2.2 |
| **Alerts aren't routed to anyone** | Alerts are one global list. The Manager sees *all* of them including low-stock — noise that belongs to the Kitchen NCO |
| **No staff-activity view** | Audit Log exists but is raw. No "who did what today" summary — the natural oversight question |
| **No exception report** | Nothing surfaces "3 bills discounted this week", "2 guests overstayed", "5 POs pending 4+ days". The Manager must go looking |
| **No period close** | Nothing marks a month as finalised. Books stay editable forever |

### Deputy Manager

| Missing | Why it matters |
|---|---|
| **No alerts at all** | Deliberate (no logs/PII), but it means a stand-in Manager is blind to every operational warning |
| **Owns Events but can't see the kitchen** | Deputy creates events and sets headcount; Kitchen NCO cooks them. Deputy has no `kitchen` access, so they can't see whether prep is on track |
| **No hall double-booking check** | Explicitly noted in [events.py:181](../backend/routers/events.py#L181) — two events can be booked into the same hall at the same time with no warning |
| **Can't send directives** | Only the Manager can. An acting Manager can't instruct anyone |

### Clerk

| Missing | Why it matters |
|---|---|
| **No discount button** | See 2.2 — the one action most often needed at a front desk |
| **No end-of-shift cash summary** | The Clerk handles cash all day and there's no "what I collected, by payment method, ready to hand over" report to close on |
| **No receipt reprint history** | No easy "reprint that receipt from Tuesday" |
| **Can't see bookings** | Deliberate, and defensible — but when a guest disputes a rate, the Clerk can only see what Checkout chose to show them |
| **No partial-payment plan** | Payments are recorded, but there's no concept of an agreed instalment or a promised date |

### Kitchen NCO

| Missing | Why it matters |
|---|---|
| **Can't raise a purchase order** | See 2.1 — this is their job and it's impossible |
| **No alerts access** | Low-stock and expiry alerts are *generated for them* and delivered to the Manager instead. They only find out via a dashboard tile — which is a dead link (2.3) |
| **No expiry view** | The backend checks expiring stock; there's no screen listing what's about to go off |
| **No tomorrow's-headcount view** | They see today's meals booked. They cook for tomorrow. The forward number is the useful one |
| **No waste entry on the main path** | Waste logs exist in the model and appear in the Manager's report, but recording waste isn't a prominent kitchen action |

### Booking NCO

| Missing | Why it matters |
|---|---|
| **No dashboard of their own** | Every other role got a tailored board; the front desk — arguably the most time-pressured — got none. They land on Bookings' Dashboard tab, which is a room grid, not a shift briefing |
| **No arrivals checklist** | No "who's coming today, are their rooms ready, who hasn't turned up yet" as a working list |
| **Can't look up a returning guest** | No `guests: view` by design, so no history — "has this officer stayed before, any notes?" is unanswerable |
| **No housekeeping loop** | They can see rooms needing housekeeping but there's no way to assign it or mark it done |
| **No overstay prompt** | Overdue departures show on other boards; the person who must act on them has no alert |

### Security Guard

| Missing | Why it matters |
|---|---|
| **A dashboard that fits their job** | See 2.4 — currently shows finance |
| **No shift handover** | No "here's what happened on the last shift" |
| **No visitor/vehicle log** | Incident reports exist; routine gate logging doesn't |

---

## Part 4 — Where the system could get smart

The app already has real intelligence: receipt OCR for stock intake, price memory that autofills purchase orders, margin alerts, and statistical anomaly detection (z-score on spend, Benford's law on invoice digits). That's a strong base. These build on it.

### High value, low effort

1. **Route alerts to the role that can act.** Alerts are one undifferentiated list. Low stock → Kitchen NCO. Unbilled stay → Clerk. Overdue departure → Booking NCO. Anomalies → Manager. This makes existing alerts useful instead of noisy, and it's mostly a filter on an existing feed.

2. **Forecast tomorrow's meal count.** Attendance history plus current occupancy plus tomorrow's arrivals gives a defensible "cook for ~N". Directly reduces food waste — the thing the Manager's waste report is already measuring.

3. **Auto-suggest reorders.** Stock levels, reorder points, and purchase frequency are all already recorded, and price memory already knows the usual vendor and price. A one-click "raise this PO" draft is a small step from data the system holds. (Needs 2.1 fixed first.)

4. **Warn on double-booked halls.** A date-range overlap check on events. Trivial to add, prevents a genuinely embarrassing failure.

### Medium effort, high payoff

5. **Predict overstays.** Guests who overstay usually share a pattern (indefinite bookings, certain duty types). Flagging likely overstays a day early lets the front desk confirm instead of chase.

6. **Occupancy forecasting.** Booking history and seasonality give a 7-day room-demand view — useful for both staffing and food ordering.

7. **Smarter cost control.** The system computes theoretical food cost per menu item and knows actual stock consumed. The *gap* between them is the single most useful kitchen number and nothing currently surfaces it as a trend.

8. **Guest recognition.** CNIC/phone identity already links stays. "This officer has stayed 6 times, always requests a ground-floor room" is a small feature that makes the mess feel well-run.

### Worth considering

9. **Natural-language reporting.** "How much did we spend on vegetables in June?" answered from the existing report endpoints.
10. **Two-way directives.** See Part 5.
11. **Automatic month-end close** with a locked-books flag.

---

## Part 5 — Ease of use

### Directives only flow one way

Directives are Manager → role, with acknowledgement ([directives.py](../backend/routers/directives.py)). Nobody can reply, and nobody can raise anything upward.

So when the Kitchen NCO needs a decision — an urgent purchase, a menu problem, a member dispute — the system has no channel for it. They have to walk down the corridor. Since the Manager's job is defined here as approvals and oversight, the *absence of an inbound request channel* is a structural gap, not a nice-to-have. A simple "raise a request → Manager approves/declines" flow would close it, and would reuse the Approvals inbox that already exists.

### Two screens carry too much

- `StockManagement.tsx` — 860 lines, 3 tabs
- `Kitchen.tsx` — 686 lines, 4 tabs (Meal Service, Production, Mess Charges, Menu)

Both mix daily operations with configuration. The Kitchen NCO doing a lunch service shouldn't be one tab away from menu pricing. Worth splitting the "do the work now" tabs from the "set things up" tabs.

### Smaller friction points

- **Quick actions are hidden on mobile.** The top-bar shortcuts are `hidden sm:flex` ([Layout.tsx:263](../src/components/Layout.tsx#L263)) — they vanish on phones, which is where a fast "New Booking" button is most valuable.
- **Nothing auto-refreshes except badges.** Alert and directive counts poll every 30 seconds; dashboards and queues don't. Two people working the same queue will see stale data.
- **No global search.** Finding a guest, member, room, or bill means knowing which module to open first.
- **No keyboard shortcuts** for the highest-frequency actions.
- **No confirmation on the big money actions** beyond standard dialogs — no "you're about to write off Rs 40,000, type the amount to confirm".
- **Dead code confuses navigation.** `Inventory.tsx` and `Procurement.tsx` sitting unrouted in `pages/` is very likely how the `/inventory` dead link (2.3) survived.

---

## Part 6 — Suggested order

### Fix first — things that are broken

| # | Fix | Effort |
|---|---|---|
| 2.1 | Route the Procurement page; add it to Inventory & Procurement | Small — the page already exists |
| 2.3 | Change `/inventory` → `/stock` in Dashboard (3 places) | Trivial |
| 2.2 | Give the Manager a path to the discount action | Small |
| 2.4 | Build a Security Guard dashboard, or hide the finance tiles from them | Small |
| 2.5 | Add permission guards to routes with a proper "no access" screen | Medium |
| 2.6 | Permission-gate `/bookings/occupancy` | Trivial |
| 2.7 | Implement or remove `check_mass_balance` | Small either way |

### Then — fill the role gaps

| # | Add | For |
|---|---|---|
| 1 | Route alerts to the role that can act | Everyone |
| 2 | Booking NCO dashboard (arrivals, room readiness, overstays) | Booking NCO |
| 3 | Alerts access + expiry view | Kitchen NCO |
| 4 | End-of-shift cash summary | Clerk |
| 5 | Two-way directives / request-to-Manager | Everyone |
| 6 | Hall double-booking check | Deputy |

### Then — the smart layer

Meal forecasting → auto-reorder suggestions → overstay prediction → cost-variance trend → guest recognition.

---

## One thing worth saying plainly

The permission model here is unusually well designed. The comments in `_ROLE_PERMISSIONS` explain not just *what* each role can do but *why*, and the "access follows the job, not the rank" principle is applied consistently. That thinking is the reason this audit could be done confidently at all.

The problem is not the design — it's that three of those carefully-reasoned permissions (`procurement: create`, `procurement: approve`, `clerk_desk: approve`) currently lead nowhere in the interface. The backend is ahead of the frontend. Closing that gap is mostly wiring, not new work, and it would unlock the Manager's approval role and the Kitchen NCO's buying role in one go.
