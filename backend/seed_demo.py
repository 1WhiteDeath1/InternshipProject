"""
SEED DEMO DATA - Hotel & Mess Management System
================================================
This script generates realistic sample data for testing and demonstration.
It is NOT part of the application runtime and does NOT run automatically.
Run this script manually after installation to populate the database with demo data.

To run: python backend/seed_demo.py
"""
import sys
import json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import datetime, timedelta, date
from backend.database import SessionLocal, engine, Base
from backend.models import *
from backend.auth import hash_password
from backend.branding import create_default_branding_file
from backend.migrations import run_startup_migrations

# Create tables + seed the 6 canonical RBAC roles (same startup path main.py uses)
Base.metadata.create_all(bind=engine)
run_startup_migrations(engine)
create_default_branding_file()

db = SessionLocal()

# --- Roles (seeded by run_startup_migrations above - just look them up) ---
manager_role = db.query(Role).filter(Role.name == "Manager").first()
deputy_role = db.query(Role).filter(Role.name == "Deputy Manager").first()
clerk_role = db.query(Role).filter(Role.name == "Clerk").first()
kitchen_role = db.query(Role).filter(Role.name == "Kitchen NCO").first()
front_desk_role = db.query(Role).filter(Role.name == "Booking NCO").first()
security_role = db.query(Role).filter(Role.name == "Security Guard").first()

# --- Users ---
admin = User(username="manager1", email="manager@samhotel.local", full_name="System Manager",
             hashed_password=hash_password("manager123"), role_id=manager_role.id,
             status=UserStatus.ACTIVE, last_login=datetime.utcnow())
deputy_user = User(username="deputy1", email="deputy@samhotel.local", full_name="Farah Zaidi",
                    hashed_password=hash_password("deputy123"), role_id=deputy_role.id, status=UserStatus.ACTIVE)
front_user = User(username="bookingnco1", email="front@samhotel.local", full_name="Sana Malik",
                  hashed_password=hash_password("front123"), role_id=front_desk_role.id, status=UserStatus.ACTIVE)
clerk_user = User(username="clerk1", email="clerk@samhotel.local", full_name="Imran Khalid",
                  hashed_password=hash_password("clerk123"), role_id=clerk_role.id, status=UserStatus.ACTIVE)
kitchen_user = User(username="kitchennco1", email="kitchen@samhotel.local", full_name="Usman Tariq",
                    hashed_password=hash_password("kitchen123"), role_id=kitchen_role.id, status=UserStatus.ACTIVE)
security_user = User(username="security1", email="security@samhotel.local", full_name="Naveed Iqbal",
                     hashed_password=hash_password("security123"), role_id=security_role.id, status=UserStatus.ACTIVE)
db.add_all([admin, deputy_user, front_user, clerk_user, kitchen_user, security_user])
db.commit()

# --- Feature Flags (will be auto-created by API, but let's add defaults here) ---

# --- Categories ---
cat_produce = InventoryCategory(name="Fresh Produce", description="Vegetables and fruits")
cat_meat = InventoryCategory(name="Meat & Poultry", description="All meat products")
cat_dairy = InventoryCategory(name="Dairy", description="Milk, cheese, yogurt")
cat_dry = InventoryCategory(name="Dry Goods", description="Rice, flour, pasta")
cat_beverages = InventoryCategory(name="Beverages", description="Coffee, tea, juice")
cat_cleaning = InventoryCategory(name="Cleaning Supplies", description="Hotel cleaning products")
db.add_all([cat_produce, cat_meat, cat_dairy, cat_dry, cat_beverages, cat_cleaning])
db.commit()

# --- Inventory Items ---
items = [
    InventoryItem(sku="RICE-001", name="Basmati Rice", category_id=cat_dry.id, unit="kg", reorder_level=20, reorder_quantity=50),
    InventoryItem(sku="CHKN-001", name="Chicken Breast", category_id=cat_meat.id, unit="kg", reorder_level=10, reorder_quantity=30),
    InventoryItem(sku="MILK-001", name="Whole Milk", category_id=cat_dairy.id, unit="liter", reorder_level=15, reorder_quantity=40),
    InventoryItem(sku="EGGS-001", name="Eggs (Tray)", category_id=cat_dairy.id, unit="tray", reorder_level=10, reorder_quantity=25),
    InventoryItem(sku="ONION-001", name="Yellow Onions", category_id=cat_produce.id, unit="kg", reorder_level=8, reorder_quantity=20),
    InventoryItem(sku="TOM-001", name="Tomatoes", category_id=cat_produce.id, unit="kg", reorder_level=10, reorder_quantity=25),
    InventoryItem(sku="COF-001", name="Coffee Beans", category_id=cat_beverages.id, unit="kg", reorder_level=5, reorder_quantity=15),
    InventoryItem(sku="SOAP-001", name="Hand Soap", category_id=cat_cleaning.id, unit="liter", reorder_level=10, reorder_quantity=30),
    InventoryItem(sku="FLOUR-001", name="All Purpose Flour", category_id=cat_dry.id, unit="kg", reorder_level=15, reorder_quantity=40),
    InventoryItem(sku="BUTTER-001", name="Butter", category_id=cat_dairy.id, unit="kg", reorder_level=5, reorder_quantity=15),
]
db.add_all(items)
db.commit()

