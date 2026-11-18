"""
Social Update backend (Flask + MySQL).

Run:
    cd backend
    pip install -r requirements.txt
    cp .env.example .env      # then edit your MySQL password
    python app.py             # http://localhost:5000

Flask also serves the ../frontend folder, so the site and the API share
one origin (no CORS setup needed, session cookies just work).
"""
import io
import math
import os
import re
import threading
import time
from collections import defaultdict, deque
from datetime import datetime

import cloudinary
import cloudinary.uploader
import pymysql
from dotenv import load_dotenv
from flask import (Flask, g, jsonify, redirect, request, send_from_directory,
                   session)
from werkzeug.security import check_password_hash, generate_password_hash

load_dotenv()

FRONTEND_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "frontend"))

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
DEBUG = os.getenv("FLASK_DEBUG", "0") == "1"
_secret = os.getenv("SECRET_KEY", "")
if len(_secret) < 24 or _secret.lower().startswith("change"):
    if not DEBUG:
        raise SystemExit(
            "SECRET_KEY in backend/.env is missing or too weak. Generate one with:\n"
            "  python -c \"import secrets; print(secrets.token_hex(32))\"")
    _secret = _secret or "dev-only-secret"
app.secret_key = _secret
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "0") == "1",  # set 1 behind HTTPS
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 14,
)

# Pictures are uploaded to Cloudinary; only the returned https link is stored
# in MySQL. Set CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY /
# CLOUDINARY_API_SECRET in backend/.env (or a single CLOUDINARY_URL).
CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME", "")
if CLOUD_NAME:
    cloudinary.config(cloud_name=CLOUD_NAME,
                      api_key=os.getenv("CLOUDINARY_API_KEY", ""),
                      api_secret=os.getenv("CLOUDINARY_API_SECRET", ""),
                      secure=True)
CLOUDINARY_READY = bool(CLOUD_NAME or os.getenv("CLOUDINARY_URL"))
CLOUD_FOLDER = os.getenv("CLOUDINARY_FOLDER", "social_update")
MAX_IMAGE_BYTES = 2 * 1024 * 1024                      # 2 MB per picture
app.config["MAX_CONTENT_LENGTH"] = MAX_IMAGE_BYTES + 512 * 1024  # + form fields
CLOUD_TIMEOUT = 30                                     # seconds, so uploads never hang

# --------------------------------------------------------------------------
# Roles, dashboard pages and what each role may post / browse
# --------------------------------------------------------------------------
ROLE_PAGES = {
    "farmer": "/farmer.html",
    "hotel_manager": "/hotel.html",
    "processing_manager": "/processing.html",
    "orphanage_incharge": "/orphanage.html",
    "college_incharge": "/college.html",
    "ngo_incharge": "/ngo.html",
    "other": "/other.html",
}
PAGE_ROLES = {page: role for role, page in ROLE_PAGES.items()}

PERMISSIONS = {
    "farmer":             {"post": ["produce"],
                           "browse": ["ingredient_need", "raw_material_need",
                                      "transport_offer"]},
    "hotel_manager":      {"post": ["ingredient_need", "surplus_food"],
                           "browse": ["produce", "food_request",
                                      "transport_offer"]},
    "processing_manager": {"post": ["raw_material_need"],
                           "browse": ["produce", "transport_offer"]},
    "orphanage_incharge": {"post": ["food_request"],
                           "browse": ["surplus_food", "transport_offer"]},
    "college_incharge":   {"post": ["ingredient_need", "surplus_food"],
                           "browse": ["produce", "food_request",
                                      "transport_offer"]},
    "ngo_incharge":       {"post": ["food_request"],
                           "browse": ["surplus_food", "food_request",
                                      "transport_offer"]},
    # volunteers, individual donors, transporters, shops, anyone else
    "other":              {"post": ["surplus_food", "food_request",
                                   "transport_offer"],
                           "browse": ["produce", "ingredient_need",
                                      "raw_material_need", "surplus_food",
                                      "food_request"]},
}

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^[0-9+() \-]{8,16}$")


