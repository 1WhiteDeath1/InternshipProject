"""Access domain migrations: the RBAC role seed/reconcile."""
from sqlalchemy.orm import Session
from backend.logging_config import get_logger

logger = get_logger("app")

_ROLE_PERMISSIONS = {
    # (module -> letters, V=view C=create E=edit A=approve). Access maps to the
    # role's JOB, not to seniority - a higher role is NOT "everyone's modules,
    # read-only". Manager/Deputy do oversight, approvals, policy and admin; they
    # get NONE of the operational transaction modules (bookings, billing, clerk
    # desk, kitchen, inventory, mess billing, attendance, security) beyond the
    # few narrow, approve-only exceptions called out below - the information
    # they'd otherwise want already reaches them summarized on the
    # dashboard/reports. Operating those modules day-to-day is the NCOs'/Clerk's job.
    "Manager": {
        # Oversight (read summaries, act on alerts/incidents at a supervisory level)
        "reports": "V", "audit": "V", "alerts": "VE",
        # Money authority: sign off on a Clerk CORRECTING an already-generated
        # bill's line items (wrong rate/charge entered) via the Approvals
        # inbox, hence "A" only (no V/E/C - they act on the request, they
        # don't operate Billing itself). Procurement is view-only: the mess
        # buys and restocks itself (Kitchen NCO logs it via Daily Stock
        # Intake), there's no PO to sign off on - Manager just sees spend.
        # Deliberately NOT "inventory": Manager's stock visibility is a
        # Dashboard widget (StockOverviewWidget, reports:view-gated) rather
        # than the full Inventory & Procurement operational page - putting
        # inventory:view here would surface that whole page/nav item, which
        # is more than an "overview" and was explicitly walked back.
        "procurement": "V", "billing": "A",
        # Discount/complimentary authority for guests lives on the dedicated
        # Guest Discounts page (bookings:approve, below) - no clerk_desk
        # permission needed, Manager never operates Clerk Desk itself.
        # Read-only access to the Customer Directory (guest identity/history) so
        # Manager can look a guest up without needing Booking NCO's full module.
        "guests": "V",
        # View-only - lets Manager see the attendant directory and the
        # activity-history leaderboard (who's carrying more/less duty time)
        # without granting roster CRUD or clock in/out, which stay Booking
        # NCO's job (attendants: "VCE" below).
        "attendants": "V",
        # "A" only: lets Manager override a booking's client_category (and the
        # bill total that flows from it) via a dedicated endpoint, without
        # granting general bookings:view/edit - that stays Booking NCO's
        # module. A full bookings:view was explicitly walked back before (see
        # git history) because it would surface Booking NCO's operational
        # Bookings page (create/check-in/cancel/etc). rooms_overview below is
        # the narrower thing that was actually wanted: read-only room status,
        # calendar and booking history, with zero write affordances.
        "bookings": "A",
        # View-only oversight: room status/housekeeping, the property
        # calendar, and booking history - the Rooms page (src/pages/
        # RoomsOverview.tsx). Deliberately a separate module from "bookings"
        # so granting it can never also unlock Booking NCO's write-capable
        # Bookings page (see the comment above).
        "rooms_overview": "V",
        # Policy: rate cards are a management decision; menu changes are
        # Kitchen NCO-proposed but Manager approves ("A" only, same narrow-
        # slice pattern as billing corrections above). Mess/Gas charge rates
        # are Kitchen NCO's own call directly - Manager only views the trend.
        "tariffs": "VE", "womens_bloc_rates": "VE", "menu": "A", "mess_rates": "V",
        # Administration: staff/access, the member roster (master-data - also
        # fully owned operationally by Kitchen NCO, see its block below), and system config
        "users": "VCE", "roles": "VCE", "members": "VCE",
        "settings": "VE", "features": "VE", "backup": "VC", "branding": "VE", "import_export": "VC",
        # View-only - the Dashboard's Events widget summarizes what Deputy
        # Manager/Kitchen NCO are running; Manager doesn't operate it.
        "events": "V",
        # One-way instruction feed: Manager is the only sender ("C"), and can
        # also see directives addressed to their own role ("V") like everyone else.
        "directives": "VC",
    },
    # Acting-manager oversight. Same shape as Manager MINUS: users/roles (no access
    # admin), audit + alerts (no logs), members (PII), and discount authority. Keeps
    # policy/rate-setting, system config, and reports. Procurement is view-only,
    # same as Manager - see that block's comment (no PO to sign off on).
    # Tariffs are view-only here - room-rate policy is Manager's call alone.
    "Deputy Manager": {
        "reports": "V",
        "procurement": "V",
        # Same read-only Rooms page as Manager - see that role's comment.
        "rooms_overview": "V",
        "tariffs": "V", "womens_bloc_rates": "VE", "menu": "A", "mess_rates": "V",
        "settings": "VE", "features": "VE", "backup": "VC", "branding": "VE",
        # Owns hall/function event bookings end-to-end: creates them, sets
        # the hall/capacity/headcount, and is the one who postpones/cancels
        # if a capacity issue comes up (no automated conflict check exists).
        "events": "VCE", "directives": "V",
    },
    # Owns billing/finalization end-to-end: charge logging, invoicing, the
    # monthly mess-bill run, and settlement. Discount/complimentary authority
    # is Manager-only (see Manager's "clerk_desk": "A" above) - Clerk no longer
    # has "A" on clerk_desk, so the master-invoice discount action 403s here.
    # No bookings:view - the booking context a Clerk needs (dates, room, rate
    # breakdown) already surfaces inline in Clerk Desk/Checkout; the Bookings
    # page itself is Booking NCO's create/edit workspace, not a Clerk lookup.
    # No guests:view either - the Customer Directory isn't needed by either
    # money-facing or front-desk staff (see Booking NCO below).
    "Clerk": {
        "clerk_desk": "VCE", "billing": "VCE", "mess_billing": "VCEA",
        "members": "V", "tariffs": "V", "womens_bloc_rates": "V",
        # View-only - needs to see which events are completed and ready to
        # invoice; the actual invoice-generation endpoint is gated on
        # clerk_desk:create like every other invoice-creating action.
        "events": "V", "directives": "V",
    },
    "Kitchen NCO": {
        "inventory": "VCE", "kitchen": "VCE", "menu": "CE", "mess_rates": "VE",
        # "E" so a mistyped/renamed vendor can actually be fixed - vendors are
        # created inline during Daily Stock Intake and there's no other admin
        # surface for them (Import/Export only bulk-imports, it can't edit one).
        "procurement": "VCE",
        "attendance": "VCE",
        # Dining/non-dining member classification (incl. marking an HRA
        # resident who isn't actually eating there as non-dining) is a mess
        # concern, so Kitchen NCO gets full member access - not just a
        # dining-status toggle. No "bookings" permission at all - the
        # Bookings module (create/check-in/cancel rooms) is Booking NCO's
        # alone and is fully hidden/blocked for Kitchen NCO.
        "members": "VCE",
        # Full access: creates and manages events end-to-end (not just the
        # prep lifecycle), same shape as Deputy Manager's event ownership.
        "events": "VCE", "directives": "V",
        # Create-only: the meal-attendance omnibar needs to register a
        # walk-in guest's identity on the spot (no room booking involved) -
        # not the full Customer Directory, which stays Booking NCO/Manager's.
        "guests": "C",
    },
    # Front desk only - no billing/mess_billing (Clerk owns money end-to-end)
    # and no guests:view (the Customer Directory is dropped for this role too;
    # check-in's own name/CNIC autocomplete is carried by bookings:view
    # instead, see the /guests/search permission check in guests.py).
    "Booking NCO": {
        "bookings": "VCE", "attendants": "VCE",
        # Full edit: Booking NCO owns the HRA classification fields
        # (is_hra/hra_stay_type/dorm_location) since they're the ones
        # actually assigning rooms/registering dorm residents, not just
        # registering a brand-new member inline from the booking form. This
        # view is also is_hra-filtered server-side (see members.py's
        # list_members) - Booking NCO only ever sees HRA members here, non-
        # HRA roster management stays Kitchen NCO's/Manager's.
        "members": "VCE", "tariffs": "V", "womens_bloc_rates": "V", "directives": "V",
        # View-only - lets Booking NCO check a member's mess bills (Member
        # Ledger's Dining & Mess Account tab) when asked, without granting any
        # generate/correct/approve capability over billing itself.
        "mess_billing": "V",
    },
    # Gate only - no guest/member/attendant lookup, no directives. Everything
    # this role needs (check-in/out log, incident reports) lives inside the
    # security module itself.
    "Security Guard": {
        # "E" added so a guard can actually move their own incident reports
        # through investigating/resolved - previously no seeded role held
        # security:edit at all, so a filed incident could never be closed.
        "security": "VCE",
    },
}
_ROLE_DESCRIPTIONS = {
    "Manager": "Oversight, bill-correction approvals, sole discount/complimentary-bill authority (Guest Discounts and Member Discounts pages), booking category overrides, customer lookup, rate/pricing policy, and staff/system administration",
    "Deputy Manager": "Acting-manager oversight and policy - no user/role admin, logs, PII, or discount/correction authority",
    "Clerk": "Owns billing end-to-end - charge logging, invoicing, monthly mess bills, and settlement; bill corrections and all discounts/complimentary bills require the Manager to act directly",
    "Kitchen NCO": "Inventory, kitchen production, proposing menu/price changes, setting mess/gas charge rates, managing the dining member roster, and logging self-purchase stock intake",
    "Booking NCO": "Front desk - bookings and attendant registration only; billing and the customer directory belong to Clerk",
    "Security Guard": "Incident reports and security logs",
}
_ACTION_LETTERS = {"V": "view", "C": "create", "E": "edit", "A": "approve"}


