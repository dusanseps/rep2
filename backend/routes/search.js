const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { searchDocuments } = require('../services/meili');

/**
 * Sanitizuje snippet z Meilisearch – ponechá len bezpečné <em class="hl"> tagy.
 * Ostatné HTML znaky sú escapované.
 */
function sanitizeSnippet(raw) {
  if (!raw) return '';
  // Nahradíme naše bezpečné HL tagy sentinelmi, escapujeme HTML, obnovíme tagy
  return String(raw)
    .split('<em class="hl">').join('\x01')
    .split('</em>').join('\x02')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .split('\x01').join('<em class="hl">')
    .split('\x02').join('</em>');
}

// Unified search endpoint
router.get('/', requireAuth, async (req, res) => {
  const rawQuery = String(req.query.query || '').trim();
  if (!rawQuery) {
    return res.status(400).json({ error: 'Search query is required' });
  }
  if (rawQuery.length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters.' });
  }

  try {
    // ── Novinky ──────────────────────────────────────────────────────────────
    const newsResults = await db.query(
      `SELECT id, title, content, 'news' AS type
       FROM news
       WHERE to_tsvector('simple', title || ' ' || COALESCE(content,'')) @@ plainto_tsquery('simple', $1)
       OR LOWER(title || ' ' || COALESCE(content,'')) LIKE LOWER($2)
       LIMIT 10`,
      [rawQuery, `%${rawQuery}%`]
    );

    // ── Udalosti ─────────────────────────────────────────────────────────────
    const eventsResults = await db.query(
      `SELECT id, title, description AS content, 'events' AS type
       FROM events
       WHERE to_tsvector('simple', title || ' ' || COALESCE(description,'')) @@ plainto_tsquery('simple', $1)
       OR LOWER(title || ' ' || COALESCE(description,'')) LIKE LOWER($2)
       LIMIT 10`,
      [rawQuery, `%${rawQuery}%`]
    );

    // ── Dokumenty (Meilisearch) ───────────────────────────────────────────────
    // Aktuálne pravidlo v app: každý prihlásený používateľ môže dokumenty čítať.
    const docHits = await searchDocuments(rawQuery, { accessibleFolderIds: null, limit: 10 });

    // ── Dopĺňanie file_urls z DB ──────────────────────────────────────────────
    let fileUrls = {};
    if (docHits.length > 0) {
      const docIds = docHits
        .map((h) => Number(h.fileId))
        .filter((id) => Number.isInteger(id) && id > 0);
      if (docIds.length === 0) {
        return res.json([]);
      }
      const urlRows = await db.query(
        `SELECT id, file_url FROM doc_files WHERE id = ANY($1)`,
        [docIds]
      );
      fileUrls = Object.fromEntries(
        urlRows.rows.map((r) => [r.id, r.file_url])
      );
    }

    // ── Kombinovanie výsledkov ────────────────────────────────────────────────
    const results = [
      ...newsResults.rows.map((row) => ({
        id: String(row.id),
        type: 'news',
        title: row.title,
        snippet: String(row.content || '').substring(0, 200),
        path: `Novinky`,
        href: `/novinky?view=${row.id}`,
      })),
      ...eventsResults.rows.map((row) => ({
        id: String(row.id),
        type: 'events',
        title: row.title,
        snippet: String(row.content || '').substring(0, 200),
        path: `Udalosti`,
        href: `/udalosti?view=${row.id}`,
      })),
      ...docHits.map((hit) => ({
        id: `doc_${hit.fileId}`,
        type: 'document',
        title: hit.name,
        snippet: sanitizeSnippet(hit.snippet),
        path: hit.folderPath ? `Dokumenty / ${hit.folderPath}` : 'Dokumenty',
        href: '/dokumenty',
        mimeType: hit.mimeType || '',
        file_url: fileUrls[hit.fileId] || '',
      })),
    ];

    res.json(results);
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
