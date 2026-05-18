/**
 * /api/news – CRUD noviniek + SSE real-time updates
 */

const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notifyTeams } = require('../services/teams');
const { isSafeUrl, normalizeTextInput } = require('../utils/security');

const router = express.Router();

// SSE klienti pripojení na real-time updaty
const sseClients = new Set();

function isEditorOrAdmin(user) {
  return user?.role === 'admin' || user?.role === 'editor';
}

async function findNewsById(newsId) {
  const result = await query(
    `SELECT id, is_published, created_by
     FROM news
     WHERE id = $1`,
    [newsId]
  );
  return result.rows[0] || null;
}

function canReadNews(user, newsRow) {
  return Boolean(newsRow);
}

function mapNewsCommentRow(r, currentUser) {
  const createdById = Number(r.created_by);
  const isAuthor = createdById === Number(currentUser?.id);
  const isAdmin = currentUser?.role === 'admin';
  return {
    id: r.id,
    news_id: r.news_id,
    parent_comment_id: r.parent_comment_id,
    content: r.content,
    created_by: r.created_by,
    author_name: r.author_name || r.author_username || 'Neznámy používateľ',
    created_at: r.created_at,
    edited_at: r.edited_at,
    updated_at: r.updated_at,
    parent_preview: r.parent_preview || null,
    can_edit: isAuthor,
    can_delete: isAuthor || isAdmin,
  };
}

// Broadcast novinku všetkým SSE klientom
function broadcastNewsUpdate(type, newsItem) {
  const data = JSON.stringify({ type, item: newsItem });
  sseClients.forEach(res => {
    try {
      res.write(`data: ${data}\n\n`);
    } catch (err) {
      console.warn('[SSE broadcast failed]', err.message);
      sseClients.delete(res);
    }
  });
}

async function replaceAttachments(newsId, attachments) {
  await query('DELETE FROM news_attachments WHERE news_id = $1', [newsId]);
  for (const att of attachments) {
    await query(
      `INSERT INTO news_attachments (news_id, name, file_url, file_size, mime_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [newsId, att.name, att.url, att.size || null, att.mime_type || null]
    );
  }
}

function validateNewsAttachmentUrls(attachments) {
  for (const att of attachments || []) {
    if (!isSafeUrl(att?.url)) return false;
  }
  return true;
}

// GET /api/news – user: publikované + ich drafty, editor/admin: všetky (vrátane draftov)
router.get('/', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 200);
  try {
    const result = await query(
      `SELECT n.id, n.title, n.description, n.content, n.banner_image_url,
              n.author_name, n.is_published, n.published_at, n.created_at, n.created_by,
              COALESCE(
                (SELECT json_agg(json_build_object(
                   'id', a.id, 'name', a.name, 'url', a.file_url,
                   'size', a.file_size, 'mime_type', a.mime_type
                 ) ORDER BY a.id)
                 FROM news_attachments a WHERE a.news_id = n.id),
                '[]'::json
              ) AS attachments
       FROM news n
       ORDER BY n.is_published DESC, n.published_at DESC, n.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Nepodarilo sa načítať novinky.' });
  }
});

// SSE /api/news/subscribe – Real-time updates (MUSÍ byť PRE /:id aby nebol matchnutý ako ID)
router.get('/subscribe', requireAuth, (req, res) => {
  console.log('[SSE] Client connected');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  sseClients.add(res);
  
  res.write(':connected\n\n');
  
  // Keep-alive ping každých 30 sekúnd
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(':\n\n');
    } catch (err) {
      console.warn('[SSE keep-alive ping failed]', err.message);
      clearInterval(keepAliveInterval);
      sseClients.delete(res);
    }
  }, 30000);
  
  req.on('close', () => {
    console.log('[SSE] Client disconnected');
    clearInterval(keepAliveInterval);
    sseClients.delete(res);
  });
});

