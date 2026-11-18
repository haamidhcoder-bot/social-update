"""
Load sample data into the Social Update database.

    cd backend
    python seed_data.py            # adds sample members + posts
    python seed_data.py --reset    # wipes users/listings first, then adds them

Passwords are hashed with the same function the app uses
(werkzeug generate_password_hash), so every sample account can log in
through the normal login form.

All sample accounts use the password:  Password@123
Safe to run more than once: members whose email already exists are skipped.
"""
import os
import sys
import time
from datetime import datetime, timedelta

import pymysql
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash

load_dotenv()

PASSWORD = "Password@123"

# (role, org, contact, phone, email, district, area, address, details, capacity, website)
USERS = [
    ("farmer", "Selvam Organic Farm", "Selvam Ramasamy", "+91 98430 11223",
     "selvam@example.com", "Coimbatore", "Pollachi", "Kinathukadavu Road, Pollachi",
     "Tomatoes, brinjal, drumstick and banana. Harvest every Tuesday and Friday.",
     "2 tonnes a week", None),
    ("farmer", "Meenakshi Vegetable Gardens", "Meenakshi S", "+91 97510 44829",
     "meenakshi@example.com", "Erode", "Perundurai", "Near the weekly market, Perundurai",
     "Onions, small onions and green chillies. Can deliver within 40 km.",
     "1.5 tonnes a week", None),
    ("farmer", "Karuppasamy Paddy Fields", "Karuppasamy P", "+91 99521 30871",
     "karuppasamy@example.com", "Thanjavur", "Papanasam", "Papanasam main road",
     "Ponni and kichadi samba rice, sold in 50 kg bags.",
     "10 tonnes a season", None),

    ("hotel_manager", "Annapoorna Mess", "Kavitha Murugan", "+91 98940 55667",
     "annapoorna@example.com", "Coimbatore", "Gandhipuram", "Cross Cut Road, Gandhipuram",
     "About 300 meals a day. Looking for rice, vegetables and cooking oil.",
     "300 meals/day", None),
    ("hotel_manager", "Hotel Saravana Bhavan Residency", "Rajesh Kumar", "+91 98420 76123",
     "saravana@example.com", "Madurai", "Anna Nagar", "Anna Nagar Main Road",
     "Restaurant and banquet hall. Surplus after functions is usually available in the evening.",
     "500 meals/day", None),

    ("processing_manager", "Sri Murugan Agro Foods", "Dhanapal V", "+91 94430 29184",
     "murugan.agro@example.com", "Salem", "Omalur", "SIDCO Industrial Estate, Omalur",
     "Tamarind, chilli and turmeric processing. Buys raw material in bulk.",
     "5 tonnes/day", "https://example.com/murugan-agro"),

    ("orphanage_incharge", "Little Hands Home", "Sr. Mary Joseph", "+91 97890 22334",
     "littlehands@example.com", "Coimbatore", "Peelamedu", "Avinashi Road, Peelamedu",
     "32 children aged 5 to 16. We can collect food within 10 km.",
     "32 children", None),
    ("orphanage_incharge", "Anbu Illam", "Lakshmi Narayanan", "+91 98650 17742",
     "anbuillam@example.com", "Madurai", "Thiruparankundram", "Near the temple, Thiruparankundram",
     "45 children. Always need rice, dal and milk.",
     "45 children", None),

    ("college_incharge", "PSG Arts College Mess", "Ganesan T", "+91 98947 66301",
     "psgmess@example.com", "Coimbatore", "Civil Aerodrome", "Civil Aerodrome Post",
     "Hostel mess for about 900 students. Surplus after special days and events.",
     "900 students", None),

    ("ngo_incharge", "Pasi Illa Tamilagam Trust", "Arun Prakash", "+91 98410 90522",
     "pasiilla@example.com", "Chennai", "Velachery", "Velachery Main Road",
     "We feed 150 people a day in two shelters. Have a van for collection.",
     "150 meals/day", "https://example.com/pasiilla"),

    ("other", "Murugan Transport", "Murugan K", "+91 90030 41256",
     "murugan.transport@example.com", "Coimbatore", "Singanallur", "Trichy Road, Singanallur",
     "Mini truck owner. Happy to carry food for free on slow days.",
     None, None),
    ("other", "Volunteer: Divya R", "Divya Ramesh", "+91 96770 38419",
     "divya.volunteer@example.com", "Chennai", "Adyar", "Adyar",
     "Weekend volunteer with a car. I can help pick up and deliver small loads.",
     None, None),
]


def hours_ago(h):
    return int((time.time() - h * 3600) * 1000)


def tag(food_type, cooked_ms, text):
    """The app stores food type + cooked time at the start of the description."""
    return f"[[ft:{food_type}|ct:{cooked_ms}]] {text}"


now = datetime.now().replace(second=0, microsecond=0)
fmt = lambda d: d.strftime("%Y-%m-%d %H:%M:%S")

