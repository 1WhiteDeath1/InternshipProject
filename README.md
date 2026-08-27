# SAM — Hotel & Mess Management System

**Branded in-app as EME MESS.** A production-grade, fully offline management system for an EME Officers Mess: room bookings, guest and member billing, kitchen production, mess accounts, inventory and procurement, events, and security logging — with role-based access for the six people who actually run the mess.

Built to run entirely on a local network with **no internet dependency**, and shipped as a single Windows installer.

> **Version 1.6.2** · FastAPI + React/TypeScript + SQLite

---

## Table of contents

- [Why it exists](#why-it-exists)
- [Feature overview](#feature-overview)
- [Roles & access](#roles--access)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Demo accounts](#demo-accounts)
- [Project layout](#project-layout)
- [How it fits together](#how-it-fits-together)
- [Building the Windows installer](#building-the-windows-installer)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [Known limitations](#known-limitations)

---

## Why it exists

An officers' mess runs on paper: a booking register, a ration-strength return, a bill book, a receipt book. That works, but it makes three things hard — knowing what a guest actually owes at checkout, knowing how much food to cook tomorrow, and reconciling the month.

SAM replaces those registers with one system while keeping the paper formats intact: printed bills and receipts reproduce the mess's existing forms line for line, so nothing about the outward process changes.

It is designed for an environment with **no reliable internet**. Everything — database, uploads, backups, PDF/QR generation, OCR — runs locally.

---

## Feature overview

### Rooms & bookings
- Room grid, month calendar, and per-room booking timeline
- Walk-in and online-portal bookings, with advance payments recorded against the stay
- Guest identity carried across visits (matched on CNIC/phone), so a returning guest keeps their history
- Room-readiness gating: housekeeping status and an assigned attendant are required before check-in
- HRA (in-mess residency) as a distinct, monthly-billed stay type
- Rate engine: rank/category tariff matrix, DA multipliers, per-room-class utilities, Women's Bloc rates

### Billing & the Clerk Desk
- Checkout generates itemised room and mess bills — room charges broken out into their real components (rent, electricity, generator, gas, internet), not one flat figure
- **Interactive bill table**: freely add/correct line items and record payments until *Make Bill* locks it; corrections after that go through a Manager-approved request
- Split payments with method and voucher tracking (Online/AG Branch, Bank Transfer, Cash)
- Printable **Master Invoice** and a **cash receipt** matching the mess's receipt book, both with a locally generated QR code
- Full payment history per bill, reprintable at any time

### Kitchen
- **Meals board** — one screen per meal, grouped by dish: who's eating what, headcounts, and one-tap cooking status
- Mark someone present and assign their dish in a single action
- *Same as last time* rolls the previous service's assignments forward
- **Special orders** (off-menu, per person) with SLA timers and overdue escalation
- Per-dish food price and gas charge, set once and applied to everyone who ate it
- Editable menu with a Kitchen-proposes / Manager-approves workflow

### Members & mess accounts
- Member roster with dining / non-dining classification and leave tracking
- Monthly mess bills computed from actual attendance (man-days × per-head rate derived from real expenditure)
- Sponsored guest meals, à la carte charges, discounts, and carried-forward balances
- Per-member ledger with full dining history

### Inventory & procurement
- Stock batches with expiry, FIFO/FEFO, waste logging and cycle counts
- Self-purchase intake (the mess buys and restocks itself — no PO workflow)
- **Smart Intake**: OCR a supplier receipt to pre-fill an intake
- Vendor management and price memory

### Oversight
- Immutable audit log with before/after snapshots on every mutation
- Alert engine including statistical anomaly detection (z-score on spend, Benford's Law on unit costs)
- Reports, income & cost analysis, expenses, and Excel import/export
- Runtime feature flags per department
- Local database backups with retention

---

## Roles & access

Access maps to the **job**, not to seniority — a senior role is deliberately *not* "everyone's screens, read-only".

| Role | Owns |
|---|---|
| **Manager** | Oversight, approvals, policy, rate cards, staff & access administration |
| **Deputy Manager** | Acting-manager oversight and policy; no access administration or PII |
| **Clerk** | All money: checkout, invoices, payments, receipts, member mess bills |
| **Booking NCO** | Rooms, bookings, check-in/out, attendants, HRA member registration |
| **Kitchen NCO** | Meals, production, mess charges, menu, inventory & procurement |
| **Security Guard** | Security logs and incident reports |

Permissions are `module + action` pairs (`view` / `create` / `edit` / `approve`) attached to a role. Every endpoint carrying PII or financial data is gated, including reads.

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | FastAPI, SQLAlchemy, Pydantic v2, JWT auth (python-jose), passlib/bcrypt |
| Frontend | React 19, TypeScript, Vite 7, React Router 7, Tailwind, shadcn/ui, Recharts |
| Database | SQLite (single file, on-premise) |
| Documents | reportlab (invoice/receipt QR codes), openpyxl (Excel import/export) |
| OCR | rapidocr-onnxruntime + OpenCV + rapidfuzz (Smart Intake) |
| Packaging | PyInstaller + Inno Setup → single Windows installer |

---

## Getting started

> Run every command from the **repository root**. The backend uses the `backend.` package prefix, so running from inside `backend/` will fail on imports.

### 1. Backend

```bash
pip install -r requirements.txt
```

```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Or use the helper scripts: `start.bat` (Windows) / `./start.sh` (Linux).

### 2. Frontend

```bash
npm install
```

```bash
npm run dev
```

Vite serves on **port 3000** and proxies `/api`, `/docs`, `/openapi.json` and `/uploads` to the backend on **port 8000**.

### 3. Seed demo data

```bash
python backend/seed_demo.py
```

Creates one user per role plus sample rooms, bookings, members and inventory.

### Other commands

```bash
npm run build
```

```bash
npm run lint
```

Interactive API docs are available at `http://localhost:8000/docs` while the backend is running.

---

## Demo accounts

Seeded by `backend/seed_demo.py`. **Offline demo data only — deliberately trivial.**

| Username | Role |
|---|---|
| `manager` | Manager |
| `deputy` | Deputy Manager |
| `clerk` | Clerk |
| `booking` | Booking NCO |
| `kitchen` | Kitchen NCO |
| `security` | Security Guard |

Password for all of the above: `123456`. A break-glass supervisor account (`admin` / `admin123`) also exists.

> ⚠️ Change these before any real deployment, and set a real `SECRET_KEY` (see [Configuration](#configuration)).

---

## Project layout

```
├── backend/
│   ├── main.py              # app assembly, static serving, SPA fallback
│   ├── config.py            # paths + pydantic-settings
│   ├── auth.py              # JWT, RBAC, permission dependencies
│   ├── audit.py             # immutable audit log
│   ├── models/              # SQLAlchemy models, one file per domain
│   ├── schemas/             # Pydantic models, mirrors models/
│   ├── routers/             # one file per domain, mounted at /api/<domain>
│   ├── migrations/          # idempotent startup patches, mirrors models/
│   └── services/            # cross-router business logic (pricing, costing, OCR)
├── src/
│   ├── pages/               # one file (or folder) per screen
│   ├── components/          # shared components + ui/ (shadcn)
│   ├── contexts/            # Auth, Theme, Features
│   └── lib/                 # axios instance, nav config, helpers
├── packaging/               # PyInstaller spec, Inno Setup script, build pipeline
└── docs/                    # architecture and module references
```

`models/`, `schemas/`, `migrations/` and `routers/` are each split **one file per domain**, mirroring each other. That is deliberate: it lets several contributors work in parallel without merge conflicts. See [`docs/MODULE_STRUCTURE.md`](docs/MODULE_STRUCTURE.md) before adding a model, endpoint or migration.

---

## How it fits together

**Serving model.** In development, Vite (3000) proxies API calls to FastAPI (8000). In production, `npm run build` emits `dist/`, and `backend/main.py` mounts `dist/assets` as static files and serves `dist/index.html` for any non-API path — so the whole app runs from **one process on one port**. The SPA catch-all is registered last so it can never shadow a real `/api/*` route.

**Schema changes.** Tables are created with `Base.metadata.create_all()` at startup. That only ever *adds* tables — it never alters an existing one. So every additive change (a new column, a new table on an existing feature) also needs a small idempotent patch function in `backend/migrations/<domain>.py`, appended to that domain's `MIGRATIONS` list. `run_startup_migrations()` runs them all on every boot.

**Auditing.** Every mutating endpoint calls `log_audit(...)`, which writes an immutable row with JSON before/after snapshots. Follow that pattern for anything new.

**Pagination.** List endpoints cap `page_size` at 100. Never treat one page as the full set — if a screen needs a total, add a server-side aggregate endpoint rather than summing a page client-side.

---

## Building the Windows installer

Deployment is via the packaged installer, not a source checkout.

```bash
powershell -ExecutionPolicy Bypass -File packaging/build.ps1
```

The pipeline verifies the seed database, builds the frontend, bundles everything with PyInstaller, then compiles an Inno Setup installer to `packaging/output/EME-MESS-Setup-<version>.exe`.

Before building, bump the version in **both** `package.json` and `packaging/installer.iss` — nothing syncs them automatically.

The installed app keeps its data outside the install directory (`%LOCALAPPDATA%\EME MESS\data`), so uninstalling or reinstalling never touches the live database, uploads, backups or logs.

> The bundled launcher binds to `127.0.0.1` only — single machine. To serve other devices on the network, change `HOST` in `packaging/launcher.py` and open the firewall port.

---

## Configuration

Settings load from an optional `.env` at the repo root via pydantic-settings (`backend/config.py`).

| Variable | Purpose |
|---|---|
| `SECRET_KEY` | JWT signing key — **must** be overridden for any real deployment |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Session length (default 480) |
| `MAX_LOGIN_ATTEMPTS`, `LOCKOUT_DURATION_MINUTES` | Login lockout policy |
| `BACKUP_RETENTION_DAYS`, `AUTO_BACKUP_HOUR` | Local backup retention and schedule |
| `DEFAULT_PAGE_SIZE` | Default list page size (25) |

No `.env` is committed. Without one, `SECRET_KEY` falls back to a placeholder default that is **not safe for production** — anyone could forge a token against a deployment that never set it. The installer ships a generated key as `{app}\.env`.

Operational settings that staff change day to day (meal cutoff times, gas charge rate, arrival deadlines, SMS gateway) live in the database and are edited on the in-app Settings page — not in `.env`.

---

## Documentation

| Document | Covers |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Stack, auth/RBAC, audit logging, conventions — start here |
| [`docs/MODULES.md`](docs/MODULES.md) | Implementation-level reference for the guest/member/booking/billing cluster |
| [`docs/MODULE_STRUCTURE.md`](docs/MODULE_STRUCTURE.md) | The domain-package convention and where new code goes |
| [`docs/UI_CONVENTIONS.md`](docs/UI_CONVENTIONS.md) | Frontend patterns and component usage |
| [`docs/SYSTEM_DESCRIPTION.md`](docs/SYSTEM_DESCRIPTION.md) | Product-level description |

---

## Known limitations

Stated plainly, because they matter if you intend to build on this:

- **No automated test suite** — neither backend nor frontend. Verification is manual.
- **SQLite, single writer.** Fine for one mess on a LAN; not a multi-tenant or high-concurrency design.
- **Alembic is installed but unused.** Schema evolution goes through the idempotent startup patches described above.
- **List endpoints cap at 100 rows.** Screens needing full-set totals must use a server-side aggregate.
- **The packaged launcher is localhost-only** by default (see above).
- **No recipe/ingredient costing.** A menu item carries an estimated price; kitchen stock is reconciled manually via cycle counts, not deducted per order.

---

## License

No license has been specified for this project.
