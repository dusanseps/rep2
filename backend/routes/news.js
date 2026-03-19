/**
 * /api/news – CRUD noviniek
 */

const express = require('express');
const { query } = require('../db');
const { requireAuth, requireEditor } = require('../middleware/auth');
const { notifyTeams } = require('../services/teams');

const router = express.Router();

// GET /api/news – zoznam publikovaných noviniek
router.get('/', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 50);
  try {
    const result = await query(`
      SELECT id, title, description, banner_image_url,
             author_name, published_at, created_at
      FROM news
      WHERE is_published = true
      ORDER BY published_at DESC
      LIMIT $1
    `, [limit]);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Nepodarilo sa načítať novinky.' });
  }
});

// GET /api/news/:id – detail novinky (vrátane content)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await query('SELECT * FROM news WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Novinka nenájdená.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Chyba.' });
  }
});

// POST /api/news (editor+)
router.post('/', requireAuth, requireEditor, async (req, res) => {
  const { title, description, content, banner_image_url, author_name, is_published, published_at } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Povinné pole: title.' });
  try {
    const result = await query(`
      INSERT INTO news (title, description, content, banner_image_url, author_name, is_published, published_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      title,
      description || null,
      content     || null,
      banner_image_url || null,
      author_name || null,
      is_published ?? true,
      published_at || new Date().toISOString(),
      req.user.id,
    ]);
    res.status(201).json(result.rows[0]);
    // Notifikácia do Teams (fire-and-forget)
    const row = result.rows[0];
    if (row.is_published) {
      notifyTeams({
        type:        'news',
        title:       row.title,
        description: row.description || '',
        author:      row.author_name || req.user.displayName || req.user.username,
      });
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Nepodarilo sa uložiť novinku.' });
  }
});

// PATCH /api/news/:id (editor+)
router.patch('/:id', requireAuth, requireEditor, async (req, res) => {
  const { title, description, content, banner_image_url, author_name, is_published, published_at } = req.body || {};
  try {
    const result = await query(`
      UPDATE news
      SET title=$1, description=$2, content=$3, banner_image_url=$4,
          author_name=$5, is_published=$6,
          published_at=COALESCE($7::timestamptz, published_at),
          updated_at=NOW()
      WHERE id=$8
      RETURNING *
    `, [title, description || null, content || null, banner_image_url || null,
        author_name || null, is_published ?? true, published_at || null, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Novinka nenájdená.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Chyba.' });
  }
});

// DELETE /api/news/:id (editor+)
router.delete('/:id', requireAuth, requireEditor, async (req, res) => {
  await query('DELETE FROM news WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
