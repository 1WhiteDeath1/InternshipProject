"""Billing domain migrations."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


def _migrate_invoices_bill_type(engine):
    # Room-bill / mess-bill split at checkout. Additive with default; older
    # single invoices remain 'combined'.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(invoices)")).fetchall()
        if not cols:
            return
        if "bill_type" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN bill_type VARCHAR(20) DEFAULT 'combined'"))
            conn.commit()
            logger.info("migration: added invoices.bill_type")


def _migrate_invoices_complimentary(engine):
    # Lets staff mark an invoice fully complimentary (Rs 0) with a reason,
    # distinct from a partial discount. Additive, nullable/defaulted.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(invoices)")).fetchall()
        if not cols:
            return
        col_names = {c[1] for c in cols}
        if "is_complimentary" not in col_names:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN is_complimentary BOOLEAN DEFAULT 0"))
            logger.info("migration: added invoices.is_complimentary")
        if "complimentary_reason" not in col_names:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN complimentary_reason TEXT"))
            logger.info("migration: added invoices.complimentary_reason")
        conn.commit()


def _migrate_invoices_guest_walkin(engine):
    """Let an invoice belong to a standalone walk-in mess guest (no room).
    Adds invoices.guest_id and drops the NOT NULL on booking_id. SQLite can't
    ALTER a column's NOT NULL, so this rebuilds the table once. Idempotent:
    re-runs no-op once guest_id exists and booking_id is nullable. FK
    enforcement is ON (database.py), so the swap runs on a raw connection with
    foreign_keys OFF, toggled outside a transaction where the pragma takes
    effect; child ids in invoice_items/payments/edit_requests stay valid
    because row ids are preserved through the copy."""
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(invoices)")).fetchall()
    if not cols:
        return
    col_names = [c[1] for c in cols]
    booking_notnull = next((c[3] for c in cols if c[1] == "booking_id"), 0)
    if "guest_id" in col_names and not booking_notnull:
        return  # already migrated

    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("PRAGMA foreign_keys=OFF")
        cur.execute("""
            CREATE TABLE invoices_new (
                id INTEGER NOT NULL PRIMARY KEY,
                invoice_number VARCHAR(50) NOT NULL,
                booking_id INTEGER,
                guest_id INTEGER,
                issue_date DATE NOT NULL,
                due_date DATE NOT NULL,
                subtotal NUMERIC(10, 2) NOT NULL,
                tax_amount NUMERIC(10, 2),
                discount NUMERIC(10, 2),
                total_amount NUMERIC(10, 2) NOT NULL,
                amount_paid NUMERIC(10, 2),
                status VARCHAR(20),
                bill_type VARCHAR(20),
                is_complimentary BOOLEAN,
                complimentary_reason TEXT,
                notes TEXT,
                created_by INTEGER,
                created_at DATETIME,
                UNIQUE (invoice_number),
                FOREIGN KEY(booking_id) REFERENCES bookings (id),
                FOREIGN KEY(guest_id) REFERENCES guests (id),
                FOREIGN KEY(created_by) REFERENCES users (id)
            )
        """)
        # Copy exactly the columns that exist today (all are in the new schema);
        # guest_id is the only new column and defaults to NULL.
        carried = ", ".join(col_names)
        cur.execute(f"INSERT INTO invoices_new ({carried}) SELECT {carried} FROM invoices")
        cur.execute("DROP TABLE invoices")
        cur.execute("ALTER TABLE invoices_new RENAME TO invoices")
        raw.commit()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()
        logger.info("migration: rebuilt invoices (guest_id added, booking_id now nullable)")
    finally:
        raw.close()


def _migrate_invoices_event_id(engine):
    # Lets an invoice belong to an event/hall booking (bill_type='event'),
    # paired with guest_id. Additive/nullable - the events table is created
    # fresh by create_all() before migrations run, so the FK target exists.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(invoices)")).fetchall()
        if not cols:
            return
        if "event_id" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN event_id INTEGER REFERENCES events(id)"))
            conn.commit()
            logger.info("migration: added invoices.event_id")


def _migrate_edit_requests_item_id_nullable(engine):
    """Lets a bill-correction request add a new line under a head that's
    currently zero/uncharged, not just correct an existing one - the
    request then carries invoice_id but no invoice_item_id. SQLite can't
    ALTER a column's NOT NULL away, so this rebuilds the table once (same
    technique as _migrate_invoices_guest_walkin above). Idempotent: a
    fresh PRAGMA read on invoice_item_id's notnull flag decides whether to
    run at all."""
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(invoice_edit_requests)")).fetchall()
    if not cols:
        return
    item_notnull = next((c[3] for c in cols if c[1] == "invoice_item_id"), 0)
    if not item_notnull:
        return  # already migrated

    col_names = [c[1] for c in cols]
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("PRAGMA foreign_keys=OFF")
        cur.execute("""
            CREATE TABLE invoice_edit_requests_new (
                id INTEGER NOT NULL PRIMARY KEY,
                invoice_item_id INTEGER,
                invoice_id INTEGER NOT NULL,
                original_description VARCHAR(255) NOT NULL,
                original_unit_price NUMERIC(10, 2) NOT NULL,
                proposed_description VARCHAR(255) NOT NULL,
                proposed_unit_price NUMERIC(10, 2) NOT NULL,
                reason TEXT NOT NULL,
                status VARCHAR(20),
                requested_by INTEGER,
                requested_at DATETIME,
                decided_by INTEGER,
                decided_at DATETIME,
                decision_reason TEXT,
                FOREIGN KEY(invoice_item_id) REFERENCES invoice_items (id),
                FOREIGN KEY(invoice_id) REFERENCES invoices (id),
                FOREIGN KEY(requested_by) REFERENCES users (id),
                FOREIGN KEY(decided_by) REFERENCES users (id)
            )
        """)
        carried = ", ".join(col_names)
        cur.execute(f"INSERT INTO invoice_edit_requests_new ({carried}) SELECT {carried} FROM invoice_edit_requests")
        cur.execute("DROP TABLE invoice_edit_requests")
        cur.execute("ALTER TABLE invoice_edit_requests_new RENAME TO invoice_edit_requests")
        raw.commit()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()
        logger.info("migration: rebuilt invoice_edit_requests (invoice_item_id now nullable)")
    finally:
        raw.close()


def _migrate_invoices_bill_serial_number(engine):
    # Manually-entered physical bill-book serial, distinct from the
    # system-generated invoice_number. Additive/nullable.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(invoices)")).fetchall()
        if not cols:
            return
        if "bill_serial_number" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN bill_serial_number VARCHAR(50)"))
            conn.commit()
            logger.info("migration: added invoices.bill_serial_number")


def _migrate_invoice_payments_ag_branch(engine):
    # AG Branch 10% advance-deduction tracking on the online-advance payment
    # row (services/master_bill.py's sibling concern, tracked here since it
    # lives on InvoicePayment). Additive/nullable.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(invoice_payments)")).fetchall()
        if not cols:
            return
        col_names = {c[1] for c in cols}
        if "voucher_number" not in col_names:
            conn.execute(text("ALTER TABLE invoice_payments ADD COLUMN voucher_number VARCHAR(50)"))
            logger.info("migration: added invoice_payments.voucher_number")
        if "ag_branch_fee" not in col_names:
            conn.execute(text("ALTER TABLE invoice_payments ADD COLUMN ag_branch_fee NUMERIC(10, 2)"))
            logger.info("migration: added invoice_payments.ag_branch_fee")
        conn.commit()


def _migrate_invoice_items_reason(engine):
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(invoice_items)")).fetchall()
        if not cols:
            return
        if "reason" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE invoice_items ADD COLUMN reason VARCHAR(255)"))
            conn.commit()
            logger.info("migration: added invoice_items.reason")


def _migrate_invoices_master_bill_fields(engine):
    # Universal master bill (services/master_bill.py): Clerk-entered
    # carry-forward balance and the "Make Bill" locked/draft state.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(invoices)")).fetchall()
        if not cols:
            return
        col_names = {c[1] for c in cols}
        if "last_debit_balance" not in col_names:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN last_debit_balance NUMERIC(10, 2) DEFAULT 0"))
            logger.info("migration: added invoices.last_debit_balance")
        if "bill_made_at" not in col_names:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN bill_made_at DATETIME"))
            logger.info("migration: added invoices.bill_made_at")
        conn.commit()


MIGRATIONS = [
    _migrate_invoices_bill_type,
    _migrate_invoices_complimentary,
    _migrate_invoices_guest_walkin,
    _migrate_invoices_event_id,
    _migrate_edit_requests_item_id_nullable,
    _migrate_invoices_bill_serial_number,
    _migrate_invoice_payments_ag_branch,
    _migrate_invoice_items_reason,
    _migrate_invoices_master_bill_fields,
]
