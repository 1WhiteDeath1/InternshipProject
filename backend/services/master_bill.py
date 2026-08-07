"""The universal paper-form bill: one fixed vocabulary of line items shared
by BOTH the guest/room Invoice and the member MessBill, so the Interactive
Invoice Table and the printable template render identically regardless of
which pipeline the bill came from. Auto-populated rows pull from data the
system already computes; everything else is a preset head a Clerk can log an
ad-hoc charge under (BookingCharge for a guest bill, MessBillCharge for a
member bill) - unused rows simply don't appear. Any ad-hoc charge whose head
ISN'T one of these presets still prints, appended after the fixed rows, so a
genuinely one-off charge is never silently dropped."""

# Exact order/wording from the physical EME Officers Mess bill register.
MASTER_BILL_LINE_ITEMS = [
    "Last Debit Balance",
    "Messing attendance",
    "Table Money",
    "Extra Messing",
    "Bar",
    "Mess Subscription",
    "Masjid",
    "Tea Bar EME Dte",
    "Wages of Servants",
    "Furniture",
    "Library Subs / News Paper",
    "Garden",
    "Sport",
    "Sweeper",
    "Dhobi",
    "Guest Room Charges",
    "Sui Gas Charges on Messing / Extra Messing",
    "Hot Water / Heater / AC Charges",
    "Extra Mettress",
    "Generator Charges",
    "MOQ Charges",
    "Breakage",
    "Saving",
    "Sui Gas Bill",
    "Band Fund EME Dte Offrs",
    "Trophy Fund EME Dte Offrs",
    "ACL Subs EME Dte Offrs",
    "ACWF EME Dte Offrs",
    "Cen Compulsory Gp Insurance",
    "Cable Fee",
    "Normal Electric Charges",
    "Ladies Club",
]

# Preset heads a Clerk can pick when logging an ad-hoc charge against either
# bill type - the paper form's line items minus the ones this system already
# auto-computes (those aren't offered as presets since manually adding one
# would double-count against the auto row of the same name).
_AUTO_COMPUTED = {"Last Debit Balance", "Messing attendance", "Extra Messing", "Guest Room Charges", "Sui Gas Charges on Messing / Extra Messing", "Extra Mettress"}
MASTER_BILL_PRESET_HEADS = [h for h in MASTER_BILL_LINE_ITEMS if h not in _AUTO_COMPUTED]


def assemble_rows(*, entries: list[dict], last_debit_balance: float, credits: float) -> dict:
    """entries is a flat, source-agnostic list of {label, amount, reason?} -
    already-computed InvoiceItem lines for a guest bill, or auto-computed +
    MessBillCharge lines for a member bill; the caller does the source-
    specific work of getting there. Same-label entries are summed together;
    anything matching the paper form's fixed vocabulary is emitted in that
    exact order, everything else (a genuinely one-off charge, e.g. Late
    Checkout Fee) is appended after instead of being dropped. Returns
    {rows, total_debit, credits, net_debits} - what the table/print both consume."""
    by_label: dict[str, float] = {}
    reasons: dict[str, str] = {}
    extra_rows = []
    for e in entries:
        label, amount, reason = e["label"], e["amount"], e.get("reason")
        if not amount:
            continue
        if label in MASTER_BILL_LINE_ITEMS:
            by_label[label] = by_label.get(label, 0) + amount
            if reason and label not in reasons:
                reasons[label] = reason
        else:
            extra_rows.append({"label": label, "amount": amount, "reason": reason})

    if last_debit_balance:
        by_label["Last Debit Balance"] = by_label.get("Last Debit Balance", 0) + last_debit_balance

    rows = [{"label": label, "amount": by_label[label], "reason": reasons.get(label)} for label in MASTER_BILL_LINE_ITEMS if label in by_label]
    rows.extend(extra_rows)

    total_debit = sum(r["amount"] for r in rows)
    net_debits = total_debit - credits
    return {"rows": rows, "total_debit": total_debit, "credits": credits, "net_debits": net_debits}
