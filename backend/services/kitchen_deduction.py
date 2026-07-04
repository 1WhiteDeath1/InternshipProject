"""Deducts recipe ingredients from kitchen-zone stock when a KitchenOrder is prepared."""
from fastapi import HTTPException
from sqlalchemy.orm import Session
from backend.models import Recipe, RecipeIngredient, StockBatch, StockMovement, StockZone


def deduct_recipe_stock(db: Session, recipe: Recipe, quantity_ordered: int, reference_id: int, created_by: int) -> None:
    """Deduct each ingredient's required quantity (scaled to quantity_ordered)
    from a kitchen-zone StockBatch, logging a `recipe_deduction` StockMovement
    per ingredient. Single-batch-per-ingredient deduction (earliest expiry
    first) is a deliberate Tier-1 simplification - splitting a shortfall
    across multiple batches of the same item is not handled here.

    Raises HTTPException(400) if any ingredient has no kitchen stock batch at
    all (checked before any mutation), or HTTPException(409) if a concurrent
    change would push a batch negative (checked via the same race-free
    post-commit-recheck-and-compensate pattern used in inventory.py's
    create_movement, generalized across every ingredient batch touched here).
    """
    ingredients = db.query(RecipeIngredient).filter(RecipeIngredient.recipe_id == recipe.id).all()
    if not ingredients:
        return

    # Pre-flight: resolve a kitchen batch for every ingredient before mutating anything,
    # so a missing batch never leaves a partial deduction in the session.
    plan = []
    for ing in ingredients:
        needed = (quantity_ordered / recipe.portions) * ing.quantity
        batch = db.query(StockBatch).filter(
            StockBatch.item_id == ing.item_id,
            StockBatch.zone == StockZone.KITCHEN,
            StockBatch.is_active == True,
        ).order_by(StockBatch.expiry_date.asc()).first()
        if not batch:
            raise HTTPException(status_code=400, detail=f"No kitchen stock batch found for ingredient item #{ing.item_id}")
        plan.append((ing, batch, needed))

    movements = []
    for ing, batch, needed in plan:
        batch.quantity -= needed
        movement = StockMovement(
            batch_id=batch.id, item_id=ing.item_id, movement_type="recipe_deduction",
            quantity=needed, from_zone=StockZone.KITCHEN,
            reference_type="kitchen_order", reference_id=reference_id,
            notes=f"Recipe deduction: {recipe.name}", created_by=created_by,
        )
        db.add(movement)
        movements.append(movement)

    db.commit()
    for _, batch, _ in plan:
        db.refresh(batch)

    if any(batch.quantity < 0 for _, batch, _ in plan):
        for _, batch, needed in plan:
            batch.quantity += needed
        for movement in movements:
            db.delete(movement)
        db.commit()
        raise HTTPException(status_code=409, detail="Stock level would go negative due to a concurrent change - please retry")
