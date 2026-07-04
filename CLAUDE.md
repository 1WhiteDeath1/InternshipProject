# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SAM Hotel & Mess Management System — a production-grade, offline/on-premise hotel and mess (canteen) management system. FastAPI backend (`backend/`) + React/TypeScript/Vite frontend (`src/`), backed by SQLite. Designed to run entirely on a local network with no internet dependency (see INSTALL.md).

## Commands

### Frontend (run from repo root)
- `npm run dev` — Vite dev server on port 3000; proxies `/api`, `/docs`, `/openapi.json` to the backend on port 8000 (see vite.config.ts)
- `npm run build` — `tsc -b && vite build`, outputs to `dist/`
- `npm run lint` — `eslint .`
- `npm run preview` — preview the production build

### Backend (run from repo root, NOT from inside `backend/` — imports use the `backend.` package prefix)
- Windows: `start.bat` → `python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload`
- Linux: `./start.sh` → `python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000`
- Dependencies (no `requirements.txt` exists; this pip line from INSTALL.md is the source of truth):
  `pip install fastapi uvicorn sqlalchemy alembic pydantic pydantic-settings bcrypt python-jose python-multipart aiofiles openpyxl reportlab cryptography`
- Seed demo data: `python backend/seed_demo.py` — creates a supervisor (`admin`/`admin123`) and 4 role-based staff accounts plus sample inventory/rooms/bookings/vendors
- No automated test suite exists for either the backend or frontend currently.

## Architecture

- Single project root containing two colocated codebases — a Vite/React app (`src/`) and a FastAPI package (`backend/`) — not a monorepo with workspaces.
- **Serving model**: In dev, Vite (port 3000) proxies API calls to FastAPI (port 8000). In production, `npm run build` outputs `dist/`, and `backend/main.py` mounts `dist/assets` as static files and serves `dist/index.html` for any non-API path (SPA fallback), so the whole app runs from one FastAPI process/port.
- **Data layer**: SQLite at `backend/hotel_mess.db`. Tables are created via `Base.metadata.create_all()` in `backend/main.py` on startup — despite `alembic` being in the install list, no migrations are actually wired up; schema changes happen by editing `backend/models.py` and relying on create-if-missing (existing DB files won't auto-migrate).
- **Config**: `backend/config.py` centralizes filesystem paths (`DB_PATH`, `LOGS_DIR`, `BACKUP_DIR`, `BRANDING_FILE`) and a pydantic-settings `Settings` object (JWT secret/expiry, login lockout policy, backup retention) loaded from an optional `.env` file.
- **Auth & permissions** (`backend/auth.py`): JWT bearer tokens. RBAC model is `Role` → `RolePermission` (module + action pairs, e.g. `inventory`/`create`) → `User`. Supervisors (`role.is_supervisor`) bypass all permission checks. Use `Depends(get_current_user)` for authentication, `check_permission(user, module, action)` or the `PermissionChecker` dependency for authorization, and `Depends(require_supervisor)` for supervisor-only endpoints.
- **Audit logging** (`backend/audit.py`): `log_audit(...)` writes immutable `AuditLog` rows with JSON before/after snapshots (via `serialize_model`). Every router calls this after create/update/delete/approve actions — follow this pattern for any new mutating endpoint.
- **Routers** (`backend/routers/*.py`): one file per business domain, each mounted in `backend/main.py` under `/api/<domain>` — `auth, users, roles, inventory, procurement, bookings, billing, security, reports, audit, alerts, settings, features, import_export, backup, branding`. All follow the same shape: `Depends(get_db)` for a scoped session, `Depends(get_current_user)`, a `check_permission` guard before mutating, and a `log_audit` call after.
- **Domain model** (`backend/models.py`) groups into: Users/Roles/Permissions; Inventory (categories, items, stock batches split by zone `warehouse`/`kitchen`, stock movements, waste logs, cycle counts); Recipes (ingredients drawn from inventory, kitchen orders); Procurement (vendors, purchase orders, three-way match against deliveries); Bookings (rooms, bookings, guest movements); Billing (invoices/invoice items); Security (security logs, incident reports); plus cross-cutting `AuditLog`, `Alert`, `FeatureFlag`, `SystemSetting`.
- **Feature flags**: `FeatureFlag` model + `/api/features` + `src/contexts/FeaturesContext.tsx` allow toggling modules per department at runtime.
- **Frontend routing** (`src/App.tsx`): flat `react-router-dom` v7 route table. `SplashScreen` and `Login` sit outside the authenticated shell; all other pages (Dashboard, Inventory, Procurement, Bookings, Billing, Security, Users, Roles, AuditLog, Alerts, Reports, Settings, ImportExport) render inside the shared `Layout` (`src/components/Layout.tsx`).
- **Frontend state**: `AuthContext` (JWT in `localStorage`), `ThemeContext`, `FeaturesContext` wrap the route tree in `App.tsx`. `src/lib/api.ts` is the single axios instance to use for all API calls — it attaches the Bearer token and force-redirects to `/login` on a 401 for an already-authenticated session.
- **UI kit**: shadcn/ui ("new-york" style, see `components.json`), pre-generated components live in `src/components/ui/`. Reuse these rather than hand-rolling primitives; add new ones through shadcn using the existing config.
- **Path alias**: `@/*` → `src/*` (see `vite.config.ts` and `tsconfig.app.json`).

## Notes
- This directory is not currently a git repository.
- No `.env` file is present; `SECRET_KEY` and other settings fall back to defaults in `backend/config.py` — for any real (non-demo) deployment these must be overridden via `.env`.
- `README.md` and `info.md` describe generic Vite/shadcn scaffolding and are stale relative to the actual application — refer to `INSTALL.md` for real setup/deployment instructions instead.
- `backend/venv/` is a local Python virtualenv checked into this folder — not source code, ignore its contents when reading/searching.