# --------------------------------------------------------------------------
# Database helpers
# --------------------------------------------------------------------------
def get_db():
    if "db" not in g:
        g.db = pymysql.connect(
            host=os.getenv("DB_HOST", "localhost"),
            port=int(os.getenv("DB_PORT", "3306")),
            user=os.getenv("DB_USER", "root"),
            password=os.getenv("DB_PASSWORD", ""),
            database=os.getenv("DB_NAME", "social_update"),
            cursorclass=pymysql.cursors.DictCursor,
            charset="utf8mb4",
            autocommit=True,
            connect_timeout=5, read_timeout=20, write_timeout=20,
        )
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def query(sql, args=(), one=False):
    with get_db().cursor() as cur:
        cur.execute(sql, args)
        rows = cur.fetchall()
    return (rows[0] if rows else None) if one else rows


def execute(sql, args=()):
    with get_db().cursor() as cur:
        cur.execute(sql, args)
        return cur.lastrowid, cur.rowcount


# --------------------------------------------------------------------------
# Auth helpers
# --------------------------------------------------------------------------
def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    if "_cu" not in g:                       # one DB lookup per request
        g._cu = query(
            "SELECT id, role, org_name, contact_name, phone, email, district, "
            "area, photo_url FROM users WHERE id=%s", (uid,), one=True)
    return g._cu


def login_required(fn):
    from functools import wraps

    @wraps(fn)
    def wrapper(*a, **kw):
        user = current_user()
        if not user:
            return jsonify(error="Please log in."), 401
        g.user = user
        return fn(*a, **kw)
    return wrapper


def err(msg, code=400):
    return jsonify(error=msg), code


# --------------------------------------------------------------------------
# Picture helpers (upload a file OR paste a link)
# --------------------------------------------------------------------------
IMAGE_LINK_RE = re.compile(r"^(https?://[^\s]+|/[^/\s][^\s]*)$", re.I)


def request_data():
    """Form fields from either multipart/form-data or a JSON body."""
    if request.mimetype == "multipart/form-data":
        return request.form
    return request.get_json(silent=True) or {}


def sniff_image_ext(head):
    """Real file type from the first bytes (the filename can lie)."""
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    return None


def get_picture(data):
    """Read the optional picture from the current request.

    Returns the value to store (a Cloudinary link or a pasted link) or None when
    no picture was given. Raises ValueError with a friendly message.
    """
    f = request.files.get("picture")
    if f and f.filename:
        blob = f.read(MAX_IMAGE_BYTES + 1)
        if len(blob) > MAX_IMAGE_BYTES:
            raise ValueError("Picture is too large. Maximum size is 2 MB.")
        ext = sniff_image_ext(blob[:12])
        if not ext:
            raise ValueError("Picture must be a JPG, PNG, GIF or WebP file.")
        if not CLOUDINARY_READY:
            raise ValueError("Picture upload is not set up yet. Add your "
                             "Cloudinary keys to backend/.env, or paste a "
                             "picture link instead.")
        try:
            res = cloudinary.uploader.upload(
                io.BytesIO(blob), folder=CLOUD_FOLDER, resource_type="image",
                allowed_formats=["jpg", "png", "gif", "webp"],
                timeout=CLOUD_TIMEOUT)
        except Exception:
            app.logger.exception("Cloudinary upload failed")
            raise ValueError("Could not upload the picture. Please try again.")
        return res["secure_url"]

    link = str(data.get("picture_url") or "").strip()
    if link:
        if len(link) > 255 or not IMAGE_LINK_RE.match(link):
            raise ValueError("Picture link must start with https:// or /.")
        return link
    return None


CLOUD_URL_RE = re.compile(
    r"^https://res\.cloudinary\.com/([^/]+)/image/upload/(?:[^/]+/)*?"
    r"(?:v\d+/)?(.+?)\.[A-Za-z0-9]+$")


