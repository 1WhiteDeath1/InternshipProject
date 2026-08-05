"""Statistical anomaly detection - stdlib-only (no numpy/scipy in this environment)."""
import statistics
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text
from backend.models import Alert, AlertStatus, AlertSeverity, User
from backend.alerts import create_alert
from backend.logging_config import get_logger

logger = get_logger("app")

Z_SCORE_THRESHOLD = 2.0
MIN_WINDOW_SIZE = 10           # guard against unstable stdev on short history
LOOKBACK_DAYS = 90             # rolling window fed into mean/stdev
BENFORD_MIN_SAMPLE = 300       # Benford's Law needs a sizeable sample to be meaningful
BENFORD_EXPECTED = {1: .301, 2: .176, 3: .125, 4: .097, 5: .079, 6: .067, 7: .058, 8: .051, 9: .046}
BENFORD_CHI2_CRITICAL = 20.09  # alpha=0.01, df=8 - conservative, to cut false positives
MIN_STAFF_SAMPLE = 3           # need at least this many staff active in the window for "peer average" to mean anything
MIN_ACTIVITY_PER_STAFF = 5     # a staff member needs this many invoices/markings before their own rate is stable enough to judge


def _flag_staff_outliers(db: Session, rows: list[tuple[int, float, int]], module: str, entity_type: str, label: str) -> int:
    """rows: (user_id, rate, n) per staff member active in the window. Flags
    whoever sits >2 stdev ABOVE the peer mean - only the high side is a fraud
    signal here (discounting/comping/excusing *less* than peers isn't). One
    active alert per staff member at a time, same de-dupe shape as the
    existing day-based checks below, just keyed on the staff member instead
    of the date.

    Every flagged alert also gets a `detail` blob built from these same
    numbers - value/mean/stdev/z plus a `series` of every peer's rate
    (anonymized as "Peer N", this alert's own subject marked `highlight`) -
    so the Alerts page can draw a small bar chart instead of just the prose
    message. No new calculation, just the existing rate/mean/stdev/z
    structured for display."""
    if len(rows) < MIN_STAFF_SAMPLE:
        return 0
    values = [r for _, r, _ in rows]
    mean = statistics.mean(values)
    stdev = statistics.pstdev(values) or 1e-6

    count = 0
    for user_id, rate, n in rows:
        z = (rate - mean) / stdev
        if z <= Z_SCORE_THRESHOLD:
            continue
        existing = db.query(Alert).filter(
            Alert.module == module,
            Alert.entity_type == entity_type,
            Alert.entity_id == user_id,
            Alert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED]),
        ).first()
        if existing:
            continue

        user = db.query(User).filter(User.id == user_id).first()
        name = user.full_name if user else f"user #{user_id}"

        peer_n = 0
        series = []
        for uid, r, _n in sorted(rows, key=lambda row: row[1]):
            if uid == user_id:
                series.append({"label": "This Alert", "value": round(r * 100, 1), "highlight": True})
            else:
                peer_n += 1
                series.append({"label": f"Peer {peer_n}", "value": round(r * 100, 1), "highlight": False})

        create_alert(
            db,
            f"{label} Outlier: {name}",
            f"{name}'s {label.lower()} rate is {rate:.1%} across {n} records in the last {LOOKBACK_DAYS} days "
            f"(z={z:.2f}), vs. a {len(rows)}-staff peer average of {mean:.1%} (stdev {stdev:.1%}).",
            AlertSeverity.HIGH if z > 3 else AlertSeverity.MEDIUM,
            module,
            entity_type,
            user_id,
            detail={
                "kind": "peer", "unit": "%",
                "value": round(rate * 100, 1), "mean": round(mean * 100, 1), "stdev": round(stdev * 100, 1),
                "z": round(z, 2), "series": series,
            },
        )
        count += 1
    return count


