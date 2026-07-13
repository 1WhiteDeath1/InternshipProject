# Handoff: Booking module rebuild + HRA monthly billing

Context for picking this work up in a new session/agent. Written 2026-07-09 on branch `feature/booking-hra-billing` (commit `8dfbd8b`), pushed to `origin`. `master` is untouched — this branch is ready for review/merge whenever.

## What this is

SAM Hotel & Mess Management System, built for a real Army officers' mess (stamp reads "EME Officers Mess"). Two pieces of work landed in this branch:

1. **Room-first booking module rebuild** — replaced a top-level "New Booking" dialog with a room-card-driven flow.
2. **HRA (Hostel Rent Allowance) monthly billing** — a previously-nonexistent billing system for permanent resident officers, built from a photographed rate card and booking register the user supplied.

See `CLAUDE.md` at the repo root for the general architecture (FastAPI + React/Vite, SQLite, RBAC, audit logging) — this doc only covers what's new.

## 1. Booking module rebuild

**Why**: the old flow was a single dialog (dates → room-picker grid → guest fields) disconnected from the room grid and its detail sheet. User wanted booking creation to happen *by clicking a room*, and the Bookings section split into three focused pages.

**Structure** (`src/pages/Bookings.tsx` is now a thin shell; real logic lives in `src/pages/bookings/`):
- `Bookings.tsx` — 3-tab shell (Dashboard / Rooms / 7-Day Overview), no top-level booking button.
- `DashboardTab.tsx` — KPIs, today's arrivals/departures (one-click check-in/out), housekeeping queue, and the searchable/cancel/no-show bookings table (this is where the old flat "Bookings" tab's functionality moved to).
- `RoomGridTab.tsx` — the actual booking surface. Floor-grouped cards with a control bar: **Instant Check-In** (today's real state) vs **Future Booking** (pick a date range, calls `/bookings/availability` with `include_booked=true`, dims conflicting rooms with a "Reserved" badge). Plus Sort By (availability/room number/room type, applied *within* each floor group) and a Hide Unavailable checkbox.
- `RoomSection.tsx` — the click-through panel (a Sheet), and the biggest file. Three sections: photo strip (upload/delete, served from `/uploads/rooms/...`), current/arriving guest card, and a month calendar. **New bookings are created here** via an inline form that auto-expands when the room is free (secondary button otherwise) — no separate dialog exists anymore. Clicking a free calendar day sets it as check-in while the form is open.
- `TimelineTab.tsx` — new 7-day Gantt-style grid, floor-grouped, from `GET /bookings/timeline`.
- `shared.ts` / `badges.tsx` — shared types/constants and badge components (`StatusBadge`, `HousekeepingBadge`, `HraBadge`) split out because ESLint's fast-refresh rule forbids mixing component and non-component exports in one file.

**New backend surface** (all in `backend/routers/bookings.py`):
- `POST/DELETE /bookings/rooms/{id}/photos` — multipart upload, saved to `backend/uploads/rooms/{id}/`, served statically at `/uploads/...` (mounted in `backend/main.py`, also proxied in `vite.config.ts` for dev).
- `GET /bookings/availability` gained an optional `room_id` filter — reused as a single-room live price quote instead of a separate endpoint.
- `GET /bookings/timeline?days=7` — per-room, per-day derived state in one query.
- `GET /bookings/occupancy` extended with `arrivals`/`departures`/`housekeeping_queue` lists (was counts-only).

**Key architectural rule already established and preserved**: occupancy is *derived* from bookings + today's date via `_derived_states()`, never trusted from a stored `Room.status` column (only `maintenance` is a real stored flag). Any new feature touching room state should keep following this — see the docstring at the top of `backend/routers/bookings.py`.

**Deliberately deferred** (flagged, not forgotten): extend-stay and room-transfer actions. `GuestMovement` already has a `room_change` type waiting for it, but `update_booking` doesn't currently re-price on a date change, so building this needs a bit more thought.

## 2. HRA monthly billing

**Why**: audited the codebase and found "HRA" (nature_of_duty option on a booking) was a complete no-op — `compute_booking_price`'s `hra_monthly` branch never computed a number, so every HRA booking billed at Rs 0, forever, with no rate tables and no monthly billing mechanism anywhere.

**Source of truth**: the user photographed the mess's actual rate card and booking register. The real figures (now in `backend/services/room_pricing.py` as `DEFAULT_HRA_RANK_RATES`/`DEFAULT_HRA_UTILITY_RATES`):
- HRA by rank: Capt 8,755 · Maj 12,288 · Lt Col/Col 15,325 · Brig 15,758 · Maj Gen 17,469 (monthly).
- Room utility charge by class: VIP 22,500 · Suite 1×AC 25,500 · Suite 2×AC / DG Suite 29,500 (monthly).
- A resident's monthly charge = rank rate + room utility rate. Full context on the mess's guest categories/register fields is in the auto-memory file `army-mess-domain-context.md` (Claude's persistent memory, not in this repo).

**Design decisions** (read these before changing anything — they're not obvious from the diff alone):
- **Reused `MessBill.stay_amount`**, not a new bill type — the mess already runs `POST /mess-billing/generate` monthly, and the code's own old comment already intended HRA to land there.
- **"Indefinite residency" is modeled as a rolling ~365-day booking window, not a schema change.** `Booking` still requires a bounded `check_in`/`check_out` everywhere (overlap checks, timeline, availability all depend on this). An HRA booking gets `check_out = check_in + 365 days` set server-side in `create_booking` (client's chosen date is ignored). **Renewal is a side effect of billing**: `mess_billing.generate_bills` → `_hra_charge_and_renew()` pushes `check_out` another 365 days forward if it's within 60 days of the billing period's end. So as long as the mess keeps running its normal monthly billing routine, the room never silently reverts to bookable. If billing genuinely stops for over a year, the residency lapses safely instead of staying phantom-occupied.
- **HRA requires a linked `Member`** (`member_id` mandatory, 404/400 if missing or inactive) and prices off `member.rank`, not a free-typed booking field — so a roster rank correction automatically fixes future bills.
- **Rooms without an HRA-rate-card entry** (e.g. a generic `deluxe`/`double`/`suite` room type, as opposed to `vip`/`suite_1ac`/`suite_2ac`/`dg_suite`) don't error — `compute_booking_price` returns `monthly_total: null` with a clear `note` explaining no rate was found, shown in the booking form's quote line. This is a real, permanent limitation of the source rate card (it only prices VIP/Suite/DG rooms for HRA), not a bug — don't "fix" it by inventing rates that aren't on the card.
- Mattress fees don't apply to HRA (a per-night guest charge; residents' utilities are already flat monthly).

**Files touched**:
- `backend/models.py` — `HraRankRate`, `HraUtilityRate` (new tables).
- `backend/services/room_pricing.py` — new rate constants/lookups (`get_hra_rank_rate`, `get_hra_utility_rate`, `hra_rank_to_band` — note this uses **finer-grained** bands than the existing `DutyRate`'s `rank_to_band`, since HRA prices Capt vs Maj separately where DA duty rates merge them), and the fixed `hra_monthly` pricing branch.
- `backend/routers/bookings.py` — `create_booking`'s HRA validation + checkout override; `nature_of_duty` now exposed on `list_rooms`/`/calendar` responses for frontend badging.
- `backend/routers/mess_billing.py` — `_hra_charge_and_renew()` helper + wiring into `generate_bills` (careful: the pre-existing short-stay `member_bookings` sum now explicitly excludes `nature_of_duty == "hra"` bookings to avoid double-counting a resident's move-in month, since their stored `total_amount` is now a nonzero snapshot).
- `backend/routers/members.py` — `list_members` now derives and returns `current_room_id`/`current_room_number` from each member's active HRA booking (not a stored column — same "derive, don't cache" rule as room occupancy).
- `backend/seed_demo.py` — seeds the new rate tables + one demo HRA resident (Brig Nasir Iqbal, `Suite-B`, checked in since 2026-01-15).
- Frontend: `HraBadge` in `badges.tsx`, shown on room cards (`RoomGridTab.tsx`) and the panel (`RoomSection.tsx`); the inline booking form swaps the check-out date picker for a static "ongoing residency" note and requires a member when HRA is selected; `Members.tsx` gained a "Current Room" column.

## Verified end-to-end this session

- `tsc -b`, `eslint`, `npm run build`, and `python -c "from backend.main import app"` all clean.
- curl: HRA booking without `member_id` → 400; with one → succeeds, `check_out` auto-set ~1 year out; pricing quote for Brig on Suite-B = Rs 45,258 = 15,758 + 29,500 (verified arithmetic).
- `mess-billing/generate` for the seeded resident produced the correct `stay_amount`; re-running it ~11 months later confirmed the renewal pushed `check_out` from `2027-01-15` → `2028-01-15`.
- In-browser (via the Claude Code preview tools): room-first booking flow, Instant/Future mode toggle, HRA badge rendering, the booking form's member-required gating, and the Members page's current-room column all confirmed working.
- One seed-data bug caught and fixed during verification: the demo HRA resident was initially placed in a generic `suite`-type room with no HRA rate-card entry (silently priced at Rs 0 utility) — moved to `Suite-B` (`suite_2ac`, a real rate-carded type).

## Not yet done / worth knowing

- No PR opened yet — branch is pushed, GitHub offered a compare link: `https://github.com/1WhiteDeath1/InternshipProject/pull/new/feature/booking-hra-billing`.
- Extend-stay / room-transfer (see "Deliberately deferred" above).
- `docs/PROJECT_DOCUMENT.docx` / `.md` in the repo root's `docs/` folder are **pre-existing, untracked, and unrelated** to this work — they were deliberately left out of the commit on this branch.
- No automated test suite exists for this project (per `CLAUDE.md`) — all verification above was manual (curl + browser), so re-verify by hand after further changes.
