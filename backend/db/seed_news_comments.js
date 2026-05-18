/**
 * seed_news_comments.js – naplnenie testovacich komentarov k novinkam
 * Spustenie: node ./db/seed_news_comments.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('./index');

async function seedNewsComments() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query(
      `SELECT id, username, display_name
       FROM users
       WHERE is_active = true
       ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id
       LIMIT 3`
    );
    const users = userRes.rows;

    if (users.length === 0) {
      throw new Error('V databaze nie su ziadni aktivni pouzivatelia.');
    }

    const newsRes = await client.query(
      `SELECT id, title
       FROM news
       ORDER BY created_at DESC
       LIMIT 2`
    );
    const newsRows = newsRes.rows;

    if (newsRows.length === 0) {
      throw new Error('V databaze nie su ziadne novinky. Najprv spustite seed.js.');
    }

    for (const n of newsRows) {
      await client.query('DELETE FROM news_comments WHERE news_id = $1', [n.id]);

      const firstAuthor = users[0];
      const secondAuthor = users[Math.min(1, users.length - 1)];
      const thirdAuthor = users[Math.min(2, users.length - 1)];

      const top1 = await client.query(
        `INSERT INTO news_comments (news_id, content, created_by)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [
          n.id,
          `Dakujem za informaciu k novinke \"${n.title}\". Potvrdzujem, ze dokumenty su uz dostupne.`,
          firstAuthor.id,
        ]
      );

      await client.query(
        `INSERT INTO news_comments (news_id, parent_comment_id, content, created_by, edited_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours')`,
        [
          n.id,
          top1.rows[0].id,
          'Super, diky za potvrdenie. Ak najdete nepresnosti, doplnte prosim feedback sem do vlakna.',
          secondAuthor.id,
        ]
      );

      await client.query(
        `INSERT INTO news_comments (news_id, content, created_by)
         VALUES ($1, $2, $3)`,
        [
          n.id,
          'Bolo by mozne doplnit aj kratke zhrnutie dopadov na prevadzku? Dakujem.',
          thirdAuthor.id,
        ]
      );
    }

    await client.query('COMMIT');
    console.log('✓ Seed komentarov k novinkam dokonceny.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed komentarov zlyhal:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seedNewsComments();