def _trend_detail(series: list[tuple[str, float]], today_label: str, mean: float, stdev: float, z: float, unit: str) -> dict:
    """Same purpose as _flag_staff_outliers' inline detail block, for the
    day-series checks: structures the numbers already computed by the
    caller (mean/stdev/z over `series`) into a chart-ready shape - last 14
    days only, so the bar chart stays compact, with today's bar marked."""
    recent = series[-14:]
    return {
        "kind": "trend", "unit": unit,
        "value": round(series[-1][1], 2), "mean": round(mean, 2), "stdev": round(stdev, 2), "z": round(z, 2),
        "series": [{"label": lbl[5:], "value": round(v, 2), "highlight": lbl == today_label} for lbl, v in recent],
    }


def _daily_spend_per_active_booking(db: Session, days: int) -> list[tuple[str, float]]:
    """One row per day: (self-purchase stock spend / max(1, active bookings)).

    Mirrors the per-day loop pattern used by reports.py's revenue_trend/occupancy_trend
    rather than a single fancy SQL query, for consistency with the rest of the codebase.
    """
    today = date.today()
    series = []
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        day_start = datetime.combine(d, datetime.min.time())
        day_end = datetime.combine(d + timedelta(days=1), datetime.min.time())

        spend = db.execute(text("""
            SELECT COALESCE(SUM(quantity * unit_cost), 0) FROM stock_batches
            WHERE created_at >= :start AND created_at < :end
        """), {"start": day_start, "end": day_end}).scalar()

        active_count = db.execute(text("""
            SELECT COUNT(*) FROM bookings
            WHERE status IN ('checked_in', 'confirmed')
            AND check_in <= :day AND check_out >= :day
        """), {"day": d}).scalar()

        series.append((d.strftime("%Y-%m-%d"), float(spend) / max(1, active_count)))
    return series


def check_procurement_spend_zscore(db: Session, lookback_days: int = LOOKBACK_DAYS) -> int:
    """Flag the current day if self-purchase stock spend-per-active-booking deviates >2 stdev from the trailing mean."""
    series = _daily_spend_per_active_booking(db, lookback_days)
    if len(series) < MIN_WINDOW_SIZE + 1:
        logger.info("anomaly_engine: skipping z-score check, insufficient history (%d days)", len(series))
        return 0

    baseline = [r for _, r in series[:-1]]  # exclude "today" from its own baseline
    mean = statistics.mean(baseline)
    stdev = statistics.pstdev(baseline) or 1e-6  # floor to avoid div-by-zero on flat history

    today_label, today_ratio = series[-1]
    z = (today_ratio - mean) / stdev

    if abs(z) <= Z_SCORE_THRESHOLD:
        return 0

    # de-dupe: don't re-alert the same day (mirrors the existing-check pattern in alerts.py)
    existing = db.query(Alert).filter(
        Alert.module == "procurement",
        Alert.entity_type == "spend_zscore",
        Alert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED]),
        Alert.title.contains(today_label),
    ).first()
    if existing:
        return 0

    create_alert(
        db,
        f"Procurement Spend Anomaly: {today_label}",
        f"Spend-per-active-booking is {today_ratio:.2f} (z={z:.2f}), "
        f"vs. {lookback_days}-day mean of {mean:.2f} (stdev {stdev:.2f}).",
        AlertSeverity.HIGH if abs(z) > 3 else AlertSeverity.MEDIUM,
        "procurement",
        "spend_zscore",
        detail=_trend_detail(series, today_label, mean, stdev, z, unit="Rs"),
    )
    return 1


