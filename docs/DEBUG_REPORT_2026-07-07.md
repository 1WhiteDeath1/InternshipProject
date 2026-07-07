# SAM Hotel & Mess — Debug & Hardening Report

**Date:** 2026-07-07
**Scope:** Full backend (FastAPI, ~6.4k LOC) + frontend (React/TS, ~4.7k LOC) audit, live extreme-dataset stress testing, bug fixes, and optimization review.
**Method:** Static read of every router/service/model/page → `tsc -b` build + `eslint` → live API stress harness on an isolated scratch DB (port 8001, never touched the real `hotel_mess.db`) covering boundary values, unicode/oversized payloads, invalid enums/dates, auth, SQL-injection literals, and a 15-thread concurrency race on a single stock batch.

---

## Summary

- **29-probe stress suite:** 28 pass, 1 "fail" that is a test-client URL-encoding artifact (the SQL-injection string was confirmed safe via a properly-encoded re-test — parameterized queries treat it as a literal).
- **Concurrency:** 15 simultaneous "issue 1 unit" requests against a 5-unit batch → exactly 5 succeeded, 10 rejected, final quantity `0`, never negative. The post-commit compensation pattern holds under load.
- **6 bugs found and fixed** (1 High, 2 Medium, 3 Low). All fixes verified live.
- No SQL injection, no auth bypass, no negative-stock race, no double-billing found. Validators (dates, discounts, consumer exclusivity, overpayment, duplicate keys) all hold.

---

## Bugs found & fixed

### 1. [HIGH] Every create/update endpoint returned an empty `{}` body
**Files:** `backend/database.py` (fix), root cause in `backend/audit.py:log_audit`
**Symptom:** `POST /attendance`, `/members`, `/inventory/items`, `/procurement/vendors`, `/recipes`, `/kitchen/orders`, etc. returned HTTP 200 with body `{}`.
**Root cause:** Endpoints do `db.commit(); db.refresh(obj)` and then call `log_audit(...)`, which runs its own `db.commit()`. With SQLAlchemy's default `expire_on_commit=True`, that second commit **expires every attribute** on the object the endpoint is about to return. FastAPI then serializes the expired instance by reading `__dict__` (no lazy reload) → `{}`.
**User-facing impact:**
- **Attendance → "Add guest meal"** was broken: `handleAddGuestMeal` reads `res.data.id` to post the follow-up `/{id}/mark`, but `id` was `undefined` → `/attendance/undefined/mark` → 422.
- **Kitchen → inline "Create new recipe"** couldn't auto-select the new recipe (`res.data.id` undefined).
- Every other create endpoint silently returned a useless body (latent API-contract bug).
**Fix:** Set `expire_on_commit=False` on `SessionLocal`. This is the idiomatic FastAPI/SQLAlchemy setting and fixes all endpoints at once. The negative-stock post-commit re-checks are unaffected because they call `db.refresh()` explicitly.
**Verified:** create_member/item/vendor now return populated bodies with `id`; guest-meal flow works end-to-end (attendance POST → id → mark = 200).

### 2. [MEDIUM] Malformed dates / invalid meal types returned raw HTTP 500
**Files:** `backend/schemas.py`, `backend/routers/attendance.py`, `backend/routers/kitchen.py`
**Symptom:** `GET /attendance/roster?date=not-a-date` → 500 (unhandled `ValueError` from `date.fromisoformat`); `POST /attendance` with `meal_type:"brunch"` → 500 (SQLAlchemy `Enum` rejected the value at flush — Pydantic typed the field as a bare `str` with no validation). Same 500s on `/kitchen/orders?date=…`, `/kitchen/orders/generate`, `/mess-billing/guest-charges`.
**Fix:** Added a shared `meal_type` field-validator to the four request schemas (`MealAttendanceBase`, `BulkAttendanceCreate`, `RosterSetRequest`, `GuestMealChargeCreate`) → clean 422; wrapped every `date.fromisoformat()` query-param parse in try/except → clean 400.
**Verified:** all five cases now return 400/422.

