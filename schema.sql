-- ============================================================
-- DVD / Blu-Ray Library Database Schema
-- Compatible with MySQL 5.7+ and MariaDB 10.4+
-- ============================================================

CREATE DATABASE IF NOT EXISTS dvdlibrary
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE dvdlibrary;

CREATE TABLE IF NOT EXISTS `movies` (
  -- Core identity (preserving original field names)
  `id`          INT NOT NULL AUTO_INCREMENT,
  `barcode`     VARCHAR(50)   DEFAULT NULL          COMMENT 'UPC/EAN barcode from disc',
  `movieName`   VARCHAR(255)  NOT NULL              COMMENT 'Movie title',
  `actors`      VARCHAR(1000) NOT NULL DEFAULT ''   COMMENT 'Main cast (comma-separated)',
  `pop`         VARCHAR(20)   NOT NULL DEFAULT ''   COMMENT 'Place of Purchase',
  `rrp`         VARCHAR(20)   NOT NULL DEFAULT ''   COMMENT 'Recommended retail price',
  `pp`          VARCHAR(20)   NOT NULL DEFAULT ''   COMMENT 'Price paid',
  `rating`      VARCHAR(20)   NOT NULL DEFAULT ''   COMMENT 'Age/content rating (G, PG, M, MA15+, R18+)',
  `comments`    VARCHAR(4000) NOT NULL DEFAULT ''   COMMENT 'Personal notes',

  -- Extended metadata (auto-populated from OMDB/barcode lookup)
  `format`      ENUM('DVD','Blu-Ray','4K UHD','Other') NOT NULL DEFAULT 'DVD',
  `director`    VARCHAR(255)  NOT NULL DEFAULT '',
  `genre`       VARCHAR(255)  NOT NULL DEFAULT '',
  `year`        VARCHAR(10)   NOT NULL DEFAULT '',
  `runtime`     VARCHAR(50)   NOT NULL DEFAULT '',
  `plot`        TEXT,
  `coverImage`  VARCHAR(500)  NOT NULL DEFAULT ''   COMMENT 'URL to poster image (original)',
  `localPoster` VARCHAR(500)  NOT NULL DEFAULT ''   COMMENT 'Local cached poster path e.g. /posters/42.jpg',
  `language`    VARCHAR(100)  NOT NULL DEFAULT '',
  `country`     VARCHAR(100)  NOT NULL DEFAULT '',
  `studio`      VARCHAR(255)  NOT NULL DEFAULT '',
  `location`    VARCHAR(100)  NOT NULL DEFAULT ''   COMMENT 'Physical shelf location (e.g. A3)',

  -- IMDB/OMDB link
  `imdbId`      VARCHAR(50)   NOT NULL DEFAULT '',
  `imdbRating`  VARCHAR(10)   NOT NULL DEFAULT '',

  -- Housekeeping
  `dateAdded`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastUpdated` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_barcode` (`barcode`),
  KEY `idx_movieName` (`movieName`),
  KEY `idx_format`    (`format`),
  KEY `idx_year`      (`year`),
  FULLTEXT KEY `ft_search` (`movieName`, `actors`, `director`, `genre`)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- Optional: migrate data from legacy MyISAM DVD table
-- Uncomment and adjust if you have existing data to import
-- ============================================================
/*
INSERT INTO movies (id, movieName, actors, pop, rrp, pp, rating, comments)
SELECT id, movieName, actors, pop, rrp, pp, rating, comments
FROM DVD;
*/

-- ============================================================
-- Loan tracking
-- ============================================================

-- Current loan state lives on the movies row for fast joins/filters
ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS `loanedTo`   VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Current borrower name (empty = in library)',
  ADD COLUMN IF NOT EXISTS `loanedDate` DATETIME     DEFAULT NULL        COMMENT 'Date lent out',
  ADD KEY IF NOT EXISTS `idx_loanedTo` (`loanedTo`);

-- Full loan history (one row per loan event)
CREATE TABLE IF NOT EXISTS `loan_history` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `movieId`      INT NOT NULL,
  `loanedTo`     VARCHAR(255) NOT NULL,
  `loanedDate`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `returnedDate` DATETIME DEFAULT NULL,
  `notes`        VARCHAR(500) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `idx_lh_movie`    (`movieId`),
  KEY `idx_lh_borrower` (`loanedTo`),
  KEY `idx_lh_active`   (`returnedDate`),
  CONSTRAINT `fk_lh_movie` FOREIGN KEY (`movieId`)
    REFERENCES `movies` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Auth: session store + authorised users log
-- ============================================================

-- express-mysql-session creates this automatically, but defining it
-- here ensures it exists with the right charset before first run.
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id`  VARCHAR(128) NOT NULL,
  `expires`     INT(11) UNSIGNED NOT NULL,
  `data`        MEDIUMTEXT,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tracks every Google account that has successfully signed in.
-- Used for audit logging; access control is done via ALLOWED_DOMAIN / ALLOWED_EMAILS in .env.
CREATE TABLE IF NOT EXISTS `auth_users` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `googleId`    VARCHAR(128) NOT NULL,
  `email`       VARCHAR(255) NOT NULL,
  `name`        VARCHAR(255) NOT NULL DEFAULT '',
  `picture`     VARCHAR(500) NOT NULL DEFAULT '',
  `lastLogin`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `firstLogin`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `loginCount`  INT NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_googleId` (`googleId`),
  UNIQUE KEY `uq_email`    (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