def _migrate_seed_rbac_roles(engine):
    """Creates the six canonical operating roles and keeps their permission rows
    reconciled to the spec above on every startup - the code is the source of
    truth for the built-in roles. A role is created if its name is absent;
    if it already exists, its permission set is rewritten to match _ROLE_PERMISSIONS
    (so evolving the spec propagates without a manual reseed). This means the six
    built-ins are code-managed: to customize access, clone one into a new role via
    the Roles page rather than hand-editing a built-in (edits would be reverted on
    restart). Custom roles are never touched. No role sets is_supervisor - it's a
    blanket bypass of check_permission() that can't be scoped."""
    from backend.models import Role, RolePermission
    with Session(engine) as session:
        by_name = {r.name: r for r in session.query(Role).all()}
        changed = []
        for role_name, modules in _ROLE_PERMISSIONS.items():
            desired = {(m, _ACTION_LETTERS[l]) for m, letters in modules.items() for l in letters}
            role = by_name.get(role_name)
            if role is None:
                role = Role(name=role_name, description=_ROLE_DESCRIPTIONS.get(role_name), is_supervisor=False)
                session.add(role)
                session.flush()
                for module, action in desired:
                    session.add(RolePermission(role_id=role.id, module=module, action=action))
                changed.append(f"{role_name} (created)")
                continue
            # Existing built-in: reconcile description + permission rows to spec
            role.description = _ROLE_DESCRIPTIONS.get(role_name, role.description)
            current = {(p.module, p.action): p for p in role.permissions}
            current_keys = set(current)
            to_add = desired - current_keys
            to_remove = current_keys - desired
            for module, action in to_add:
                session.add(RolePermission(role_id=role.id, module=module, action=action))
            for key in to_remove:
                session.delete(current[key])
            if to_add or to_remove:
                changed.append(f"{role_name} (+{len(to_add)}/-{len(to_remove)})")
        if changed:
            session.commit()
            logger.info("migration: reconciled RBAC roles: %s", ", ".join(changed))


MIGRATIONS = [_migrate_seed_rbac_roles]
