"""Recipe/menu management router."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Recipe, RecipeIngredient
from backend.schemas import RecipeCreate, RecipeUpdate
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction
from backend.logging_config import get_logger

logger = get_logger("app")
router = APIRouter()


@router.get("")
async def list_recipes(
    menu_category: str = "", is_active: bool = True,
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    query = db.query(Recipe).filter(Recipe.is_active == is_active)
    if menu_category:
        query = query.filter(Recipe.menu_category == menu_category)

    total = query.count()
    recipes = query.order_by(Recipe.name).offset((page - 1) * page_size).limit(page_size).all()

    # One query for all ingredients across this page's recipes instead of one query per recipe.
    recipe_ids = [r.id for r in recipes]
    ingredients_by_recipe = {}
    if recipe_ids:
        all_ingredients = db.query(RecipeIngredient).filter(RecipeIngredient.recipe_id.in_(recipe_ids)).all()
        for ing in all_ingredients:
            ingredients_by_recipe.setdefault(ing.recipe_id, []).append(ing)

    return {"items": [
        {"id": r.id, "name": r.name, "description": r.description, "menu_category": r.menu_category,
         "portions": r.portions, "is_active": r.is_active,
         "ingredients": [{"id": i.id, "item_id": i.item_id, "item_name": i.item.name if i.item else None,
                          "quantity": i.quantity, "unit": i.unit} for i in ingredients_by_recipe.get(r.id, [])]}
        for r in recipes], "total": total}


@router.post("")
async def create_recipe(data: RecipeCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "recipes", "create"):
        raise HTTPException(status_code=403, detail="Permission denied")

    recipe = Recipe(name=data.name, description=data.description, menu_category=data.menu_category, portions=data.portions)
    db.add(recipe)
    db.commit()
    db.refresh(recipe)

    for ing in data.ingredients:
        db.add(RecipeIngredient(recipe_id=recipe.id, item_id=ing.item_id, quantity=ing.quantity, unit=ing.unit))
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.CREATE, "recipes", recipe.id, after_state=serialize_model(recipe), ip_address=request.client.host)
    return recipe


@router.put("/{recipe_id}")
async def update_recipe(recipe_id: int, data: RecipeUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "recipes", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    before = serialize_model(recipe)
    update_fields = data.model_dump(exclude_unset=True, exclude={"ingredients"})
    for field, value in update_fields.items():
        setattr(recipe, field, value)

    if data.ingredients is not None:
        db.query(RecipeIngredient).filter(RecipeIngredient.recipe_id == recipe.id).delete()
        for ing in data.ingredients:
            db.add(RecipeIngredient(recipe_id=recipe.id, item_id=ing.item_id, quantity=ing.quantity, unit=ing.unit))

    db.commit()
    db.refresh(recipe)

    log_audit(db, current_user.id, current_user.full_name, AuditAction.UPDATE, "recipes", recipe.id, before_state=before, after_state=serialize_model(recipe), ip_address=request.client.host)
    return recipe


@router.delete("/{recipe_id}")
async def deactivate_recipe(recipe_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "recipes", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    before = serialize_model(recipe)
    recipe.is_active = False
    db.commit()

    log_audit(db, current_user.id, current_user.full_name, AuditAction.SOFT_DELETE, "recipes", recipe.id, before_state=before, after_state=serialize_model(recipe), reason="Soft deleted", ip_address=request.client.host)
    return {"message": "Recipe deactivated"}
