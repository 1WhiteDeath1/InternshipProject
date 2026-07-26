# Module Reference: Guests, Attendants, Members, Bookings, Billing, Clerk Desk, Attendance, Kitchen, Mess Billing

Technical reference for these 9 modules — what each contains, its workflow, and how it connects to the others. For general architecture (stack, auth, RBAC, audit logging) see `CLAUDE.md` at the repo root. This doc is implementation-level (models, endpoints, FKs), not product-level — for the pitch/problem-statement framing see `docs/PROJECT_DOCUMENT.md`.

## Guests
**Models**: `Guest` (id, full_name, phone, id_type, id_number, unit_address) — pure identity dedup, no billing fields.
**Backend**: `backend/routers/guests.py` — `GET /guests/search?q=` (substring match on name/phone/id_number, capped 8, ordered by recency).
**Connects to**: `Booking.guest_id` (nullable FK) — set by `_find_or_create_guest` in `bookings.py` on every booking creation (match by id_number, then phone; else create). Powers the check-in form's name/CNIC autocomplete. Guest has no FK back to Booking — one-directional.

## Attendants
**Models**: `Attendant` (id, name, shift, is_active, `on_duty`, `on_duty_since`).
**Backend**: `backend/routers/attendants.py`; `PUT /attendants/{id}/duty` for clock-in/out.
**Connects to**: `Room.attendant_id` (default/current housekeeper for a room) and `Booking.attendant_id` (snapshot of who was responsible during that specific stay — kept separate so reassigning a room later doesn't rewrite history). `on_duty` drives on-duty-first grouping in attendant pickers across the Bookings module.

## Members
**Models**: `Member` (id, service_number, full_name, rank, unit, `mess_category` [officers/jcos/ors], `client_category`, `is_womens_bloc`, `custom_discount_rate`, status).
**Backend**: `backend/routers/members.py` — list/search, `GET /members/{id}` (detail), `GET /members/{id}/residencies` (HRA booking history), status change.
**Frontend**: `Members.tsx` (roster + CRUD + Women's Bloc rate admin dialog), `MemberLedger.tsx` (`/members/:id` — Room Allocation + Dining tabs).
**Connects to**: `Booking.member_id` (set when a permanent resident occupies a room, `nature_of_duty="hra"`) → drives HRA rate lookup in `room_pricing.py` and monthly charge in Mess Billing. `MealAttendance.member_id` → drives man-days for Mess Billing and Kitchen production. `is_womens_bloc` branches which rank-rate table (`HraRankRate` vs `WomensBlocRankRate`) is used.

## Bookings
**Models**: `Room` (room_number, room_type, status, housekeeping_status, ac_count, attendant_id), `Booking` (room_id, guest_id, member_id, check_in/check_out, status [pending/confirmed/checked_in/checked_out/cancelled/no_show], `nature_of_duty` [visit/leave/official_duty/hra], client_category, stay_type, rank, da_multiplier, rate_breakdown JSON, `source` [walk_in/online] + `online_voucher_no`, `advance_payment_amount` + `advance_paid_at` — online bookings pay the room charge in full, in advance, outside SAM; mess still bills normally at checkout regardless of source).
**Backend**: `backend/routers/bookings.py`; pricing engine in `backend/services/room_pricing.py` (`compute_booking_price`, `reprice_for_departure`, rate tables: `RoomRate`, `DutyRate`, `HraRankRate`, `WomensBlocRankRate`, `HraUtilityRate`, `TariffRate`).
**Workflow**: create/quote booking → room assigned → check-in (status→checked_in) → stay → check-out reprices actual nights stayed (folio practice) except HRA (bills monthly instead, never per-stay).
**Connects to**: Guest (identity), Member (HRA residents), Attendant (room service), Billing (checkout consumes Booking + its charges), Mess Billing (`_hra_charge_and_renew` reads `Booking.nature_of_duty=="hra"` rows monthly), Attendance (`MealAttendance.booking_id` for room guests' meals).

## Billing
**Models**: `Invoice` (booking_id, `bill_type` [room/mess/combined], status, amounts), `InvoiceItem`, `BookingCharge` (booking_id, head, amount, `is_mess_charge` flag).
**Backend**: `backend/routers/billing.py` — `POST /bookings/{id}/instant-checkout` (atomic: frees room, reprices, gathers unbilled room+mess items via `_gather_unbilled_items`, issues invoice(s) — **no draft/lock state, checkout=settling the bill everywhere**, no standalone check-out-only endpoint exists), `GET /bookings/{id}/running-balance` (live preview, same gather logic so preview==invoice), `GET /bookings/{id}/master-invoice` (merges room+mess invoices into one printable doc), `GET /invoices/{id}/print-data`.
**Connects to**: Bookings (1 stay → up to 2 Invoices, room+mess, generated together or deferred separately), Kitchen/Attendance (unbilled `MealAttendance`/`KitchenOrder` rows feed the mess side of a guest's bill), Clerk Desk (the UI that drives this).

## Clerk Desk
**Not a data model** — a worklist view over Billing + Bookings + Mess Billing.
**Backend**: `GET /billing/desk` — checked-in non-HRA bookings + `unsettled_invoices` (live invoices with money owing). Deliberately does NOT surface a "checked out but still unbilled" state — checkout (`instant-checkout`) always bills everything owed in one shot (walk-ins pay room+mess together on the spot; online guests prepaid the room in advance, so only mess is due at checkout), so there's no legitimate gap to worklist there; a booking only reappears after checkout via `unsettled_invoices` if its bill was generated but not fully paid. `GET /billing/mess-only-desk` — walk-in (no room booking) guests with unbilled meals. Member billing reuses the `/mess-billing/*` endpoints (see Mess Billing below) — Clerk Desk adds no endpoints of its own for that side.
**Frontend**: `src/pages/clerk-desk/` — `ClerkDeskLayout.tsx` (shared data fetch for the desk/mess-only/member-bill feeds + the tab strip) wraps four tabs, no dashboard/overview tab (the Clerk's headline numbers live on the main `/dashboard` page instead, see below): `LiveGuests.tsx` (checked-in, folio still accruing, the only place `CheckoutSheet.tsx` is opened from), `Checkout.tsx` (settle queue over already-generated `unsettled_invoices` only → `BillPrintView`/`MasterInvoiceView` from `BillPrint.tsx`), `MessOnly.tsx` (walk-in guests, generates a mess-only invoice), `Members.tsx` (the monthly member mess-bill workflow, merged in from the old standalone Mess Billing page — card grid grouped Newly Generated/Issued/Paid, issue/mark-paid/discount/print actions, a read-only guest-meal-charges panel). Payment collection for guest stays happens entirely here; the Billing page is history/search only. Members.tsx intentionally excludes bill *generation* and guest-charge *logging* — Clerk holds `mess_billing` view/edit/approve but not create, so those two stay Booking NCO's job on the standalone Mess Billing page (see below); Clerk Desk's Members tab picks up from the drafts Booking NCO's Generate Bills produces.
**Dashboard**: the Clerk's own `/dashboard` view (`src/pages/Dashboard.tsx`, `isClerk` branch) is a deliberately compact, single-screen "financial pulse" — four large hero tiles only (today's/month's collections, outstanding across room+mess+member billing, count of bills pending action), each linking into Clerk Desk for the actual detail. No charts, lists, or breakdowns on the face.
**Connects to**: Bookings (source of truth for who to bill), Billing (the actual checkout action), Guests (display names), Mess Billing (Members tab operates the same `MessBill` rows Booking NCO generates).

## Attendance
**Models**: `MealAttendance` (member_id **or** booking_id — exactly one, date, meal_type, `status` [booked/attended/cancelled/excluded/no_show], recipe_id), `MemberLeave`.
**Backend**: `backend/routers/attendance.py` — book/mark/roster endpoints, `GET /attendance/lookup` (omnibar search), `POST /attendance/serve` (idempotent create-or-confirm), `POST /attendance/no-show-sweep` (manual — no scheduler in this app).
**Workflow**: a person books/is served a meal for a date+meal_type → status flows booked→attended, or booked→no_show if never served past the meal window+grace.
**Connects to**: Members and Bookings (the two possible owners of a row), Kitchen (`_aggregate_suggestions` groups booked/attended rows by recipe to generate production orders), Mess Billing (`get_man_days` counts ATTENDED+NO_SHOW rows for the per-head rate), Billing (guest-linked rows in `booked/attended/no_show` bill at guest checkout).

## Kitchen
**Models**: `Recipe`, `RecipeIngredient` (draws from `InventoryItem`), `MenuPrice` (guest-facing flat price per recipe), `KitchenOrder` (routine + à la carte, status pending→prepared/cooking→served, `is_ala_carte`, member_id/booking_id for à la carte consumer).
**Backend**: `backend/routers/kitchen.py` — `GET /suggested-orders` (from Attendance), `POST /orders/generate` (promotes suggestions to KitchenOrders), prepare/cook/serve/à-la-carte lifecycle; stock deduction via `backend/services/kitchen_deduction.py`; theoretical costing via `backend/services/recipe_costing.py` (feeds `check_recipe_margins` in `backend/alerts.py`).
**Connects to**: Inventory (ingredient stock, deducted on cook), Attendance (production input), Billing/Mess Billing (`KitchenOrder.food_cost`/à la carte charges feed both guest invoices and member `MessBill.ala_carte_amount`).

## Mess Billing
**Models**: `MessBill` (member_id, month, year, man_days, per_head_rate, `base_menu_amount`, `stay_amount` [room/HRA side], `extra_meals_amount`, `ala_carte_amount`, discount fields, total_amount, status [draft/issued/paid]), `GuestMealCharge` (member-sponsored guest meals).
**Backend**: `backend/routers/mess_billing.py` — `POST /generate?month=&year=` (`mess_billing:create` — one MessBill row per active member per period; `stay_amount` = non-HRA booking totals + `_hra_charge_and_renew` HRA/Women's-Bloc figure; dining = attendance-derived per-head rate + extras + à la carte), `POST /issue-all` / `POST /bills/{id}/issue` / `POST /bills/{id}/apply-discount` (`mess_billing:approve`), `POST /bills/{id}/mark-paid` (`mess_billing:edit`), `POST /guest-charges` (`mess_billing:create`), `GET /room-lease-dispatch` (Pipeline A — aggregate stay_amount across members, HRA vs Women's Bloc subtotal), `GET /bills/{id}/diet-invoice` (Pipeline B — dining-only, excludes stay_amount). `GET /bills` also returns each bill's member "type" (`member_rank`, `member_mess_category`, `member_is_womens_bloc`, `member_service_number`), joined in for display — Clerk Desk's Members tab is the main consumer.
**Frontend**: two entry points over the same data, split by the `mess_billing` create/edit-approve permission split — `src/pages/MessBilling.tsx` (Booking NCO: generate the period's bills, log sponsored guest meal charges) and Clerk Desk's `Members.tsx` (Clerk: issue/collect/discount/print what Booking NCO generated). Clerk no longer sees `MessBilling.tsx` in the sidebar (`Layout.tsx` hides it whenever the user also holds `clerk_desk:view`) even though they retain `mess_billing:view` — that permission is what makes their own Members tab work.
**Connects to**: Members (billed entity), Bookings (HRA + non-HRA booking totals), Attendance (man-days), Kitchen (à la carte cost).

---

## Two end-to-end pipelines

**Guest stay** (transient, per-visit): Guest → Booking (room, non-HRA) → check-in → Attendance rows (meals) → Kitchen produces from them + BookingCharges accrue → check-out via Clerk Desk → Billing instant-checkout gathers everything unbilled → Invoice(s) issued. Settles once, at checkout.

**Member residency** (recurring, monthly): Member → Booking (`nature_of_duty="hra"`, no per-stay bill) + Attendance rows (meals) → Kitchen produces from them → month-end Booking NCO runs `POST /mess-billing/generate` (own standalone page) which aggregates HRA/Women's-Bloc room charge (`stay_amount`) + dining (attendance × per-head rate + extras + à la carte) into one draft `MessBill` per member → Clerk picks the drafts up in Clerk Desk's Members tab to issue/collect/discount → optionally split for output only via Room-Lease Dispatch (org) / Diet Invoice (individual). Never touches guest `Invoice`.

---

*Written 2026-07-20, updated 2026-07-23 for the Clerk Desk restructure (Overview tab removed in favour of the compact /dashboard view; Members tab absorbed the Mess Billing workflow; online-booking advance payments auto-credited at checkout; the "checked out but still unbilled" worklist removed since checkout always bills everything owed in one shot). Update this file (not just memory) when any of the 9 modules above change shape — this is the doc a cold-start future agent should read first for this cluster.*
