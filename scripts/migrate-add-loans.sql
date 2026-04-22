-- ============================================================
-- Migration: add loan tracking to existing dvdlibrary database
-- Run ONCE if your DB was created before this update.
--
-- Usage:
--   mysql -u dvdlib -p dvdlibrary < scripts/migrate-add-loans.sql
-- ============================================================

USE dvdlibrary;

-- Add current-loan columns to movies table
ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS `loanedTo`   VARCHAR(255) NOT NULL DEFAULT ''
    COMMENT 'Current borrower name (empty = in library)',
  ADD COLUMN IF NOT EXISTS `loanedDate` DATETIME DEFAULT NULL
    COMMENT 'Date lent out';

-- Add index for borrower lookups
ALTER TABLE movies
  ADD KEY IF NOT EXISTS `idx_loanedTo` (`loanedTo`);

-- Full loan history table
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

SELECT 'Migration complete.' AS status;
