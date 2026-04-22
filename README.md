# 🎬 DVD / Blu-Ray Library Manager

A self-hosted web app for cataloguing your physical disc collection.
Works on desktop and as a PWA on iPhone/Android — scan barcodes with your camera
and auto-fill metadata from OMDB (the open IMDB mirror).

---

## Features

- **Barcode scanning** via device camera (iPhone Safari, Android Chrome, desktop webcam)
- **Auto-fill from OMDB/IMDB** — title, cast, plot, poster, rating, runtime, genre
- **CRUD library** — add, edit, delete, search, filter, sort
- **Grid & List views** with poster images
- **Statistics dashboard** — by format, genre, decade, average IMDB rating
- **PWA** — add to home screen on iOS/Android, works offline for browsing
- **MySQL/MariaDB** backend — your data stays on your own server
- Preserves all original schema fields (`movieName`, `actors`, `pop`, `rrp`, `pp`, `rating`, `comments`)

---

## Quick Start (Docker — recommended)

### 1. Prerequisites
```bash
# Docker + Docker Compose
docker --version        # ≥ 24
docker compose version  # ≥ 2.20
```

### 2. Get your free OMDB API key
Register at **https://www.omdbapi.com/apikey.aspx** (free tier: 1000 req/day).

### 3. Configure environment
```bash
cd dvd-library
cp backend/.env.example .env
nano .env           # set OMDB_API_KEY and change passwords
```

`.env` file:
```ini
DB_ROOT_PASS=changeme_root      # MariaDB root password
DB_PASS=dvdlib_secret           # App DB user password
OMDB_API_KEY=your_key_here      # From omdbapi.com
PORT=3000                       # Web port (change if 3000 is taken)
```

### 4. Start everything
```bash
docker compose up -d
```

### 5. Open the app
```
http://localhost:3000            # or
http://YOUR_SERVER_IP:3000
```

### 6. Stop / Update
```bash
docker compose down              # stop
docker compose pull && docker compose up -d --build   # update
```

---

## Manual Install (without Docker)

### Requirements
- Node.js ≥ 18
- MySQL 5.7+ or MariaDB 10.4+

### Database setup
```bash
mysql -u root -p < schema.sql
```

### Backend
```bash
cd backend
npm install
cp .env.example .env
nano .env          # configure DB and OMDB key
node server.js
```

### Frontend
The frontend is a static single HTML file — the Node backend serves it automatically.
No build step needed.

---

## Nginx reverse proxy (HTTPS on Linux host)

If you want to run behind nginx with SSL:

```nginx
server {
    listen 80;
    server_name dvd.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name dvd.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/dvd.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dvd.yourdomain.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Get free SSL: `certbot --nginx -d dvd.yourdomain.com`

HTTPS is **required** for camera barcode scanning on iOS.

---

## Mobile App (iPhone & Android)

The web app is a **Progressive Web App (PWA)**. No App Store required.

### iPhone (Safari)
1. Open `https://dvd.yourdomain.com` in Safari
2. Tap Share → **Add to Home Screen**
3. The app opens full-screen, camera scanning works via `html5-qrcode`

### Android (Chrome)
1. Open the URL in Chrome
2. Tap the "Install" banner or Menu → **Add to Home Screen**

> Camera barcode scanning requires HTTPS. Use the nginx config above or a
> service like Tailscale / Cloudflare Tunnel to expose your local server securely.

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/movies` | List movies. Params: `search`, `format`, `sort` |
| GET | `/api/movies/:id` | Single movie |
| POST | `/api/movies` | Create movie |
| PUT | `/api/movies/:id` | Update movie |
| DELETE | `/api/movies/:id` | Delete movie |
| GET | `/api/lookup/barcode/:code` | Barcode → OMDB lookup chain |
| GET | `/api/lookup/imdb/:id` | OMDB lookup by IMDB ID |
| GET | `/api/lookup/title/:title` | OMDB lookup by title |
| GET | `/api/search/omdb?q=` | Search OMDB (multiple results) |
| GET | `/api/stats` | Library statistics |
| GET | `/api/health` | Health check |

---

## Database Schema

The app extends the original `DVD` table with additional fields while keeping
all original column names unchanged:

| Column | Type | Notes |
|--------|------|-------|
| `id` | INT AUTO_INCREMENT | Primary key |
| `movieName` | VARCHAR(255) | **Original** |
| `actors` | VARCHAR(1000) | **Original** |
| `pop` | VARCHAR(20) | **Original** — place of purchase |
| `rrp` | VARCHAR(20) | **Original** — retail price |
| `pp` | VARCHAR(20) | **Original** — price paid |
| `rating` | VARCHAR(20) | **Original** — age rating |
| `comments` | VARCHAR(4000) | **Original** — personal notes |
| `barcode` | VARCHAR(50) UNIQUE | UPC/EAN from disc |
| `format` | ENUM | DVD / Blu-Ray / 4K UHD / Other |
| `director` | VARCHAR(255) | From OMDB |
| `genre` | VARCHAR(255) | From OMDB |
| `year` | VARCHAR(10) | From OMDB |
| `runtime` | VARCHAR(50) | From OMDB |
| `plot` | TEXT | From OMDB |
| `coverImage` | VARCHAR(500) | Poster URL from OMDB |
| `imdbId` | VARCHAR(50) | e.g. tt0111161 |
| `imdbRating` | VARCHAR(10) | e.g. 9.3 |
| `language` | VARCHAR(100) | From OMDB |
| `country` | VARCHAR(100) | From OMDB |
| `studio` | VARCHAR(255) | From OMDB |
| `location` | VARCHAR(100) | Physical shelf location |
| `dateAdded` | DATETIME | Auto-set |
| `lastUpdated` | DATETIME | Auto-updated |

### Migrating from old DVD table
Uncomment the migration block at the bottom of `schema.sql` to import existing data.

---

## Project Structure

```
dvd-library/
├── docker-compose.yml
├── schema.sql
├── .env                    ← create from backend/.env.example
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js           ← Express REST API
│   └── .env.example
└── frontend/
    ├── index.html          ← Full PWA (single file, no build step)
    └── manifest.json       ← PWA manifest for home screen install
```

---

## Barcode Lookup Flow

```
Scan barcode
     │
     ▼
Own database ──found──▶ Show "Already in Library"
     │ not found
     ▼
UPCitemdb.com (free, 100 req/day) ──no match──▶ "Add Manually"
     │ match → title
     ▼
OMDB API ──found──▶ Pre-fill form with full metadata
                     (title, cast, director, poster, plot, rating…)
```

---

## Troubleshooting

**Camera not working on iPhone**
→ Must be served over HTTPS. See nginx config above.

**OMDB search returns "key not configured"**
→ Add `OMDB_API_KEY=xxx` to your `.env` file and restart.

**Barcode lookup finds nothing**
→ UPCitemdb free tier has 100 requests/day. Use Manual Barcode Entry as fallback.
   For higher limits, upgrade at upcitemdb.com.

**DB connection refused**
→ In docker-compose setup, the backend waits for the DB healthcheck.
   `docker compose logs db` to check MariaDB status.
