"""Receipt scanning pipeline: image preprocessing, OCR line reconstruction,
and heuristic parsing into inventory intake candidates.

This deliberately does not aim for perfect parsing - a messy photographed
receipt (tilted, faint, oddly abbreviated) will never parse 100% reliably.
The goal is only to get close enough that a clerk fixing the output in the
"Smart Intake" staging grid (see routers/inventory.py) is faster than typing
every line from scratch. Anything this module can't confidently extract is
left null rather than guessed, so the staging grid can flag it in red.
"""
import re
from typing import Optional

import cv2
import numpy as np
from rapidfuzz import fuzz, process, utils

_ocr_engine = None


def _get_engine():
    # Lazy singleton: RapidOCR loads its ONNX models from disk on first
    # construction (~1s) - importing at module load time would slow down
    # every backend startup even when no one ever scans a receipt.
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr_engine = RapidOCR()
    return _ocr_engine


def preprocess_image(image_bytes: bytes) -> np.ndarray:
    """Grayscale + deskew + binarize, to combat tilted photos, shadows/
    creases, and faint prints before OCR ever sees the image."""
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Deskew: find the minimum-area rectangle around all "ink" pixels and
    # rotate that angle flat. Bounded to +/-15 deg so an already-straight
    # photo (where the detected angle is just noise) isn't over-corrected.
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    coords = cv2.findNonZero(thresh)
    angle = 0.0
    if coords is not None and len(coords) > 50:
        rect_angle = cv2.minAreaRect(coords)[-1]
        angle = rect_angle + 90 if rect_angle < -45 else rect_angle
        if abs(angle) > 15:
            angle = 0.0

    if abs(angle) > 0.3:
        h, w = gray.shape
        m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        gray = cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)

    # Adaptive threshold copes with uneven lighting/shadows across the
    # receipt better than a single global cutoff; median blur clears
    # salt-and-pepper speckling from a poor-quality print or scan.
    binarized = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
    )
    denoised = cv2.medianBlur(binarized, 3)
    return cv2.cvtColor(denoised, cv2.COLOR_GRAY2BGR)


def extract_lines(image: np.ndarray) -> list[dict]:
    """Runs OCR and reconstructs visual text rows from RapidOCR's individual
    text-box detections. RapidOCR detects contiguous text blocks, not full
    rows - "TOMATO A-GRADE" and "25.0 kg 3500.00" printed on the same line
    come back as two separate boxes, so they're re-grouped here by vertical
    (y-axis) overlap before any item parsing happens."""
    engine = _get_engine()
    result, _ = engine(image)
    if not result:
        return []

    boxes = []
    for box, text, conf in result:
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        boxes.append({
            "text": text,
            "conf": float(conf),
            "y_center": sum(ys) / len(ys),
            "height": max(ys) - min(ys),
            "x_left": min(xs),
        })

    boxes.sort(key=lambda b: b["y_center"])

    rows: list[list[dict]] = []
    for b in boxes:
        placed = False
        for row in rows:
            ref = row[0]
            tolerance = max(ref["height"], b["height"]) * 0.6
            if abs(b["y_center"] - ref["y_center"]) <= tolerance:
                row.append(b)
                placed = True
                break
        if not placed:
            rows.append([b])

    reconstructed = []
    for row in rows:
        row.sort(key=lambda b: b["x_left"])
        text = " ".join(b["text"] for b in row).strip()
        if not text:
            continue
        conf = sum(b["conf"] for b in row) / len(row)
        reconstructed.append({"text": text, "confidence": round(conf, 3)})
    return reconstructed


# Generic noise keywords, matched wherever they appear on the receipt (not
# just header/footer position) - column headers like "Qty" / "Description"
# sometimes get OCR'd as their own line even inside the item block. Matched
# only when they make up the *entire* alphabetic content of a line (see
# _matches_keyword_line) so a real product whose name happens to contain
# one of these words (e.g. "Total Wheat Flour") isn't accidentally dropped.
_SKIP_KEYWORDS = {
    "thank you", "thankyou", "invoice", "receipt", "date", "cashier",
    "welcome", "visit again", "served by", "table no", "order no",
    "bill no", "customer", "signature", "terms", "delivery", "note",
    "qty", "item", "description", "amount", "price", "phone", "tel",
    "address", "email",
}