# (owner email, type, title, quantity, unit, price, description, vehicle, from, until)
LISTINGS = [
    ("selvam@example.com", "produce", "Fresh tomatoes", 120, "kg", 22,
     "Picked this morning. Pick-up from the farm gate, or we can deliver above 100 kg.", None, None, None),
    ("selvam@example.com", "produce", "Drumstick", 40, "kg", 55,
     "Tender, first-picking drumsticks.", None, None, None),
    ("meenakshi@example.com", "produce", "Small onions (sambar onion)", 300, "kg", 48,
     "Cleaned and graded. Price drops for orders above 200 kg.", None, None, None),
    ("karuppasamy@example.com", "produce", "Ponni raw rice", 2000, "kg", 41,
     "New harvest, 50 kg bags.", None, None, None),

    ("annapoorna@example.com", "ingredient_need", "Rice and vegetables for the mess", 200, "kg", None,
     "Looking for a regular supplier near Coimbatore. Weekly delivery preferred.", None, None, None),
    ("annapoorna@example.com", "surplus_food", "Veg meals, about 40 plates", 40, "meals", 0,
     tag(0, hours_ago(1), "Left over from lunch. Pick-up from the mess hall."), None, None, None),
    ("saravana@example.com", "surplus_food", "Chapati and kurma", 60, "meals", 0,
     tag(1, hours_ago(2), "Banquet leftovers, packed in boxes. Pick-up from the back gate."), None, None, None),

    ("murugan.agro@example.com", "raw_material_need", "Dry red chillies", 2, "tonnes", None,
     "Need good-colour, low-moisture chillies. Can arrange transport.", None, None, None),

    ("littlehands@example.com", "food_request", "Rice and dal for 32 children", 25, "kg", None,
     "Any day this week. We can send someone to collect.", None, None, None),
    ("anbuillam@example.com", "food_request", "Milk for the children", 30, "litres", None,
     "Needed every Saturday. Even a once-a-month donation helps.", None, None, None),

    ("psgmess@example.com", "ingredient_need", "Vegetables for the hostel mess", 150, "kg", None,
     "Beans, carrot, cabbage and potato. Delivery before 7 am.", None, None, None),
    ("psgmess@example.com", "surplus_food", "Sambar rice and curd rice", 80, "meals", 0,
     tag(0, hours_ago(1), "Left from the department function. Collection from the mess."), None, None, None),

    ("pasiilla@example.com", "food_request", "Cooked meals for the evening shelter", 100, "meals", None,
     "We serve at 7 pm. Please drop by 6:30 pm if you can.", None, None, None),

    ("murugan.transport@example.com", "transport_offer", "Mini truck free tomorrow", 1, "tonnes", 0,
     "Can carry crates or vessels. Based in Singanallur, happy to go up to 50 km.",
     "Mini truck / tempo", fmt(now), fmt(now + timedelta(days=2))),
    ("divya.volunteer@example.com", "transport_offer", "Car available this weekend", 40, "boxes", 0,
     "Can pick up food boxes and drop at any home in Chennai.",
     "Car", fmt(now), fmt(now + timedelta(days=3))),
]


def connect():
    return pymysql.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "social_update"),
        charset="utf8mb4",
        autocommit=False,
    )


def main():
    db = None
    cur = None
    try:
        db = connect()
        cur = db.cursor()

        if "--reset" in sys.argv:
            confirm = input(
                "This will DELETE ALL rows from users and listings. "
                "Type RESET to continue: "
            )
            if confirm != "RESET":
                print("Reset cancelled. No data was changed.")
                return

            # Delete child rows before parent rows because of the foreign key.
            cur.execute("DELETE FROM listings")
            cur.execute("DELETE FROM users")
            cur.execute("ALTER TABLE listings AUTO_INCREMENT = 1")
            cur.execute("ALTER TABLE users AUTO_INCREMENT = 1")
            print("Cleared existing users and listings.")

        pw_hash = generate_password_hash(PASSWORD)
        ids, added_users = {}, 0

        for (role, org, contact, phone, email, district, area, address,
             details, capacity, website) in USERS:
            cur.execute("SELECT id FROM users WHERE email = %s", (email,))
            row = cur.fetchone()
            if row:
                ids[email] = row[0]
                continue

            cur.execute(
                "INSERT INTO users (role, org_name, contact_name, phone, email, "
                "password_hash, district, area, address, details, capacity, website) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (role, org, contact, phone, email, pw_hash, district, area,
                 address, details, capacity, website)
            )
            ids[email] = cur.lastrowid
            added_users += 1

        added_listings = 0
        for (email, ltype, title, qty, unit, price, desc, vehicle,
             a_from, a_until) in LISTINGS:
            uid = ids[email]
            cur.execute(
                "SELECT id FROM listings WHERE user_id = %s AND title = %s",
                (uid, title)
            )
            if cur.fetchone():
                continue

            cur.execute(
                "INSERT INTO listings (user_id, type, title, quantity, unit, price, "
                "description, vehicle, available_from, available_until) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (uid, ltype, title, qty, unit, price, desc, vehicle,
                 a_from, a_until)
            )
            added_listings += 1

        db.commit()
        print(f"Added {added_users} members and {added_listings} posts.")
        print(
            f"Log in with any sample email, e.g. "
            f"selvam@example.com / {PASSWORD}"
        )

    except Exception:
        if db:
            db.rollback()
        raise

    finally:
        if cur:
            cur.close()
        if db:
            db.close()


if __name__ == "__main__":
    main()
