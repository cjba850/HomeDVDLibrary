# 🎬 DVD / Blu-Ray Library Manager

A self-hosted web app for cataloguing your physical disc collection.
Works on desktop and as a PWA on iPhone/Android — scan barcodes with your camera,
auto-fill metadata from OMDB/IMDB, track loans, and batch-enrich missing data.

---

## Features

- **Barcode scanning** via device camera (iPhone Safari, Android Chrome, desktop webcam)
- **Auto-fill from OMDB/IMDB** — title, cast, plot, poster, rating, runtime, genre
- **CRUD library** — add, edit, delete, search, filter, sort
- **Advanced filter panel** — genre, age rating, place of purchase, IMDB score range, year range, poster-only toggle
- **Fuzzy duplicate detection** — exact, IMDB ID, SOUNDEX phonetic, and word-overlap matching on every save/lookup
- **Loan tracking** — loan out to named people, mark returned, full history per disc
- **Loans view** — see all on-loan discs, filter by person, days-out colouring
- **Batch Enrich** — step through movies missing metadata with OMDB confirmation popup, update IMDB ID / barcode / poster in bulk
- **Poster caching** — download OMDB poster images locally so library works offline
- **Statistics dashboard** — by format, genre, decade, average IMDB rating
- **PWA** — add to home screen on iOS/Android
- **MySQL/MariaDB** backend — your data stays on your own server
- Preserves all original schema fields (`movieName`, `actors`, `pop`, `rrp`, `pp`, `rating`, `comments`)

---

## Quick Start (Docker — recommended)

### 1. Prerequisites
```bash
docker --version        # ≥ 24
docker compose version  # ≥ 2.20
```

### 2. Get your free OMDB API key
Register at **https://www.omdbapi.com/apikey.aspx** (free tier: 1000 req/day).

### 3. Configure environment
```bash
cd dvd-library
cp backend/.env.example .env
nano .env   # set OMDB_API_KEY and change passwords
```

`.env` values:
```ini
DB_ROOT_PASS=changeme_root
DB_PASS=dvdlib_secret
OMDB_API_KEY=your_key_here
PORT=3000
```

### 4. Start
```bash
docker compose up -d
# Open http://localhost:3000  or  http://YOUR_SERVER_IP:3000
```

---

## Manual Install (without Docker)

### Requirements
- Node.js ≥ 18
- MySQL 5.7+ or MariaDB 10.4+

### Setup
```bash
# 1. Create database
sudo mariadb -u root -p << SQL
CREATE DATABASE dvdlibrary CHARACTER SET utf8mb4;
CREATE USER 'dvdlib'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL ON dvdlibrary.* TO 'dvdlib'@'localhost';
SQL

# 2. Load schema
mariadb -u dvdlib -p dvdlibrary < schema.sql

# 3. Configure
cp backend/.env.example .env && nano .env

# 4. Install & run
cd backend && npm install
node server.js
```

---

## Existing Database Migrations

If you have an existing database, run the applicable migration scripts in order:

```bash
# Add local poster cache column (if created before poster-caching update)
mariadb -u dvdlib -p dvdlibrary < scripts/migrate-add-localposter.sql

# Add loan tracking tables (if created before loans update)
mariadb -u dvdlib -p dvdlibrary < scripts/migrate-add-loans.sql
```

---

## Poster Image Caching

Downloads posters locally so the library loads faster and works offline.

```bash
# From the project root (backend/.env or .env must be configured)
node scripts/fetch-posters.js              # all missing posters
node scripts/fetch-posters.js --force      # re-download everything
node scripts/fetch-posters.js --dry-run    # preview without downloading
node scripts/fetch-posters.js --id 42      # single movie by DB id
```

Images are saved to `frontend/posters/<id>.jpg`. The app automatically
uses the local file when available, falling back to the OMDB URL.

---

## Running as a Linux Service (systemd)

```bash
# Install (creates dvdlib user, copies to /opt/dvd-library, enables service)
sudo bash systemd/install-service.sh

# Management
sudo systemctl status  dvd-library
sudo systemctl restart dvd-library
sudo journalctl -u dvd-library -f          # live logs

# Or use the helper:
sudo bash systemd/manage-service.sh update     # sync new files & restart
sudo bash systemd/manage-service.sh logs
sudo bash systemd/manage-service.sh uninstall
```

---

## Mobile App (iPhone & Android)

The web app is a **Progressive Web App (PWA)**. No App Store required.

**iPhone:** Open in Safari → Share → Add to Home Screen  
**Android:** Open in Chrome → Menu → Add to Home Screen

> Camera barcode scanning requires HTTPS. Use the nginx config below or
> Cloudflare Tunnel / Tailscale to expose your server securely.

### Nginx + HTTPS config

```nginx
server {
    listen 443 ssl http2;
    server_name dvd.yourdomain.com;
    ssl_certificate     /etc/letsencrypt/live/dvd.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dvd.yourdomain.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Get free SSL: `certbot --nginx -d dvd.yourdomain.com`

---

## API Reference

### Movies
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/movies` | List. Params: `search`, `format`, `genre`, `ageRating`, `purchasedAt`, `minImdb`, `minYear`, `maxYear`, `sort` |
| GET | `/api/movies/:id` | Single movie |
| POST | `/api/movies` | Create |
| PUT | `/api/movies/:id` | Update |
| DELETE | `/api/movies/:id` | Delete |