# --- Stock Batches ---
batches = [
    StockBatch(item_id=items[0].id, batch_number="B001", quantity=45, bin_location="A1", expiry_date=date(2026, 12, 31), unit_cost=2.5),
    StockBatch(item_id=items[1].id, batch_number="B002", quantity=12, unit_cost=8.0),
    StockBatch(item_id=items[2].id, batch_number="B003", quantity=25, unit_cost=1.2),
    StockBatch(item_id=items[4].id, batch_number="B004", quantity=30, bin_location="V1", unit_cost=1.5),
    StockBatch(item_id=items[5].id, batch_number="B005", quantity=15, unit_cost=2.0),
    StockBatch(item_id=items[6].id, batch_number="B006", quantity=8, bin_location="B2", expiry_date=date(2026, 10, 15), unit_cost=12.0),
]
db.add_all(batches)
db.commit()

# --- Vendors ---
vendors = [
    Vendor(name="Imtiaz Super Market", contact_person="Ahmed Raza", phone="+92-21-111-124-224", email="orders@imtiazsuper.pk", address="Shahrah-e-Faisal, Karachi", payment_terms="Net 30"),
    Vendor(name="Metro Cash & Carry", contact_person="Bilal Sheikh", phone="+92-42-111-635-825", email="sales@metro-pakistan.com", address="Multan Road, Lahore", payment_terms="Net 15"),
    Vendor(name="CSD - Canteen Stores Department", contact_person="Brig (R) Tariq Mehmood", phone="+92-51-9270123", email="csd@csd.gov.pk", address="The Mall, Rawalpindi", payment_terms="Net 30"),
]
db.add_all(vendors)
db.commit()

# --- Purchase Orders ---
po = PurchaseOrder(po_number="PO-20260701-0001", vendor_id=vendors[0].id, status=POStatus.RECEIVED,
                   total_amount=375.0, expected_delivery=date(2026, 7, 5), created_by=admin.id)
db.add(po)
db.commit()
poi = PurchaseOrderItem(po_id=po.id, item_id=items[0].id, quantity_ordered=100, quantity_delivered=100, quantity_received=100, unit_price=2.5, total_price=250.0)
poi2 = PurchaseOrderItem(po_id=po.id, item_id=items[4].id, quantity_ordered=50, quantity_delivered=50, quantity_received=50, unit_price=2.5, total_price=125.0)
db.add_all([poi, poi2])
db.commit()

# --- Rooms (three classes per the rate card) ---
rooms = []
for floor in range(1, 4):
    for room_num in range(1, 9):
        rooms.append(Room(
            room_number=f"{floor}0{room_num}",
            room_type=RoomType.STANDARD,
            floor=floor,
            capacity=2,
            base_price=3500,  # card total for a serving officer
        ))

# Named suites (A-C are 2xAC, D-F are 1xAC - the AC count drives the HRA
# monthly utility figure) and the DG suite.
for suite_name, acs in [("Suite-A", 2), ("Suite-B", 2), ("Suite-C", 2),
                        ("Suite-D", 1), ("Suite-E", 1), ("Suite-F", 1)]:
    rooms.append(Room(room_number=suite_name, room_type=RoomType.SUITE, ac_count=acs, floor=1, capacity=2, base_price=4500))
rooms.append(Room(room_number="DG-Suite", room_type=RoomType.DG_SUITE, ac_count=2, floor=3, capacity=2, base_price=4500))
db.add_all(rooms)
db.commit()

# --- Rate card (room class x guest category, itemized) ---
from backend.services.room_pricing import (
    DEFAULT_ROOM_RATES, DEFAULT_DUTY_RATES, RATE_COMPONENTS,
    DEFAULT_HRA_RANK_RATES, DEFAULT_HRA_UTILITY_RATES, compute_booking_price,
)
for rt, cats in DEFAULT_ROOM_RATES.items():
    for cat, values in cats.items():
        db.add(RoomRate(room_type=rt, guest_category=cat, **dict(zip(RATE_COMPONENTS, values))))
for band, (label, amount) in DEFAULT_DUTY_RATES.items():
    db.add(DutyRate(rank_band=band, label=label, da_amount=amount))
