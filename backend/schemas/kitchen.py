"""Kitchen domain schemas: recipes, kitchen production orders, menu prices."""
from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict, model_validator


class RecipeIngredientBase(BaseModel):
    item_id: int
    quantity: float = Field(..., gt=0)
    unit: str

class RecipeBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    menu_category: Optional[str] = None
    portions: int = Field(1, gt=0)

class RecipeCreate(RecipeBase):
    ingredients: List[RecipeIngredientBase] = []

class RecipeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    menu_category: Optional[str] = None
    portions: Optional[int] = Field(None, gt=0)
    is_active: Optional[bool] = None
    ingredients: Optional[List[RecipeIngredientBase]] = None  # replaces all existing ingredients when provided

class RecipeIngredientOut(RecipeIngredientBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    item_name: Optional[str] = None

class RecipeOut(RecipeBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    ingredients: List[RecipeIngredientOut] = []

class KitchenOrderCreate(BaseModel):
    recipe_id: int
    quantity_ordered: int = Field(1, gt=0)
    notes: Optional[str] = None
    is_ala_carte: bool = False
    consumer_type: Optional[str] = None  # "member" | "guest"
    member_id: Optional[int] = None
    booking_id: Optional[int] = None
    sla_minutes: Optional[int] = Field(None, gt=0)

    @model_validator(mode="after")
    def _check_consumer(self):
        if self.is_ala_carte:
            if bool(self.member_id) == bool(self.booking_id):
                raise ValueError("Exactly one of member_id or booking_id is required for an a la carte order")
            self.consumer_type = "member" if self.member_id else "guest"
        return self

class KitchenOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recipe_id: int
    recipe_name: Optional[str] = None
    quantity_ordered: int
    actual_portions: Optional[int] = None
    food_cost: Optional[float] = None
    status: str
    notes: Optional[str] = None
    meal_date: Optional[date] = None
    meal_type: Optional[str] = None
    source: Optional[str] = None
    ordered_by: Optional[int] = None
    created_at: datetime
    is_ala_carte: bool = False
    consumer_type: Optional[str] = None
    member_id: Optional[int] = None
    booking_id: Optional[int] = None
    consumer_name: Optional[str] = None
    sla_minutes: Optional[int] = None
    due_at: Optional[datetime] = None
    cooking_started_at: Optional[datetime] = None

class KitchenOrderPrepareRequest(BaseModel):
    actual_portions: Optional[int] = Field(None, gt=0)

class MenuPriceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recipe_id: int
    recipe_name: Optional[str] = None
    price: float
    is_active: bool
    updated_at: Optional[datetime] = None

class MenuPriceUpdate(BaseModel):
    price: float = Field(..., ge=0)
    is_active: bool = True
