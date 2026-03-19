-- ============================================================
-- REPRESENTATIVE – databázová schéma
-- PostgreSQL, DB user: rep_test
--
-- Spustenie:
--   psql -U rep_test -d representative -f ./db/schema.sql
-- ============================================================

-- ── Rozšírenia ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Používatelia ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE,
  display_name  VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(50)  NOT NULL DEFAULT 'user'
                  CHECK (role IN ('admin', 'editor', 'user')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Ticker správy ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticker_messages (
  id          SERIAL PRIMARY KEY,
  text        VARCHAR(500) NOT NULL,
  link_url    VARCHAR(2048),
  expires_at  TIMESTAMPTZ,
  expires_days INTEGER,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Udalosti ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(500) NOT NULL,
  description TEXT,
  event_start TIMESTAMPTZ NOT NULL,
  event_end   TIMESTAMPTZ,
  all_day     BOOLEAN NOT NULL DEFAULT true,
  location    VARCHAR(500),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Novinky ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news (
  id               SERIAL PRIMARY KEY,
  title            VARCHAR(500) NOT NULL,
  description      TEXT,
  content          TEXT,
  banner_image_url VARCHAR(2048),
  author_name      VARCHAR(255),
  is_published     BOOLEAN NOT NULL DEFAULT true,
  published_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexy ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_events_start   ON events (event_start);
CREATE INDEX IF NOT EXISTS idx_news_published ON news (published_at DESC) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_ticker_expires ON ticker_messages (expires_at);

-- ── Dokumenty – priečinky ────────────────────────────────────
CREATE TABLE IF NOT EXISTS doc_folders (
  id          SERIAL PRIMARY KEY,
  parent_id   INTEGER REFERENCES doc_folders(id) ON DELETE CASCADE,
  name        VARCHAR(500) NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Dokumenty – súbory ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS doc_files (
  id          SERIAL PRIMARY KEY,
  folder_id   INTEGER NOT NULL REFERENCES doc_folders(id) ON DELETE CASCADE,
  name        VARCHAR(500) NOT NULL,
  description TEXT,
  file_url    VARCHAR(2048),
  file_size   BIGINT,
  mime_type   VARCHAR(120),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_folders_parent ON doc_folders (parent_id);
CREATE INDEX IF NOT EXISTS idx_doc_files_folder   ON doc_files (folder_id);
