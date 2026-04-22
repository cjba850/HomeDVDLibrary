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
  `coverImage`  VARCHAR(500)  NOT NULL DEFAULT ''   COMMENT 'URL to poster image',
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
