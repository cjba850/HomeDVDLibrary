-- ============================================================
-- Migration: add localPoster column
-- Run this ONCE against your existing dvdlibrary database
-- if you created the DB before this script was added.
--
-- Usage:
--   mysql -u dvdlib -p dvdlibrary < scripts/migrate-add-localposter.sql
-- ============================================================

USE dvdlibrary;

-- Add localPoster column if it doesn't already exist
ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS `localPoster` VARCHAR(500) NOT NULL DEFAULT ''
    COMMENT 'Local cached poster path e.g. /posters/42.jpg'
  AFTER `coverImage`;
