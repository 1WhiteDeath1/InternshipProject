# SAM Hotel & Mess Management System — Project Document

## 1. Project Goal

SAM is a production-grade, offline/on-premise hotel and mess (canteen) management
system built to replace the fragmented, register-based way hospitality and food-service
operations are typically run. Instead of separate paper logs and spreadsheets for
bookings, kitchen inventory, procurement, billing, attendance, and security, SAM puts
every department on one shared, permission-controlled database — so an action recorded
in one module (a delivery received, a room booked, a meal served) is immediately visible
and verifiable in every other module that depends on it.

The system is designed to run entirely on a local network with **no internet
dependency** (see [INSTALL.md](../INSTALL.md)), making it suitable for hotels and mess
facilities that need full control over their data and cannot rely on cloud connectivity.

## 2. Technology Stack

SAM is a two-codebase project colocated in a single repository (not a monorepo/workspace
setup):

| Layer | Technology | Approx. size |
|---|---|---|
| Frontend | React 19 + TypeScript, Vite 7, react-router-dom v7 | ~10,900 lines across 102 files (`src/`) |
| UI Kit | shadcn/ui ("new-york" style) on Radix primitives + Tailwind CSS | 50+ prebuilt primitives in `src/components/ui/` |
| Backend | FastAPI (Python), SQLAlchemy ORM | ~6,450 lines across 40+ files (`backend/`) |
| Database | SQLite (single file, `backend/hotel_mess.db`) | 49 model classes across 17 domains |
| Auth | JWT bearer tokens, bcrypt password hashing | — |

**~63% of the codebase (by line count) is the React/TypeScript frontend**, with the
remaining ~37% being the FastAPI/Python backend — reflecting that SAM is a
UI-heavy operational tool: most of the engineering surface is the forms, tables,
dashboards, and role-based views that staff interact with all day, backed by a leaner
API and data layer.

In development, Vite (port 3000) proxies API calls to FastAPI (port 8000). In
production, `npm run build` outputs a static `dist/`, and `backend/main.py` mounts it
directly and serves `index.html` for any non-API route — so the entire application runs
from a single FastAPI process on one port, with no separate frontend server to deploy or
maintain.

## 3. Problem Statement

### Overview

Mess and hotel facilities that rely on manual, register-based systems to record
bookings, kitchen inventory, billing, and security logs are at high risk of financial
loss. These paper-based or spreadsheet-based methods create redundant data entry, lack
any centralized check-and-balance mechanism, and leave each department operating as a
disconnected system. The result is reduced transparency, increased human error, and a
wide window during which losses go undetected. This exposure is not just hearsay:
industry-wide, organizations lose an estimated 5 percent of annual revenue to fraud each
year, and research from the Association of Certified Fraud Examiners (ACFE) found that
close to half of fraud cases occurred specifically because organizations lacked adequate
internal controls, confirming that the absence of structured verification, not just bad
actors, is itself the primary driver of loss.

### Kitchen Inventory Vulnerabilities

Within the kitchen and procurement function specifically, four compounding weaknesses
exist under the current manual system.

- **Inventory Blind Spot:** Manual stock logs for bulk commodities (Chawal, Tel, Daal,
  Gosht) carry no central authorization layer, allowing high-value items to vanish with
  no systemic tracing. This aligns with ACFE findings that theft or misuse of assets,
  including misuse of inventory, is the most common form of occupational fraud,
  accounting for the large majority of cases globally.
- **Vendor Invoice Fraud:** Incoming stock is accepted with no audit trail connecting
  the purchase order, delivery note, and physical goods received, leaving purchasing
  transactions unverified at the point of entry.
- **Food Cost Bleeding:** Meal planning operates without an integrated system between
  portions planned, portions served, and waste discarded. This mirrors a sector-wide
  pattern: food service operations globally account for roughly 26 percent of all food
  waste generated, a share that UN-affiliated research identifies as a priority area for
  intervention through better tracking technology and practices. Separately, food waste
  has been shown to erode restaurant and food service profit margins by up to 4 percent,
  an avoidable loss directly tied to the absence of portion-level tracking.
- **Authorization Failure:** Routine, low-value approvals are processed through the
  same manual chain as high-value transactions, freezing daily kitchen operations and
  delaying stock updates that should be instantaneous.

### Hotel-Wide Vulnerabilities

These same structural weaknesses extend beyond the kitchen into booking, security, and
billing operations. Guest check-in and movement are tracked manually with no live,
verifiable record accessible to security staff. Bookings, room status, and billing exist
as separate records maintained by separate departments, so a booking can be confirmed in
one register without being reflected in occupancy status or billing in another, creating
space for unbilled stays, double-bookings, or unverified guest entries. Without a shared
verification layer across departments, reconciling these records after the fact is slow
and error-prone, and discrepancies are typically caught only during periodic manual
audits rather than at the moment they occur.

### Root Cause

All of the above vulnerabilities trace back to one structural issue: every department,
including procurement, kitchen inventory, billing, booking, and security, functions as
an isolated, decentralized system. Data entered in one register is not automatically
verified against or reflected in another, so cross-checking depends entirely on manual
reconciliation. This is precisely the gap that internal-control research identifies as
the leading cause of undetected organizational loss.