def remove_picture_file(url):
    """Delete our own Cloudinary upload (links to other sites are left alone)."""
    m = CLOUD_URL_RE.match(url or "")
    if not m or not CLOUDINARY_READY or m.group(1) != CLOUD_NAME:
        return
    public_id = m.group(2)

    def _bg():                               # don't make the user wait for this
        try:
            cloudinary.uploader.destroy(public_id, resource_type="image",
                                        timeout=CLOUD_TIMEOUT)
        except Exception:
            app.logger.warning("Could not delete Cloudinary picture %s", public_id)
    threading.Thread(target=_bg, daemon=True).start()


@app.errorhandler(413)
def too_large(_e):
    return err("Picture is too large. Maximum size is 2 MB.", 413)


# --------------------------------------------------------------------------
# Page protection: /farmer.html etc. only open for the matching role
# --------------------------------------------------------------------------
@app.before_request
def guard_dashboards():
    if request.path == "/account.html":          # any logged-in member
        return None if current_user() else redirect("/")
    required_role = PAGE_ROLES.get(request.path)
    if not required_role:
        return None
    user = current_user()
    if not user:
        return redirect("/")
    if user["role"] != required_role:
        return redirect(ROLE_PAGES[user["role"]])
    return None


@app.route("/")
def home():
    return send_from_directory(FRONTEND_DIR, "index.html")


# --------------------------------------------------------------------------
# Input validation (keeps over-long / odd input from turning into MySQL 500s)
# --------------------------------------------------------------------------
def text(d, key, maxlen, required=False, label=None):
    v = str(d.get(key) or "").strip()
    if required and not v:
        raise ValueError("Please fill in all required fields.")
    if len(v) > maxlen:
        raise ValueError(f"{label or key.capitalize()} is too long (max {maxlen} characters).")
    return v or None


def clean_profile(d):
    """Validated profile fields shared by register and account update."""
    out = {
        "org": text(d, "org", 150, True, "Name"),
        "contact": text(d, "contact", 100, True, "Contact person"),
        "phone": text(d, "phone", 20, True, "Mobile number"),
        "email": (text(d, "email", 150, True, "Email") or "").lower(),
        "district": text(d, "district", 60, True, "District"),
        "area": text(d, "area", 100, True, "Area"),
        "address": text(d, "address", 255, label="Address"),
        "details": text(d, "details", 5000, label="Details"),
        "capacity": text(d, "capacity", 100, label="Capacity"),
        "website": text(d, "website", 255, label="Website"),
    }
    if not EMAIL_RE.match(out["email"]):
        raise ValueError("Enter a valid email address.")
    if not PHONE_RE.match(out["phone"]):
        raise ValueError("Enter a valid mobile number.")
    if out["website"] and not re.match(r"^https?://[^\s]+$", out["website"], re.I):
        raise ValueError("Website must start with http:// or https://")
    return out


def check_password_len(pw, what="Password"):
    if len(pw) < 8:
        raise ValueError(f"{what} must be at least 8 characters.")
    if len(pw) > 128:
        raise ValueError(f"{what} is too long (max 128 characters).")


# --------------------------------------------------------------------------
# Security: headers, same-origin check for writes, login/sign-up throttling
# --------------------------------------------------------------------------
CSP = ("default-src 'self'; "
       "script-src 'self' 'unsafe-inline' https://unpkg.com https://maps.googleapis.com https://maps.gstatic.com; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://maps.googleapis.com; "
       "font-src https://fonts.gstatic.com; "
       "img-src 'self' data: blob: https:; "
       "connect-src 'self' https://nominatim.openstreetmap.org https://maps.googleapis.com; "
       "frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; "
       "frame-ancestors 'none'")


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("Content-Security-Policy", CSP)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)")
    if request.path.startswith("/api/") or request.path.endswith(".html") or request.path == "/":
        resp.headers["Cache-Control"] = "no-store"   # private data / role pages
    return resp


@app.before_request
def same_origin_writes():
    """Block cross-site POST/DELETE (CSRF) on top of SameSite=Lax cookies."""
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        origin = request.headers.get("Origin")
        if origin and origin.split("://", 1)[-1] != request.host:
            return err("Cross-site request blocked.", 403)
    return None


_hits = defaultdict(deque)
_hits_lock = threading.Lock()


