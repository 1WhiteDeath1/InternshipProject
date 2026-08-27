# Module Structure & Contribution Convention

How this codebase is split so multiple contributors, any number of them working at the same time, can extend it without merge conflicts. For general architecture see `ARCHITECTURE.md`; for the guest/member/booking/billing domain's implementation detail see `docs/MODULES.md`. This doc is about *where new code goes* and *why*, not what any specific feature does.

## What a "module" is here

One domain concern (bookings, inventory, billing, security, ...), expressed as up to five parallel files that always move together:

- `backend/models/<domain>.py` — SQLAlchemy models
- `backend/schemas/<domain>.py` — Pydantic request/response schemas
- `backend/routers/<domain>.py` — FastAPI endpoints
- `backend/migrations/<domain>.py` — schema-patch functions (only if the domain has ever needed one)
- `src/pages/<Domain>.tsx` — the frontend page (where the domain has a dedicated page)

The domain list today:

| Domain | Models | Schemas | Router |
|---|---|---|---|
| `access` | Role, RolePermission, User | ✓ | `auth`, `users`, `roles` |
| `system` | FeatureFlag, SystemSetting | ✓ | `features`, `settings` |
| `audit` | AuditLog | ✓ | `audit` |
| `alerts` | Alert | ✓ | `alerts` |
| `inventory` | InventoryCategory, InventoryItem, StockBatch, StockMovement, WasteLog, CycleCount | ✓ | `inventory` |
| `kitchen` | MenuItem, MenuItemEditRequest, GasChargeRate, GasChargeRateHistory, KitchenOrder | ✓ | `kitchen` |
| `procurement` | Vendor (self-purchase lookup list only — no PO workflow, see Inventory's `StockBatch.vendor_id`) | ✓ | `procurement` |
| `rooms` | Room, Attendant, RoomPhoto | ✓ | `attendants` (room CRUD lives in `bookings` router) |
| `rates` | RoomRate, DutyRate, HraRankRate, WomensBlocRankRate, HraUtilityRate, TariffRate | ✓ | `tariffs`, `womens_bloc_rates` |
| `guests` | Guest | ✓ | `guests` |
| `bookings` | Booking, BookingCharge, SmsMessage, GuestMovement | ✓ | `bookings` |
| `billing` | Invoice, InvoiceItem, InvoicePayment | ✓ | `billing` |
| `security` | SecurityLog, IncidentReport | ✓ | `security` |
| `members` | Member, MemberLeave | ✓ | `members` |
| `attendance` | MealAttendance | ✓ | `attendance` |
| `mess_billing` | MessBill, GuestMealCharge | ✓ | `mess_billing` |

`models/enums.py` holds every model-layer enum in one place (shared across domains, so no domain file imports another's enum — enums are rarely touched, so this isn't a real conflict surface). `schemas/common.py` holds the genuinely cross-cutting shapes with no single domain owner (`Token`, `PaginatedResponse`, `DashboardStats`, `BrandingConfig`, etc.) plus two tiny shared validators (`_ensure_meal_type`, `_check_exactly_one_consumer`) used by both `attendance` and `mess_billing`.

## The core rule: extend, don't centralize

A new field, model, schema, or endpoint for an **existing** domain goes into that domain's existing file. Never add it to a shared/common file, and never create a second file for a domain that already has one. If you're adding a column to `Booking`, it goes in `models/bookings.py` — not `models/common.py`, not a new `models/bookings2.py`.

## Creating a genuinely new module

When a feature doesn't fit any existing domain, create it consistently:

1. `models/<new>.py` (if it has its own tables)
2. `schemas/<new>.py` (if it has its own request/response shapes)
3. `routers/<new>.py` (it almost always needs one)
4. `migrations/<new>.py` (only once it needs its first schema patch — don't create an empty file up front)

Then register it exactly once each in `models/__init__.py`, `schemas/__init__.py`, `backend/routers/__init__.py`, `backend/main.py`, and (if applicable) `migrations/__init__.py`.

**Litmus test**: if you're asking "which existing file does this belong in?" and the honest answer is "none, it's really its own thing," it's a new module. Don't force-fit it into the nearest existing one just to avoid the extra file — that's exactly how a domain file quietly turns back into a shared monolith.

## The re-export contract

`models/__init__.py` and `schemas/__init__.py` re-export every public name from every domain submodule (`from backend.models.<domain> import X, Y` style, collected into one `__all__`). Every consumer in the codebase does `from backend.models import X` / `from backend.schemas import X` regardless of which submodule `X` actually lives in — that's what let this split happen with zero changes to any router or service file. **Adding a class to a domain file without adding it to the matching `__init__.py` import list breaks every importer of that name.** Always update both in the same change.

## The migrations contract

Each `migrations/<domain>.py` exports `MIGRATIONS: list[Callable[[Engine], None]]`. To add a new patch to an *existing* domain, write the function and append it to that file's own `MIGRATIONS` list — never touch `migrations/__init__.py` for this. Only add a line to `migrations/__init__.py`'s `_DOMAINS` tuple when a domain gets its *first* migration file.

## The append-only lists

`backend/main.py` (`app.include_router(...)`), `backend/routers/__init__.py` (router imports), `src/App.tsx` (`<Route>` entries), and `src/components/Layout.tsx` (`navItems`) are still flat lists touched by every domain — but each entry is one self-contained line. New entries always go at the end; never reorder or reformat existing lines just because you're nearby. This single habit is what lets unrelated additions from different contributors merge without a conflict, no matter how many people are working at once.

## Cross-module imports

Allowed, but must be one-directional. Today's real example: `schemas/guests.py` imports `GuestBookingSummary` from `schemas/bookings.py` and `GuestInvoiceSummary` from `schemas/billing.py` (a guest profile embeds booking/invoice summaries) — `bookings.py` and `billing.py` never import from `guests.py`. Before adding a cross-module import, check the direction doesn't already flow the other way; a cycle between two domain files is the one way this structure can actually break Python's import system.

## Dividing work across any number of contributors

Because every module is a self-contained set of files, ownership is "how many modules does each contributor take," not a fixed headcount split — it works the same whether it's 2 contributors or 5:

- **One module = one unit of ownership.** Never split a single module's files between two people working at the same time.
- Whoever's coordinating (a lead, or an agent asked to plan a sprint) divides the module list above into however many buckets the team actually has that week — there's no fixed assignment to preserve.
- A natural grouping when buckets need to be bigger than one module each: front-desk cluster (`bookings`, `rooms`, `rates`, `guests`, `security`, `billing`), kitchen/supply cluster (`inventory`, `kitchen`, `procurement`), and admin/mess cluster (`members`, `attendance`, `mess_billing`, `access`, `system`, `audit`, `alerts`) — split those three further, or combine them, based on actual headcount.

## Daily workflow discipline

The file split removes the *mechanical* cause of merge conflicts, but it only holds if the workflow around it does too:

- **Pull before you start work, every day** — not just before opening a PR. A conflict caught at the start of your session is a non-event; the same conflict discovered after two days of work is a real headache.
- **Keep PRs small and scoped to one module.** A PR that touches one domain's files merges clean same-day. A PR that drifts across several modules over a week is where real conflicts compound.
- **Never split a single module's files between two people working at the same time.** If two people genuinely need to touch the same module together, that's a signal to talk first (a quick message, not a design doc) — not something the file structure is meant to solve for you.
- **Respect the append-only lists** (see above) even under time pressure — add your line at the end, don't "clean up" or reorder while you're in there.
- **Reconcile your role/permission or migration additions the same way** — append to your own domain's list, run the app once locally to confirm it boots clean, then commit.

## Guidance for a contributor picking up a task here

1. Identify which module(s) the task touches before writing any code — check the table above.
2. If the task spans multiple modules, edit each module's own files. Don't reach into another module's file, and don't create a shared helper file to avoid touching two files.
3. If it's genuinely a new concern, follow "Creating a genuinely new module" above rather than bolting it onto the nearest existing module for convenience.
4. If you add or move a model/schema class, verify the `__init__.py` re-export list — an import that used to work (`from backend.models import X`) must keep working.