def check_benford_stock_prices(db: Session, min_sample: int = BENFORD_MIN_SAMPLE) -> int:
    """Low-confidence advisory signal only.

    Deliberately scoped to self-purchase stock-intake unit costs, not
    booking/billing totals: Invoice.total_amount is deterministically
    derived from a small, fixed set of Room.base_price values, which
    violates the unconstrained-magnitude assumption behind Benford's Law
    and would produce structural false positives there.
    Chi-square goodness-of-fit is hand-rolled since scipy is not installed.
    """
    rows = db.execute(text(
        "SELECT unit_cost FROM stock_batches WHERE unit_cost > 0"
    )).fetchall()
    if len(rows) < min_sample:
        return 0

    counts = {d: 0 for d in range(1, 10)}
    for r in rows:
        digits = str(r[0]).lstrip("0.").lstrip("-")
        if digits and digits[0].isdigit() and digits[0] != "0":
            counts[int(digits[0])] += 1

    n = sum(counts.values())
    if n < min_sample:
        return 0

    chi2 = sum(((counts[d] - BENFORD_EXPECTED[d] * n) ** 2) / (BENFORD_EXPECTED[d] * n) for d in range(1, 10))
    if chi2 <= BENFORD_CHI2_CRITICAL:
        return 0

    existing = db.query(Alert).filter(
        Alert.module == "procurement",
        Alert.entity_type == "benford_line_items",
        Alert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED]),
    ).first()
    if existing:
        return 0

    create_alert(
        db,
        "Vendor Pricing Pattern Deviation (Benford's Law, low-confidence)",
        f"PO line-item leading-digit distribution deviates from Benford's Law "
        f"(chi2={chi2:.1f} > {BENFORD_CHI2_CRITICAL}, n={n}). Advisory only - review vendor pricing patterns.",
        AlertSeverity.LOW,
        "procurement",
        "benford_line_items",
    )
    return 1


def check_discount_rate_by_staff(db: Session, lookback_days: int = LOOKBACK_DAYS) -> int:
    """Flags a staff member whose average Invoice.discount rate is a peer
    outlier - the direct signal for one clerk quietly over-discounting
    (friends/family) relative to everyone else doing the same job."""
    cutoff = datetime.utcnow() - timedelta(days=lookback_days)
    rows = db.execute(text("""
        SELECT created_by,
               AVG(CASE WHEN subtotal > 0 THEN CAST(discount AS FLOAT) / CAST(subtotal AS FLOAT) ELSE 0 END) as rate,
               COUNT(*) as n
        FROM invoices
        WHERE created_at >= :cutoff AND created_by IS NOT NULL
        GROUP BY created_by
        HAVING COUNT(*) >= :min_n
    """), {"cutoff": cutoff, "min_n": MIN_ACTIVITY_PER_STAFF}).fetchall()
    return _flag_staff_outliers(db, [(r[0], r[1], r[2]) for r in rows], "billing", "discount_rate_staff", "Discount Rate")


def check_complimentary_rate_by_staff(db: Session, lookback_days: int = LOOKBACK_DAYS) -> int:
    """Flags a staff member whose share of invoices marked is_complimentary
    is a peer outlier - a bill waived entirely is the blunter, easier-to-spot
    cousin of over-discounting above."""
    cutoff = datetime.utcnow() - timedelta(days=lookback_days)
    rows = db.execute(text("""
        SELECT created_by,
               AVG(CASE WHEN is_complimentary THEN 1.0 ELSE 0.0 END) as rate,
               COUNT(*) as n
        FROM invoices
        WHERE created_at >= :cutoff AND created_by IS NOT NULL
        GROUP BY created_by
        HAVING COUNT(*) >= :min_n
    """), {"cutoff": cutoff, "min_n": MIN_ACTIVITY_PER_STAFF}).fetchall()
    return _flag_staff_outliers(db, [(r[0], r[1], r[2]) for r in rows], "billing", "complimentary_rate_staff", "Complimentary-Bill Rate")


