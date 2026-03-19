/**
 * /api/ticker – CRUD ticker správ
 */

const express = require('express');
const { query } = require('../db');
const { requireAuth, requireEditor } = require('../middleware/auth');

const router  = express.Router();
const DAY_MS  = 24 * 60 * 60 * 1000;
const PURGE_DAYS = 30; // auto-delete po 30 dňoch od expirácie

// GET /api/ticker – všetky správy (aktívne aj expirované)
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT t.id, t.text, t.link_url, t.expires_at, t.expires_days,
             t.created_at, t.updated_at,
             u.display_name AS author,
             COALESCE(
               (SELECT json_agg(json_build_object(
                  'id', a.id, 'name', a.name, 'url', a.file_url,
                  'size', a.file_size, 'mime_type', a.mime_type
                ) ORDER BY a.id)
                FROM ticker_attachments a WHERE a.ticker_id = t.id),
               '[]'::json
             ) AS attachments
      FROM ticker_messages t
      LEFT JOIN users u ON u.id = t.created_by
      ORDER BY t.created_at DESC
      LIMIT 200
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Nepodarilo sa načítať ticker správy.' });
  }
});

// POST /api/ticker (editor+)
router.post('/', requireAuth, requireEditor, async (req, res) => {
  const { text, link_url, expires_days, attachments } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Povinné pole: text.' });

  let expires_at = null;
  if (expires_days && parseInt(expires_days) > 0) {
    expires_at = new Date(Date.now() + parseInt(expires_days) * DAY_MS).toISOString();
  }

  try {
    const result = await query(`
      INSERT INTO ticker_messages (text, link_url, expires_days, expires_at, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [text.trim(), link_url || null, expires_days || null, expires_at, req.user.id]);
    const tickerId = result.rows[0].id;
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (const att of attachments) {
        await query(
          `INSERT INTO ticker_attachments (ticker_id, name, file_url, file_size, mime_type)
           VALUES ($1, $2, $3, $4, $5)`,
          [tickerId, att.name, att.url, att.size || null, att.mime_type || null]
        );
      }
    }
    res.status(201).json({ ...result.rows[0], attachments: attachments || [] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Nepodarilo sa uložiť správu.' });
  }
});

// PATCH /api/ticker/:id (editor+)
router.patch('/:id', requireAuth, requireEditor, async (req, res) => {
  const { text, link_url, expires_days, attachments } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Povinné pole: text.' });

  let expires_at = null;
  if (expires_days && parseInt(expires_days) > 0) {
    expires_at = new Date(Date.now() + parseInt(expires_days) * DAY_MS).toISOString();
  }

  try {
    const result = await query(`
      UPDATE ticker_messages
      SET text=$1, link_url=$2, expires_days=$3, expires_at=$4, updated_at=NOW()
      WHERE id=$5
      RETURNING *
    `, [text.trim(), link_url || null, expires_days || null, expires_at, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Správa nenájdená.' });
    if (Array.isArray(attachments)) {
      await query('DELETE FROM ticker_attachments WHERE ticker_id = $1', [req.params.id]);
      for (const att of attachments) {
        await query(
          `INSERT INTO ticker_attachments (ticker_id, name, file_url, file_size, mime_type)
           VALUES ($1, $2, $3, $4, $5)`,
          [req.params.id, att.name, att.url, att.size || null, att.mime_type || null]
        );
      }
    }
    res.json({ ...result.rows[0], attachments: attachments || [] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Chyba.' });
  }
});

// DELETE /api/ticker/:id (editor+)
router.delete('/:id', requireAuth, requireEditor, async (req, res) => {
  await query('DELETE FROM ticker_messages WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

// DELETE /api/ticker/purge – zmaže expirované staršie ako 30 dní (admin)
router.delete('/purge', requireAuth, async (req, res) => {
  try {
    const result = await query(`
      DELETE FROM ticker_messages
      WHERE expires_at IS NOT NULL
        AND expires_at < NOW() - INTERVAL '${PURGE_DAYS} days'
    `);
    res.json({ deleted: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Chyba.' });
  }
});

module.exports = router;
