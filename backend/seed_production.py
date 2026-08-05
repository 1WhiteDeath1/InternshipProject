"""
SEED PRODUCTION DATA - EME MESS
================================
Generates the client's real starting database: the 6 RBAC roles, 5 real
staff accounts (Manager, Deputy Manager, Clerk, Booking NCO, Kitchen NCO -
no Security Guard account yet), and the mess's actual 28-room register.
Deliberately does NOT create any demo bookings, guests, members, menu
items, inventory, or vendors - those are real operational data the client
enters themselves once live, not something to fabricate on their behalf.

This is NOT part of the application runtime and does NOT run automatically.
Run once to produce the DB that packaging/seed_data/hotel_mess.db ships as
a fresh install's starting database (see packaging/EME-MESS.spec).

To run: python backend/seed_production.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.database import SessionLocal, engine, Base
from backend.models import *
from backend.auth import hash_password
from backend.branding import create_default_branding_file
from backend.migrations import run_startup_migrations

Base.metadata.create_all(bind=engine)
run_startup_migrations(engine)
create_default_branding_file()

db = SessionLocal()

manager_role = db.query(Role).filter(Role.name == "Manager").first()
deputy_role = db.query(Role).filter(Role.name == "Deputy Manager").first()
clerk_role = db.query(Role).filter(Role.name == "Clerk").first()
kitchen_role = db.query(Role).filter(Role.name == "Kitchen NCO").first()
front_desk_role = db.query(Role).filter(Role.name == "Booking NCO").first()

# TEMPORARY password for all 5 accounts - change every one of these via
# Settings > Change Password immediately after first login. Not meant to
# survive past that first login.
TEMP_PASSWORD = "ChangeMe#2026"

db.add_all([
    User(username="manager", email="manager@ememess.local", full_name="Manager",
         hashed_password=hash_password(TEMP_PASSWORD), role_id=manager_role.id, status=UserStatus.ACTIVE),
    User(username="deputy", email="deputy@ememess.local", full_name="Deputy Manager",
         hashed_password=hash_password(TEMP_PASSWORD), role_id=deputy_role.id, status=UserStatus.ACTIVE),
    User(username="clerk", email="clerk@ememess.local", full_name="Clerk",
         hashed_password=hash_password(TEMP_PASSWORD), role_id=clerk_role.id, status=UserStatus.ACTIVE),
    User(username="booking", email="booking@ememess.local", full_name="Booking NCO",
         hashed_password=hash_password(TEMP_PASSWORD), role_id=front_desk_role.id, status=UserStatus.ACTIVE),
    User(username="kitchen", email="kitchen@ememess.local", full_name="Kitchen NCO",
         hashed_password=hash_password(TEMP_PASSWORD), role_id=kitchen_role.id, status=UserStatus.ACTIVE),
])
db.commit()

# --- Rooms (28 total, per the mess's actual room register - unchanged from
# the demo seed, since this reflects real physical rooms, not sample data) ---
rooms = []
for room_num in list(range(2, 15)) + list(range(20, 27)):
    rooms.append(Room(room_number=f"VIP-{room_num}", room_type=RoomType.STANDARD, floor=1, capacity=2, base_price=3500))
for suite_name, acs in [("Suite-A", 2), ("Suite-B", 2), ("Suite-C", 2),
                        ("Suite-D", 1), ("Suite-E", 1), ("Suite-F", 1)]:
    rooms.append(Room(room_number=suite_name, room_type=RoomType.SUITE, ac_count=acs, floor=1, capacity=2, base_price=4500))
rooms.append(Room(room_number="DG-Suite-1", room_type=RoomType.DG_SUITE, ac_count=2, floor=3, capacity=2, base_price=4500))
rooms.append(Room(room_number="DG-Suite-2", room_type=RoomType.DG_SUITE, ac_count=2, floor=3, capacity=2, base_price=4500))
db.add_all(rooms)
db.commit()

# --- Attendants (check-in hard-requires one assigned to the room) ---
attendants = [
    Attendant(full_name="Attendant 1", shift="morning", is_active=True),
    Attendant(full_name="Attendant 2", shift="evening", is_active=True),
]
db.add_all(attendants)
db.commit()
for i, room in enumerate(rooms):
    room.attendant_id = attendants[i % len(attendants)].id
db.commit()

print("Production data seeded successfully!")
print(f"  - {db.query(Role).count()} roles")
print(f"  - {db.query(User).count()} users (manager/deputy/clerk/booking/kitchen)")
print(f"  - {db.query(Room).count()} rooms")
print(f"  - {db.query(Attendant).count()} attendants (rename these to your real staff via Attendants)")
print(f"\nTEMP PASSWORD for all 5 accounts: {TEMP_PASSWORD}")
print("Change every one of these via Settings > Change Password on first login.")
print("No menu items, inventory, members, bookings, or vendors were created -")
print("enter those for real once the system is live.")
