"""Guest-facing (non-member, pay-per-item) menu prices - a small list decoupled
from Recipe itself, since a recipe used only for member routine meals may
never need a guest price."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import MenuPrice, Recipe
from backend.schemas import MenuPriceOut, MenuPriceUpdate
from backend.auth import get_current_user, check_permission
from backend.audit import log_audit, serialize_model, AuditAction

router = APIRouter()


@router.get("", response_model=list[MenuPriceOut])
async def list_menu_prices(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rows = db.query(MenuPrice).all()
    return [
        MenuPriceOut(id=r.id, recipe_id=r.recipe_id, recipe_name=r.recipe.name if r.recipe else None,
                     price=float(r.price), is_active=r.is_active, updated_at=r.updated_at)
        for r in rows
    ]


@router.put("/{recipe_id}", response_model=MenuPriceOut)
async def upsert_menu_price(recipe_id: int, data: MenuPriceUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not check_permission(current_user, "kitchen", "edit"):
        raise HTTPException(status_code=403, detail="Permission denied")
    if not db.query(Recipe).filter(Recipe.id == recipe_id).first():
        raise HTTPException(status_code=404, detail="Recipe not found")

    mp = db.query(MenuPrice).filter(MenuPrice.recipe_id == recipe_id).first()
    before = serialize_model(mp) if mp else None
    if not mp:
        mp = MenuPrice(recipe_id=recipe_id)
        db.add(mp)
    mp.price = data.price
    mp.is_active = data.is_active
    mp.updated_by = current_user.id
    db.commit()
    db.refresh(mp)

    action = AuditAction.UPDATE if before else AuditAction.CREATE
    log_audit(db, current_user.id, current_user.full_name, action, "menu_prices", mp.id, before_state=before, after_state=serialize_model(mp), ip_address=request.client.host)
    return MenuPriceOut(id=mp.id, recipe_id=mp.recipe_id, recipe_name=mp.recipe.name if mp.recipe else None,
                        price=float(mp.price), is_active=mp.is_active, updated_at=mp.updated_at)
