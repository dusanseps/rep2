/**
 * /api/events – CRUD udalostí
 */

const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notifyTeams } = require('../services/teams');

const router = express.Router();

const sseClients = new Set();

function isAdminOrEditor(user) {
  return user?.role === 'admin' || user?.role === 'editor';
}

function broadcastEventsUpdate(type, eventItem) {
  const data = JSON.stringify({ type, item: eventItem });
  sseClients.forEach((res) => {
    try {
      res.write(`data: ${data}\n\n`);
    } catch (_err) {
      sseClients.delete(res);
    }
  });
}

router.get('/subscribe', requireAuth, (req, res) => {
  console.log('[Events SSE] Client connected');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  sseClients.add(res);
  res.write(':connected\n\n');

  const keepAliveInterval = setInterval(() => {
    try {
      res.write(':\n\n');
    } catch (_err) {
      clearInterval(keepAliveInterval);
      sseClients.delete(res);
    }
  }, 30000);

  req.on('close', () => {
    console.log('[Events SSE] Client disconnected');
    clearInterval(keepAliveInterval);
    sseClients.delete(res);
  });
});

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
      SELECT id, title, description, event_start, event_end, all_day, location, created_at, created_by
      FROM events
      ORDER BY event_start DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Chyba.' });
  }
});

// POST /api/events – vytvorenie udalosti (všetci prihlásení používatelia)
router.post('/', requireAuth, async (req, res) => {
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
    const created = result.rows[0];
    res.status(201).json(created);
    broadcastEventsUpdate('create', created);
    // Notifikácia do Teams (fire-and-forget)
    const row = created;
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

// PATCH /api/events/:id – úprava udalosti (vlastník alebo admin/editor)
router.patch('/:id', requireAuth, async (req, res) => {
  const { title, description, event_start, event_end, all_day, location } = req.body || {};
  try {
    const ownerCheck = await query('SELECT created_by FROM events WHERE id = $1', [req.params.id]);
    if (!ownerCheck.rows[0]) return res.status(404).json({ error: 'Udalosť nenájdená.' });

    const isOwner = ownerCheck.rows[0].created_by === req.user.id;
    if (!isOwner && !isAdminOrEditor(req.user)) {
      return res.status(403).json({ error: 'Nemáte oprávnenie upraviť túto udalosť.' });
    }

    const result = await query(`
      UPDATE events
      SET title=$1, description=$2, event_start=$3, event_end=$4, all_day=$5, location=$6, updated_at=NOW()
      WHERE id=$7
      RETURNING *
    `, [title, description || null, event_start, event_end || null, all_day ?? true, location || null, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Udalosť nenájdená.' });
    const updated = result.rows[0];
    res.json(updated);
    broadcastEventsUpdate('update', updated);
  } catch (err) {
    res.status(500).json({ error: 'Chyba.' });
  }
});

// DELETE /api/events/:id (vlastník alebo admin/editor)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const ownerCheck = await query('SELECT created_by FROM events WHERE id = $1', [req.params.id]);
    if (!ownerCheck.rows[0]) return res.status(404).json({ error: 'Udalosť nenájdená.' });

    const isOwner = ownerCheck.rows[0].created_by === req.user.id;
    if (!isOwner && !isAdminOrEditor(req.user)) {
      return res.status(403).json({ error: 'Nemáte oprávnenie zmazať túto udalosť.' });
    }

    await query('DELETE FROM events WHERE id = $1', [req.params.id]);
    broadcastEventsUpdate('delete', { id: req.params.id });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'Chyba.' });
  }
});

module.exports = router;