### 3. [MEDIUM] Mess-bill discount silently erased à la carte charges
**File:** `backend/routers/mess_billing.py:apply_discount`
**Symptom:** `apply_discount` recomputed `total_amount = base_menu − discount + stay + extra_meals`, **omitting `ala_carte_amount`**. A member who ordered à la carte items and then received any discount lost those charges from their bill total (under-billing).
**Fix:** Recompute now mirrors `generate_bills` exactly, including `+ ala_carte_amount`.

### 4. [LOW] `/api/health` was unreachable (shadowed by SPA fallback)
**File:** `backend/main.py`
**Root cause:** The catch-all `@app.get("/{full_path:path}")` (SPA fallback) was registered **before** `/api/health`. FastAPI matches routes in registration order, so `/api/health` returned `index.html` instead of `{"status":"ok"}`.
**Fix:** Registered the health route before the static mount/catch-all. (Other `/api/*` routers were already registered first, so only health was affected.)
**Verified:** `/api/health` now returns JSON.

### 5. [LOW] Clerk Desk balance preview didn't match the invoice it produces
**File:** `backend/routers/billing.py`
**Root cause:** `running-balance` (the preview card) summed **raw** menu prices, but `instant-checkout` scales meal-charge items by the client-category multiplier (`civilian_meal_multiplier` / `non_civilian_meal_multiplier`). With any multiplier ≠ 1.0, the total the clerk saw before checkout differed from the invoice actually charged.
**Fix:** Extracted a shared `_meal_multiplier(db, booking)` helper used by both paths; the preview now bakes the multiplier into `routine_meals`.
**Verified:** with multiplier 2.0, preview total (180.0) == invoice total (180.0).

### 6. [LOW] `PUT /settings/{key}` 404'd before the Settings page was ever opened
**File:** `backend/routers/settings.py`
**Root cause:** Default settings rows were seeded lazily **only** on `GET /settings`. A `PUT` before any `GET` hit a missing row → 404 (so a fresh deployment couldn't set a multiplier/rate until someone visited the Settings page).
**Fix:** Extracted `DEFAULT_SETTINGS` + `_seed_missing_settings(db)` (per-key seeding, so defaults added in later releases also appear), and call it from both GET and PUT.
**Verified:** PUT before any GET now returns 200.

---

## Reviewed and found correct (no change needed)

- **Concurrency / negative stock** — `inventory.create_movement`, `log_waste`, and `kitchen_deduction.deduct_recipe_stock` all use commit → `refresh` → compensate-and-reject. Held under a 15-thread race.
- **Double-booking guard** — pre-check + post-commit lowest-id re-check in `bookings.create_booking`.
- **Double-billing guards** — `invoiced_at` on `MealAttendance` / `KitchenOrder`; single-invoice-per-booking check.
- **Validators** — reversed/zero-night bookings (422), overpayment (400), discount rate>100 / both-fields (422), duplicate SKU/service-number (400/409), consumer-exclusivity on attendance & à la carte (422).
- **Auth** — no token / bad token → 401; login lockout after N attempts; supervisor-only routes gated.
- **Billing invoice discount** (`billing.py:apply_invoice_discount`) — correct; subtotal already includes all line items.

---

## Optimization opportunities (safe, not yet applied — no functional change)

These cost nothing in features and are low-risk, but were left out of this pass to keep the diff focused on correctness. Recommend as a follow-up:

1. **`reports.py` `revenue-trend` / `occupancy-trend`** issue one query per day (up to 365 round-trips). A single `GROUP BY date(created_at)` query would collapse each to one. Supervisor-only + capped, so not urgent.
2. **`billing.list_invoices`** triggers N+1 lazy loads (`inv.booking.room`, `inv.items`). Add `joinedload(Invoice.booking).joinedload(Booking.room)` + `selectinload(Invoice.items)`.
3. **Frontend bundle is 969 KB** (single chunk; Vite warns >500 KB). Route-level `React.lazy` code-splitting would cut initial load materially.
4. **9 eslint `react-hooks/exhaustive-deps` warnings** (fetch fns omitted from `useEffect` deps). Currently benign because the effects key on the real inputs, but wrapping fetchers in `useCallback` and listing them removes the footgun.

---

## Test artifacts

Stress harness (stdlib-only, isolated scratch DB): `scratchpad/stress_test.py`, `stress_test2.py`. Server bootstrap that repoints `config` paths so the real DB is never touched: `scratchpad/run_test_server.py`.
