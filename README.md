# 🎬 DVD / Blu-Ray Library Manager

A self-hosted web application for cataloguing physical disc collections.
Access via any browser, or install as a PWA on iPhone/Android and scan barcodes with your camera.

---

## Feature Summary

| Category | Features |
|----------|----------|
| **Library** | Grid/list views · sort · full-text search · poster images · OUT badge on loaned discs |
| **Filters** | Format · genre · age rating · place of purchase · IMDB score · year range · poster-only toggle |
| **Add/Edit** | Manual entry · barcode scan · OMDB auto-fill · cover preview · shelf location |
| **Barcode** | Camera scan (iOS Safari / Android Chrome / desktop) · manual entry fallback · UPCitemdb lookup chain |
| **OMDB Search** | Tabbed panel: title search with **actor-match scoring** + **direct IMDB ID lookup** · top results auto-enriched with cast for comparison · matched results sorted to top |
| **Duplicates** | Exact title · IMDB ID · SOUNDEX phonetic · word-overlap — 4 strategies with confidence grading |
| **Posters** | Remote OMDB URL or locally cached `/posters/<id>.jpg` · tap poster in detail view to **replace via device camera** · **delete** incorrect poster with one tap |
| **Loans** | Loan out to named person · borrower autocomplete · mark returned · full history per disc · days-out colour coding |
| **Batch Enrich** | Step through missing-metadata movies · OMDB confirmation popup · actor-match in batch results · resumable via **"Start at record #"** offset · updates barcode/IMDB/poster in bulk |
| **Stats** | Totals · by format · top genres · by decade · average IMDB rating · average price paid |
| **Auth** | Google SSO (OAuth 2.0) · domain allowlist · email allowlist · session stored in MariaDB · **or disable entirely with `AUTH_ENABLED=false`** |
| **Security** | Helmet CSP · rate limiting · input validation · parameterised SQL · no-store cache headers |
| **PWA** | Installable on iOS/Android home screen · works offline for browsing |
| **Service** | systemd unit · auto-start on reboot · `manage-service.sh` with start/stop/restart/logs/update |

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

Run these in order if you have a database created before a particular update:

```bash
# Add local poster cache column
mariadb -u dvdlib -p dvdlibrary < scripts/migrate-add-localposter.sql

# Add loan tracking tables
mariadb -u dvdlib -p dvdlibrary < scripts/migrate-add-loans.sql

# Add Google SSO auth tables
mariadb -u dvdlib -p dvdlibrary < scripts/migrate-add-auth.sql
```

---

## Disabling Authentication (AUTH_ENABLED=false)

For private-network or single-user deployments where a login screen is unnecessary,
you can turn off Google SSO entirely with one env variable:

```ini
AUTH_ENABLED=false
```

When disabled:
- No login page is shown — the library loads directly
- All API routes are accessible without a session
- Google credentials are ignored and can be left blank
- The user avatar pill in the header is hidden
- Session and `auth_users` tables are created but unused

To re-enable later, set `AUTH_ENABLED=true` (or remove the line) and restart.

> **Security note:** Only use `AUTH_ENABLED=false` on a private network or behind a VPN/firewall.
> Never expose an unauthenticated instance to the open internet.

---

## OMDB Search & IMDB Lookup

The **Auto-fill from OMDB / IMDB** panel in the Add/Edit form has two modes, selectable by tab:

### Title Search (default)

Type a movie title and press Search or Enter. The app:

1. Fetches up to 10 results from OMDB
2. Immediately displays them so you can browse
3. Fetches full details (including cast) for the **top 5 results in parallel**
4. Scores each result against the **actors already in the current form** using name-part matching
5. Re-renders the list sorted by match quality

Result highlighting:

| Badge | Meaning |
|-------|---------|
| ✓ **Cast match** (green) | ≥ 60% of your DB actors appear in this result's cast |
| ~ **Partial cast** (amber) | Some cast overlap but below 60% |
| *(cast preview)* | No match — shows the first two OMDB actor names so you can judge manually |

Click any result row to auto-fill the entire form (title, year, director, cast, genre, plot, rating, poster, IMDB ID). The entire row is clickable including the badge and cast preview text.

### Direct IMDB ID Lookup

Switch to the **IMDB ID** tab when you already know the exact ID. Enter it in `tt1234567` format — the `tt` prefix is added automatically if you paste just the digits. Fetches full details directly with no ambiguity.

**When editing an existing record**, the IMDB ID tab is pre-filled with the record's current `imdbId` value (if one exists), so you can switch straight to that tab and hit Look Up to refresh metadata without retyping. When adding a new record the field starts empty.

