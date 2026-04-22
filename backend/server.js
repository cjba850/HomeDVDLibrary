'use strict';

// Load .env if running locally (ignored in Docker where env is injected)
try { require('dotenv').config(); } catch (_) {}

const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const axios   = require('axios');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ── DB Connection Pool ────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:              process.env.DB_HOST || 'localhost',
  port:              parseInt(process.env.DB_PORT || '3306'),
  user:              process.env.DB_USER || 'dvdlib',
  password:          process.env.DB_PASS || 'dvdlib_secret',
  database:          process.env.DB_NAME || 'dvdlibrary',
  waitForConnections: true,
  connectionLimit:   10,
  queueLimit:        0,
  charset:           'utf8mb4',
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const MOVIE_FIELDS = [
  'barcode','movieName','actors','director','genre','year','runtime',
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
app.get('/api/movies', async (req, res) => {
  try {
    const { search, format, genre, sort = 'movieName' } = req.query;
    const allowed = ['movieName','year','dateAdded','imdbRating','pp'];
    const orderBy  = allowed.includes(sort) ? sort : 'movieName';

    let sql = 'SELECT * FROM movies WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (movieName LIKE ? OR actors LIKE ? OR director LIKE ? OR genre LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (format) { sql += ' AND format = ?'; params.push(format); }
    if (genre)  { sql += ' AND genre LIKE ?'; params.push(`%${genre}%`); }

    sql += ` ORDER BY ${orderBy}`;

    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/movies/:id
app.get('/api/movies/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM movies WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Movie not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/movies — create
app.post('/api/movies', async (req, res) => {
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
app.put('/api/movies/:id', async (req, res) => {
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
app.delete('/api/movies/:id', async (req, res) => {
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
app.get('/api/lookup/barcode/:code', async (req, res) => {
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
app.get('/api/lookup/imdb/:id', async (req, res) => {
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
app.get('/api/lookup/title/:title', async (req, res) => {
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
app.get('/api/search/omdb', async (req, res) => {
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

// ── Stats ────────────────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
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

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬  DVD Library running → http://0.0.0.0:${PORT}`);
  console.log(`    DB:   ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}`);
  console.log(`    OMDB: ${omdbKey() ? '✓ configured' : '✗ not configured (title/barcode lookup disabled)'}\n`);
});
