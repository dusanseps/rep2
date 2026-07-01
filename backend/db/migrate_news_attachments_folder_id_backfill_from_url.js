require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('./index');

(async () => {
  try {
    console.log('Backfilling news_attachments.folder_id from /uploads/documents/<slug-id>/... URL segment...');

    const result = await pool.query(`
      WITH parsed AS (
        SELECT
          na.id,
          substring(na.file_url from '/uploads/documents/([^/]+)/') AS folder_segment
        FROM news_attachments na
        WHERE na.folder_id IS NULL
          AND na.file_url LIKE '/uploads/documents/%'
      ),
      mapped AS (
        SELECT
          p.id,
          f.id AS folder_id
        FROM parsed p
        JOIN doc_folders f
          ON f.id::text = substring(p.folder_segment from '([0-9]+)$')
      )
      UPDATE news_attachments na
      SET folder_id = m.folder_id
      FROM mapped m
      WHERE na.id = m.id
      RETURNING na.id
    `);

    console.log(`Backfill from URL complete. Updated rows: ${result.rowCount}`);
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  } finally {
    pool.end();
  }
})();
