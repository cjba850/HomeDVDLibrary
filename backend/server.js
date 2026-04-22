'use strict';

// Load .env if running locally (ignored in Docker where env is injected)
require('dotenv').config();

const express        = require('express');
const mysql          = require('mysql2/promise');
const cors           = require('cors');
const axios          = require('axios');
const path           = require('path');
const session        = require('express-session');
const MySQLStore     = require('express-mysql-session')(session);
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app  = express();
const PORT = process.env.PORT || 3000;

// ── DB Connection Pool ────────────────────────────────────────────────────────
// (defined early so the session store can reuse the same config)
const dbConfig = {
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER || 'dvdlib',
  password: process.env.DB_PASS || 'dvdlib_secret',
  database: process.env.DB_NAME || 'dvdlibrary',
  charset:  'utf8mb4',
};
const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
});

// ── Access-control helpers ────────────────────────────────────────────────────
const ALLOWED_DOMAIN = (process.env.ALLOWED_DOMAIN || '').trim().toLowerCase();
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function isAllowedEmail(email) {
  if (!email) return false;
  const e = email.toLowerCase();
  if (ALLOWED_EMAILS.length && ALLOWED_EMAILS.includes(e)) return true;
  if (ALLOWED_DOMAIN && e.endsWith('@' + ALLOWED_DOMAIN)) return true;
  // If neither filter is configured, allow any authenticated Google account
  if (!ALLOWED_DOMAIN && !ALLOWED_EMAILS.length) return true;
  return false;
}

// ── Session store (MariaDB) ───────────────────────────────────────────────────
const sessionStore = new MySQLStore({
  host:               dbConfig.host,
  port:               dbConfig.port,
  user:               dbConfig.user,
  password:           dbConfig.password,
  database:           dbConfig.database,
  charset:            'utf8mb4',
  createDatabaseTable: true,
  endConnectionOnClose: true,
  clearExpired:        true,
  checkExpirationInterval: 900000, // prune expired sessions every 15 min
  expiration:          parseInt(process.env.SESSION_MAX_AGE || '28800000'),
  schema: {
    tableName:   'sessions',
    columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' },
  },
});

sessionStore.onReady().then(() => {
  console.log('  Session store: MariaDB connected ✓');
}).catch(err => {
  console.error('  Session store ERROR — sessions will not persist across restarts:', err.message);
  console.error('  Run: mysql -u dvdlib -p dvdlibrary < scripts/migrate-add-auth.sql');
});

// ── Passport: Google OAuth 2.0 ───────────────────────────────────────────────
const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

if (googleConfigured) {
  passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  (process.env.APP_URL || 'http://localhost:' + PORT) + '/auth/google/callback',
    scope:        ['profile', 'email'],
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email   = profile.emails?.[0]?.value || '';
      const name    = profile.displayName || '';
      const picture = profile.photos?.[0]?.value || '';

      if (!isAllowedEmail(email)) {
        return done(null, false, {
          message: `Access denied: ${email} is not authorised. Contact your administrator.`,
        });
      }

      // Upsert user record for audit log
      await pool.execute(
        `INSERT INTO auth_users (googleId, email, name, picture, loginCount)
         VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), picture = VALUES(picture),
           lastLogin = NOW(), loginCount = loginCount + 1`,
        [profile.id, email, name, picture]
      );

      return done(null, { id: profile.id, email, name, picture });
    } catch (err) {
      return done(err);
    }
  }));
}

