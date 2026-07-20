"""Read-only theoretical recipe costing, for margin-alert checks.

Deliberately a standalone function, not a refactor of
`kitchen_deduction.deduct_recipe_stock` - that function is production-critical
(it actually deducts stock when a dish is cooked), so this duplicates its
ingredient-costing logic rather than risk that path. Must stay consistent
with its simplifications (single earliest-expiry active batch per ingredient,
no weighted average) so a "theoretical" cost doesn't diverge from what
deduction will actually charge for reasons unrelated to real cost changes.
"""
from typing import Optional
from sqlalchemy.orm import Session
from backend.models import Recipe, RecipeIngredient, StockBatch
from backend.services.unit_conversion import convert_to_item_unit


def compute_theoretical_recipe_cost(db: Session, recipe: Recipe) -> Optional[float]:
    """Cost of producing one portion of `recipe` at current stock prices.

    Returns None (not an exception) if any ingredient has no active stock
    batch to cost against - this runs unattended inside a batch alert check,
    unlike deduct_recipe_stock which is called from an interactive request
    and is allowed to 400.
    """
    ingredients = db.query(RecipeIngredient).filter(RecipeIngredient.recipe_id == recipe.id).all()
    if not ingredients:
        return None

    total_cost = 0.0
    for ing in ingredients:
        needed_in_recipe_unit = ing.quantity / recipe.portions
        needed = convert_to_item_unit(ing.item, needed_in_recipe_unit, ing.unit)
        batch = db.query(StockBatch).filter(
            StockBatch.item_id == ing.item_id,
            StockBatch.is_active == True,
        ).order_by(StockBatch.expiry_date.asc()).first()
        if not batch:
            return None
        total_cost += needed * float(batch.unit_cost or 0)

    return total_cost
