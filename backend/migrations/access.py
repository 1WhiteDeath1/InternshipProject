"""Access domain migrations: the RBAC role seed/reconcile."""
from sqlalchemy.orm import Session
from backend.logging_config import get_logger

logger = get_logger("app")

_ROLE_PERMISSIONS = {
    # (module -> letters, V=view C=create E=edit A=approve). Access maps to the
    # role's JOB, not to seniority - a higher role is NOT "everyone's modules,
    # read-only". Manager/Deputy do oversight, approvals, policy and admin; they
    # get NONE of the operational transaction modules (bookings, billing, clerk
    # desk, kitchen, inventory, mess billing, attendance, security), because the
    # information they'd want from those already reaches them summarized on the
    # dashboard/reports. Operating those modules is the NCOs'/Clerk's job.
    "Manager": {
        # Oversight (read summaries, act on alerts/incidents at a supervisory level)
        "reports": "V", "audit": "V", "alerts": "VE",
        # Money authority: sign off SPEND (POs) via the Approvals inbox. Concessions
        # (discounts/comps) are the Clerk's job - Manager oversees them via reports.
        "procurement": "VA",
        # Policy: rate cards and menu pricing are management decisions
        "tariffs": "VE", "womens_bloc_rates": "VE", "menu_prices": "VE",
        # Administration: staff/access, the member roster (master-data), and system config
        "users": "VCE", "roles": "VCE", "members": "VCE",
        "settings": "VE", "features": "VE", "backup": "VC", "branding": "VE", "import_export": "VC",
    },
    # Acting-manager oversight. Same shape as Manager MINUS: users/roles (no access
    # admin), audit + alerts (no logs), members (PII), and discount authority. Keeps
    # PO sign-off (spend), policy/rate-setting, system config, and reports.
    "Deputy Manager": {
        "reports": "V",
        "procurement": "VA",
        "tariffs": "VE", "womens_bloc_rates": "VE", "menu_prices": "VE",
        "settings": "VE", "features": "VE", "backup": "VC", "branding": "VE",
    },
    # Owns billing/finalization end-to-end: invoice + mess-bill discounts,
    # complimentary bills, and settlement. This is where all concessions live.
    "Clerk": {
        "clerk_desk": "VCEA", "billing": "VE", "mess_billing": "VEA",
        "bookings": "V", "guests": "V", "members": "V",
        "menu_prices": "V", "tariffs": "V", "womens_bloc_rates": "V",
    },
    "Kitchen NCO": {
        "inventory": "VCE", "kitchen": "VCE", "recipes": "VCE", "procurement": "VC",
        "menu_prices": "V", "attendance": "VCE",
    },
    "Booking NCO": {
        "bookings": "VCE", "guests": "VCE", "attendants": "VCE",
        "billing": "VC", "mess_billing": "VC",
        "members": "V", "tariffs": "V", "womens_bloc_rates": "V",
    },
    "Security Guard": {
        "security": "VC", "guests": "V", "members": "V", "attendants": "V",
    },
}
_ROLE_DESCRIPTIONS = {
    "Manager": "Oversight, PO approvals, rate/pricing policy, and staff/system administration - no hands-on operational work",
    "Deputy Manager": "Acting-manager oversight, PO approvals, and policy - no user/role admin, logs, PII, or discount authority",
    "Clerk": "Owns billing end-to-end - invoice/mess-bill discounts, complimentary bills, and settlement",
    "Kitchen NCO": "Inventory, kitchen production, recipe costing, and raising purchase orders",
    "Booking NCO": "Front desk - bookings, guest/attendant registration, charge logging",
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
