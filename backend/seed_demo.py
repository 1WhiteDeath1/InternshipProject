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
# One account per RBAC role, deliberately trivial credentials (username = role,
# password = "123456" for every single one) - this is offline demo/dev data
# only (see module docstring), never a production seed, so memorability beats
# any password hygiene concern here. Swap to real credentials before any
# real deployment.
DEMO_PASSWORD = "123456"
admin = User(username="manager", email="manager@samhotel.local", full_name="System Manager",
             hashed_password=hash_password(DEMO_PASSWORD), role_id=manager_role.id,
             status=UserStatus.ACTIVE, last_login=datetime.utcnow())
deputy_user = User(username="deputy", email="deputy@samhotel.local", full_name="Farah Zaidi",
                    hashed_password=hash_password(DEMO_PASSWORD), role_id=deputy_role.id, status=UserStatus.ACTIVE)
front_user = User(username="booking", email="front@samhotel.local", full_name="Sana Malik",
                  hashed_password=hash_password(DEMO_PASSWORD), role_id=front_desk_role.id, status=UserStatus.ACTIVE)
clerk_user = User(username="clerk", email="clerk@samhotel.local", full_name="Imran Khalid",
                  hashed_password=hash_password(DEMO_PASSWORD), role_id=clerk_role.id, status=UserStatus.ACTIVE)
kitchen_user = User(username="kitchen", email="kitchen@samhotel.local", full_name="Usman Tariq",
                    hashed_password=hash_password(DEMO_PASSWORD), role_id=kitchen_role.id, status=UserStatus.ACTIVE)
security_user = User(username="security", email="security@samhotel.local", full_name="Naveed Iqbal",
                     hashed_password=hash_password(DEMO_PASSWORD), role_id=security_role.id, status=UserStatus.ACTIVE)
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

# --- Self-purchase stock intake (vendor-tagged, demoing Daily Stock Intake) ---
vendor_batches = [
    StockBatch(item_id=items[0].id, batch_number="SI-DEMO-001", quantity=100, unit_cost=2.5, vendor_id=vendors[0].id),
    StockBatch(item_id=items[4].id, batch_number="SI-DEMO-002", quantity=50, unit_cost=2.5, vendor_id=vendors[0].id),
]
db.add_all(vendor_batches)
db.commit()

# --- Rooms (28 total, per the mess's actual room register) ---
rooms = []
# "VIP" rooms are just the mess's naming convention for standard rooms -
# not a distinct RoomType. Numbered 2-14 and 20-26 (15-19 don't exist).
for room_num in list(range(2, 15)) + list(range(20, 27)):
    rooms.append(Room(
        room_number=f"VIP-{room_num}",
        room_type=RoomType.STANDARD,
        floor=1,
        capacity=2,
        base_price=3500,  # card total for a serving officer
    ))

# Named suites (A-C are 2xAC, D-F are 1xAC - the AC count drives the HRA
# monthly utility figure) and the two DG suites.
for suite_name, acs in [("Suite-A", 2), ("Suite-B", 2), ("Suite-C", 2),
                        ("Suite-D", 1), ("Suite-E", 1), ("Suite-F", 1)]:
    rooms.append(Room(room_number=suite_name, room_type=RoomType.SUITE, ac_count=acs, floor=1, capacity=2, base_price=4500))
rooms.append(Room(room_number="DG-Suite-1", room_type=RoomType.DG_SUITE, ac_count=2, floor=3, capacity=2, base_price=4500))
rooms.append(Room(room_number="DG-Suite-2", room_type=RoomType.DG_SUITE, ac_count=2, floor=3, capacity=2, base_price=4500))
db.add_all(rooms)
db.commit()

# --- Attendants (check-in hard-requires one assigned to the room - without
# these, a fresh install can create a booking but can't check anyone in) ---
attendants = [
    Attendant(full_name="Rashid Ali", phone="0300-1000001", shift="morning", is_active=True),
    Attendant(full_name="Bilal Ahmed", phone="0300-1000002", shift="evening", is_active=True),
]
db.add_all(attendants)
db.commit()
for i, room in enumerate(rooms):
    room.attendant_id = attendants[i % len(attendants)].id
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
ii = InvoiceItem(invoice_id=inv.id, description="Room VIP-2 - 5 nights", quantity=5, unit_price=50, total_price=250)
db.add(ii)
db.commit()

# --- Waste Log ---
waste = WasteLog(item_id=items[2].id, quantity=2, category=WasteCategory.SPOILAGE, note="Milk spoiled during power outage", cost=2.4, logged_by=kitchen_user.id)
db.add(waste)
db.commit()

