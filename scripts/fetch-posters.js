#!/usr/bin/env node
// Resolve modules from backend/node_modules regardless of where the script is run from
const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();

/**
 * fetch-posters.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time (or repeatable) script that downloads poster images for every movie
 * in the library that has a coverImage URL but no locally cached copy.
 *
 * Images are saved to:  frontend/posters/<id>.jpg
 * The DB column        `localPoster`  is updated to:  /posters/<id>.jpg
 * The Express server already serves /frontend/ statically, so the path
 * resolves automatically in the browser.
 *
 * Usage:
 *   node scripts/fetch-posters.js              # process all missing posters
 *   node scripts/fetch-posters.js --force      # re-download even if cached
 *   node scripts/fetch-posters.js --id 42      # single movie by DB id
 *   node scripts/fetch-posters.js --dry-run    # show what would be fetched
 *
 * Requirements:
 *   npm install mysql2 axios        (already in backend/package.json)
 *   .env or environment variables must be set (same as the main server)
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const fs     = require('fs');
const mysql  = require('mysql2/promise');
const axios  = require('axios');

// Load .env from backend/ or project root
[path.join(__dirname, '../backend/.env'),
 path.join(__dirname, '../.env'),
 path.join(__dirname, '.env')]
  .forEach(p => { try { require('dotenv').config({ path: p }); } catch (_) {} });

// ── Config ────────────────────────────────────────────────────────────────────
const POSTER_DIR  = path.join(__dirname, '../frontend/posters');
const CONCURRENCY = 4;    // parallel downloads
const TIMEOUT_MS  = 12000;
const RETRY_MAX   = 2;

const args     = process.argv.slice(2);
const FORCE    = args.includes('--force');
const DRY_RUN  = args.includes('--dry-run');
const ONLY_ID  = (() => { const i = args.indexOf('--id'); return i >= 0 ? parseInt(args[i+1]) : null; })();

// ── DB pool ───────────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER || 'dvdlib',
  password: process.env.DB_PASS || 'dvdlib_secret',
  database: process.env.DB_NAME || 'dvdlibrary',
  waitForConnections: true,
  connectionLimit: 5,
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(level, ...args) {
  const colours = { INFO: '\x1b[36m', OK: '\x1b[32m', WARN: '\x1b[33m', ERR: '\x1b[31m', SKIP: '\x1b[90m' };
  const reset = '\x1b[0m';
  console.log(`${colours[level]||''}[${level}]${reset}`, ...args);
}

async function downloadImage(url, destPath, attempt = 1) {
  try {
    const res = await axios.get(url, {
      responseType: 'stream',
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'DVDLibrary/1.0 poster-fetcher' },
    });

    const contentType = res.headers['content-type'] || '';
    if (!contentType.startsWith('image/')) {
      throw new Error(`Non-image content-type: ${contentType}`);
    }

    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(destPath);
      res.data.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
    });

    const stat = fs.statSync(destPath);
    if (stat.size < 500) throw new Error(`File too small (${stat.size} bytes) — likely an error page`);

    return true;
  } catch (err) {
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    if (attempt < RETRY_MAX) {
      await sleep(1500 * attempt);
      return downloadImage(url, destPath, attempt + 1);
    }
    throw err;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Ensure poster directory exists
  fs.mkdirSync(POSTER_DIR, { recursive: true });

  // Query movies that need posters
  let sql = `SELECT id, movieName, coverImage, localPoster
             FROM movies
             WHERE coverImage IS NOT NULL AND coverImage != ''`;

  if (!FORCE) sql += ` AND (localPoster IS NULL OR localPoster = '')`;
  if (ONLY_ID) sql += ` AND id = ${parseInt(ONLY_ID)}`;
  sql += ' ORDER BY id';

  const [rows] = await pool.execute(sql);

  if (rows.length === 0) {
    log('INFO', 'No movies need poster downloads. Use --force to re-download all.');
    await pool.end();
    return;
  }

  log('INFO', `Found ${rows.length} movie(s) to process${DRY_RUN ? ' (DRY RUN)' : ''}`);
  if (DRY_RUN) {
    rows.forEach(r => log('INFO', `  [${r.id}] ${r.movieName}  →  ${r.coverImage}`));
    await pool.end();
    return;
  }

  // Process in batches of CONCURRENCY
  let done = 0, skipped = 0, failed = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async movie => {
      const ext      = '.jpg';  // OMDB always returns JPEG
      const filename = `${movie.id}${ext}`;
      const destPath = path.join(POSTER_DIR, filename);
      const webPath  = `/posters/${filename}`;

      // Already on disk and not forcing?
      if (!FORCE && fs.existsSync(destPath)) {
        // Just make sure DB is updated
        await pool.execute('UPDATE movies SET localPoster = ? WHERE id = ?', [webPath, movie.id]);
        log('SKIP', `[${movie.id}] ${movie.movieName} — already cached`);
        skipped++;
        return;
      }

      try {
        await downloadImage(movie.coverImage, destPath);
        await pool.execute('UPDATE movies SET localPoster = ? WHERE id = ?', [webPath, movie.id]);
        log('OK', `[${movie.id}] ${movie.movieName}`);
        done++;
      } catch (err) {
        log('ERR', `[${movie.id}] ${movie.movieName} — ${err.message}`);
        failed++;
      }
    }));

    // Small pause between batches to be polite to OMDB CDN
    if (i + CONCURRENCY < rows.length) await sleep(300);
  }

  log('INFO', `\nComplete — ✓ Downloaded: ${done}  ⟳ Skipped: ${skipped}  ✗ Failed: ${failed}`);
  log('INFO', `Posters saved to: ${POSTER_DIR}`);

  await pool.end();
}

main().catch(err => {
  log('ERR', 'Fatal:', err.message);
  process.exit(1);
});
