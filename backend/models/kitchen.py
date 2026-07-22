"""Kitchen domain: recipes, ingredients, kitchen production orders, menu prices."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Date, Text, ForeignKey, Numeric
from sqlalchemy.orm import relationship
from backend.database import Base


class Recipe(Base):
    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    menu_category = Column(String(50))  # breakfast, lunch, dinner, snack
    portions = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredients"

    id = Column(Integer, primary_key=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String(50), nullable=False)

    recipe = relationship("Recipe")
    item = relationship("InventoryItem")


class KitchenOrder(Base):
    __tablename__ = "kitchen_orders"

    id = Column(Integer, primary_key=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False)
    quantity_ordered = Column(Integer, nullable=False, default=1)
    actual_portions = Column(Integer)
    food_cost = Column(Numeric(12, 2))
    status = Column(String(20), default="pending")  # pending, prepared, served, cancelled
    notes = Column(Text)
    # Set when an order is auto-generated from that day's bookings, so the
    # generate step stays idempotent and traceable (manual orders leave these null).
    meal_date = Column(Date, nullable=True)
    meal_type = Column(String(20), nullable=True)
    source = Column(String(20), nullable=True)  # manual | auto_from_bookings
    ordered_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    # --- À la carte custom-order fields (is_ala_carte=True only) ---
    # A la carte orders are attributed to one specific consumer for billing -
    # MealAttendance can't hold this (its unique constraint allows only one row
    # per person per date/meal_type, but a guest may order several custom
    # dishes in a day), so the link lives here instead.
    is_ala_carte = Column(Boolean, default=False)
    consumer_type = Column(String(20), nullable=True)  # "member" | "guest"
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True)
    sla_minutes = Column(Integer, nullable=True)
    due_at = Column(DateTime, nullable=True)  # fixed at creation; later SystemSetting changes don't move it
    cooking_started_at = Column(DateTime, nullable=True)  # set the instant status -> "cooking" (also the deduction instant)
    escalated_at = Column(DateTime, nullable=True)  # idempotency guard: >15min-overdue admin alert posted once
    invoiced_at = Column(DateTime, nullable=True)  # set once pulled into a MessBill/Invoice, guards double-billing

    recipe = relationship("Recipe")
    member = relationship("Member")
    booking = relationship("Booking")


class MenuPrice(Base):
    """Guest-facing (non-member, pay-per-item) price for a recipe. Deliberately
    decoupled from Recipe itself - a recipe used only for member routine meals
    may never need a guest price, and pricing may vary by context later without
    touching recipe/ingredient data. One row per recipe; missing/inactive means
    "not yet priced for guests" and is excluded from bills, flagged instead."""
    __tablename__ = "menu_prices"

    id = Column(Integer, primary_key=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False, unique=True)
    price = Column(Numeric(12, 2), nullable=False, default=0)
    is_active = Column(Boolean, default=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    recipe = relationship("Recipe")