def throttle(bucket, limit, window):
    """True when this client has used up `limit` attempts in `window` seconds."""
    key = (bucket, request.remote_addr)
    now = time.time()
    with _hits_lock:
        q = _hits[key]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            return True
        q.append(now)
        return False


@app.errorhandler(pymysql.err.IntegrityError)
def db_integrity(e):
    if e.args and e.args[0] == 1062:
        return err("This email is already registered. Please log in.", 409)
    app.logger.exception("DB integrity error")
    return err("Could not save that. Please check your details.")


@app.errorhandler(pymysql.err.MySQLError)
def db_error(_e):
    app.logger.exception("Database error")
    return err("The database is busy or unavailable. Please try again.", 503)


@app.errorhandler(500)
def server_error(_e):
    return err("Something went wrong on our side. Please try again.", 500)


def like(term):
    """LIKE pattern for user text with % and _ treated literally."""
    t = term.strip()[:100].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{t}%"


def parse_pin(d):
    """Optional map pin -> (lat, lng) as floats, or (None, None)."""
    raw_lat = str(d.get("latitude") or "").strip()
    raw_lng = str(d.get("longitude") or "").strip()
    if not raw_lat and not raw_lng:
        return None, None
    try:
        lat, lng = round(float(raw_lat), 6), round(float(raw_lng), 6)
    except ValueError:
        raise ValueError("The map location is not valid. Please pick it again.")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValueError("The map location is out of range.")
    return lat, lng


@app.get("/api/config")
def public_config():
    """Public front-end settings (the Google Maps browser key is meant to be
    public; restrict it by HTTP referrer in Google Cloud Console)."""
    return jsonify(maps_key=os.getenv("GOOGLE_MAPS_API_KEY", ""))


# --------------------------------------------------------------------------
# API: auth
# --------------------------------------------------------------------------
@app.post("/api/register")
def register():
    if throttle("register", 10, 3600):
        return err("Too many sign-up attempts. Please try again later.", 429)
    d = request_data()
    role = d.get("role", "")
    if role not in ROLE_PAGES:
        return err("Please choose a valid role.")
    try:
        f = clean_profile(d)
        password = str(d.get("password") or "")
        check_password_len(password)
    except ValueError as e:
        return err(str(e))
    email = f["email"]
    if query("SELECT id FROM users WHERE email=%s", (email,), one=True):
        return err("This email is already registered. Please log in.", 409)

    try:
        photo = get_picture(d)
    except ValueError as e:
        return err(str(e))

    try:
        lat, lng = parse_pin(d)
    except ValueError as e:
        return err(str(e))

    user_id, _ = execute(
        "INSERT INTO users (role, org_name, contact_name, phone, email, "
        "password_hash, district, area, address, latitude, longitude, details, "
        "capacity, website, photo_url) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (role, f["org"], f["contact"], f["phone"],
         email, generate_password_hash(password),
         f["district"], f["area"], f["address"], lat, lng,
         f["details"], f["capacity"], f["website"], photo))

    session.clear()
    session.permanent = True
    session["user_id"] = user_id
    return jsonify(ok=True, role=role, redirect=ROLE_PAGES[role]), 201


@app.post("/api/login")
def login():
    d = request.get_json(silent=True) or {}
    email = str(d.get("email") or "").strip().lower()[:150]
    password = str(d.get("password") or "")[:128]
    if throttle("login-try", 30, 900):
        return err("Too many login attempts. Please wait a few minutes.", 429)
    user = query("SELECT id, role, password_hash FROM users WHERE email=%s",
                 (email,), one=True)
    if not user or not check_password_hash(user["password_hash"], password):
        return err("Incorrect email or password.", 401)
    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    return jsonify(ok=True, role=user["role"],
                   redirect=ROLE_PAGES[user["role"]])


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
@login_required
def me():
    u = g.user
    return jsonify(user=u, permissions=PERMISSIONS[u["role"]],
                   page=ROLE_PAGES[u["role"]])


