const { pool } = require('./index');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Adding folder_id to ticker_attachments...');
    
    await client.query(`
      ALTER TABLE ticker_attachments 
      ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES doc_folders(id) ON DELETE SET NULL
    `);
    
    console.log('✓ Migration completed successfully');
  } catch (err) {
    console.error('✗ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
