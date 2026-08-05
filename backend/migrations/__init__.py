"""One-off, idempotent schema patches for databases created before a model
change, since this app has no real migration tooling (Alembic is a vendored
dependency, never invoked - schema evolution is Base.metadata.create_all()
only, which adds new tables but never alters existing ones). Call
run_startup_migrations(engine) once, right after create_all(), on every
startup - each check is a no-op once applied.

Split into one file per domain (see docs/MODULE_STRUCTURE.md) - each exports
a MIGRATIONS list. Add a new patch to an existing domain by appending to that
domain's list; only edit this file when adding a brand-new domain."""
from backend.migrations import access, rooms, bookings, billing, inventory, kitchen, attendance, mess_billing, members, alerts, events

_DOMAINS = (access, rooms, bookings, billing, inventory, kitchen, attendance, mess_billing, members, alerts, events)


def run_startup_migrations(engine):
    for domain in _DOMAINS:
        for migrate_fn in domain.MIGRATIONS:
            migrate_fn(engine)
