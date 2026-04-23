# 🎬 DVD / Blu-Ray Library Manager

A self-hosted web application for cataloguing physical disc collections.
Access via any browser, or install as a PWA on iPhone/Android and scan barcodes with your camera.

---

## Feature Summary

| Category | Features |
|----------|----------|
| **Library** | Grid/list views · sort · full-text search · poster images |
| **Filters** | Format · genre · age rating · place of purchase · IMDB score · year range · poster-only |
| **Add/Edit** | Manual entry · barcode scan · OMDB auto-fill · cover preview · shelf location |
| **Barcode** | Camera scan (iOS Safari / Android Chrome / desktop) · manual entry fallback · UPCitemdb lookup chain |
| **OMDB** | Title search · IMDB ID lookup · auto-fill all metadata · batch enrichment |
| **Duplicates** | Exact match · IMDB ID · SOUNDEX phonetic · word-overlap (4 strategies) |
| **Posters** | Remote OMDB URL or locally cached `/posters/<id>.jpg` |
| **Loans** | Loan out to named person · mark returned · full history · days-out colour coding |
| **Batch Enrich** | Step through missing-metadata movies · confirm OMDB match · update barcode/IMDB/poster in bulk · resumable via "Start at record #" offset |
| **Stats** | Totals · by format · top genres · by decade · average IMDB rating · average price paid |
| **Auth** | Google SSO (OAuth 2.0) · domain allowlist · email allowlist · session stored in MariaDB |
| **Security** | Helmet CSP · rate limiting · input validation · parameterised SQL · no-store cache headers |
| **PWA** | Installable on iOS/Android home screen · works offline for browsing |
| **Service** | systemd unit · auto-start on reboot · manage-service.sh helper |

---

## Technology Stack

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | **v24 LTS** recommended (v18+ minimum) | |
| Express | ^4.19 | REST API + static file server |
| MariaDB / MySQL | 10.4+ / 5.7+ | Primary datastore |
| Passport.js | ^0.7 | Google OAuth 2.0 |
| express-session | ^1.18 | Session management |
| express-mysql-session | ^3.0 | Session persistence in MariaDB |
| Helmet | ^7.1 | Security headers / CSP |
| express-rate-limit | ^7.3 | Auth + API rate limiting |
| axios | ^1.6 | OMDB / UPCitemdb HTTP calls |
| html5-qrcode | 2.3.8 | Camera barcode scanning (CDN) |
| Bootstrap | 5.3.3 | UI framework (CDN) |

---

## Quick Start (Docker)

### 1. Prerequisites
```bash
docker --version        # ≥ 24
docker compose version  # ≥ 2.20
```

### 2. Get a free OMDB key
Register at **https://www.omdbapi.com/apikey.aspx** (1 000 req/day free).

### 3. Configure
```bash
cp backend/.env.example .env
nano .env   # set OMDB_API_KEY, DB_PASS, SESSION_SECRET, GOOGLE_CLIENT_ID/SECRET
```

### 4. Start
```bash
docker compose up -d
# Open http://localhost:3000
```

---

## Manual Install (Linux — Node.js + MariaDB)

### Install Node.js 24 LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should print v24.x.x
```

### Install MariaDB
```bash
sudo apt install -y mariadb-server
sudo mysql_secure_installation
```

### Create database & user
```bash
sudo mariadb -u root -p << SQL
CREATE DATABASE dvdlibrary CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'dvdlib'@'localhost' IDENTIFIED BY 'your_strong_password';
GRANT ALL PRIVILEGES ON dvdlibrary.* TO 'dvdlib'@'localhost';
FLUSH PRIVILEGES;
SQL
```

### Load schema
```bash
mariadb -u dvdlib -p dvdlibrary < schema.sql
```

### Configure & run
```bash
cp backend/.env.example .env
nano .env          # fill in all values

cd backend
npm install
node server.js     # development / manual start
```

---

## Running as a Linux Service (auto-start on reboot)

```bash
# Install once — creates dvdlib user, copies to /opt/dvd-library, enables systemd
sudo bash systemd/install-service.sh

