"""Mess billing domain migrations."""
from sqlalchemy import text
from backend.logging_config import get_logger

logger = get_logger("app")


def _migrate_mess_bills_ala_carte(engine):
    # A member's own a la carte custom-order charges for the period, folded
    # into their monthly statement alongside the existing extra_meals_amount.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(mess_bills)")).fetchall()
        if not cols:
            return
        if "ala_carte_amount" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE mess_bills ADD COLUMN ala_carte_amount NUMERIC(12, 2) DEFAULT 0"))
            conn.commit()
            logger.info("migration: added mess_bills.ala_carte_amount")


def _migrate_mess_bills_master_bill_fields(engine):
    # Universal master bill (services/master_bill.py): payment tracking
    # (MessBill had none), Clerk-entered carry-forward balance, physical
    # bill-book serial (matches invoices.bill_serial_number), and the
    # "Make Bill" locked/draft state.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(mess_bills)")).fetchall()
        if not cols:
            return
        col_names = {c[1] for c in cols}
        additions = (
            ("last_debit_balance", "NUMERIC(12, 2) DEFAULT 0"),
            ("amount_paid", "NUMERIC(12, 2) DEFAULT 0"),
            ("bill_serial_number", "VARCHAR(50)"),
            ("bill_made_at", "DATETIME"),
        )
        for name, ddl_type in additions:
            if name not in col_names:
                conn.execute(text(f"ALTER TABLE mess_bills ADD COLUMN {name} {ddl_type}"))
                logger.info("migration: added mess_bills.%s", name)
        conn.commit()


def _migrate_mess_bill_payments_voucher_number(engine):
    # Split-payment architecture: voucher_number (required for
    # online_ag_branch, optional for bank_transfer) mirrors
    # InvoicePayment.voucher_number so the same Payment Receipt Slip
    # template/logic works for either bill type.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(mess_bill_payments)")).fetchall()
        if not cols:
            return
        if "voucher_number" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE mess_bill_payments ADD COLUMN voucher_number VARCHAR(50)"))
            conn.commit()
            logger.info("migration: added mess_bill_payments.voucher_number")


def _migrate_mess_bills_gas_amount(engine):
    # Per-dish gas charge for a member's routine dining (see
    # mess_charge_calc.get_member_gas_total), replacing the old read-only
    # "% of Extra Messing" estimate shown on the printed Master Bill.
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(mess_bills)")).fetchall()
        if not cols:
            return
        if "gas_amount" not in {c[1] for c in cols}:
            conn.execute(text("ALTER TABLE mess_bills ADD COLUMN gas_amount NUMERIC(12, 2) DEFAULT 0"))
            conn.commit()
            logger.info("migration: added mess_bills.gas_amount")


MIGRATIONS = [
    _migrate_mess_bills_ala_carte, _migrate_mess_bills_master_bill_fields,
    _migrate_mess_bill_payments_voucher_number, _migrate_mess_bills_gas_amount,
]