## 4. Proposed Solution

### Core Infrastructure & Governance

- **Centralized Platform:** Replaces disconnected manual systems with a unified
  database, enabling cross-departmental data sharing for procurement, inventory,
  billing, and security.
- **Permanent, unchangeable records:** Every create/update/delete/approve action is
  written to an immutable audit log with before/after snapshots, ensuring transparency
  and accountability for all transactions.
- **Access control based on user roles:** System access is restricted by a
  Role → Permission → User model (industry-standard RBAC), minimizing insider-threat
  risk and simplifying audit trails. Supervisors bypass restrictions; every other role is
  scoped to the modules and actions it needs.
- **Rules-Based Alert Engine:** Provides real-time notifications for unusual activity,
  such as billing mismatches, low stock, or unauthorized access attempts.

### Inventory & Procurement Management

- **End-to-End Procurement:** Integrates verifying purchase orders against delivery
  notes and actual receipts (three-way match) to automate purchasing and verification.
- **Advanced Inventory Control:** Manages stock levels split by zone (warehouse/kitchen)
  with detailed user access, instant deductions, and automated cycle counts, reducing
  manual stock logging errors.
- **Waste & Recipe Integration:** Ties ingredient deductions directly to recipes and
  kitchen orders, providing a closed-loop system for tracking usage and waste.
- **Storage & Expiry Management:** Enforces first-in-first-out stock batch handling to
  proactively manage inventory and reduce spoilage.

## 5. Feature Modules

SAM is organized into role-gated modules, each backed by its own FastAPI router and
frontend page, and each toggleable per-department via runtime feature flags:

| Module | What it covers |
|---|---|
| **Dashboard** | Cross-department KPI overview and quick links |
| **Inventory** | Categories, items, stock batches (warehouse/kitchen zones), stock movements, waste logs, cycle counts |
| **Procurement** | Vendors, purchase orders, delivery/three-way match against goods received |
| **Kitchen** | Recipes (ingredients sourced from inventory), production/kitchen orders with SLA timers, à la carte ordering |
| **Bookings** | Rooms, room status, guest bookings, guest movement tracking |
| **Billing** | Guest invoices, invoice line items, payments |
| **Mess Billing** | Member-based mess billing, meal attendance, guest meal charges |
| **Members & Attendance** | Member records, leave, per-meal attendance tracking |
| **Clerk Desk** | Fast front-desk / instant checkout workflow |
| **Security** | Security logs, incident reports, guest movement visibility |
| **Users & Roles** | User accounts, role definitions, module/action-level permissions |
| **Audit Log** | Immutable, queryable record of every mutating action system-wide |
| **Alerts** | Rules-based real-time notifications (billing mismatches, stock thresholds, access anomalies) |
| **Reports** | Cross-module reporting and export |
| **Import/Export** | Bulk data import/export (Excel via `openpyxl`) |
| **Settings & Branding** | System settings, backup/retention policy, white-label branding |

## 6. Workflow

A typical operational flow through the system looks like this:

1. **Procurement → Inventory.** A purchase order is raised against a vendor. When
   goods arrive, the delivery is checked against the PO and physical receipt via a
   three-way match before the stock batch is created — closing the "accepted with no
   audit trail" gap described in the problem statement.
2. **Inventory → Kitchen.** Recipes reference inventory items directly. When a kitchen
   order is produced, ingredient quantities are deducted automatically from stock,
   linking planned portions, served portions, and waste in one closed loop instead of
   three disconnected logs.
3. **Bookings → Billing.** A room booking updates room status in real time; guest
   movement (check-in/out) is logged and visible to Security immediately. Charges from
   bookings, à la carte kitchen orders, and mess bills all flow into a single invoice per
   guest/member, removing the double-entry gap between booking, occupancy, and billing
   registers.
4. **Mess Billing.** Members are tracked separately from hotel guests: meal attendance
   is recorded per meal type, leave is tracked, and mess bills are generated from actual
   attendance rather than flat estimates.
5. **Every mutation → Audit Log + Alerts.** Every create/update/delete/approve action
   across every module above is written to an immutable audit record with a
   before/after snapshot, and the rules-based alert engine evaluates each transaction for
   anomalies (e.g. a billing total that doesn't reconcile, an access attempt outside a
   role's permissions) and surfaces it in real time rather than at the next manual audit.
6. **Role-scoped visibility.** Every screen and action above is gated by the
   RBAC permission model, so a kitchen staff member cannot approve a high-value purchase
   order, and a front-desk clerk cannot edit security logs — routine low-value actions
   move fast, while high-value/cross-department actions stay checked.

## 7. Expected Outcome

By centralizing data, enforcing role-based access, applying cross-verification before
transactions are committed, and maintaining secure, unchangeable records, the system is
designed to close the detection window for operational loss from months down to days —
while requiring no new infrastructure beyond what the existing FastAPI, React, and
SQLite-based platform already supports.