# Marks the boundary between the item block and the totals/footer block -
# the first line matching one of these ends the item section. Reliable
# across almost all receipt formats since a totals line always follows the
# last item, whatever the header/footer text around it looks like.
_TOTALS_KEYWORDS = {
    "subtotal", "sub total", "total", "grand total", "tax", "vat", "gst",
    "cash", "change", "balance", "balance due", "amount due", "discount",
    "paid", "tender", "tendered",
}

# Address/contact words matched anywhere in a line regardless of its total
# word count (unlike _SKIP_KEYWORDS/_TOTALS_KEYWORDS, which only match short
# lines) - a street address or phone number line is often several words
# long ("123 Market Street, Lahore") and, critically, its digits (a house
# number, a phone number) can look exactly like a "quantity price" item
# line to the numeric parser below. These words essentially never appear
# inside a genuine grocery/inventory item name, so matching them anywhere
# is safe.
_ADDRESS_CONTACT_WORDS = {
    "street", "road", "avenue", "lane", "block", "sector", "phase",
    "phone", "tel", "fax", "mobile", "cell", "website", "www", "email",
}

_UNIT_TOKEN = r"(kgs|kg|gms|gm|grams|gram|g|ltr|liters|litres|liter|litre|l|ml|pcs|pc|dozen|doz|trays|tray|packs|pack|bottles|bottle|cans|can|bags|bag|boxes|box)"
_NUMBER = r"\d[\d,]*(?:\.\d+)?"


def _matches_keyword_line(line: str, keywords: set[str]) -> bool:
    alpha_only = re.sub(r"[\d.,:/#\-]+", " ", line).strip().lower()
    words = alpha_only.split()
    if not words:
        return True
    if len(words) <= 2:
        joined = " ".join(words)
        for kw in keywords:
            if kw in joined or fuzz.ratio(joined, kw) > 80:
                return True
    return False


def _is_address_or_contact_line(line: str) -> bool:
    alpha_only = re.sub(r"[\d.,:/#\-]+", " ", line).lower()
    words = set(alpha_only.split())
    if words & _ADDRESS_CONTACT_WORDS:
        return True
    # A long run of digits with dashes/spaces (e.g. "042-1234567",
    # "0300 1234567") reads as a phone number, not an item price.
    if re.search(r"\d[\d\-\s]{6,}\d", line):
        return True
    return False


def _looks_like_currency_amount(line: str) -> bool:
    """True if the line contains at least one decimal-formatted number
    (e.g. "3500.00") - used only to help locate where the item block
    starts. Real prices on printed receipts are almost always shown with
    cents; plain integers (street numbers, invoice IDs) usually aren't,
    which is what lets this catch header noise a keyword list would miss."""
    return bool(re.search(r"\d+\.\d+", line))


def _is_boilerplate(line: str) -> bool:
    return _matches_keyword_line(line, _SKIP_KEYWORDS) or _is_address_or_contact_line(line)