# --- Menu (the mess's actual weekly lunch/dinner rotation - Executive Mess
# Rawat's paper menu - plus a small generic breakfast/hitea set since the
# paper menu only covers lunch/dinner). Prices are Kitchen NCO-editable
# estimates, not costed figures - there's no ingredient/recipe data behind
# them anymore. Feeds the Attendance page's "Today's menu item" picker and
# Kitchen production.) ---
WEEKLY_MENU = [
    # (day_of_week, meal_type, name, price)
    ("monday", "lunch", "Chana Pulao", 200), ("monday", "lunch", "Raita", 80), ("monday", "lunch", "Chicken Shami Kebab (2 pcs)", 250),
    ("monday", "dinner", "Malai Boti (3 skewers)", 350), ("monday", "dinner", "Kebab (1 pc)", 200),
    ("monday", "dinner", "1/8 Chicken Tikka", 300), ("monday", "dinner", "Naan / Puri Paratha", 60),

    ("tuesday", "lunch", "Chicken Qorma", 300), ("tuesday", "lunch", "Naan", 50), ("tuesday", "lunch", "Salad", 80),
    ("tuesday", "dinner", "Chicken Karahi", 350), ("tuesday", "dinner", "Tandoori Roti", 40),

    ("wednesday", "lunch", "Mixed Vegetables", 180), ("wednesday", "lunch", "Chapati", 30),
    ("wednesday", "dinner", "Chicken Makhni Handi", 350), ("wednesday", "dinner", "Chapati", 30), ("wednesday", "dinner", "Raita", 80),

    ("thursday", "lunch", "Mixed Daal", 150), ("thursday", "lunch", "1/2 Rice", 100), ("thursday", "lunch", "Roti (2 pcs)", 30),
    ("thursday", "dinner", "Chicken Qorma", 300), ("thursday", "dinner", "Tandoori Roti", 40),

    ("friday", "lunch", "Chicken Karahi", 350), ("friday", "lunch", "Naan", 50), ("friday", "lunch", "Raita", 80),
    ("friday", "dinner", "Daal Mash", 150), ("friday", "dinner", "1/8 Roasted Chicken", 280),
    ("friday", "dinner", "Chapati", 30), ("friday", "dinner", "Tandoori Roti", 40),

    ("saturday", "lunch", "Lahori Chana", 180), ("saturday", "lunch", "Naan", 50),
    ("saturday", "dinner", "Plain Pulao", 150), ("saturday", "dinner", "Chicken Karahi", 350),

    # Sunday: the regular afternoon/night rows plus the paper menu's separate
    # "Sunday Special" rotation choices for the same two slots.
    ("sunday", "lunch", "Paratha", 60), ("sunday", "lunch", "Aloo Keema", 220), ("sunday", "lunch", "Egg", 40),
    ("sunday", "lunch", "Puri Chutney", 80), ("sunday", "lunch", "Chana Pulao", 200), ("sunday", "lunch", "Raita / Soup", 90),
    ("sunday", "lunch", "Naan", 50), ("sunday", "lunch", "Reshmi Kebab (1 pc)", 250), ("sunday", "lunch", "1/8 Chicken Tikka", 300),
    ("sunday", "lunch", "Chicken Biryani", 280), ("sunday", "lunch", "Tandoori Roti", 40),
    ("sunday", "dinner", "Boneless Chicken", 320), ("sunday", "dinner", "Aloo Anda Gravy", 200), ("sunday", "dinner", "Tandoori Roti", 40),
    ("sunday", "dinner", "Malai Boti (3 skewers)", 350), ("sunday", "dinner", "Kebab (1 pc)", 200), ("sunday", "dinner", "Reshmi Kebab (1 pc)", 250),
    ("sunday", "dinner", "1/8 Chicken Tikka", 300), ("sunday", "dinner", "Naan / Puri Paratha", 60),
    ("sunday", "dinner", "Chicken Biryani", 280), ("sunday", "dinner", "Aloo Keema Gravy", 230),

    # Not on the paper menu (lunch/dinner only) - a small generic set so
    # breakfast/hitea aren't empty in the picker.
    (None, "breakfast", "Anda Paratha", 100), (None, "breakfast", "Plain Omelette", 90), (None, "breakfast", "Tea & Toast", 70),
    (None, "hitea", "Tea & Biscuits", 60), (None, "hitea", "Coffee & Samosa", 90),
]
menu_items = [MenuItem(day_of_week=day, meal_type=meal, name=name, price=price) for day, meal, name, price in WEEKLY_MENU]
db.add_all(menu_items)
db.commit()

# --- Gas charge rate (Kitchen NCO-set percentage of the computed Extra
# Messing total; Extra Messing itself has no rate to seed - it's always
# computed from actual orders) ---
db.add(GasChargeRate(percentage=10, updated_by=kitchen_user.id))
db.commit()

# --- Security Logs ---
sec_log = SecurityLog(event_type="check_in", guest_name="Ahmed Hassan", room_number="VIP-2", processed_by=front_user.id)
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
print(f"  - {db.query(MenuItem).count()} menu items")
print(f"  - {db.query(Role).count()} roles")
print(f"  - {db.query(User).count()} users (manager/deputy/clerk/kitchen/booking/security, password 123456)")
print(f"  - {db.query(InventoryItem).count()} inventory items")
print(f"  - {db.query(Room).count()} rooms")
print(f"  - {db.query(Attendant).count()} attendants")
print(f"  - {db.query(Booking).count()} bookings")
print(f"  - {db.query(Member).count()} members ({db.query(Booking).filter(Booking.nature_of_duty == 'hra').count()} HRA resident)")
print(f"  - {db.query(Vendor).count()} vendors")
print("Login with any of: manager / deputy / clerk / kitchen / booking / security, password 123456")
