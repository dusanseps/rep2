require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('./index');

(async () => {
  try {
    console.log('Backfilling news_attachments.folder_id from doc_files.file_url...');

    const result = await pool.query(`
      WITH candidates AS (
        SELECT
          na.id AS news_attachment_id,
          MIN(df.folder_id) AS folder_id
        FROM news_attachments na
        JOIN doc_files df ON df.file_url = na.file_url
        WHERE na.folder_id IS NULL
        GROUP BY na.id
      )
      UPDATE news_attachments na
      SET folder_id = c.folder_id
      FROM candidates c
      WHERE na.id = c.news_attachment_id
      RETURNING na.id
    `);

    console.log(`Backfill complete. Updated rows: ${result.rowCount}`);
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  } finally {
    pool.end();
  }
})();