# Day-to-day management
sudo bash systemd/manage-service.sh start
sudo bash systemd/manage-service.sh stop
sudo bash systemd/manage-service.sh restart
sudo bash systemd/manage-service.sh status
sudo bash systemd/manage-service.sh logs        # live log tail
sudo bash systemd/manage-service.sh update      # pull new code and restart
sudo bash systemd/manage-service.sh uninstall   # clean removal
```

The service is enabled for **auto-start on reboot** by default after install.
Secrets live in `/etc/dvd-library/env` (mode 640, owned root:dvdlib).

---

## Existing Database Migrations

Run these in order if you have an existing database:

```bash
# Add local poster cache column
mariadb -u dvdlib -p dvdlibrary < scripts/migrate-add-localposter.sql

# Add loan tracking tables
mariadb -u dvdlib -p dvdlibrary < scripts/migrate-add-loans.sql

# Add Google SSO auth tables
mariadb -u dvdlib -p dvdlibrary < scripts/migrate-add-auth.sql
```

---

## Batch Enrich

Batch Enrich lets you step through movies that are missing IMDB data, barcodes, or poster images and confirm each OMDB match before applying it. Access it from the **Stats** tab → **Batch Enrich** button.

### Setup options

| Option | Description |
|--------|-------------|
| What to enrich | Filter candidates: Any missing data · IMDB ID only · Barcode only · Poster only |
| Max to review | How many records to load in this session (10 – 500) |
| Start at record # | Skip the first N−1 candidates — use this to resume a previous session |

### How to resume across sessions

The app does not automatically remember where you left off. At the end of each session the summary screen tells you the exact number to enter next time — for example:

> **Resume next session:** set "Start at record" to **51** (150 records remaining)

Make a note of that number before closing the modal.

### Per-record actions

- **Yes, Update** — applies the OMDB match to the record (title, cast, director, genre, plot, poster, IMDB ID/rating). Uncheck "Update all metadata" to only write the IMDB ID, rating, and barcode.
- **Skip** — leaves the record unchanged and moves to the next.
- **Select a different match** — if the top OMDB result is wrong, pick an alternative from the list below it.
- **Stop** — ends the session immediately and shows the summary.

A duplicate warning appears automatically if a similar title already exists in your library.

After a batch session that updated poster URLs, run:
```bash
node scripts/fetch-posters.js
```
to download the new images locally.

---



```bash
node scripts/fetch-posters.js              # download all missing posters
node scripts/fetch-posters.js --force      # re-download everything
node scripts/fetch-posters.js --dry-run    # preview only
node scripts/fetch-posters.js --id 42      # single movie by id
```

Images saved to `frontend/posters/<id>.jpg`.
The app prefers the local file; falls back to OMDB URL automatically.

---

## Google SSO Setup — Step by Step

### Step 1 — Create a Google Cloud Project
1. Go to **https://console.cloud.google.com/**
2. Click the project selector → **New Project** → name it `DVD Library` → **Create**

### Step 2 — OAuth Consent Screen
1. **APIs & Services → OAuth consent screen**
2. Choose **Internal** (Google Workspace users only) or **External** (add test users)
3. Fill in App name, support email, developer contact → **Save and Continue**

### Step 3 — Create Credentials
1. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Add authorised redirect URI:
   ```
   https://dvd.yourdomain.com/auth/google/callback
   ```
   For local testing also add: `http://localhost:3000/auth/google/callback`
4. Copy the **Client ID** and **Client Secret**

### Step 4 — Configure .env
```ini
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxx
APP_URL=https://dvd.yourdomain.com
ALLOWED_DOMAIN=yourdomain.com          # any @yourdomain.com can sign in
ALLOWED_EMAILS=                        # optional: specific extra addresses
SESSION_SECRET=<generate below>
SESSION_COOKIE_SECURE=false            # set true only for end-to-end HTTPS

# Generate SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 5 — Access Control
| Scenario | Config |
|----------|--------|
| All staff on `company.com` | `ALLOWED_DOMAIN=company.com` |
| Specific people only | `ALLOWED_EMAILS=alice@x.com,bob@gmail.com` |
| Both | Set both — either rule grants access |
| Any Google account | Leave both blank |

### Step 6 — Apply migrations & restart
```bash
mariadb -u dvdlib -p dvdlibrary < scripts/migrate-add-auth.sql
sudo systemctl restart dvd-library
```

### Troubleshooting SSO
| Symptom | Fix |
|---------|-----|
| `redirect_uri_mismatch` | Redirect URI in Google Console doesn't exactly match `APP_URL + /auth/google/callback` |
| "Access denied" after sign-in | Email doesn't match `ALLOWED_DOMAIN` or `ALLOWED_EMAILS` |
| Keeps showing login page | Check SESSION_SECRET is set; check `SESSION_COOKIE_SECURE=false` for HTTP setups |
| `sso_not_configured` on login | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` missing from env |
| "This app isn't verified" | Use **Internal** consent screen for Workspace, or add test users for External |

