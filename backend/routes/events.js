/**
 * /api/events – CRUD udalostí
 */

const express = require('express');
const { query } = require('../db');
const { requireAuth, requireEditor } = require('../middleware/auth');
const { notifyTeams } = require('../services/teams');

const router = express.Router();

// GET /api/events – nadchádzajúce udalosti
router.get('/', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 8, 50);
  try {
    const result = await query(`
      SELECT id, title, description, event_start, event_end, all_day, location,
             created_by, created_at
      FROM events
      WHERE event_start >= NOW() - INTERVAL '1 hour'
      ORDER BY event_start ASC
      LIMIT $1
    `, [limit]);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Nepodarilo sa načítať udalosti.' });
  }
});

// GET /api/events/all – všetky udalosti (paginovaná)
router.get('/all', requireAuth, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;
  try {
    const result = await query(`
      SELECT id, title, description, event_start, event_end, all_day, location, created_at
      FROM events
      ORDER BY event_start DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Chyba.' });
  }
});

// POST /api/events – vytvorenie udalosti (editor+)
router.post('/', requireAuth, requireEditor, async (req, res) => {
  const { title, description, event_start, event_end, all_day, location } = req.body || {};
  if (!title || !event_start) {
    return res.status(400).json({ error: 'Povinné polia: title, event_start.' });
  }
  try {
    const result = await query(`
      INSERT INTO events (title, description, event_start, event_end, all_day, location, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [title, description || null, event_start, event_end || null, all_day ?? true, location || null, req.user.id]);
    res.status(201).json(result.rows[0]);
    // Notifikácia do Teams (fire-and-forget)
    const row = result.rows[0];
    const startStr = row.event_start
      ? new Date(row.event_start).toLocaleDateString('sk-SK', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    notifyTeams({
      type:        'event',
      title:       row.title,
      description: row.description || '',
      author:      req.user.displayName || req.user.username,
      date:        startStr,
      location:    row.location || '',
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Nepodarilo sa vytvoriť udalosť.' });
  }
});

// PATCH /api/events/:id – úprava udalosti (editor+)
router.patch('/:id', requireAuth, requireEditor, async (req, res) => {
  const { title, description, event_start, event_end, all_day, location } = req.body || {};
  try {
    const result = await query(`
      UPDATE events
      SET title=$1, description=$2, event_start=$3, event_end=$4, all_day=$5, location=$6, updated_at=NOW()
      WHERE id=$7
      RETURNING *
    `, [title, description || null, event_start, event_end || null, all_day ?? true, location || null, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Udalosť nenájdená.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Chyba.' });
  }
});

// DELETE /api/events/:id (editor+)
router.delete('/:id', requireAuth, requireEditor, async (req, res) => {
  await query('DELETE FROM events WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