To find an IMDB ID: go to [imdb.com](https://www.imdb.com), find the movie, and copy the `tt` number from the URL (e.g. `https://www.imdb.com/title/tt0111161/`).

---

## Poster Image Caching

Download OMDB poster URLs to local files so the library loads faster and works offline:

```bash
node scripts/fetch-posters.js              # download all missing posters
node scripts/fetch-posters.js --force      # re-download everything
node scripts/fetch-posters.js --dry-run    # preview only
node scripts/fetch-posters.js --id 42      # single movie by DB id
```

Images are saved to `frontend/posters/<id>.jpg`. The app always prefers the local file and falls back to the OMDB URL automatically.

---

## Poster Camera

The detail modal for each movie has an interactive poster section.

**When a poster exists** — tap the image or the **Camera** button beneath it to replace it, or tap **Delete** to remove it entirely.

**When no poster exists** — tap the placeholder (📷) or **Camera** to open the device camera.

### Capture flow

1. The app opens the rear-facing camera (front on desktop)
2. Position the disc cover in frame and tap **Capture**
3. The image is scaled to max 600 px wide, encoded as JPEG, and uploaded to the server
4. Saved as `frontend/posters/<id>.jpg`; `localPoster` is updated in the DB
5. The detail modal updates instantly — no page reload needed

### Requirements

- **HTTPS required** on iOS Safari and Android Chrome (see nginx config below)
- Desktop Chrome/Firefox allow camera on `localhost` and local IPs without HTTPS
- Uploaded images must be under ~3 MB (decoded)

---

## Batch Enrich

Step through movies missing IMDB data, barcodes, or posters and confirm each OMDB match before applying. Access from the **Stats** tab → **Batch Enrich** button.

### Setup options

| Option | Description |
|--------|-------------|
| What to enrich | Any missing data · IMDB ID only · Barcode only · Poster only |
| Max to review | Records to load this session (10 – 500) |
| Start at record # | Skip the first N−1 candidates — use to resume a previous session |

### Resuming across sessions

The app does not save progress automatically. At the end of each session the summary screen shows:

> **Resume next session:** set "Start at record" to **51** (150 records remaining)

Note that number before closing the modal.

### Per-record actions

- **Yes, Update** — applies the OMDB match (title, cast, director, genre, plot, poster, IMDB ID/rating). Uncheck "Update all metadata" to write only IMDB ID, rating, and barcode.
- **Skip** — leaves the record unchanged and moves on.
- **Select a different match** — pick an alternative from the list below the top result.
- **Stop** — ends the session and shows the summary.

A duplicate warning appears automatically if a similar title already exists in your library.

After a session that updated poster URLs, run `node scripts/fetch-posters.js` to download them locally.

---

## Google SSO Setup — Step by Step

### Step 1 — Create a Google Cloud Project
1. Go to **https://console.cloud.google.com/**
2. Project selector → **New Project** → name it `DVD Library` → **Create**

### Step 2 — OAuth Consent Screen
1. **APIs & Services → OAuth consent screen**
2. Choose **Internal** (Workspace users only) or **External** (add test users manually)
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
AUTH_ENABLED=true
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxx
APP_URL=https://dvd.yourdomain.com

# Allow any user from your Workspace domain:
ALLOWED_DOMAIN=yourdomain.com

# Or specific email addresses (comma-separated):
ALLOWED_EMAILS=alice@company.com,bob@gmail.com

# Generate SESSION_SECRET:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=your_generated_secret_here
SESSION_COOKIE_SECURE=false   # set true only for end-to-end HTTPS
```

### Step 5 — Access control options

| Scenario | Config |
|----------|--------|
| All staff on `company.com` | `ALLOWED_DOMAIN=company.com` |
| Specific people only | `ALLOWED_EMAILS=alice@x.com,bob@gmail.com` |
| Both rules | Set both — either grants access |
| Any Google account | Leave both blank |

### Step 6 — Apply migration & restart
```bash
mariadb -u dvdlib -p dvdlibrary < scripts/migrate-add-auth.sql
sudo systemctl restart dvd-library
```

### Troubleshooting SSO

| Symptom | Fix |
|---------|-----|
| `redirect_uri_mismatch` | Redirect URI in Google Console must exactly match `APP_URL/auth/google/callback` — check trailing slashes and http vs https |
| "Access denied" after sign-in | Email doesn't match `ALLOWED_DOMAIN` or `ALLOWED_EMAILS` |
| Keeps redirecting to login | Check `SESSION_COOKIE_SECURE=false` for HTTP setups; verify `SESSION_SECRET` is set |
| `sso_not_configured` on login page | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` missing from env |
| "This app isn't verified" | Use **Internal** consent for Workspace; for External add test users in Google Console |

---

## nginx + HTTPS

Required for camera-based barcode scanning and poster capture on iOS.

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

### Auth (public — no session required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/google` | Begin Google OAuth flow |
| GET | `/auth/google/callback` | OAuth callback — register this URI in Google Console |
| GET | `/auth/logout` | Destroy session, redirect to login |
| GET | `/api/auth/me` | Current user info, 401, or `{ authEnabled: false }` |
| GET | `/api/auth/users` | All users who have signed in (requires auth) |
| GET | `/api/health` | Health check — always public (used by Docker) |

### Movies (all require auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/movies` | List. Params: `search`, `format`, `genre`, `ageRating`, `purchasedAt`, `minImdb`, `minYear`, `maxYear`, `sort` |
| GET | `/api/movies/:id` | Single movie |
| POST | `/api/movies` | Create |
| PUT | `/api/movies/:id` | Update |
| DELETE | `/api/movies/:id` | Delete |

### Posters (require auth)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/movies/:id/poster` | Upload camera capture. Body: `{ imageData: "data:image/jpeg;base64,…" }` |
| DELETE | `/api/movies/:id/poster` | Delete local file, clear `localPoster` + `coverImage` |

### Lookups (all require auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/lookup/barcode/:code` | UPC → UPCitemdb → OMDB chain |
| GET | `/api/lookup/imdb/:id` | OMDB by IMDB ID (e.g. `tt0111161`) |
| GET | `/api/lookup/title/:title` | OMDB by title (single best match) |
| GET | `/api/search/omdb?q=` | OMDB search (up to 10 results) |
| GET | `/api/similar?title=&year=&imdbId=&excludeId=` | Fuzzy duplicate check |
| GET | `/api/filters` | Distinct genres, ratings, stores for filter dropdowns |

### Loans (all require auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/loans` | All currently on-loan movies. Param: `?person=` |
| GET | `/api/loans/people` | Current + historical borrower names |
| GET | `/api/loans/history/:movieId` | Loan history for one title |
| POST | `/api/movies/:id/loan` | Lend out. Body: `{ loanedTo, notes }` |
| POST | `/api/movies/:id/return` | Mark returned |

### Batch Enrichment (all require auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/batch/candidates` | Titles missing data. Params: `?missing=any\|imdb\|barcode\|poster&limit=50&offset=0`. Returns `totalCandidates` alongside paged results. |
| GET | `/api/batch/lookup/:id` | OMDB best match + duplicate check for one title |
| POST | `/api/batch/apply` | Apply confirmed OMDB data. Body: `{ id, imdbId, barcode, applyFields }` |

### Stats

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/stats` | ✓ | Library statistics (formats, genres, decades, averages) |

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
| `barcode` | VARCHAR(50) UNIQUE | UPC/EAN from disc |
| `format` | ENUM | DVD / Blu-Ray / 4K UHD / Other |
| `director` | VARCHAR(255) | |
| `genre` | VARCHAR(255) | Comma-separated |
| `year` | VARCHAR(10) | |
| `runtime` | VARCHAR(50) | e.g. "148 min" |
| `plot` | TEXT | Synopsis |
| `coverImage` | VARCHAR(500) | OMDB poster URL (original) |
| `localPoster` | VARCHAR(500) | Locally cached poster e.g. `/posters/42.jpg` |
| `imdbId` | VARCHAR(50) | e.g. `tt0111161` |
| `imdbRating` | VARCHAR(10) | e.g. `9.3` |
| `language` | VARCHAR(100) | |
| `country` | VARCHAR(100) | |
| `studio` | VARCHAR(255) | Production company |
| `location` | VARCHAR(100) | Physical shelf location |
| `loanedTo` | VARCHAR(255) | Current borrower (empty = in library) |
| `loanedDate` | DATETIME | When lent out |
| `dateAdded` | DATETIME | Auto on insert |
| `lastUpdated` | DATETIME | Auto on update |

### loan_history table

| Column | Type | Notes |
|--------|------|-------|
| `id` | INT AUTO_INCREMENT | |
| `movieId` | INT | FK → movies.id (CASCADE DELETE) |
| `loanedTo` | VARCHAR(255) | Borrower name |
| `loanedDate` | DATETIME | |
| `returnedDate` | DATETIME | NULL = still out |
| `notes` | VARCHAR(500) | Optional notes |

### auth_users table

| Column | Type | Notes |
|--------|------|-------|
| `id` | INT AUTO_INCREMENT | |
| `googleId` | VARCHAR(128) UNIQUE | |
| `email` | VARCHAR(255) UNIQUE | |
| `name` | VARCHAR(255) | Display name |
| `picture` | VARCHAR(500) | Google avatar URL |
| `firstLogin` | DATETIME | |
| `lastLogin` | DATETIME | |
| `loginCount` | INT | |

### sessions table
Auto-managed by `express-mysql-session`. Created on first run.

---

## Security Notes

- **Helmet.js** sets CSP, X-Frame-Options, HSTS, and other security headers on every response
- **Rate limiting**: auth endpoints capped at 20 req/15 min; all API routes at 300 req/min
- **requireAuth middleware** guards every `/api/*` route (bypassed when `AUTH_ENABLED=false`)
- **Input validation**: all `:id` params validated as positive integers; `imdbId` checked against `/^tt\d{7,8}$/`; barcodes against `/^[0-9]{8,14}$/`; all strings length-capped before DB writes
- **SQL injection**: all queries use `pool.query()` with `?` parameterisation; dynamic column names in batch apply are checked against a hardcoded whitelist
- **Session cookies**: `httpOnly: true`, `sameSite: lax`; `secure` flag controlled explicitly by `SESSION_COOKIE_SECURE` env var
- **Body size**: JSON bodies capped at 64 KB; uploaded poster images capped at ~3 MB
- **OMDB responses**: capped at 512 KB; max 3 redirects
- **Secrets**: stored in `/etc/dvd-library/env` (mode 640, root:dvdlib) — never committed to git

---

## Project Structure

```
dvd-library/
├── README.md
├── schema.sql                         ← Full DB schema incl. loans + auth tables
├── docker-compose.yml
├── .gitignore
├── backend/
│   ├── Dockerfile
│   ├── package.json                   ← Node.js dependencies
│   ├── server.js                      ← Express REST API (all routes)
│   └── .env.example                   ← Environment variable template
├── frontend/
│   ├── index.html                     ← Full PWA (single file, no build step)
│   ├── login.html                     ← Google SSO sign-in page
│   ├── manifest.json                  ← PWA manifest
│   └── posters/                       ← Locally cached poster images (git-ignored)
├── scripts/
│   ├── fetch-posters.js               ← Download/cache OMDB poster images locally
│   ├── migrate-add-localposter.sql    ← Migration: add localPoster column
│   ├── migrate-add-loans.sql          ← Migration: add loan tracking tables
│   └── migrate-add-auth.sql           ← Migration: add SSO auth tables
└── systemd/
    ├── dvd-library.service            ← systemd unit file
    ├── install-service.sh             ← Full installer: Node check, user, service enable
    └── manage-service.sh              ← start|stop|restart|status|logs|update|uninstall
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Camera barcode scanning not working (iOS) | Must be HTTPS. See nginx config above. |
| Camera poster capture not working (iOS/Android) | Must be HTTPS. Desktop works on HTTP for `localhost`. |
| Poster upload fails with 413 | Image too large (~3 MB limit). Move camera closer so the cover fills the frame. |
| `Cannot find module 'mysql2/promise'` in fetch-posters.js | Run from project root: `node scripts/fetch-posters.js` — the script resolves modules from `backend/node_modules` automatically. |
| `Incorrect arguments to mysqld_stmt_execute` | Fixed — all `pool.execute()` replaced with `pool.query()` (client-side escaping; no MariaDB prepared-statement protocol issues). |
| OMDB search returns "key not configured" | Set `OMDB_API_KEY` in env and restart. |
| OMDB search results not clickable | Fixed — child elements (badge, cast preview, year) now have `pointer-events:none` so clicks pass through to the row. Pull latest `index.html`. |
| IMDB ID tab empty when editing a record | Fixed — `Detail.edit()` now pre-fills the IMDB ID input from the record's existing `imdbId` value. |
| OMDB search shows no actor match badges | Actor matching requires the **actors field to be populated** in the current form before searching. When editing an existing record the field is pre-filled; when adding new the field is blank until you fill it or pick a first result. |
| Login loop / "session expired" on first visit | Fixed. Check `SESSION_COOKIE_SECURE=false` for HTTP setups. |
| `redirect_uri_mismatch` on Google sign-in | Redirect URI in Google Console must exactly match `APP_URL/auth/google/callback`. |
| App shows login page even with `AUTH_ENABLED=false` | Edit the correct env file (`/etc/dvd-library/env` for service installs) and restart: `sudo systemctl restart dvd-library`. |
| Service won't start after reboot | `sudo journalctl -u dvd-library -n 50` — verify env file has real values, not placeholders. |
| Batch Enrich UI blank / white screen | Fixed — `showSummary()` no longer uses nested template literals. Pull latest `index.html`. |
| Posters stretched in card view | Fixed — `object-fit: cover; object-position: center top` applied to all poster images. |
