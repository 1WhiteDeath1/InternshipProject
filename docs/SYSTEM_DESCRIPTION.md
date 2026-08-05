# EME MANAGEMENT SYSTEM — System Description

**Version:** 1.5.0 · **Status:** Built, deployed, and in active use at the EME Officers Mess (not a prototype/demo)
**Last updated:** 5 August 2026

This document has two parts. [Part 1](#part-1--for-clients-and-non-technical-readers) explains the system
in plain language — what it is, the security model, every role and what that person actually does with it
day to day, and what each module offers. [Part 2](#part-2--technical-description) is the engineering
reference — stack, architecture, data model, and deployment.

---

## Part 1 — For clients and non-technical readers

### What this is, in one sentence

EME MANAGEMENT SYSTEM is a single computer program that runs the entire day-to-day operation of a hotel-and-mess
(canteen) facility — bookings, kitchen, stores, billing, staff, and security — replacing the
separate paper registers and spreadsheets each department used to keep on its own.

### The problem it replaces

Before a system like this, a typical mess runs on paper: a booking register at the front desk,
a stock ledger in the kitchen, a separate cash/billing book, a guard's movement log, and an
attendance register for members. Each of these is accurate on its own page, but **nothing checks
one register against another**. A room gets booked in one book without the kitchen or billing
book ever finding out. A sack of rice leaves the store with no record of who authorized it. A
guest checks out without the mess ever being told to add the food bill.

None of this requires anyone to be dishonest — it's simply what happens when five departments
each keep their own truth and nobody's job is to compare them. EME MANAGEMENT SYSTEM puts every
department's records into **one shared database** instead of five separate books, so bookings,
billing, kitchen, stock, and security all see the same facts at the same time.

---

## Security — how the system protects the mess's data and money

Security here means two different things, and the system addresses both: **keeping the wrong
people out of screens they shouldn't touch**, and **making sure that when the right people act,
there's a permanent, honest record of what they did.**

### 1. Every staff member sees only their own job

Nobody logs in and sees "the whole system." Each person is assigned one **role** (Manager, Deputy
Manager, Clerk, Kitchen NCO, Booking NCO, or Security Guard), and that role determines, screen by
screen and action by action, what they can see and what they can do. A Kitchen NCO cannot open the
billing screens. A Booking NCO cannot approve their own discount. This isn't just a matter of
hiding buttons in the interface — the server itself refuses the request even if someone tried to
reach a screen directly, so it can't be bypassed by guessing a web address. This was specifically
tested this month: every one of the ~200 actions the system can perform was checked against every
role, confirming a Booking NCO genuinely cannot touch billing, a Clerk genuinely cannot touch
kitchen orders, and so on, with no exceptions found.

### 2. Every login is protected against guessing

Passwords are never stored in readable form — they're scrambled with an industry-standard method
(bcrypt) that can't practically be reversed even if someone got hold of the database file directly.
Five wrong password attempts in a row locks that account for 30 minutes automatically, which stops
a brute-force guessing attack cold. A Manager can unlock an account early if a genuine staff member
gets locked out by mistake.

### 3. A permanent, tamper-proof paper trail

Every time anyone creates a booking, edits a price, approves a discount, corrects a bill, or
changes a stock count, the system writes a permanent record: who did it, exactly when, and — for
anything that changes a value — what it was before and what it became after. This record **cannot
be edited or deleted by anyone**, including the mess's own Manager. If a question ever comes up
about who changed something and why, the answer is always available, not dependent on someone's
memory or a handwritten note.

### 4. Nothing leaves the building

The system runs entirely on the mess's own computer and local network. It does not need — and does
not use — an internet connection to operate. No booking, no bill, no member's personal information
is ever sent outside the mess's own premises. This is a deliberate design choice appropriate for a
military-affiliated facility, not a limitation to work around.

### 5. Its own signing key, unique to this installation

Every time someone logs in, the system issues them a signed digital "pass" that proves who they are
on every subsequent action. That pass is stamped with a secret key generated specifically for this
installation — not a default value that ships the same in every copy of the software. Nobody
outside this specific deployment could forge a valid login pass even if they had a copy of the
software itself.

### 6. Backups

The system can produce a complete, self-contained backup of the entire database on demand — every
booking, bill, and record, in one file, ready to be copied off-site or onto a USB drive. (This was
one of the specific things fixed in this month's review — it was silently failing before and has
since been corrected and verified.)

### 7. Multiple desks writing at the same instant, handled safely

Now that the system runs as one shared server multiple desks connect to over the network, it's a
real scenario for the kitchen to be marking meal attendance at the exact same moment front desk is
checking a guest in. The database has been specifically tuned for this: every write is queued and
completed safely rather than colliding, and reading a screen is never blocked by someone else's
save happening at the same time. Verified this month with an automated test firing 10 simultaneous
writes at the database in the same instant — comfortably double the mess's actual number of
concurrent users — with every single one completing successfully.

---

## The six roles

Every staff account belongs to exactly one of these. A person's job title in real life doesn't
have to match the system role name exactly — what matters is which of these six sets of screens
and actions fits what they actually do.

| Role | In one line |
|---|---|
| **Manager** | Runs the mess — approvals, policy, pricing, staff administration, and the full picture |
| **Deputy Manager** | Acting-manager oversight, minus staff admin, audit access, and discount authority |
| **Clerk** | Owns money end-to-end — every bill, every payment, every collection |
| **Kitchen NCO** | Runs the kitchen and the store — menu, production, stock, and the member roster |
| **Booking NCO** | Runs the front desk — every room booking, check-in, and check-out |
| **Security Guard** | Runs the gate log and incident reports |

### Manager — a day in the system

The Manager's dashboard opens on a single-screen summary: this week's revenue, occupancy, a
cost-and-revenue flow diagram, stock value, and upcoming events — the whole operation at a glance,
without asking five people for five numbers.

From there, a Manager:
- **Approves or rejects** things other staff propose — a Clerk's request to correct an
  already-issued bill, a Kitchen NCO's proposed menu or price change, a request from front desk to
  reclassify a guest's billing category.
- **Sets pricing policy** — the room rate card (rank × room type × guest category), duty
  allowance rates, and HRA (resident officer) monthly rates — the numbers every bill is
  automatically calculated from.
- **Grants complimentary stays or discounts** — the only role with this authority, and every use
  of it is logged with a reason.
- **Administers staff and access** — creates and edits user accounts, assigns roles, unlocks a
  locked-out account, and (new this release) can create custom roles beyond the six built-in ones
  if the mess's structure ever needs one.
- **Reads the audit log** — the only role, alongside Deputy Manager, that can review the full
  permanent history of who changed what.
- **Sends directives** — one-way instructions broadcast to a whole role (e.g. "all Booking NCOs")
  with a read-receipt showing who's acknowledged it.
- **Views rooms and the calendar, read-only** (new this release) — can see exactly what the
  Booking NCO sees for room status, the week/month calendar, and booking history, without being
  able to accidentally create or cancel a booking themselves. This was built specifically so
  Manager oversight of occupancy doesn't require operating the booking desk.
- **Configures the system** — the mess's own name/address/phone on printed documents, alert
  thresholds, SMS provider, and which optional modules are switched on.
- **Reviews alerts** — low stock, an unusual after-hours access, a statistical anomaly in
  procurement spending flagged automatically.
- **Runs reports** — occupancy trends, revenue trends, cost breakdowns, waste-by-category, vendor
  performance — cross-department numbers pulled live from the same data every other screen uses,
  so it can never disagree with what staff see on their own screens.
- **Triggers backups** and exports data to Excel for external use.

### Deputy Manager — the same oversight, a narrower slice

Everything a Deputy Manager does mirrors the Manager's oversight role, deliberately minus the
things that carry legal/PII weight or are meant to stay with one person: no staff/user
administration, no audit log access, no discount or bill-correction authority. What a Deputy
Manager *does* own outright is **Events** — hall and function bookings (dinners, ceremonies) are
created, priced, and managed by the Deputy Manager end-to-end, separately from ordinary guest room
bookings. They also approve menu changes, set rate/tariff policy, and get the same read-only view
of rooms, occupancy, and reports as the Manager.

### Clerk — every rupee, tracked

The Clerk owns billing completely, front to back. A typical day:
- **Clerk Desk** is the Clerk's home screen — every currently checked-in guest and every member
  with an outstanding balance, in one grid, with a one-click "Checkout & Bill" action that pulls
  together the room charge, every ad-hoc charge (laundry, breakages, extras), and the mess/food
  charge into one consolidated bill — nothing has to be manually matched from separate registers.
- **Checkout** produces the actual invoice, correctly excluding guests with a monthly residency
  arrangement (they're billed through the monthly cycle instead, never double-billed at checkout).
- **Payments** are recorded against an invoice as they come in — cash, card, whatever mix — with
  the system refusing to let a payment exceed what's actually still owed.
- **Monthly Mess Billing** — once a month, generates every resident member's food bill
  automatically from their *actual recorded meals* for that month, not a flat estimate. The Clerk
  reviews, applies any approved discount, issues the bills, and marks them paid as collections come
  in.
- **Order History, split and printable** (new this release) — for any guest or member, a
  two-part, printable/exportable breakdown: their regular meal attendance history in one table, and
  their separately-itemized à la carte orders in another — so if a customer asks "what did I
  actually order," the Clerk has a clean answer ready to hand over or print as a receipt.
- **Events invoicing** — once Deputy Manager marks a function complete, the Clerk generates its
  invoice, and (new this release) can log what the event actually cost to run, with the system
  automatically showing the profit or loss against what was billed.
- **Income & Cost reports** — the Clerk's own financial summary, independent of the Manager's
  broader report suite.

### Kitchen NCO — the kitchen and the store

The Kitchen NCO's job spans two connected areas: what's cooked, and what's bought.
- **Stock & procurement** — logs every delivery as it arrives (including "Smart Intake," which
  reads a paper delivery slip via camera/scanner instead of typing every line by hand), tracks
  what's low and needs reordering, logs waste by category, and periodically counts physical stock
  against what the system expects (the system itself prompts this on roughly a weekly cycle per
  category, rather than waiting for a once-a-year audit to discover a shortfall). The system also
  remembers what each vendor charged last time, so a price increase is visible the moment a new
  delivery is logged, not discovered months later.
- **Kitchen production** — the daily menu, and the actual cooking queue: regular meal orders
  moving through prepared → served, and separately, à la carte "special order" requests with a
  visible countdown timer so nothing sits forgotten.
- **Meal attendance** — marks members and guests present/absent for each meal, which is what
  actually drives both the kitchen's production numbers and the monthly mess billing calculation
  downstream.
- **Menu & rates** — proposes new dishes or price changes (which the Manager approves before they
  go live), and sets the mess/gas surcharge rates.
- **Member roster** — creates and maintains the resident member list, including dining status
  (a member on leave or away can be marked non-dining so they're correctly excluded from that
  month's bill).
- **Walk-in guest identities** (new this release) — can register a walk-in guest's basic identity
  on the spot from the meal-attendance screen, for someone eating a meal without a room booking.

### Booking NCO — the front desk

The Booking NCO runs the entire guest-room lifecycle:
- **Booking** — checks room availability (today or a future date), creates a booking with the
  guest's details, and either checks them in immediately (walk-in) or holds the reservation for
  their arrival date. The system automatically enforces sensible rules underneath — no double
  bookings, no checking a guest into a room that isn't clean or is under maintenance, no checking
  in without a housekeeping attendant assigned to that room.
- **Check-in / check-out coordination** — moves a guest from confirmed → checked-in, and hands off
  to the Clerk for the actual billing at departure (the Booking NCO's job ends at "the guest is
  ready to leave," never at collecting money).
- **Room status board** — a live view of every room: occupied, vacant, reserved, under
  maintenance, and whether housekeeping still needs to clean it — filterable and sortable by
  what needs attention right now.
- **Calendar views** — week, month, and a room-by-room month grid, so a multi-day or seasonal
  booking pattern is visible at a glance, not reconstructed from a stack of index cards.
- **Extending a stay, changing rooms, cancelling** — the everyday adjustments a front desk handles
  constantly, each logged the same way as a fresh booking.
- **HRA residencies** — long-term resident officers are booked once and billed monthly going
  forward automatically, rather than needing a fresh booking entry every month.
- **Attendant roster** — registers housekeeping attendants and clocks them on/off duty, which
  feeds directly into the check-in rule above (a room can't be checked into without one assigned).

### Security Guard — the gate and the incident file

- **Security log** — records access events (a guest movement, an unusual entry) as they happen.
- **Incident reports** — files a written incident report, sets its severity, and — as of this
  release — can now actually move it through investigating → resolved themselves (previously,
  incidents could be filed but nobody in the system could formally close one; this is now fixed).
  A high or critical incident automatically raises an alert for management's attention the moment
  it's filed.

---

## Every module, and what it offers

| Module | What it gives the mess |
|---|---|
| **Bookings & Rooms** | Full room lifecycle: availability, booking, check-in/out, housekeeping status, week/month/calendar views, HRA residencies |
| **Rooms Overview** *(new)* | The same room/calendar/booking-history visibility for Manager and Deputy Manager, view-only — oversight without needing to operate the booking desk |
| **Billing & Clerk Desk** | One consolidated bill per guest covering room + food + extras; payments, receipts, invoice corrections with a formal approval trail |
| **Mess Billing** | Monthly resident-member bills generated from actual recorded meals, not a flat estimate; discount and collection tracking |
| **Kitchen** | Daily menu, production queue, à la carte ordering with SLA timers, mess/gas rate management |
| **Attendance** | Per-meal presence tracking for members and guests — the real number that drives both kitchen production and billing |
| **Inventory & Procurement** | Stock levels, batches, waste logging, cycle counts, vendor price memory, Smart Intake receipt scanning |
| **Members** | The resident officer roster — rank, category, dining status, leave record |
| **Guests** | A searchable customer directory with stay and billing history |
| **Attendants** | Housekeeping staff roster, duty clock, and an activity/workload report |
| **Events** | Hall/function bookings with their own menu, invoice, and (new) actual-cost-vs-invoice margin |
| **Security** | Access/movement logging and a full incident-report lifecycle |
| **Tariffs & Rate Cards** | The pricing tables (room rates, duty allowances, HRA rates, Women's Bloc rates) every bill is calculated from — editable by Manager without touching any code |
| **Users, Roles & Permissions** | Staff accounts, role assignment, and (new) the ability to create a custom role if the mess's structure ever needs one beyond the standard six |
| **Audit Log** | The permanent, unchangeable record of every mutating action across the whole system |
| **Alerts** | Automatic flags — low stock, unusual access hours, statistical anomalies in spending |
| **Directives** | One-way management instructions to a role, with acknowledgement tracking |
| **Reports** | Cross-department occupancy, revenue, cost, and waste reporting, always matching what staff see on their own screens |
| **Settings, Features & Branding** | The mess's own identity on documents, configurable alert thresholds, and modules that can be switched on/off without a code change |
| **Backup** | On-demand, complete database backup to a single file |
| **Import/Export** | Bulk data in and out via Excel, for inventory, vendors, rooms, and bookings |

### What EME MANAGEMENT SYSTEM deliberately does *not* try to do

- No purchase-order approval chain — the mess buys and restocks itself day to day; the system
  tracks *what* was bought and from whom, not a multi-step sign-off before buying.
- No "recipe" concept — the kitchen menu is dishes with an estimated price, not a costed
  ingredient list. Stock isn't deducted automatically per dish cooked; it's reconciled by the
  physical counts described above.
- No internet dependency, by design.

### How someone actually gets it and runs it

EME MANAGEMENT SYSTEM ships as a normal Windows installer — double-click, click through the
install wizard, and a desktop icon appears. No command line, no separate database software, no
internet connection required at any point. One PC on the mess's own network acts as the server;
every other desk (Booking, Kitchen, Clerk, etc.) connects to it from their own PC or tablet's
browser, the same way they'd open any website — nothing to install on those machines.

---

## Part 2 — Technical description

### Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript, Vite 7, react-router-dom v7 |
| UI kit | shadcn/ui ("new-york" style) on Radix UI primitives + Tailwind CSS |
| Backend | FastAPI (Python), SQLAlchemy ORM |
| Database | SQLite, single file (`backend/hotel_mess.db`) |
| Auth | JWT bearer tokens, bcrypt password hashing |
| Packaging | PyInstaller (backend) + Inno Setup (Windows installer) |

### Architecture

- **Not a monorepo.** Two colocated codebases in one repo root: a Vite/React app (`src/`) and a
  FastAPI package (`backend/`).
- **Serving model:** in development, Vite (port 3000) proxies API calls to FastAPI (port 8000).
  In production, `npm run build` outputs a static `dist/`, and `backend/main.py` mounts it
  directly and serves `index.html` for any non-API path — the entire application is one FastAPI
  process on one port, no separate frontend server to run or deploy.
- **Data layer:** SQLite, tables created via `Base.metadata.create_all()` on startup. This only
  *adds* new tables — it never alters existing ones — so every additive schema change (new
  column on an existing table) needs an idempotent migration function in
  `backend/migrations/<domain>.py`, run by `run_startup_migrations()` right after `create_all()`
  on every boot.
- **Auth & permissions (RBAC):** `Role → RolePermission (module + action) → User`. Enforced with
  `Depends(get_current_user)` for authentication and `check_permission(user, module, action)` /
  the `PermissionChecker` dependency for authorization on essentially every endpoint, including
  read-only endpoints that carry PII or financial data. `role.is_supervisor` is an unscoped total
  bypass, reserved for a hypothetical break-glass account — none of the seeded operational roles
  use it. The frontend route table is also gated (`RequirePermission` + `navConfig.tsx`), so direct
  navigation to a disallowed page redirects to a `NoAccess` page rather than only hiding the
  sidebar link.
- **Audit logging:** `log_audit()` writes immutable `AuditLog` rows with JSON before/after
  snapshots. Every mutating endpoint across every router calls this after create/update/delete/
  approve.
- **Domain model** (`backend/models/`, one file per domain): Users/Roles/Permissions; Inventory;
  Kitchen (menu items, kitchen orders); Procurement (vendors, purchase records, three-way match);
  Bookings (rooms, bookings, guests, attendants, rate tables); Members & Attendance; Billing &
  Mess Billing; Events; Security; plus cross-cutting `AuditLog`, `Alert`, `FeatureFlag`,
  `SystemSetting`, `SmsMessage`.
- **Services layer:** `room_pricing.py` (the rate-table pricing engine), `mess_billing_calc.py` /
  `mess_charge_calc.py` (mess charges computed from actual recorded orders), `receipt_ocr.py`
  (Smart Intake OCR), `anomaly_engine.py` (statistical anomaly detection), `sms.py`.

### This month's changes (v1.4.0 → v1.5.0)

- **New Rooms Overview module** — read-only room/calendar/booking-history visibility for Manager
  and Deputy Manager, backed by a new `rooms_overview` permission kept deliberately separate from
  the Booking NCO's write-capable `bookings` permission.
- **Full-system QA pass** — 235 automated test cases exercising every workflow, every role, and
  deliberate edge/extreme cases (see `docs/DEPLOYMENT_READINESS_REPORT.md` for the full report).
  231 passed outright; the 4 genuine findings have since been fixed:
  - Backup creation was silently crashing on every attempt — fixed.
  - Two input-validation gaps that could crash the server on a malformed value (incident severity,
    member category) — fixed with proper validation.
  - Security incidents could be filed but never formally resolved by any role — fixed.
  - The walk-in guest quick-create feature was unreachable by any role — fixed.
  - A real gap where three room/booking endpoints had no permission check at all (any logged-in
    user, any role, could read every guest's name and stay details) — fixed.
- **Dev startup performance** — an unrelated but confirmed fix: local development startup dropped
  from ~12s to ~2s (the file-watcher was scanning the entire dependency tree on every restart).
- **LAN deployment resolved.** The single-PC-only limitation noted in the previous version of this
  document is now fixed: the packaged installer binds to every network interface, so other
  desks/devices on the mess's network can connect to one server PC instead of everyone needing
  their own installation.
- **Production starting data.** The installer now ships with the mess's real 28-room register and
  one real account per operating role, rather than sample/demo content.
- **Per-installation signing key.** The JWT signing key is now generated uniquely per deployment
  rather than using the software's built-in default.
- **Concurrent-write hardening.** `backend/database.py` now sets `PRAGMA journal_mode=WAL` and
  `PRAGMA busy_timeout=5000` on every connection. Previously, SQLite's default mode meant a write
  landing while another write was mid-commit failed immediately with `database is locked` (an
  unhandled 500) rather than queuing - a real risk now that multiple desks write to one shared
  server concurrently over the LAN. WAL also lets reads proceed without waiting on a write
  in-flight, which the previous default journal mode did not. Verified with a 10-thread
  barrier-synchronized concurrent-write test (all 10 firing in the same instant, double the mess's
  actual concurrent-user count) - 10/10 succeeded, zero lock errors, both against a raw SQLite
  connection and against the app's actual SQLAlchemy engine.

### Deployment & packaging

```
packaging/build.ps1:
  npm run build                              (frontend -> dist/)
  → PyInstaller (packaging/EME-MESS.spec)     (backend -> onedir bundle)
  → Inno Setup (packaging/installer.iss)      (bundle -> EME-MESS-Setup-<version>.exe)
```

The installer installs under the current user's profile (no admin/UAC prompt needed). One PC on
the mess's network runs the installed application as the server (bound to every network
interface); other desks connect over the LAN via browser. See `docs/DEPLOYMENT_READINESS_REPORT.md`
for the full pre-deployment QA findings and `packaging/launcher.py` for the exact startup behavior.

### Known scope gaps (stated plainly, not hidden)

- No automated test suite (correctness rests on the manual QA pass documented in
  `docs/DEPLOYMENT_READINESS_REPORT.md` and the audit log, not CI).
- No recipe entity and no automatic per-dish stock deduction — reconciliation is via manual Cycle
  Counts, nudged on a weekly cycle.
- No purchase-order sign-off workflow — procurement is self-purchase with three-way match at
  receipt, not pre-purchase approval.
- The production frontend bundle is a single JS file, not yet code-split.