def check_invoice_edit_value_zscore(db: Session, lookback_days: int = LOOKBACK_DAYS) -> int:
    """Daily z-score (same shape as check_procurement_spend_zscore) on the
    total value shaved off invoices per day via APPROVED InvoiceEditRequests
    - only approved ones move real revenue, so pending/rejected proposals
    (which may just be honest error corrections) don't add noise. Catches a
    sustained drip of small "corrections" that individually look harmless."""
    today = date.today()
    series = []
    for i in range(lookback_days - 1, -1, -1):
        d = today - timedelta(days=i)
        day_start = datetime.combine(d, datetime.min.time())
        day_end = datetime.combine(d + timedelta(days=1), datetime.min.time())
        shaved = db.execute(text("""
            SELECT COALESCE(SUM(CAST(original_unit_price AS FLOAT) - CAST(proposed_unit_price AS FLOAT)), 0)
            FROM invoice_edit_requests
            WHERE status = 'approved' AND decided_at >= :start AND decided_at < :end
              AND proposed_unit_price < original_unit_price
        """), {"start": day_start, "end": day_end}).scalar()
        series.append((d.strftime("%Y-%m-%d"), float(shaved)))

    if len(series) < MIN_WINDOW_SIZE + 1:
        return 0
    baseline = [r for _, r in series[:-1]]
    mean = statistics.mean(baseline)
    stdev = statistics.pstdev(baseline) or 1e-6
    today_label, today_value = series[-1]
    z = (today_value - mean) / stdev
    if z <= Z_SCORE_THRESHOLD:  # only a spike upward (more value shaved) is the fraud-relevant direction
        return 0

    existing = db.query(Alert).filter(
        Alert.module == "billing",
        Alert.entity_type == "invoice_edit_value",
        Alert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED]),
        Alert.title.contains(today_label),
    ).first()
    if existing:
        return 0

    create_alert(
        db,
        f"Invoice Correction Value Anomaly: {today_label}",
        f"Rs {today_value:,.0f} shaved off invoices via approved corrections today (z={z:.2f}), "
        f"vs. {lookback_days}-day mean of Rs {mean:,.0f} (stdev {stdev:,.0f}).",
        AlertSeverity.HIGH if z > 3 else AlertSeverity.MEDIUM,
        "billing",
        "invoice_edit_value",
        detail=_trend_detail(series, today_label, mean, stdev, z, unit="Rs"),
    )
    return 1


def check_noshow_rate_by_staff(db: Session, lookback_days: int = LOOKBACK_DAYS) -> int:
    """Flags a staff member whose rate of marking meals no_show/excluded (of
    everything they've marked) is a peer outlier - mess bills are generated
    from actual attendance, so excusing a meal that was eaten is a direct
    way to shrink someone's bill without touching billing at all."""
    cutoff = datetime.utcnow() - timedelta(days=lookback_days)
    rows = db.execute(text("""
        SELECT marked_by,
               AVG(CASE WHEN status IN ('no_show', 'excluded') THEN 1.0 ELSE 0.0 END) as rate,
               COUNT(*) as n
        FROM meal_attendance
        WHERE marked_at >= :cutoff AND marked_by IS NOT NULL
        GROUP BY marked_by
        HAVING COUNT(*) >= :min_n
    """), {"cutoff": cutoff, "min_n": MIN_ACTIVITY_PER_STAFF}).fetchall()
    return _flag_staff_outliers(db, [(r[0], r[1], r[2]) for r in rows], "attendance", "noshow_rate_staff", "No-Show/Excused Marking Rate")


def run_anomaly_checks(db: Session) -> dict:
    """Mirrors backend/alerts.py:run_all_checks - same aggregator shape,
    called alongside it from POST /api/alerts/run-checks.

    A mass-balance check (correlating kitchen-zone stock consumption
    against SUM(adults+children) for checked-in bookings) used to live
    here and was removed rather than left as a permanent stub: kitchen
    orders don't deduct inventory ingredient-by-ingredient (menu items
    carry an estimated price, not a costed recipe; stock is reconciled
    manually via Cycle Counts instead), so there's no per-ingredient
    consumption signal to correlate against - nothing to build without
    reintroducing that deduction model."""
    return {
        "procurement_spend_zscore": check_procurement_spend_zscore(db),
        "benford_stock_prices": check_benford_stock_prices(db),
        "discount_rate_by_staff": check_discount_rate_by_staff(db),
        "complimentary_rate_by_staff": check_complimentary_rate_by_staff(db),
        "invoice_edit_value_zscore": check_invoice_edit_value_zscore(db),
        "noshow_rate_by_staff": check_noshow_rate_by_staff(db),
    }