---

## nginx + HTTPS (required for camera scanning on iOS)

```nginx
server {
    listen 443 ssl http2;
    server_name dvd.yourdomain.com;
    ssl_certificate     /etc/letsencrypt/live/dvd.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dvd.yourdomain.com/privkey.pem;
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   X-Real-IP         $remote_addr;
    }
}
server {
    listen 80;
    server_name dvd.yourdomain.com;
    return 301 https://$host$request_uri;
}
```
Free SSL: `sudo certbot --nginx -d dvd.yourdomain.com`

When behind HTTPS nginx, set `SESSION_COOKIE_SECURE=true` in your env.

---

## API Reference

### Auth (public)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/google` | Begin Google OAuth flow |
| GET | `/auth/google/callback` | OAuth callback (set as redirect URI in Google Console) |
| GET | `/auth/logout` | Destroy session, redirect to login |
| GET | `/api/auth/me` | Current user or 401 |
| GET | `/api/auth/users` | All users who have signed in (requires auth) |

### Movies (all require auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/movies` | List. Params: `search`, `format`, `genre`, `ageRating`, `purchasedAt`, `minImdb`, `minYear`, `maxYear`, `sort` |
| GET | `/api/movies/:id` | Single movie |
| POST | `/api/movies` | Create |
| PUT | `/api/movies/:id` | Update |
| DELETE | `/api/movies/:id` | Delete |

### Lookups (all require auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/lookup/barcode/:code` | UPC → UPCitemdb → OMDB |
| GET | `/api/lookup/imdb/:id` | OMDB by IMDB ID |
| GET | `/api/lookup/title/:title` | OMDB by title |
| GET | `/api/search/omdb?q=` | OMDB search (multiple results) |
| GET | `/api/similar?title=&year=&imdbId=&excludeId=` | Fuzzy duplicate check |
| GET | `/api/filters` | Distinct genres, ratings, stores for dropdowns |

### Loans (all require auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/loans` | All on-loan movies. Param: `?person=` |
| GET | `/api/loans/people` | Current + historical borrowers |
| GET | `/api/loans/history/:movieId` | Loan history for one title |
| POST | `/api/movies/:id/loan` | Lend out. Body: `{ loanedTo, notes }` |
| POST | `/api/movies/:id/return` | Mark returned |

### Batch Enrichment (all require auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/batch/candidates` | Titles missing data. Params: `?missing=any\|imdb\|barcode\|poster&limit=50&offset=0`. Returns `totalCandidates` (grand total) alongside the paged results. |
| GET | `/api/batch/lookup/:id` | OMDB match + duplicate check for one title |
| POST | `/api/batch/apply` | Apply confirmed OMDB data. Body: `{ id, imdbId, barcode, applyFields }` |

