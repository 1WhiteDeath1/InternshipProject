"""Statistical anomaly detection - stdlib-only (no numpy/scipy in this environment)."""
import statistics
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text
from backend.models import Alert, AlertStatus, AlertSeverity
from backend.alerts import create_alert
from backend.logging_config import get_logger

logger = get_logger("app")

Z_SCORE_THRESHOLD = 2.0
MIN_WINDOW_SIZE = 10           # guard against unstable stdev on short history
LOOKBACK_DAYS = 90             # rolling window fed into mean/stdev
BENFORD_MIN_SAMPLE = 300       # Benford's Law needs a sizeable sample to be meaningful
BENFORD_EXPECTED = {1: .301, 2: .176, 3: .125, 4: .097, 5: .079, 6: .067, 7: .058, 8: .051, 9: .046}
BENFORD_CHI2_CRITICAL = 20.09  # alpha=0.01, df=8 - conservative, to cut false positives


def _daily_spend_per_active_booking(db: Session, days: int) -> list[tuple[str, float]]:
    """One row per day: (date label, PO total_amount / max(1, active bookings)).

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
            SELECT COALESCE(SUM(total_amount), 0) FROM purchase_orders
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
    """Flag the current day if PO spend-per-active-booking deviates >2 stdev from the trailing mean."""
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
    )
    return 1


def check_benford_po_line_items(db: Session, min_sample: int = BENFORD_MIN_SAMPLE) -> int:
    """Low-confidence advisory signal only.

    Deliberately scoped to procurement line-item prices, not booking/billing totals:
    Invoice.total_amount is deterministically derived from a small, fixed set of
    Room.base_price values, which violates the unconstrained-magnitude assumption
    behind Benford's Law and would produce structural false positives there.
    Chi-square goodness-of-fit is hand-rolled since scipy is not installed.
    """
    rows = db.execute(text(
        "SELECT unit_price FROM purchase_order_items WHERE unit_price > 0"
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


def check_mass_balance(db: Session) -> int:
    """Not implemented: no code path currently writes kitchen-zone `recipe_deduction`
    StockMovements (no /recipes or /kitchen router exists yet). Wire that up first,
    then correlate SUM(kitchen consumption) against SUM(adults+children) for
    checked_in bookings per day, following the same shape as
    check_procurement_spend_zscore above.
    """
    return 0


def run_anomaly_checks(db: Session) -> dict:
    """Mirrors backend/alerts.py:run_all_checks - same aggregator shape,
    called alongside it from POST /api/alerts/run-checks."""
    return {
        "procurement_spend_zscore": check_procurement_spend_zscore(db),
        "benford_po_line_items": check_benford_po_line_items(db),
        "mass_balance": check_mass_balance(db),
    }
