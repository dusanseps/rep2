require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('./index');

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS news_attachments (
        id SERIAL PRIMARY KEY,
        news_id INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,
        name VARCHAR(500) NOT NULL,
        file_url VARCHAR(2048) NOT NULL,
        file_size BIGINT,
        mime_type VARCHAR(120),
        folder_id INTEGER REFERENCES doc_folders(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE news_attachments
      ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES doc_folders(id) ON DELETE SET NULL
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_news_att ON news_attachments (news_id)');
    console.log('news_attachments OK');
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  } finally {
    pool.end();
  }
})();