for band, (label, amount) in DEFAULT_HRA_RANK_RATES.items():
    db.add(HraRankRate(rank_band=band, label=label, monthly_amount=amount))
for room_type, amount in DEFAULT_HRA_UTILITY_RATES.items():
    db.add(HraUtilityRate(room_type=room_type, monthly_amount=amount))
db.commit()

# --- Members & one demo HRA resident ---
member = Member(service_number="PA-55201", full_name="Brig Nasir Iqbal", rank="Brig", unit="GHQ",
                 mess_category=MessCategory.OFFICERS, client_category=ClientCategory.PERMANENT_MEMBER, status=MemberStatus.ACTIVE)
db.add(member)
db.commit()

hra_room = next(r for r in rooms if r.room_number == "Suite-B")  # unused by the transient bookings_data above, and an actual HRA-rated room class
hra_room.status = RoomStatus.OCCUPIED
hra_check_in = date(2026, 1, 15)
hra_pricing = compute_booking_price(
    db, hra_room, check_in=hra_check_in, check_out=hra_check_in + timedelta(days=365),
    client_category="serving_officer", nature_of_duty="hra", member_id=member.id,
)
hra_booking = Booking(
    booking_reference="BK-20260115-9001", guest_name=member.full_name, member_id=member.id,
    rank=member.rank, room_id=hra_room.id, check_in=hra_check_in, check_out=hra_check_in + timedelta(days=365),
    status=BookingStatus.CHECKED_IN, client_category=ClientCategory.SERVING_OFFICER, nature_of_duty="hra",
    total_amount=hra_pricing["total"], rate_breakdown=json.dumps(hra_pricing), processed_by=front_user.id,
)
db.add(hra_booking)
db.commit()

# --- Bookings ---
bookings_data = [
    {"guest_name": "Ahmed Hassan", "phone": "+92-300-1234567", "room_idx": 0, "check_in": date(2026, 6, 28), "check_out": date(2026, 7, 3), "status": BookingStatus.CHECKED_IN},
    {"guest_name": "Ayesha Malik", "phone": "+92-321-2345678", "room_idx": 2, "check_in": date(2026, 6, 29), "check_out": date(2026, 7, 2), "status": BookingStatus.CHECKED_IN},
    {"guest_name": "Bilal Chaudhry", "phone": "+92-333-3456789", "room_idx": 5, "check_in": date(2026, 7, 1), "check_out": date(2026, 7, 5), "status": BookingStatus.CONFIRMED},
    {"guest_name": "Sana Farooqi", "phone": "+92-345-4567890", "room_idx": 8, "check_in": date(2026, 7, 2), "check_out": date(2026, 7, 7), "status": BookingStatus.CONFIRMED},
]
for i, bd in enumerate(bookings_data):
    room = rooms[bd["room_idx"]]
    nights = (bd["check_out"] - bd["check_in"]).days
    b = Booking(
        booking_reference=f"BK-20260701-{i+1:04d}",
        guest_name=bd["guest_name"], guest_phone=bd["phone"],
        room_id=room.id, check_in=bd["check_in"], check_out=bd["check_out"],
        status=bd["status"], total_amount=float(room.base_price) * max(nights, 1),
        processed_by=front_user.id,
    )
    if bd["status"] == BookingStatus.CHECKED_IN:
        room.status = RoomStatus.OCCUPIED
    elif bd["status"] == BookingStatus.CONFIRMED:
        room.status = RoomStatus.RESERVED
    db.add(b)
db.commit()

# --- Invoices ---
inv = Invoice(invoice_number="INV-202607-00001", booking_id=1, issue_date=date(2026, 7, 1),
              due_date=date(2026, 7, 8), subtotal=250, tax_amount=20, discount=0, total_amount=270,
              status=InvoiceStatus.ISSUED, created_by=admin.id)
db.add(inv)
db.commit()
ii = InvoiceItem(invoice_id=inv.id, description="Room 101 - 5 nights", quantity=5, unit_price=50, total_price=250)
db.add(ii)
db.commit()

# --- Waste Log ---
waste = WasteLog(item_id=items[2].id, quantity=2, category=WasteCategory.SPOILAGE, note="Milk spoiled during power outage", cost=2.4, logged_by=kitchen_user.id)
db.add(waste)
db.commit()

