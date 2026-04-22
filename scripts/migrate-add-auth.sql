-- ============================================================
-- Migration: add Google SSO auth tables to existing database
-- Run ONCE if your DB was created before this update.
--
-- Usage:
--   mysql -u dvdlib -p dvdlibrary < scripts/migrate-add-auth.sql
-- ============================================================

USE dvdlibrary;

CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id`  VARCHAR(128) NOT NULL,
  `expires`     INT(11) UNSIGNED NOT NULL,
  `data`        MEDIUMTEXT,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

SELECT 'Auth migration complete.' AS status;