// GET /api/news/:id/comments – diskusia pod novinkou
router.get('/:id/comments', requireAuth, async (req, res) => {
  try {
    const newsRow = await findNewsById(req.params.id);
    if (!newsRow) return res.status(404).json({ error: 'Novinka nenájdená.' });
    if (!canReadNews(req.user, newsRow)) {
      return res.status(403).json({ error: 'Nemáte oprávnenie zobraziť diskusiu k tejto novinke.' });
    }

    const result = await query(
      `SELECT c.id, c.news_id, c.parent_comment_id, c.content, c.created_by,
              c.created_at, c.edited_at, c.updated_at,
              u.display_name AS author_name, u.username AS author_username,
              parent.content AS parent_preview
       FROM news_comments c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN news_comments parent ON parent.id = c.parent_comment_id
       WHERE c.news_id = $1
       ORDER BY c.created_at DESC, c.id DESC`,
      [req.params.id]
    );

    res.json(result.rows.map((r) => mapNewsCommentRow(r, req.user)));
  } catch (err) {
    console.error('[News comments list] Error:', err.message);
    res.status(500).json({ error: 'Nepodarilo sa načítať komentáre.' });
  }
});

// POST /api/news/:id/comments – pridanie komentára/odpovede
router.post('/:id/comments', requireAuth, async (req, res) => {
  const content = normalizeTextInput(req.body?.content, { maxLength: 4000 });
  const parentCommentId = req.body?.parent_comment_id == null ? null : Number(req.body.parent_comment_id);

  if (!content) return res.status(400).json({ error: 'Komentár nemôže byť prázdny.' });
  if (content.length > 4000) return res.status(400).json({ error: 'Komentár je príliš dlhý (max 4000 znakov).' });
  if (parentCommentId != null && (!Number.isInteger(parentCommentId) || parentCommentId <= 0)) {
    return res.status(400).json({ error: 'Neplatný parent komentár.' });
  }

  try {
    const newsRow = await findNewsById(req.params.id);
    if (!newsRow) return res.status(404).json({ error: 'Novinka nenájdená.' });
    if (!canReadNews(req.user, newsRow)) {
      return res.status(403).json({ error: 'Nemáte oprávnenie komentovať túto novinku.' });
    }

    if (parentCommentId != null) {
      const parent = await query(
        `SELECT id, news_id
         FROM news_comments
         WHERE id = $1`,
        [parentCommentId]
      );
      if (!parent.rows[0] || Number(parent.rows[0].news_id) !== Number(req.params.id)) {
        return res.status(400).json({ error: 'Komentár, na ktorý odpovedáte, neexistuje.' });
      }
    }

    const inserted = await query(
      `INSERT INTO news_comments (news_id, parent_comment_id, content, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [req.params.id, parentCommentId, content, req.user.id]
    );

    const fullRow = await query(
      `SELECT c.id, c.news_id, c.parent_comment_id, c.content, c.created_by,
              c.created_at, c.edited_at, c.updated_at,
              u.display_name AS author_name, u.username AS author_username,
              parent.content AS parent_preview
       FROM news_comments c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN news_comments parent ON parent.id = c.parent_comment_id
       WHERE c.id = $1`,
      [inserted.rows[0].id]
    );

    const responseData = mapNewsCommentRow(fullRow.rows[0], req.user);
    res.status(201).json(responseData);
    broadcastNewsUpdate('comment_create', {
      newsId: Number(req.params.id),
      commentId: responseData.id,
    });
  } catch (err) {
    console.error('[News comments create] Error:', err.message);
    res.status(500).json({ error: 'Nepodarilo sa uložiť komentár.' });
  }
});

// PATCH /api/news/:id/comments/:commentId – editácia vlastného komentára
router.patch('/:id/comments/:commentId', requireAuth, async (req, res) => {
  const content = normalizeTextInput(req.body?.content, { maxLength: 4000 });
  if (!content) return res.status(400).json({ error: 'Komentár nemôže byť prázdny.' });
  if (content.length > 4000) return res.status(400).json({ error: 'Komentár je príliš dlhý (max 4000 znakov).' });

  try {
    const newsRow = await findNewsById(req.params.id);
    if (!newsRow) return res.status(404).json({ error: 'Novinka nenájdená.' });
    if (!canReadNews(req.user, newsRow)) {
      return res.status(403).json({ error: 'Nemáte oprávnenie upraviť komentár pri tejto novinke.' });
    }

    const existing = await query(
      `SELECT id, news_id, created_by
       FROM news_comments
       WHERE id = $1`,
      [req.params.commentId]
    );
    const row = existing.rows[0];
    if (!row || Number(row.news_id) !== Number(req.params.id)) {
      return res.status(404).json({ error: 'Komentár nenájdený.' });
    }

    if (Number(row.created_by) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Môžete upraviť iba vlastný komentár.' });
    }

    await query(
      `UPDATE news_comments
       SET content = $1,
           edited_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [content, req.params.commentId]
    );

    const updated = await query(
      `SELECT c.id, c.news_id, c.parent_comment_id, c.content, c.created_by,
              c.created_at, c.edited_at, c.updated_at,
              u.display_name AS author_name, u.username AS author_username,
              parent.content AS parent_preview
       FROM news_comments c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN news_comments parent ON parent.id = c.parent_comment_id
       WHERE c.id = $1`,
      [req.params.commentId]
    );

    const responseData = mapNewsCommentRow(updated.rows[0], req.user);
    res.json(responseData);
    broadcastNewsUpdate('comment_update', {
      newsId: Number(req.params.id),
      commentId: responseData.id,
    });
  } catch (err) {
    console.error('[News comments update] Error:', err.message);
    res.status(500).json({ error: 'Nepodarilo sa upraviť komentár.' });
  }
});