### Misc
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/stats` | ✓ | Library statistics |
| GET | `/api/health` | public | Docker healthcheck |

---

## Database Schema

### movies table
| Column | Type | Notes |
|--------|------|-------|
| `id` | INT AUTO_INCREMENT | PK |
| `movieName` | VARCHAR(255) | **Original field** |
| `actors` | VARCHAR(1000) | **Original field** |
| `pop` | VARCHAR(20) | **Original field** — place of purchase |
| `rrp` | VARCHAR(20) | **Original field** — retail price |
| `pp` | VARCHAR(20) | **Original field** — price paid |
| `rating` | VARCHAR(20) | **Original field** — age rating |
| `comments` | VARCHAR(4000) | **Original field** — personal notes |
| `barcode` | VARCHAR(50) UNIQUE | UPC/EAN |
| `format` | ENUM | DVD / Blu-Ray / 4K UHD / Other |
| `director` | VARCHAR(255) | |
| `genre` | VARCHAR(255) | |
| `year` | VARCHAR(10) | |
| `runtime` | VARCHAR(50) | |
| `plot` | TEXT | |
| `coverImage` | VARCHAR(500) | OMDB poster URL |
| `localPoster` | VARCHAR(500) | Locally cached poster path |
| `imdbId` | VARCHAR(50) | e.g. tt0111161 |
| `imdbRating` | VARCHAR(10) | e.g. 9.3 |
| `language` | VARCHAR(100) | |
| `country` | VARCHAR(100) | |
| `studio` | VARCHAR(255) | |
| `location` | VARCHAR(100) | Physical shelf location |
| `loanedTo` | VARCHAR(255) | Current borrower (empty = in library) |
| `loanedDate` | DATETIME | When lent out |
| `dateAdded` | DATETIME | Auto on insert |
| `lastUpdated` | DATETIME | Auto on update |

### loan_history table
| Column | Type | Notes |
|--------|------|-------|
| `id` | INT AUTO_INCREMENT | |
| `movieId` | INT | FK → movies.id (CASCADE) |
| `loanedTo` | VARCHAR(255) | |
| `loanedDate` | DATETIME | |
| `returnedDate` | DATETIME | NULL = still out |
| `notes` | VARCHAR(500) | |

### auth_users table
| Column | Type | Notes |
|--------|------|-------|
| `id` | INT AUTO_INCREMENT | |
| `googleId` | VARCHAR(128) UNIQUE | |
| `email` | VARCHAR(255) UNIQUE | |
| `name` | VARCHAR(255) | |
| `picture` | VARCHAR(500) | Avatar URL |
| `firstLogin` | DATETIME | |
| `lastLogin` | DATETIME | |
| `loginCount` | INT | |

### sessions table
Auto-managed by express-mysql-session.

---

## Security Notes

- **Helmet.js** sets CSP, X-Frame-Options, HSTS, and other security headers on every response
- **Rate limiting**: auth endpoints capped at 20 req/15 min; API at 300 req/min
- **All API routes** require an authenticated session (`requireAuth` middleware)
- **Input validation**: all `:id` params validated as positive integers; barcode/imdbId format-checked with regex; all strings length-capped before DB writes
- **SQL injection**: all queries use parameterised statements (`?` placeholders) or hardcoded safe strings; dynamic column names are checked against a whitelist
- **Session cookies**: `httpOnly: true`, `sameSite: lax`; `secure` flag controlled by `SESSION_COOKIE_SECURE` env var (not auto-detected)
- **Body size**: JSON bodies capped at 64 KB
- **OMDB responses**: capped at 512 KB; redirect-limited to 3
- **Secrets**: stored in `/etc/dvd-library/env` (mode 640, root:dvdlib) — never in the app directory or git

---

## Project Structure

```
dvd-library/
├── README.md
├── schema.sql                         ← Full DB schema
├── docker-compose.yml
├── .gitignore
├── backend/
│   ├── Dockerfile
│   ├── package.json                   ← Node.js dependencies
│   ├── server.js                      ← Express REST API (all routes)
│   └── .env.example                   ← Environment variable template
├── frontend/
│   ├── index.html                     ← Full PWA (single file)
│   ├── login.html                     ← Google SSO sign-in page
│   ├── manifest.json                  ← PWA manifest
│   └── posters/                       ← Cached poster images (git-ignored)
├── scripts/
│   ├── fetch-posters.js               ← Download/cache OMDB poster images
│   ├── migrate-add-localposter.sql
│   ├── migrate-add-loans.sql
│   └── migrate-add-auth.sql
└── systemd/
    ├── dvd-library.service            ← systemd unit file
    ├── install-service.sh             ← Full installer (Node + MySQL checks, auto-reboot)
    └── manage-service.sh              ← start|stop|restart|status|logs|update|uninstall
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Camera barcode scanning not working (iOS) | Must be HTTPS. See nginx config above. |
| `Cannot find module 'mysql2/promise'` in fetch-posters.js | Run from project root: `node scripts/fetch-posters.js` |
| `Incorrect arguments to mysqld_stmt_execute` | Fixed in current version — all `pool.execute()` calls replaced with `pool.query()` (client-side escaping, no MariaDB prepared-statement protocol issues) |
| OMDB search returns "key not configured" | Set `OMDB_API_KEY` in env and restart |
| Login loop / session_expired on first visit | Fixed in current version. Check `SESSION_COOKIE_SECURE=false` for HTTP setups |
| `redirect_uri_mismatch` on Google sign-in | Redirect URI in Google Console must exactly match `APP_URL/auth/google/callback` |
| Service won't start after reboot | Check `sudo journalctl -u dvd-library -n 50`; verify env file has real values |
| Posters stretched in card view | Fixed in current version (`object-fit: cover; object-position: center top`) |
