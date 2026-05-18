-- ============================================================
-- REPRESENTATIVE – databázová schéma
-- PostgreSQL, DB user: rep_test
--
-- Spustenie:

--   psql -U rep_test -d representative -h localhost -f ./backend/db/schema.sql
-- ============================================================

-- ── Rozšírenia ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Reset tabuliek (POZOR: zmaze data) ───────────────────────
/* Príkazy DROP majú využitie v prípade potreby zmeny tabuliek. Po použití je potrebné ich znovu vypnúť poznámkou */

-- DROP TABLE IF EXISTS user_folder_permissions CASCADE;
-- DROP TABLE IF EXISTS doc_files CASCADE;
-- DROP TABLE IF EXISTS doc_folders CASCADE;
-- DROP TABLE IF EXISTS news_comments CASCADE;
-- DROP TABLE IF EXISTS news CASCADE;
-- DROP TABLE IF EXISTS events CASCADE;
-- DROP TABLE IF EXISTS ticker_messages CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;

-- ── Používatelia ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE,
  display_name  VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL
                  CHECK (
                    password_hash ~ '^[$]2[aby][$](0[4-9]|[12][0-9]|3[01])[$][./A-Za-z0-9]{53}$'
                    OR password_hash ~ '^[$]argon2(id|i|d)[$]v=[0-9]+[$]m=[0-9]+,t=[0-9]+,p=[0-9]+[$][A-Za-z0-9+/]+={0,2}[$][A-Za-z0-9+/]+={0,2}$'
                  ),
  role          VARCHAR(50)  NOT NULL DEFAULT 'user'
                  CHECK (role IN ('admin', 'user')),
  read_access   BOOLEAN NOT NULL DEFAULT false,
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

CREATE TABLE IF NOT EXISTS ticker_attachments (
  id          SERIAL PRIMARY KEY,
  ticker_id   INTEGER NOT NULL REFERENCES ticker_messages(id) ON DELETE CASCADE,
  name        VARCHAR(500) NOT NULL,
  file_url    VARCHAR(2048) NOT NULL,
  file_size   BIGINT,
  mime_type   VARCHAR(120),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticker_att ON ticker_attachments (ticker_id);

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
  published_at     TIMESTAMPTZ,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS news_attachments (
  id          SERIAL PRIMARY KEY,
  news_id     INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  name        VARCHAR(500) NOT NULL,
  file_url    VARCHAR(2048) NOT NULL,
  file_size   BIGINT,
  mime_type   VARCHAR(120),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS news_comments (
  id                SERIAL PRIMARY KEY,
  news_id           INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  parent_comment_id INTEGER REFERENCES news_comments(id) ON DELETE CASCADE,
  content           TEXT NOT NULL CHECK (length(trim(content)) > 0 AND length(content) <= 4000),
  created_by        INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at         TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexy ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_events_start   ON events (event_start);
CREATE INDEX IF NOT EXISTS idx_news_published ON news (published_at DESC) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_news_att       ON news_attachments (news_id);
CREATE INDEX IF NOT EXISTS idx_news_comments_news_created ON news_comments (news_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_comments_parent ON news_comments (parent_comment_id);
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

-- ── Prístupy a oprávnenia k priečinkom ───────────────────────
/*
  Tabuľka user_folder_permissions priraďuje používateľa ku konkrétnemu root priečinku (root_folder_id).
  Priradenie sa dedí na celý strom pod daným root priečinkom.

  Trigger ensure_root_folder_permission zabezpečuje, že priradenie je možné iba ku root priečinkom
  (kde parent_id IS NULL), čo zjednodušuje správu práv a dedenie.
*/

CREATE TABLE IF NOT EXISTS user_folder_permissions (
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  root_folder_id  INTEGER NOT NULL REFERENCES doc_folders(id) ON DELETE RESTRICT,
  assigned_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, root_folder_id)
);

CREATE INDEX IF NOT EXISTS idx_user_folder_permissions_root_folder
  ON user_folder_permissions (root_folder_id);

CREATE OR REPLACE FUNCTION ensure_root_folder_permission()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM doc_folders f
    WHERE f.id = NEW.root_folder_id
      AND f.parent_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Permissions can be assigned only to root folders (parent_id IS NULL).';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ensure_root_folder_permission ON user_folder_permissions;
CREATE TRIGGER trg_ensure_root_folder_permission
BEFORE INSERT OR UPDATE OF root_folder_id ON user_folder_permissions
FOR EACH ROW
EXECUTE FUNCTION ensure_root_folder_permission();