// DELETE /api/news/:id/comments/:commentId – admin všetky, user iba vlastné
router.delete('/:id/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const newsRow = await findNewsById(req.params.id);
    if (!newsRow) return res.status(404).json({ error: 'Novinka nenájdená.' });
    if (!canReadNews(req.user, newsRow)) {
      return res.status(403).json({ error: 'Nemáte oprávnenie mazať komentáre pri tejto novinke.' });
    }

    const existing = await query(
      `SELECT id, news_id, created_by
       FROM news_comments
       WHERE id = $1`,
      [req.params.commentId]
    );
    const row = existing.rows[0];
    if (!row || Number(row.news_id) !== Number(req.params.id)) {
      return res.status(404).json({ error: 'Komentár nenájdený.' });
    }

    const isOwner = Number(row.created_by) === Number(req.user.id);
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Môžete zmazať iba vlastný komentár.' });
    }

    await query('DELETE FROM news_comments WHERE id = $1', [req.params.commentId]);
    broadcastNewsUpdate('comment_delete', {
      newsId: Number(req.params.id),
      commentId: Number(req.params.commentId),
    });
    res.status(204).end();
  } catch (err) {
    console.error('[News comments delete] Error:', err.message);
    res.status(500).json({ error: 'Nepodarilo sa zmazať komentár.' });
  }
});