# --- Recipes / Menu Items (breakfast/lunch/hitea/dinner options for the
# Attendance page's "Today's menu item" picker and Kitchen production) ---
recipes = [
    Recipe(name="Anda Paratha", description="Fried egg wrapped in a buttered paratha", menu_category="breakfast", portions=1),
    Recipe(name="Plain Omelette", description="Two-egg omelette with butter", menu_category="breakfast", portions=1),
    Recipe(name="Tea & Toast", description="Buttered toast with a cup of tea", menu_category="breakfast", portions=1),
    Recipe(name="Chicken Karahi", description="Chicken cooked with tomatoes and onions", menu_category="lunch", portions=4),
    Recipe(name="Vegetable Pulao", description="Basmati rice with sauteed onions and tomatoes", menu_category="lunch", portions=6),
    Recipe(name="Plain Rice & Curry", description="Steamed basmati rice with mixed vegetable curry", menu_category="lunch", portions=6),
    Recipe(name="Tea & Biscuits", description="Hi-tea service with assorted biscuits", menu_category="hitea", portions=1),
    Recipe(name="Coffee & Samosa", description="Hi-tea service with fried samosas", menu_category="hitea", portions=1),
    Recipe(name="Chicken Biryani", description="Layered rice with spiced chicken, onions and tomatoes", menu_category="dinner", portions=4),
    Recipe(name="Roti & Chicken Curry", description="Wheat flatbread with chicken curry", menu_category="dinner", portions=4),
]
db.add_all(recipes)
db.commit()

recipe_ingredients = [
    RecipeIngredient(recipe_id=recipes[0].id, item_id=items[3].id, quantity=1, unit="pcs"),   # Anda Paratha - Eggs
    RecipeIngredient(recipe_id=recipes[0].id, item_id=items[8].id, quantity=0.1, unit="kg"),  # - Flour
    RecipeIngredient(recipe_id=recipes[0].id, item_id=items[9].id, quantity=0.02, unit="kg"), # - Butter
    RecipeIngredient(recipe_id=recipes[1].id, item_id=items[3].id, quantity=2, unit="pcs"),   # Plain Omelette - Eggs
    RecipeIngredient(recipe_id=recipes[1].id, item_id=items[9].id, quantity=0.02, unit="kg"), # - Butter
    RecipeIngredient(recipe_id=recipes[3].id, item_id=items[1].id, quantity=1.0, unit="kg"),  # Chicken Karahi - Chicken
    RecipeIngredient(recipe_id=recipes[3].id, item_id=items[5].id, quantity=0.3, unit="kg"),  # - Tomatoes
    RecipeIngredient(recipe_id=recipes[3].id, item_id=items[4].id, quantity=0.3, unit="kg"),  # - Onions
    RecipeIngredient(recipe_id=recipes[4].id, item_id=items[0].id, quantity=1.5, unit="kg"),  # Vegetable Pulao - Rice
    RecipeIngredient(recipe_id=recipes[4].id, item_id=items[4].id, quantity=0.2, unit="kg"),  # - Onions
    RecipeIngredient(recipe_id=recipes[8].id, item_id=items[0].id, quantity=1.5, unit="kg"),  # Chicken Biryani - Rice
    RecipeIngredient(recipe_id=recipes[8].id, item_id=items[1].id, quantity=1.0, unit="kg"),  # - Chicken
    RecipeIngredient(recipe_id=recipes[8].id, item_id=items[4].id, quantity=0.3, unit="kg"),  # - Onions
]
db.add_all(recipe_ingredients)
db.commit()

# --- Security Logs ---
sec_log = SecurityLog(event_type="check_in", guest_name="Ahmed Hassan", room_number="101", processed_by=front_user.id)
db.add(sec_log)
db.commit()

# --- Incident ---
inc = IncidentReport(title="Water leak in hallway", description="Minor water leak observed near room 205", location="2nd Floor Hallway", category="safety", severity=AlertSeverity.MEDIUM, reported_by=security_user.id)
db.add(inc)
db.commit()

# --- Audit entries ---
for entry_data in [
    {"user_id": admin.id, "user_name": admin.full_name, "action": AuditAction.LOGIN, "entity_type": "users", "entity_id": admin.id, "department": "system"},
    {"user_id": admin.id, "user_name": admin.full_name, "action": AuditAction.CREATE, "entity_type": "rooms", "entity_id": 1, "department": "bookings"},
    {"user_id": front_user.id, "user_name": front_user.full_name, "action": AuditAction.CREATE, "entity_type": "bookings", "entity_id": 1, "department": "bookings"},
]:
    db.add(AuditLog(**entry_data))
db.commit()

print("Demo data seeded successfully!")
print(f"  - {db.query(Recipe).count()} recipes")
print(f"  - {db.query(Role).count()} roles")
print(f"  - {db.query(User).count()} users (admin/admin123)")
print(f"  - {db.query(InventoryItem).count()} inventory items")
print(f"  - {db.query(Room).count()} rooms")
print(f"  - {db.query(Booking).count()} bookings")
print(f"  - {db.query(Member).count()} members ({db.query(Booking).filter(Booking.nature_of_duty == 'hra').count()} HRA resident)")
print(f"  - {db.query(Vendor).count()} vendors")
print("Login with: admin / admin123")
