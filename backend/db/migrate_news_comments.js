require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('./index');

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS news_comments (
        id                SERIAL PRIMARY KEY,
        news_id           INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,
        parent_comment_id INTEGER REFERENCES news_comments(id) ON DELETE CASCADE,
        content           TEXT NOT NULL CHECK (length(trim(content)) > 0 AND length(content) <= 4000),
        created_by        INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        edited_at         TIMESTAMPTZ,
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query('CREATE INDEX IF NOT EXISTS idx_news_comments_news_created ON news_comments (news_id, created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_news_comments_parent ON news_comments (parent_comment_id)');

    console.log('✓ news_comments migration completed');
  } catch (err) {
    console.error('news_comments migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
