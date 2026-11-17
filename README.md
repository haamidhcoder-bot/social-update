# Social Update — Food, Farm & Community Network

Connects farmers with hotels, colleges and food factories, and connects
surplus food with orphanages and NGOs.

**Stack:** HTML + CSS + JS (frontend) · Python Flask (backend) · MySQL (database)

## Roles → pages

| Role | Slug (DB) | Page | Can post | Can browse |
|---|---|---|---|---|
| Farmer | `farmer` | `/farmer.html` | produce | ingredient + raw-material needs |
| Hotel Manager | `hotel_manager` | `/hotel.html` | ingredient needs, surplus food | produce, food requests |
| Food Processing Manager | `processing_manager` | `/processing.html` | raw-material needs | produce |
| Orphanage Incharge | `orphanage_incharge` | `/orphanage.html` | food requests | surplus food |
| College Food Incharge | `college_incharge` | `/college.html` | ingredient needs, surplus food | produce, food requests |
| NGO Incharge | `ngo_incharge` | `/ngo.html` | food requests | surplus food, food requests |
| Others (volunteers, donors, transporters, shops…) | `other` | `/other.html` | surplus food, food requests, **transport offers** (when free + how much they can carry) | everything except transport offers |

After register/login the user is redirected to their own page. The backend
also blocks opening another role's page (see `guard_dashboards` in `app.py`).
The post/browse rules live in one place: `PERMISSIONS` in `backend/app.py`.

## Setup

```bash
# 1. database
mysql -u root -p < database/schema.sql

# 2. backend
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # set DB_PASSWORD and SECRET_KEY
python app.py
```

Open http://localhost:5000 — Flask serves the `frontend/` folder too, so no
CORS setup is needed.

## Pictures (Cloudinary)

Every listing (crop, surplus food, ingredient / raw-material need, food
request) and every member profile can have an optional picture: upload a
JPG / PNG / GIF / WebP (max 2 MB) **or** paste a link, with a live preview
and a "Remove current picture" option. Uploads are checked by their real file
type, sent to Cloudinary, and only the returned `https://res.cloudinary.com/...`
link is stored in MySQL. Replaced / deleted pictures are removed from Cloudinary.

1. Create a free account at https://cloudinary.com and open the Console.
2. Copy the Cloud name, API Key and API Secret into `backend/.env`
   (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`).
3. `pip install -r requirements.txt` and restart the server.

Upgrading an existing database? Run once:
`mysql -u root -p social_update < database/migration_add_pictures.sql`
(this also adds the new `other` role)
Then, for transport offers: `mysql -u root -p social_update < database/migration_add_transport.sql`

## Project layout

```
social_update/
├── database/schema.sql        users + listings tables
├── backend/
│   ├── app.py                 all routes (auth, listings, members)
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── index.html             landing, register, login, directory
    ├── farmer.html hotel.html processing.html
    ├── orphanage.html college.html ngo.html other.html
    ├── account.html           My Account page (all roles)
    ├── css/style.css
    └── js/ api.js (helpers) · main.js (landing) · dashboard.js (role pages) · account.js (My Account)
```

## API

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/register` | create account, logs in, returns `redirect` |
| POST | `/api/login` | returns `redirect` to the role page |
| POST | `/api/logout` | |
| GET | `/api/account` | own full account details |
| POST | `/api/account` | edit own details, picture and (optionally) password; multipart or JSON |
| GET | `/api/me` | current user + permissions |
| GET | `/api/listings?q=&types=&district=` | browse others' listings |
| GET | `/api/my-listings` | own listings |
| POST | `/api/listings` | create listing, optional picture (multipart or JSON) |
| DELETE | `/api/listings/<id>` | delete own listing |
| GET | `/api/members?q=&role=&district=` | public directory (contacts hidden when logged out) |

## Where to add your logic later

- Order/interest requests between members (new table + routes)
- Listing status (`open` → `closed`) and expiry for surplus food
- Notifications, email/SMS verification, password reset
- Rate limiting and CSRF protection before going live