passport.serializeUser((user, done)   => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── Middleware ────────────────────────────────────────────────────────────────
// Static files served BEFORE auth so login.html and its assets are public
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/posters', express.static(path.join(__dirname, '../frontend/posters')));

app.use(cors({ credentials: true, origin: process.env.APP_URL || true }));
app.use(express.json());

// Trust the first reverse proxy (nginx/Cloudflare) so req.secure works correctly
app.set('trust proxy', 1);

// Only mark cookies as Secure if explicitly enabled (requires HTTPS end-to-end)
// Default: false — works correctly behind nginx HTTP→app or plain HTTP
const SECURE_COOKIE = process.env.SESSION_COOKIE_SECURE === 'true';

app.use(session({
  key:               'dvdlib_session',
  secret:            process.env.SESSION_SECRET || 'dvdlib-change-me-in-env',
  store:             sessionStore,
  resave:            false,
  saveUninitialized: false,
  rolling:           true,   // reset expiry on each request
  cookie: {
    maxAge:   parseInt(process.env.SESSION_MAX_AGE || '28800000'), // 8 hours
    httpOnly: true,
    sameSite: 'lax',
    secure:   SECURE_COOKIE,
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// ── Auth guard — applied to all /api/* routes ─────────────────────────────────
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Not authenticated', loginUrl: '/login.html' });
}

// ── Google OAuth routes (public — no auth guard) ─────────────────────────────
app.get('/auth/google',
  (req, res, next) => {
    if (!googleConfigured) {
      return res.redirect('/login.html?error=sso_not_configured');
    }
    next();
  },
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login.html?error=access_denied' }),
  (req, res, next) => {
    // Explicitly persist session to store BEFORE redirecting.
    // Without this, the redirect can race ahead of the async DB write
    // causing the next page load to find no session and loop back to login.
    req.session.save(err => {
      if (err) return next(err);
      res.redirect('/');
    });
  }
);

app.get('/auth/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.session.destroy(() => res.redirect('/login.html?msg=signed_out'));
  });
});

// GET /api/auth/me — returns current user or 401
app.get('/api/auth/me', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ authenticated: false, loginUrl: '/login.html' });
  }
  res.json({ authenticated: true, user: req.user });
});

// GET /api/auth/users — list all users who have ever signed in (admin view)
app.get('/api/auth/users', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, email, name, picture, firstLogin, lastLogin, loginCount FROM auth_users ORDER BY lastLogin DESC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const MOVIE_FIELDS = [
  'barcode','movieName','actors','director','genre','year','runtime',
  'localPoster',
  'plot','coverImage','format','pop','rrp','pp','rating','comments',
  'imdbId','imdbRating','language','country','studio','location'
];

function sanitise(body) {
  const out = {};
  MOVIE_FIELDS.forEach(f => {
    out[f] = body[f] !== undefined ? String(body[f]).trim() : '';
  });
  // barcode: store as NULL when empty so UNIQUE constraint works correctly
  if (!out.barcode) out.barcode = null;
  return out;
}

function omdbToMovie(d, extra = {}) {
  return {
    movieName:  d.Title   || '',
    actors:     d.Actors  || '',
    director:   d.Director|| '',
    genre:      d.Genre   || '',
    year:       d.Year    || '',
    runtime:    d.Runtime || '',
    plot:       d.Plot    || '',
    coverImage: (d.Poster && d.Poster !== 'N/A') ? d.Poster : '',
    rating:     d.Rated   || '',
    imdbId:     d.imdbID  || '',
    imdbRating: d.imdbRating || '',
    language:   d.Language|| '',
    country:    d.Country || '',
    studio:     d.Production || '',
    ...extra,
  };
}

const omdbKey = () => process.env.OMDB_API_KEY || '';

async function omdbGet(params) {
  const key = omdbKey();
  if (!key) throw new Error('OMDB_API_KEY not configured. Get a free key at https://www.omdbapi.com/apikey.aspx');
  const url = 'https://www.omdbapi.com/';
  const res = await axios.get(url, { params: { ...params, apikey: key }, timeout: 8000 });
  return res.data;
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.execute('SELECT 1');
    res.json({ status: 'ok', db: 'connected', omdb: !!omdbKey() });
  } catch (e) {
    res.status(503).json({ status: 'error', error: e.message });
  }
});

// ── Movies CRUD ───────────────────────────────────────────────────────────────