# --------------------------------------------------------------------------
# API: listings (basic CRUD - extend the logic here later)
# --------------------------------------------------------------------------
@app.get("/api/listings")
@login_required
def browse_listings():
    """Listings from other members that this role is allowed to browse."""
    allowed = PERMISSIONS[g.user["role"]]["browse"]
    types = [t for t in request.args.get("types", "").split(",") if t in allowed]
    types = types or allowed
    q = like(request.args.get("q", ""))
    district = request.args.get("district", "").strip()

    sql = (
        "SELECT l.id, l.type, l.title, l.quantity, l.unit, l.price, "
        "l.description, l.image_url, "
        "l.vehicle, DATE_FORMAT(l.available_from, '%%Y-%%m-%%dT%%H:%%i') AS available_from, "
        "DATE_FORMAT(l.available_until, '%%Y-%%m-%%dT%%H:%%i') AS available_until, "
        "l.created_at, u.org_name, u.contact_name, u.phone, "
        "u.email, u.district, u.area "
        "FROM listings l JOIN users u ON u.id = l.user_id "
        "WHERE l.status='open' AND l.user_id <> %s "
        f"AND l.type IN ({','.join(['%s'] * len(types))}) "
        "AND (l.type <> 'transport_offer' OR l.available_until IS NULL "
        "     OR l.available_until > NOW()) "
        "AND (l.title LIKE %s OR l.description LIKE %s OR u.org_name LIKE %s) "
    )
    args = [g.user["id"], *types, q, q, q]
    if district:
        sql += "AND u.district = %s "
        args.append(district)
    sql += "ORDER BY l.created_at DESC LIMIT 100"
    return jsonify(listings=query(sql, args))


@app.get("/api/my-listings")
@login_required
def my_listings():
    rows = query("SELECT id, type, title, quantity, unit, price, description, "
                 "image_url, vehicle, "
                 "DATE_FORMAT(available_from, '%%Y-%%m-%%dT%%H:%%i') AS available_from, "
                 "DATE_FORMAT(available_until, '%%Y-%%m-%%dT%%H:%%i') AS available_until, "
                 "status, created_at FROM listings WHERE user_id=%s "
                 "ORDER BY created_at DESC", (g.user["id"],))
    return jsonify(listings=rows)


@app.post("/api/listings")
@login_required
def create_listing():
    d = request_data()
    ltype = d.get("type", "")
    if ltype not in PERMISSIONS[g.user["role"]]["post"]:
        return err("Your role cannot post this type of listing.", 403)
    try:
        title = text(d, "title", 150, True, "Title")
        unit = text(d, "unit", 20, label="Unit")
        description = text(d, "description", 5000, label="Description")
    except ValueError as e:
        return err(str(e))

    def num(key):
        try:
            v = d.get(key)
            x = float(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None
        if x is None or not math.isfinite(x) or x < 0 or x > 99999999:
            return None
        return x

    vehicle = avail_from = avail_until = None
    if ltype == "transport_offer":
        # when the person is free and how much they can carry are required
        if not num("quantity") or num("quantity") <= 0:
            return err("Tell us how much you can transport.")
        if not unit:
            return err("Choose a unit for how much you can transport.")
        try:
            avail_from = datetime.strptime(
                str(d.get("available_from") or ""), "%Y-%m-%dT%H:%M")
            avail_until = datetime.strptime(
                str(d.get("available_until") or ""), "%Y-%m-%dT%H:%M")
        except ValueError:
            return err("Tell us when you are free (from and until).")
        if avail_until <= avail_from:
            return err("'Free until' must be after 'free from'.")
        if avail_until <= datetime.now():
            return err("'Free until' is already in the past.")
        vehicle = (d.get("vehicle") or "").strip()[:60] or None

    try:
        image = get_picture(d)
    except ValueError as e:
        return err(str(e))

    new_id, _ = execute(
        "INSERT INTO listings (user_id, type, title, quantity, unit, price, "
        "description, image_url, vehicle, available_from, available_until) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (g.user["id"], ltype, title, num("quantity"),
         unit, num("price"), description, image,
         vehicle, avail_from, avail_until))
    return jsonify(ok=True, id=new_id), 201