### Lookups
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/lookup/barcode/:code` | UPC → UPCitemdb → OMDB chain |
| GET | `/api/lookup/imdb/:id` | OMDB by IMDB ID |
| GET | `/api/lookup/title/:title` | OMDB by title |
| GET | `/api/search/omdb?q=` | OMDB search (multiple results) |
| GET | `/api/similar?title=&year=&imdbId=&excludeId=` | Fuzzy duplicate check |
| GET | `/api/filters` | Distinct genres, ratings, purchase locations for dropdowns |

### Loans
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/loans` | All on-loan movies. Param: `?person=` |
| GET | `/api/loans/people` | Current + past borrowers |
| GET | `/api/loans/history/:movieId` | Full history for one movie |
| POST | `/api/movies/:id/loan` | Lend out. Body: `{ loanedTo, notes }` |
| POST | `/api/movies/:id/return` | Mark returned |

### Batch Enrichment
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/batch/candidates` | Movies needing data. Params: `?missing=any\|imdb\|barcode\|poster&limit=50` |
| GET | `/api/batch/lookup/:id` | OMDB match + duplicate check for one movie |
| POST | `/api/batch/apply` | Apply confirmed OMDB data. Body: `{ id, imdbId, barcode, applyFields }` |

### Other
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Library statistics |
| GET | `/api/health` | Health check |

---

## Database Schema

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
| `coverImage` | VARCHAR(500) | Original OMDB poster URL |
| `localPoster` | VARCHAR(500) | Locally cached poster path |
| `imdbId` | VARCHAR(50) | e.g. tt0111161 |
| `imdbRating` | VARCHAR(10) | e.g. 9.3 |
| `language` | VARCHAR(100) | From OMDB |
| `country` | VARCHAR(100) | From OMDB |
| `studio` | VARCHAR(255) | From OMDB |
| `location` | VARCHAR(100) | Physical shelf location |
| `loanedTo` | VARCHAR(255) | Current borrower (empty = in library) |
| `loanedDate` | DATETIME | When it was lent out |
| `dateAdded` | DATETIME | Auto-set on insert |
| `lastUpdated` | DATETIME | Auto-updated on change |

**Loan History Table** (`loan_history`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | INT AUTO_INCREMENT | |
| `movieId` | INT | FK → movies.id (CASCADE DELETE) |
| `loanedTo` | VARCHAR(255) | Borrower name |
| `loanedDate` | DATETIME | When lent |
| `returnedDate` | DATETIME | NULL = still out |
| `notes` | VARCHAR(500) | Optional notes |

---

## Barcode Lookup Flow

```
Scan barcode
     │
     ▼
Own database ──found──▶ "Already in Library"
     │ not found
     ▼
UPCitemdb.com (free) ──no match──▶ "Add Manually"
     │ match → title
     ▼
OMDB API ──found──▶ Pre-fill form + run duplicate check
```

## Duplicate Detection (on every save/lookup)

Four strategies, in order of confidence:
1. **Exact normalised** — strips punctuation/articles, case-insensitive
2. **IMDB ID** — same imdbId already exists in library
3. **SOUNDEX phonetic** — catches typos and alternate spellings
4. **Word overlap (≥60%)** — strips stop words, scores shared meaningful words

Year filter demotes or removes matches where years differ by more than 2–5 years.

---

## Project Structure

```
dvd-library/
├── README.md
├── schema.sql                       ← Full DB schema incl. loans
├── docker-compose.yml
├── .env                             ← create from backend/.env.example
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js                    ← All REST API routes
│   └── .env.example
├── frontend/
│   ├── index.html                   ← Full PWA (single file, no build step)
│   ├── manifest.json
│   └── posters/                     ← Locally cached poster images (git-ignored)
├── scripts/
│   ├── fetch-posters.js             ← Download/cache OMDB poster images
│   ├── migrate-add-localposter.sql  ← Migration: add localPoster column
│   └── migrate-add-loans.sql        ← Migration: add loan tracking tables
└── systemd/
    ├── dvd-library.service          ← systemd unit file
    ├── install-service.sh           ← Install & enable as Linux service
    └── manage-service.sh            ← update / uninstall / logs helper
```

---

## Troubleshooting

**Camera not working on iPhone** → Must be HTTPS. See nginx config above.

**OMDB search returns "key not configured"** → Add `OMDB_API_KEY=xxx` to `.env` and restart.

**Barcode lookup finds nothing** → UPCitemdb free tier is 100 req/day. Use Manual Barcode Entry or search by title as fallback.

**`Cannot find module 'mysql2/promise'` in fetch-posters.js** → Run from project root: `node scripts/fetch-posters.js`. The script resolves modules from `backend/node_modules` automatically.

**DB connection refused** → `docker compose logs db` to check MariaDB status. The backend waits for the DB healthcheck before starting.

**Images stretched in card view** → Fixed in current version. Posters use `object-fit: cover; object-position: center top` with a locked `aspect-ratio: 2/3`.