def parse_line(line: str) -> dict:
    """Best-effort extraction of {raw_name, quantity, total_cost} from one
    reconstructed receipt row. Deliberately conservative: anything it can't
    confidently pull out is left null so the staging grid flags it in
    amber/red for a human, instead of silently guessing wrong. The one
    exception is quantity: a line with a clear price but no discernible
    count (e.g. "Eggs (Tray)  350.00", no explicit "x2" or unit-tagged
    number) almost always means "one of whatever's listed" on a real
    receipt, so that case defaults to 1 rather than forcing a review."""
    line = line.strip()
    if _is_boilerplate(line):
        return {"raw_name": None, "quantity": None, "total_cost": None, "quantity_assumed": False, "skip": True}

    numbers = [(m.start(), m.end(), m.group()) for m in re.finditer(_NUMBER, line)]
    if not numbers:
        return {"raw_name": line or None, "quantity": None, "total_cost": None, "quantity_assumed": False, "skip": False}

    def to_float(s: str) -> float:
        return float(s.replace(",", ""))

    quantity = None
    qty_span = None
    unit_match = re.search(_NUMBER + r"\s*" + _UNIT_TOKEN + r"\b", line, re.IGNORECASE)
    if unit_match:
        num_match = re.search(_NUMBER, unit_match.group())
        quantity = to_float(num_match.group())
        qty_span = unit_match.span()

    remaining_numbers = [n for n in numbers if qty_span is None or not (qty_span[0] <= n[0] < qty_span[1])]

    total_cost = None
    if quantity is not None:
        # Unit-tagged quantity already identified - whatever number is left
        # (usually the last one on the line) is the price.
        if remaining_numbers:
            total_cost = to_float(remaining_numbers[-1][2])
    else:
        # No explicit unit token. Two or more bare numbers on the line is
        # the common "qty  price" layout (e.g. "45.0  2250.00"); exactly
        # one number is ambiguous, so treat it as the price only and leave
        # quantity for the clerk to fill in.
        if len(remaining_numbers) >= 2:
            quantity = to_float(remaining_numbers[-2][2])
            total_cost = to_float(remaining_numbers[-1][2])
        elif len(remaining_numbers) == 1:
            total_cost = to_float(remaining_numbers[-1][2])

    # Strip every matched numeric/unit token to get the leftover product name.
    # Word boundaries are essential here: without them the short unit
    # abbreviations ("g", "l") match as bare substrings inside ordinary
    # words too - e.g. "A-GRADE" contains "g", "BNLSS" contains "l" - and
    # would get silently chewed out of the product name.
    name = line
    for start, end, _ in sorted(numbers, key=lambda n: -n[0]):
        name = name[:start] + " " + name[end:]
    name = re.sub(r"\b" + _UNIT_TOKEN + r"\b", " ", name, flags=re.IGNORECASE)
    name = re.sub(r"\bx\b", " ", name, flags=re.IGNORECASE)  # stray "2x"-style multiplier notation
    name = re.sub(r"\s+", " ", name).strip(" -:@*.,").strip()

    quantity_assumed = False
    if total_cost is not None and quantity is None:
        quantity = 1.0
        quantity_assumed = True

    return {
        "raw_name": name or None,
        "quantity": quantity,
        "total_cost": total_cost,
        "quantity_assumed": quantity_assumed,
        "skip": False,
    }


def classify_receipt_lines(ocr_lines: list[dict]) -> list[dict]:
    """Narrows OCR-reconstructed lines down to item candidates only,
    dropping header (store name, address, invoice/date) and footer
    (totals, thank-you) noise.

    Keyword matching alone (see _is_boilerplate) can't catch everything -
    a footer slogan like "Come again soon!" or a header phone number
    matches no keyword at all. So this leans on the receipt's predictable
    shape instead: header, then an item block, then a totals/footer block.
    The first totals-family line (subtotal/tax/total/...) marks where the
    item block ends; the first line before that which actually parsed as a
    priced item marks where it begins. Anything outside that window is
    dropped regardless of whether it matched a specific keyword.

    Returns a list of {ocr_line, parsed} dicts for lines inside the item
    window only (boilerplate-keyword lines within that window are still
    excluded too).
    """
    parsed = [parse_line(ocr_line["text"]) for ocr_line in ocr_lines]

    totals_start = len(parsed)
    for idx, ocr_line in enumerate(ocr_lines):
        if _matches_keyword_line(ocr_line["text"], _TOTALS_KEYWORDS):
            totals_start = idx
            break

    item_start = totals_start
    for idx in range(totals_start):
        if (
            not parsed[idx]["skip"]
            and parsed[idx]["total_cost"] is not None
            and _looks_like_currency_amount(ocr_lines[idx]["text"])
        ):
            item_start = idx
            break

    return [
        {"ocr_line": ocr_lines[idx], "parsed": parsed[idx]}
        for idx in range(item_start, totals_start)
        if not parsed[idx]["skip"]
    ]


def fuzzy_match_item(raw_name: str, item_choices: dict[int, str], threshold: int = 70) -> tuple[Optional[int], Optional[str], int]:
    """item_choices: {item_id: item_name}. Returns (matched_item_id,
    matched_item_name, score). WRatio + default_process (case/punctuation
    folding) gives the cleanest separation for messy vendor abbreviations
    like "TOMATO A-GRADE" -> "Tomatoes": genuine matches typically land
    75-100, unrelated items stay in the 30-45 range."""
    if not raw_name or not item_choices:
        return None, None, 0
    result = process.extractOne(raw_name, item_choices, scorer=fuzz.WRatio, processor=utils.default_process)
    if result is None:
        return None, None, 0
    matched_name, score, matched_id = result
    score = int(round(score))
    if score < threshold:
        return None, None, score
    return matched_id, matched_name, score