// GET /api/news/:id – detail novinky (vrátane content)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT n.*, COALESCE(
          (SELECT json_agg(json_build_object(
             'id', a.id, 'name', a.name, 'url', a.file_url,
             'size', a.file_size, 'mime_type', a.mime_type
           ) ORDER BY a.id)
           FROM news_attachments a WHERE a.news_id = n.id),
          '[]'::json
        ) AS attachments
       FROM news n
       WHERE n.id = $1`,
      [req.params.id]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Novinka nenájdená.' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Chyba.' });
  }
});

// POST /api/news – ALL authenticated users
router.post('/', requireAuth, async (req, res) => {
  const { title, description, content, banner_image_url, author_name, is_published, published_at, attachments } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Povinné pole: title.' });
  if (!isSafeUrl(banner_image_url)) {
    return res.status(400).json({ error: 'Neplatný banner_image_url.' });
  }
  if (!validateNewsAttachmentUrls(attachments || [])) {
    return res.status(400).json({ error: 'Neplatný URL odkaz v prílohách.' });
  }
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
      published_at || (is_published === false ? null : new Date().toISOString()),
      req.user.id,
    ]);
    const row = result.rows[0];
    const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
    if (normalizedAttachments.length > 0) {
      await replaceAttachments(row.id, normalizedAttachments);
    }

    const withAttachments = await query(
      `SELECT n.*, COALESCE(
          (SELECT json_agg(json_build_object(
             'id', a.id, 'name', a.name, 'url', a.file_url,
             'size', a.file_size, 'mime_type', a.mime_type
           ) ORDER BY a.id)
           FROM news_attachments a WHERE a.news_id = n.id),
          '[]'::json
        ) AS attachments
       FROM news n
       WHERE n.id = $1`,
      [row.id]
    );

    const responseData = withAttachments.rows[0];
    res.status(201).json(responseData);
    broadcastNewsUpdate('create', responseData);
    // Notifikácia do Teams (fire-and-forget)
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

// PATCH /api/news/:id – Owner or Admin only
router.patch('/:id', requireAuth, async (req, res) => {
  const { title, description, content, banner_image_url, author_name, is_published, published_at, attachments } = req.body || {};
  if (!isSafeUrl(banner_image_url)) {
    return res.status(400).json({ error: 'Neplatný banner_image_url.' });
  }
  if (Array.isArray(attachments) && !validateNewsAttachmentUrls(attachments)) {
    return res.status(400).json({ error: 'Neplatný URL odkaz v prílohách.' });
  }
  try {
    // Check ownership: owner or admin can edit
    const ownerCheck = await query('SELECT created_by FROM news WHERE id = $1', [req.params.id]);
    if (!ownerCheck.rows[0]) return res.status(404).json({ error: 'Novinka nenájdená.' });
    const isOwner = ownerCheck.rows[0].created_by === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Nemáte oprávnenie upraviť túto novinku.' });

    // ✅ Spravená logika: ak je is_published true, published_at = NOW(); ak false, published_at = NULL
    const newPublishedAt = is_published ? (published_at || new Date().toISOString()) : null;

    const result = await query(`
      UPDATE news
      SET title=$1, description=$2, content=$3, banner_image_url=$4,
          author_name=$5, is_published=$6,
          published_at=$7,
          updated_at=NOW()
      WHERE id=$8
      RETURNING *
    `, [
      title,
      description || null,
      content || null,
      banner_image_url || null,
      author_name || null,
      is_published === true,
      newPublishedAt,
      req.params.id,
    ]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Novinka nenájdená.' });

    if (Array.isArray(attachments)) {
      await replaceAttachments(req.params.id, attachments);
    }

    const withAttachments = await query(
      `SELECT n.*, COALESCE(
          (SELECT json_agg(json_build_object(
             'id', a.id, 'name', a.name, 'url', a.file_url,
             'size', a.file_size, 'mime_type', a.mime_type
           ) ORDER BY a.id)
           FROM news_attachments a WHERE a.news_id = n.id),
          '[]'::json
        ) AS attachments
       FROM news n
       WHERE n.id = $1`,
      [req.params.id]
    );
    const responseData = withAttachments.rows[0];
    res.json(responseData);
    broadcastNewsUpdate('update', responseData);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Chyba.' });
  }
});

// DELETE /api/news/:id – Owner or Admin only
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    // Check ownership: owner or admin can delete
    const ownerCheck = await query('SELECT created_by FROM news WHERE id = $1', [req.params.id]);
    if (!ownerCheck.rows[0]) return res.status(404).json({ error: 'Novinka nenájdená.' });
    const isOwner = ownerCheck.rows[0].created_by === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Nemáte oprávnenie zmazať túto novinku.' });

    await query('DELETE FROM news WHERE id = $1', [req.params.id]);
    broadcastNewsUpdate('delete', { id: req.params.id });
    res.status(204).end();
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Chyba pri mazaní.' });
  }
});

module.exports = router;