@app.delete("/api/listings/<int:listing_id>")
@login_required
def delete_listing(listing_id):
    row = query("SELECT image_url FROM listings WHERE id=%s AND user_id=%s",
                (listing_id, g.user["id"]), one=True)
    _, count = execute("DELETE FROM listings WHERE id=%s AND user_id=%s",
                       (listing_id, g.user["id"]))
    if not count:
        return err("Listing not found.", 404)
    remove_picture_file(row and row["image_url"])
    return jsonify(ok=True)


# --------------------------------------------------------------------------
# API: my account (view / edit details, picture and password)
# --------------------------------------------------------------------------
ACCOUNT_COLS = ("id, role, org_name, contact_name, phone, email, district, "
                "area, address, latitude, longitude, details, capacity, website, photo_url")


@app.get("/api/account")
@login_required
def get_account():
    return jsonify(account=query(
        f"SELECT {ACCOUNT_COLS} FROM users WHERE id=%s", (g.user["id"],),
        one=True))


@app.post("/api/account")
@login_required
def update_account():
    """Edit own details. Role cannot be changed. Password is optional."""
    d = request_data()
    uid = g.user["id"]
    try:
        f = clean_profile(d)
    except ValueError as e:
        return err(str(e))
    email = f["email"]
    if query("SELECT id FROM users WHERE email=%s AND id<>%s", (email, uid),
             one=True):
        return err("This email is already used by another account.", 409)

    new_pw = str(d.get("new_password") or "")
    if new_pw:
        row = query("SELECT password_hash FROM users WHERE id=%s", (uid,),
                    one=True)
        if throttle("pw-change", 10, 900):
            return err("Too many attempts. Please wait a few minutes.", 429)
        if not check_password_hash(row["password_hash"],
                                   str(d.get("current_password") or "")[:128]):
            return err("Current password is incorrect.", 403)
        try:
            check_password_len(new_pw, "New password")
        except ValueError as e:
            return err(str(e))

    try:
        lat, lng = parse_pin(d)
    except ValueError as e:
        return err(str(e))

    old = query("SELECT photo_url FROM users WHERE id=%s", (uid,),
                one=True)["photo_url"]
    try:
        uploaded = get_picture(d)
    except ValueError as e:
        return err(str(e))
    if uploaded:
        photo = uploaded
    elif str(d.get("remove_picture", "")) in ("1", "true", "on"):
        photo = None
    else:
        photo = old

    execute(
        "UPDATE users SET org_name=%s, contact_name=%s, phone=%s, email=%s, "
        "district=%s, area=%s, address=%s, latitude=%s, longitude=%s, "
        "details=%s, capacity=%s, website=%s, photo_url=%s WHERE id=%s",
        (f["org"], f["contact"], f["phone"], email,
         f["district"], f["area"], f["address"], lat, lng,
         f["details"], f["capacity"], f["website"], photo, uid))
    if new_pw:
        execute("UPDATE users SET password_hash=%s WHERE id=%s",
                (generate_password_hash(new_pw), uid))
    if old != photo:
        remove_picture_file(old)
    return jsonify(ok=True, account=query(
        f"SELECT {ACCOUNT_COLS} FROM users WHERE id=%s", (uid,), one=True))


# --------------------------------------------------------------------------
# API: public community directory (no phone/email until logged in)
# --------------------------------------------------------------------------
@app.get("/api/members")
def members():
    role = request.args.get("role", "")
    district = request.args.get("district", "").strip()
    q = like(request.args.get("q", ""))
    logged_in = bool(current_user())

    cols = "id, role, org_name, district, area, details, photo_url"
    if logged_in:                      # exact pin + contact only for members
        cols += ", latitude, longitude, contact_name, phone, email"
    sql = (f"SELECT {cols} FROM users WHERE "
           "(org_name LIKE %s OR area LIKE %s OR details LIKE %s) ")
    args = [q, q, q]
    if role in ROLE_PAGES:
        sql += "AND role=%s "
        args.append(role)
    if district:
        sql += "AND district=%s "
        args.append(district)
    sql += "ORDER BY created_at DESC LIMIT 100"
    return jsonify(members=query(sql, args))


if __name__ == "__main__":
    app.run(debug=DEBUG,
            port=int(os.getenv("PORT", "5000")))