// GET /api/movies  — list with optional search & filters
app.get('/api/movies', requireAuth, async (req, res) => {
  try {
    const { search, format, genre, sort = 'movieName' } = req.query;
    const allowed = ['movieName','year','dateAdded','imdbRating','pp'];
    const orderBy  = allowed.includes(sort) ? sort : 'movieName';

    let sql = 'SELECT * FROM movies WHERE 1=1';
    const params = [];

    const { minImdb, maxYear, minYear, ageRating, purchasedAt } = req.query;

    if (search) {
      sql += ' AND (movieName LIKE ? OR actors LIKE ? OR director LIKE ? OR genre LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (format)     { sql += ' AND format = ?';                          params.push(format); }
    if (genre)      { sql += ' AND genre LIKE ?';                        params.push(`%${genre}%`); }
    if (ageRating)  { sql += ' AND rating = ?';                          params.push(ageRating); }
    if (purchasedAt){ sql += ' AND pop LIKE ?';                          params.push(`%${purchasedAt}%`); }
    if (minImdb)    { sql += ' AND CAST(imdbRating AS DECIMAL(3,1)) >= ?'; params.push(parseFloat(minImdb)); }
    if (minYear)    { sql += ' AND CAST(year AS UNSIGNED) >= ?';          params.push(parseInt(minYear)); }
    if (maxYear)    { sql += ' AND CAST(year AS UNSIGNED) <= ?';          params.push(parseInt(maxYear)); }

    sql += ` ORDER BY ${orderBy}`;

    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/movies/:id
app.get('/api/movies/:id', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM movies WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Movie not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/movies — create
app.post('/api/movies', requireAuth, async (req, res) => {
  try {
    const d = sanitise(req.body);
    if (!d.movieName) return res.status(400).json({ error: 'movieName is required' });

    const [result] = await pool.execute(
      `INSERT INTO movies
         (barcode,movieName,actors,director,genre,year,runtime,plot,coverImage,
          format,pop,rrp,pp,rating,comments,imdbId,imdbRating,language,country,studio,location)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [d.barcode,d.movieName,d.actors,d.director,d.genre,d.year,d.runtime,d.plot,
       d.coverImage,d.format||'DVD',d.pop,d.rrp,d.pp,d.rating,d.comments,
       d.imdbId,d.imdbRating,d.language,d.country,d.studio,d.location]
    );
    res.status(201).json({ id: result.insertId, message: 'Movie added successfully' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'A movie with this barcode already exists in your library' });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// PUT /api/movies/:id — update
app.put('/api/movies/:id', requireAuth, async (req, res) => {
  try {
    const d = sanitise(req.body);
    if (!d.movieName) return res.status(400).json({ error: 'movieName is required' });

    const [result] = await pool.execute(
      `UPDATE movies SET
         barcode=?,movieName=?,actors=?,director=?,genre=?,year=?,runtime=?,plot=?,
         coverImage=?,format=?,pop=?,rrp=?,pp=?,rating=?,comments=?,imdbId=?,
         imdbRating=?,language=?,country=?,studio=?,location=?
       WHERE id=?`,
      [d.barcode,d.movieName,d.actors,d.director,d.genre,d.year,d.runtime,d.plot,
       d.coverImage,d.format||'DVD',d.pop,d.rrp,d.pp,d.rating,d.comments,
       d.imdbId,d.imdbRating,d.language,d.country,d.studio,d.location,
       req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Movie not found' });
    res.json({ message: 'Movie updated successfully' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Another movie with this barcode already exists' });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// DELETE /api/movies/:id
app.delete('/api/movies/:id', requireAuth, async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM movies WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Movie not found' });
    res.json({ message: 'Movie deleted successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Barcode Lookup Chain ──────────────────────────────────────────────────────
// 1. Check own DB  →  2. UPC ItemDB (free)  →  3. OMDB by title
app.get('/api/lookup/barcode/:code', requireAuth, async (req, res) => {
  const code = req.params.code.trim();

  // 1. Already in library?
  try {
    const [rows] = await pool.execute('SELECT * FROM movies WHERE barcode = ?', [code]);
    if (rows.length) return res.json({ found: true, inLibrary: true, movie: rows[0] });
  } catch (e) { /* continue */ }

  // 2. UPC ItemDB
  let title = null;
  try {
    const upc = await axios.get(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`,
      { timeout: 6000 }
    );
    if (upc.data?.items?.[0]) {
      title = upc.data.items[0].title;
    }
  } catch (e) { /* UPC lookup unavailable */ }

  if (!title) {
    return res.json({ found: false, barcode: code, message: 'Barcode not found in UPC database' });
  }

  // 3. OMDB by title
  try {
    const d = await omdbGet({ t: title, plot: 'short' });
    if (d.Response === 'True') {
      return res.json({ found: true, inLibrary: false, movie: omdbToMovie(d, { barcode: code }) });
    }
  } catch (e) { /* OMDB unavailable */ }

  // Return bare title from UPC
  res.json({ found: true, inLibrary: false, movie: { barcode: code, movieName: title } });
});

// ── OMDB Lookup by IMDB ID ────────────────────────────────────────────────────
app.get('/api/lookup/imdb/:id', requireAuth, async (req, res) => {
  try {
    const d = await omdbGet({ i: req.params.id, plot: 'full' });
    if (d.Response === 'True') {
      res.json({ found: true, movie: omdbToMovie(d) });
    } else {
      res.json({ found: false, message: d.Error });
    }
  } catch (e) {
    res.status(e.message.includes('OMDB_API_KEY') ? 503 : 500).json({ error: e.message });
  }
});

// ── OMDB Lookup by Title ──────────────────────────────────────────────────────
app.get('/api/lookup/title/:title', requireAuth, async (req, res) => {
  try {
    const d = await omdbGet({ t: req.params.title, plot: 'full' });
    if (d.Response === 'True') {
      res.json({ found: true, movie: omdbToMovie(d) });
    } else {
      res.json({ found: false, message: d.Error });
    }
  } catch (e) {
    res.status(e.message.includes('OMDB_API_KEY') ? 503 : 500).json({ error: e.message });
  }
});

// ── OMDB Search (multiple results) ───────────────────────────────────────────
app.get('/api/search/omdb', requireAuth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'q parameter required' });
    const d = await omdbGet({ s: q, type: 'movie' });
    if (d.Response === 'True') {
      res.json({ found: true, results: d.Search });
    } else {
      res.json({ found: false, message: d.Error, results: [] });
    }
  } catch (e) {
    res.status(e.message.includes('OMDB_API_KEY') ? 503 : 500).json({ error: e.message });
  }
});


// ── Similar Title Matching ────────────────────────────────────────────────────
// GET /api/similar?title=Foo&year=2001&imdbId=tt123&excludeId=5
// Returns library entries that are likely the same movie via three strategies:
//   1. Exact normalised title match  (highest confidence)
//   2. SOUNDEX phonetic match        (catches typos / slight variations)
//   3. Significant-word overlap      (catches subtitle differences, articles)
// Each match is returned with a confidence label so the UI can grade the warning.
app.get('/api/similar', requireAuth, async (req, res) => {
  try {
    const { title, year, imdbId, excludeId } = req.query;
    if (!title) return res.status(400).json({ error: 'title parameter required' });

    const exclude = excludeId ? parseInt(excludeId) : null;
    const matches = new Map(); // id → {movie, confidence}

    // ── Strategy 1: Exact normalised match ──────────────────────────────────
    // Strip punctuation, articles, and collapse whitespace for comparison
    const [exactRows] = await pool.execute(
      `SELECT *, 'exact' AS matchType
       FROM movies
       WHERE LOWER(REGEXP_REPLACE(movieName, '[^a-z0-9 ]', ''))
           = LOWER(REGEXP_REPLACE(?, '[^a-z0-9 ]', ''))
         ${exclude ? 'AND id != ?' : ''}`,
      exclude ? [title, exclude] : [title]
    );
    exactRows.forEach(r => matches.set(r.id, { movie: r, confidence: 'exact' }));

    // ── Strategy 2: IMDB ID match (if provided) ──────────────────────────────
    if (imdbId) {
      const [imdbRows] = await pool.execute(
        `SELECT *, 'imdbId' AS matchType FROM movies
         WHERE imdbId = ? AND imdbId != ''
           ${exclude ? 'AND id != ?' : ''}`,
        exclude ? [imdbId, exclude] : [imdbId]
      );
      imdbRows.forEach(r => {
        if (!matches.has(r.id)) matches.set(r.id, { movie: r, confidence: 'exact' });
      });
    }

    // ── Strategy 3: SOUNDEX phonetic match ───────────────────────────────────
    const [soundexRows] = await pool.execute(
      `SELECT *, 'soundex' AS matchType
       FROM movies
       WHERE SOUNDEX(movieName) = SOUNDEX(?)
         ${exclude ? 'AND id != ?' : ''}`,
      exclude ? [title, exclude] : [title]
    );
    soundexRows.forEach(r => {
      if (!matches.has(r.id)) matches.set(r.id, { movie: r, confidence: 'soundex' });
    });

    // ── Strategy 4: Significant-word overlap (JS-side) ───────────────────────
    // Pull all titles, then score them for word overlap in Node
    const STOP_WORDS = new Set([
      'the','a','an','of','and','or','in','on','at','to','for',
      'with','from','by','is','it','its','this','that','be','are',
      'was','were','not','but','as','if','so','yet'
    ]);

    function significantWords(str) {
      return str.toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOP_WORDS.has(w));
    }

    function wordOverlapScore(a, b) {
      const wa = new Set(significantWords(a));
      const wb = new Set(significantWords(b));
      if (!wa.size || !wb.size) return 0;
      const intersection = [...wa].filter(w => wb.has(w)).length;
      return intersection / Math.max(wa.size, wb.size);
    }

    // Only fetch if we don't already have a huge number of matches
    if (matches.size < 20) {
      const [allRows] = await pool.execute(
        `SELECT id, movieName, year, format, coverImage, localPoster, imdbRating, director
         FROM movies ${exclude ? 'WHERE id != ?' : ''}`,
        exclude ? [exclude] : []
      );
      allRows.forEach(r => {
        if (matches.has(r.id)) return;
        const score = wordOverlapScore(title, r.movieName);
        if (score >= 0.6) {
          matches.set(r.id, {
            movie: r,
            confidence: score >= 0.85 ? 'high' : 'possible',
            score: Math.round(score * 100),
          });
        }
      });
    }

    // ── Year filter: remove implausible matches ───────────────────────────────
    // If a year is provided, demote matches where years differ by > 2
    // (allow ±2 for re-releases, director's cuts, etc.)
    const results = [];
    for (const { movie, confidence, score } of matches.values()) {
      let conf = confidence;
      if (year && movie.year) {
        const diff = Math.abs(parseInt(year) - parseInt(movie.year));
        if (diff > 2 && conf !== 'exact' && conf !== 'imdbId') {
          conf = 'possible'; // downgrade
        }
        if (diff > 5 && conf === 'soundex') continue; // skip very different years
      }
      results.push({ ...movie, confidence: conf, score: score || null });
    }

    // Sort: exact first, then high, soundex, possible
    const ORDER = { exact: 0, imdbId: 0, high: 1, soundex: 2, possible: 3 };
    results.sort((a, b) => (ORDER[a.confidence] ?? 9) - (ORDER[b.confidence] ?? 9));

    res.json({ count: results.length, matches: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Stats ────────────────────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const [[{ total }]]    = await pool.execute('SELECT COUNT(*) AS total FROM movies');
    const [formats]        = await pool.execute('SELECT format, COUNT(*) AS count FROM movies GROUP BY format ORDER BY count DESC');
    const [genres]         = await pool.execute(`
      SELECT TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(genre, ',', n.n), ',', -1)) AS g, COUNT(*) AS count
      FROM movies
      CROSS JOIN (SELECT 1 n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5) n
      WHERE CHAR_LENGTH(genre) - CHAR_LENGTH(REPLACE(genre, ',', '')) >= n.n - 1
        AND genre != ''
      GROUP BY g ORDER BY count DESC LIMIT 12`);
    const [decades]        = await pool.execute(`
      SELECT CONCAT(FLOOR(CAST(year AS UNSIGNED)/10)*10,'s') AS decade, COUNT(*) AS count
      FROM movies WHERE year REGEXP '^[0-9]{4}$'
      GROUP BY decade ORDER BY decade`);
    const [[{ avgImdb }]]  = await pool.execute(
      "SELECT ROUND(AVG(CAST(imdbRating AS DECIMAL(3,1))),1) AS avgImdb FROM movies WHERE imdbRating != '' AND imdbRating IS NOT NULL");
    const [[{ avgPaid }]]  = await pool.execute(
      "SELECT ROUND(AVG(CAST(REPLACE(pp,'$','') AS DECIMAL(8,2))),2) AS avgPaid FROM movies WHERE pp != '' AND pp REGEXP '^\\\\$?[0-9]'");

    res.json({ total, formats, genres, decades, avgImdb, avgPaid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ── Filter Options (for dropdowns) ───────────────────────────────────────────
app.get('/api/filters', requireAuth, async (req, res) => {
  try {
    // Distinct age ratings
    const [ratings] = await pool.execute(
      "SELECT DISTINCT rating FROM movies WHERE rating != '' ORDER BY rating");

    // Distinct genres (split comma-separated values)
    const [genres] = await pool.execute(`
      SELECT DISTINCT TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(genre, ',', n.n), ',', -1)) AS g
      FROM movies
      CROSS JOIN (SELECT 1 n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6) n
      WHERE CHAR_LENGTH(genre) - CHAR_LENGTH(REPLACE(genre, ',', '')) >= n.n - 1
        AND genre != ''
      ORDER BY g`);

    // Year range
    const [[yearRange]] = await pool.execute(
      "SELECT MIN(CAST(year AS UNSIGNED)) AS minYear, MAX(CAST(year AS UNSIGNED)) AS maxYear FROM movies WHERE year REGEXP '^[0-9]{4}$'");

    // Place of purchase options
    const [purchases] = await pool.execute(
      "SELECT DISTINCT pop FROM movies WHERE pop != '' ORDER BY pop");

    res.json({
      ratings:   ratings.map(r => r.rating),
      genres:    genres.map(g => g.g).filter(Boolean),
      yearRange: { min: yearRange?.minYear || 1970, max: yearRange?.maxYear || new Date().getFullYear() },
      purchases: purchases.map(p => p.pop),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ════════════════════════════════════════════════════════════════════════════
// LOAN MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

// GET /api/loans  — all currently on-loan movies, optional ?person= filter
app.get('/api/loans', requireAuth, async (req, res) => {
  try {
    const { person } = req.query;
    let sql = `
      SELECT m.*, lh.id AS loanHistoryId, lh.notes AS loanNotes,
             lh.loanedDate AS loanStart
      FROM movies m
      JOIN loan_history lh ON lh.movieId = m.id AND lh.returnedDate IS NULL
      WHERE m.loanedTo != ''`;
    const params = [];
    if (person) { sql += ' AND m.loanedTo LIKE ?'; params.push(`%${person}%`); }
    sql += ' ORDER BY m.loanedDate DESC';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/loans/people  — distinct borrower names (for autocomplete)
app.get('/api/loans/people', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT DISTINCT loanedTo AS name, COUNT(*) AS count FROM movies WHERE loanedTo != '' GROUP BY loanedTo ORDER BY loanedTo"
    );
    // Also include historical borrowers not currently holding anything
    const [hist] = await pool.execute(
      "SELECT DISTINCT loanedTo AS name FROM loan_history WHERE loanedTo NOT IN (SELECT loanedTo FROM movies WHERE loanedTo != '') ORDER BY loanedTo"
    );
    res.json({ current: rows, past: hist.map(r => r.name) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/loans/history/:movieId  — full loan history for one movie
app.get('/api/loans/history/:movieId', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM loan_history WHERE movieId = ? ORDER BY loanedDate DESC',
      [req.params.movieId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/movies/:id/loan  — lend a movie out
// body: { loanedTo: "Alice Smith", notes: "optional" }
app.post('/api/movies/:id/loan', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { loanedTo, notes = '' } = req.body;
    if (!loanedTo?.trim()) {
      await conn.rollback();
      return res.status(400).json({ error: 'loanedTo name is required' });
    }
    const [[movie]] = await conn.execute(
      'SELECT id, movieName, loanedTo FROM movies WHERE id = ?', [req.params.id]
    );
    if (!movie) { await conn.rollback(); return res.status(404).json({ error: 'Movie not found' }); }
    if (movie.loanedTo) {
      await conn.rollback();
      return res.status(409).json({ error: `Already on loan to ${movie.loanedTo}` });
    }
    const now = new Date();
    await conn.execute(
      'UPDATE movies SET loanedTo = ?, loanedDate = ? WHERE id = ?',
      [loanedTo.trim(), now, req.params.id]
    );
    await conn.execute(
      'INSERT INTO loan_history (movieId, loanedTo, loanedDate, notes) VALUES (?,?,?,?)',
      [req.params.id, loanedTo.trim(), now, notes.trim()]
    );
    await conn.commit();
    res.json({ message: `"${movie.movieName}" loaned to ${loanedTo.trim()}` });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// POST /api/movies/:id/return  — mark a movie as returned
app.post('/api/movies/:id/return', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[movie]] = await conn.execute(
      'SELECT id, movieName, loanedTo FROM movies WHERE id = ?', [req.params.id]
    );
    if (!movie) { await conn.rollback(); return res.status(404).json({ error: 'Movie not found' }); }
    if (!movie.loanedTo) {
      await conn.rollback();
      return res.status(409).json({ error: 'Movie is not currently on loan' });
    }
    const now = new Date();
    await conn.execute(
      "UPDATE movies SET loanedTo = '', loanedDate = NULL WHERE id = ?", [req.params.id]
    );
    await conn.execute(
      `UPDATE loan_history SET returnedDate = ?
       WHERE movieId = ? AND returnedDate IS NULL
       ORDER BY loanedDate DESC LIMIT 1`,
      [now, req.params.id]
    );
    await conn.commit();
    res.json({ message: `"${movie.movieName}" returned by ${movie.loanedTo}` });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});


// ════════════════════════════════════════════════════════════════════════════
// BATCH ENRICHMENT
// ════════════════════════════════════════════════════════════════════════════

// GET /api/batch/candidates
// Returns movies that are missing IMDB data, barcode, or poster.
// Query params: ?limit=50&missing=imdb|barcode|poster|any (default: any)
app.get('/api/batch/candidates', requireAuth, async (req, res) => {
  try {
    const limit   = Math.min(parseInt(req.query.limit || '200'), 500);
    const missing = req.query.missing || 'any';

    let where = '';
    if (missing === 'imdb')    where = "(imdbId = '' OR imdbId IS NULL)";
    else if (missing === 'barcode') where = "(barcode IS NULL OR barcode = '')";
    else if (missing === 'poster')  where = "(coverImage = '' OR coverImage IS NULL) AND (localPoster = '' OR localPoster IS NULL)";
    else where = "(imdbId = '' OR imdbId IS NULL OR barcode IS NULL OR coverImage = '')";

    const [rows] = await pool.execute(
      `SELECT id, movieName, year, format, imdbId, barcode, coverImage, localPoster, director, genre
       FROM movies WHERE ${where} ORDER BY movieName LIMIT ?`,
      [limit]
    );
    res.json({ count: rows.length, candidates: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/batch/lookup/:id
// For a single candidate movie: search OMDB by title and also run /similar check.
// Returns the best OMDB match + any library duplicates to warn about.
app.get('/api/batch/lookup/:id', requireAuth, async (req, res) => {
  try {
    const [[movie]] = await pool.execute(
      'SELECT * FROM movies WHERE id = ?', [req.params.id]
    );
    if (!movie) return res.status(404).json({ error: 'Movie not found' });

    // If we already have an imdbId use it directly, otherwise search by title
    let omdbData = null;
    let omdbResults = [];
    try {
      if (movie.imdbId) {
        const d = await omdbGet({ i: movie.imdbId, plot: 'short' });
        if (d.Response === 'True') omdbData = d;
      }
      if (!omdbData) {
        const d = await omdbGet({ t: movie.movieName, y: movie.year || undefined, plot: 'short' });
        if (d.Response === 'True') omdbData = d;
      }
      // Also get a search list for alternatives
      const s = await omdbGet({ s: movie.movieName, type: 'movie' });
      if (s.Response === 'True') omdbResults = s.Search.slice(0, 6);
    } catch (_) { /* OMDB unavailable */ }

    // Duplicate check — exclude self
    const STOP_WORDS = new Set(['the','a','an','of','and','or','in','on','at','to','for','with','from','by']);
    function sigWords(str) {
      return str.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
    }
    function overlapScore(a, b) {
      const wa = new Set(sigWords(a)), wb = new Set(sigWords(b));
      if (!wa.size || !wb.size) return 0;
      return [...wa].filter(w => wb.has(w)).length / Math.max(wa.size, wb.size);
    }

    const [allMovies] = await pool.execute(
      'SELECT id, movieName, year, format, coverImage, localPoster, imdbId FROM movies WHERE id != ?',
      [movie.id]
    );
    const similar = allMovies
      .map(m => ({ ...m, score: overlapScore(movie.movieName, m.movieName) }))
      .filter(m => m.score >= 0.7 || (movie.imdbId && m.imdbId === movie.imdbId))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    res.json({ movie, omdbData, omdbResults, similar });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/batch/apply
// Apply confirmed OMDB data to a movie record.
// body: { id, imdbId, applyFields: true (full update) | false (imdbId/barcode/poster only) }
app.post('/api/batch/apply', requireAuth, async (req, res) => {
  try {
    const { id, imdbId, barcode, applyFields = true } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });

    // Fetch fresh from OMDB
    const d = await omdbGet({ i: imdbId, plot: 'full' });
    if (d.Response !== 'True') return res.status(404).json({ error: d.Error || 'OMDB not found' });

    const patch = { imdbId: d.imdbID || imdbId, imdbRating: d.imdbRating || '' };
    if (barcode) patch.barcode = barcode;

    if (applyFields) {
      Object.assign(patch, {
        movieName:  d.Title      || '',
        actors:     d.Actors     || '',
        director:   d.Director   || '',
        genre:      d.Genre      || '',
        year:       d.Year       || '',
        runtime:    d.Runtime    || '',
        plot:       d.Plot       || '',
        rating:     d.Rated      || '',
        language:   d.Language   || '',
        country:    d.Country    || '',
        studio:     d.Production || '',
      });
      if (d.Poster && d.Poster !== 'N/A') patch.coverImage = d.Poster;
    }

    // Build SET clause dynamically
    const keys   = Object.keys(patch);
    const values = Object.values(patch);
    const setClause = keys.map(k => `\`${k}\` = ?`).join(', ');
    values.push(id);

    const [result] = await pool.execute(
      `UPDATE movies SET ${setClause} WHERE id = ?`, values
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Movie not found' });

    // Return the updated movie row
    const [[updated]] = await pool.execute('SELECT * FROM movies WHERE id = ?', [id]);
    res.json({ message: 'Movie enriched', movie: updated });
  } catch (e) {
    res.status(e.message.includes('OMDB_API_KEY') ? 503 : 500).json({ error: e.message });
  }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬  DVD Library running → http://0.0.0.0:${PORT}`);
  console.log(`    DB:     ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}`);
  console.log(`    OMDB:   ${omdbKey() ? '✓ configured' : '✗ not configured'}`);
  console.log(`    Auth:   ${googleConfigured ? '✓ Google SSO configured' : '✗ Google SSO NOT configured — set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET'}`);
  if (googleConfigured) {
    console.log(`    Domain: ${ALLOWED_DOMAIN || '(any Google account)'}`);
    if (ALLOWED_EMAILS.length) console.log(`    Emails: ${ALLOWED_EMAILS.join(', ')}`);
    console.log(`    Cookie: secure=${SECURE_COOKIE} | callback: ${process.env.APP_URL || 'http://localhost:'+PORT}/auth/google/callback`);
  }
  console.log('');
});
