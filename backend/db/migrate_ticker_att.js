require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('./index');

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticker_attachments (
        id SERIAL PRIMARY KEY,
        ticker_id INTEGER NOT NULL REFERENCES ticker_messages(id) ON DELETE CASCADE,
        name VARCHAR(500) NOT NULL,
        file_url VARCHAR(2048) NOT NULL,
        file_size BIGINT,
        mime_type VARCHAR(120),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_ticker_att ON ticker_attachments (ticker_id)');
    console.log('ticker_attachments OK');
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  } finally {
    pool.end();
  }
})();
