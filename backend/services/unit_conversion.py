"""Converts a recipe-authored ingredient quantity into the inventory item's
own stock-tracked unit, so kitchen_deduction.py can subtract it from
StockBatch.quantity correctly regardless of what unit a recipe was authored in.

Two kinds of conversion happen here:
- Same-axis (volume->volume, e.g. cup->l, or mass->mass, e.g. g->kg): exact,
  physical constants, independent of what the ingredient actually is.
- Cross-axis (volume->mass or mass->volume, e.g. cup->kg): approximate,
  because "how much a cup weighs" depends on the substance. IngredientType is
  a deliberately coarse 4-bucket density approximation (not a per-item
  density table) - good enough for mess-scale stock/cost tracking, not
  precision baking.
"""
from backend.models import IngredientType, InventoryItem

_ML_PER_UNIT = {"ml": 1, "l": 1000, "cup": 236.588, "tbsp": 14.787, "tsp": 4.929}
_G_PER_UNIT = {"g": 1, "kg": 1000}
_VOLUME_UNITS = set(_ML_PER_UNIT)
_MASS_UNITS = set(_G_PER_UNIT)

# Approximate grams per cup, by ingredient type - the only guessed numbers in
# this whole module; everything else above is a fixed physical constant.
_GRAMS_PER_CUP = {
    IngredientType.LIQUID: 240,        # water/milk-like
    IngredientType.POWDER: 120,        # flour-like
    IngredientType.GRANULAR: 200,      # sugar/rice-like
    IngredientType.SOLID_PIECES: 150,  # diced veg/meat-like
}


def convert_to_item_unit(item: InventoryItem, quantity: float, from_unit: str) -> float:
    """Convert `quantity` expressed in `from_unit` into the equivalent
    quantity expressed in `item.unit`. Falls back to treating `quantity` as
    already being in `item.unit` (today's behavior, still correct) whenever
    `from_unit == item.unit`, or whenever a cross-axis bridge would be needed
    but the item has no `ingredient_type` set (count-based items like "pcs"
    have no principled cup-to-piece conversion - the Kitchen picker only
    offers `item.unit` itself for these, so this path shouldn't normally be
    hit, but it degrades safely if it is)."""
    to_unit = item.unit
    if from_unit == to_unit:
        return quantity

    if from_unit in _VOLUME_UNITS and to_unit in _VOLUME_UNITS:
        return quantity * _ML_PER_UNIT[from_unit] / _ML_PER_UNIT[to_unit]
    if from_unit in _MASS_UNITS and to_unit in _MASS_UNITS:
        return quantity * _G_PER_UNIT[from_unit] / _G_PER_UNIT[to_unit]

    if not item.ingredient_type:
        return quantity  # no density info to bridge axes - safe pass-through, matches pre-existing behavior

    grams_per_cup = _GRAMS_PER_CUP[IngredientType(item.ingredient_type)]
    grams_per_ml = grams_per_cup / _ML_PER_UNIT["cup"]

    if from_unit in _VOLUME_UNITS and to_unit in _MASS_UNITS:
        grams = quantity * _ML_PER_UNIT[from_unit] * grams_per_ml
        return grams / _G_PER_UNIT[to_unit]
    if from_unit in _MASS_UNITS and to_unit in _VOLUME_UNITS:
        ml = (quantity * _G_PER_UNIT[from_unit]) / grams_per_ml
        return ml / _ML_PER_UNIT[to_unit]

    return quantity  # unrecognized unit on either side - pass through rather than guess
