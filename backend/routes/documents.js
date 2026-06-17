/**
 * /api/documents – správa priečinkov a súborov dokumentov
 */
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const fs      = require('fs');
const { query, pool } = require('../db');
const { requireAuth, requireEditor, requireAdmin } = require('../middleware/auth');
const { extractText } = require('../services/textExtract');
const { getStatus, reconnectNow, indexDocument } = require('../services/meili');
const { isSameOriginRequest } = require('../utils/security');
const logger  = require('../utils/logger');

const router = express.Router();

// SSE klienti pripojení na real-time updaty
const sseClients = new Set();

function broadcastDocumentsUpdate(type, payload = {}) {
  const data = JSON.stringify({ type, ...payload });
  sseClients.forEach(res => {
    try {
      res.write(`data: ${data}\n\n`);
    } catch (_) {
      sseClients.delete(res);
    }
  });
}

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const DOCS_ROOT_PREFIX = 'documents';
const ALLOWED_EXT = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.zip', '.rar', '.7z',
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg', '.tif', '.tiff',
  '.msg', '.eml', '.odt', '.ods', '.odp', '.rtf', '.xml', '.json', '.md',
];

function isElevatedUser(user) {
  return user?.role === 'admin' || user?.role === 'editor';
}

async function userHasFolderAccess(userId, folderId) {
  const folder = Number(folderId);
  if (!Number.isInteger(folder) || folder <= 0) return false;

  const { rows } = await query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id
       FROM doc_folders
       WHERE id = $1
       UNION ALL
       SELECT f.id, f.parent_id
       FROM doc_folders f
       JOIN ancestors a ON a.parent_id = f.id
     )
     SELECT 1
     FROM ancestors a
     JOIN user_folder_permissions p ON p.root_folder_id = a.id
     WHERE p.user_id = $2
     LIMIT 1`,
    [folder, userId]
  );

  return Boolean(rows[0]);
}

async function listManageableFolderIds(userId) {
  const { rows } = await query(
    `WITH RECURSIVE allowed AS (
       SELECT f.id
       FROM doc_folders f
       JOIN user_folder_permissions p ON p.root_folder_id = f.id
       WHERE p.user_id = $1

       UNION ALL

       SELECT c.id
       FROM doc_folders c
       JOIN allowed a ON c.parent_id = a.id
     )
     SELECT id FROM allowed`,
    [userId]
  );

  return new Set(rows.map((r) => Number(r.id)));
}

async function assertWriteAccess(req, res, folderId) {
  if (isElevatedUser(req.user)) return true;

  // Zistíme či je priečinok root
  const { rows } = await query(
    'SELECT parent_id FROM doc_folders WHERE id = $1',
    [folderId]
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'Priečinok neexistuje.' });
    return false;
  }
  
  // Skontrolujeme prístup (platí aj pre root priečinky)
  const hasAccess = await userHasFolderAccess(req.user.id, folderId);
  if (!hasAccess) {
    res.status(403).json({ error: 'Nemáte oprávnenie pre tento priečinok.' });
    return false;
  }

  return true;
}

function slugifySegment(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'folder';
}

async function getFolderNode(folderId) {
  const { rows } = await query('SELECT id, parent_id, name FROM doc_folders WHERE id = $1', [folderId]);
  return rows[0] || null;
}

async function resolveFolderPath(folderId) {
  const segments = [];
  let currentId = Number(folderId);

  while (Number.isFinite(currentId)) {
    const row = await getFolderNode(currentId);
    if (!row) break;
    segments.unshift(`${slugifySegment(row.name)}-${row.id}`);
    currentId = row.parent_id ? Number(row.parent_id) : NaN;
  }

  if (segments.length === 0) {
    return null; // Priečinok nenájdený
  }

  return path.join(DOCS_ROOT_PREFIX, ...segments);
}

function urlToUploadPath(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string' || !fileUrl.startsWith('/uploads/')) return null;
  const rel = decodeURIComponent(fileUrl.replace(/^\/uploads\//, ''));
  const normalized = path.normalize(rel).replace(/^([.][.][\/\\])+/, '');
  if (normalized.startsWith('..')) return null;
  return path.join(UPLOAD_DIR, normalized);
}

function normalizeRequestedFileName(name, fallbackName) {
  const raw = String(name || '').trim();
  if (!raw) return String(fallbackName || '').trim();
  return raw.replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim();
}

function buildSuggestedName(baseName) {
  const clean = String(baseName || '').trim();
  if (!clean) return 'subor (1)';
  const ext = path.extname(clean);
  const stem = ext ? clean.slice(0, -ext.length) : clean;
  const m = stem.match(/\s*\((\d+)\)$/);
  if (!m) return `${stem} (1)${ext}`;
  const next = Number(m[1]) + 1;
  return `${stem.replace(/\s*\(\d+\)$/, '')} (${next})${ext}`;
}

function removeUploadedTempFile(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}

const docStorage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    try {
      const folderId = req.params.id;
      const relativeDir = await resolveFolderPath(folderId);
      if (!relativeDir) {
        return cb(new Error('FOLDER_NOT_FOUND'));
      }
      const absoluteDir = path.join(UPLOAD_DIR, relativeDir);
      fs.mkdirSync(absoluteDir, { recursive: true });
      cb(null, absoluteDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const hash = crypto.randomBytes(12).toString('hex');
    cb(null, `${Date.now()}-${hash}${ext}`);
  },
});
const uploadDoc = multer({
  storage: docStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const blockedMime = [
      'application/x-msdownload',
      'application/x-sh',
      'text/x-php',
      'application/x-httpd-php',
    ];
    const mime = String(file.mimetype || '').toLowerCase();
    const allowed = ALLOWED_EXT.includes(ext) && Boolean(mime) && !blockedMime.includes(mime);
    allowed ? cb(null, true) : cb(new Error('Nepodporovaný formát.'));
  },
});

// ── GET /api/documents/subscribe – SSE real-time updates ──────────────────
router.get('/subscribe', requireAuth, (req, res) => {
  if (!isSameOriginRequest(req)) {
    return res.status(403).json({ error: 'Zamietnutý cross-origin request.' });
  }
  logger.http('DOCUMENTS_SSE_CONNECT', { userId: req.user.id, username: req.user.username });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  sseClients.add(res);
  res.write(':connected\n\n');
  const keepAliveInterval = setInterval(() => {
    try { res.write(':\n\n'); }
    catch (e) { clearInterval(keepAliveInterval); sseClients.delete(res); }
  }, 30000);
  req.on('close', () => {
    logger.http('DOCUMENTS_SSE_DISCONNECT', { userId: req.user.id, username: req.user.username });
    clearInterval(keepAliveInterval);
    sseClients.delete(res);
  });
});

// GET /api/documents/sse/stats - diagnostika SSE (admin)
router.get('/sse/stats', requireAuth, requireAdmin, (_req, res) => {
  res.json({ clients: sseClients.size, channel: 'documents' });
});

// ── GET /api/documents/tree – celý strom priečinkov ─────────────────────────
router.get('/tree', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        f.id,
        f.parent_id,
        f.name,
        f.description,
        f.sort_order,
        COALESCE(COUNT(df.id), 0)::int AS file_count
      FROM doc_folders f
      LEFT JOIN doc_files df ON df.folder_id = f.id
      GROUP BY f.id, f.parent_id, f.name, f.description, f.sort_order
      ORDER BY COALESCE(f.parent_id, 0), f.sort_order, f.name
    `);

    const manageableIds = isElevatedUser(req.user)
      ? null
      : await listManageableFolderIds(req.user.id);

    // Zostavíme strom v pamäti
    const map = {};
    const roots = [];
    for (const row of rows) {
      map[row.id] = {
        ...row,
        file_count: Number(row.file_count) || 0,
        can_manage: isElevatedUser(req.user)
          ? true
          : manageableIds.has(Number(row.id)),
        children: [],
      };
    }
    for (const row of rows) {
      if (row.parent_id && map[row.parent_id]) {
        map[row.parent_id].children.push(map[row.id]);
      } else if (!row.parent_id) {
        roots.push(map[row.id]);
      }
    }

    res.json(roots);
  } catch (err) {
    logger.error('DOCUMENTS_TREE_ERROR', { message: err.message });
    res.status(500).json({ error: 'Nepodarilo sa načítať dokumenty. Skúste prosím neskôr.' });
  }
});

// ── GET /api/documents/folders/:id/files – súbory v priečinku ───────────────
router.get('/folders/:id/files', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT f.id, f.name, f.description, f.file_url, f.file_size, f.mime_type, f.created_at,
             u.display_name AS uploaded_by_name
      FROM doc_files f
      LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.folder_id = $1
      ORDER BY f.name
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    logger.error('DOCUMENTS_FILES_ERROR', { message: err.message });
    res.status(500).json({ error: 'Nepodarilo sa načítať súbory. Skúste prosím neskôr.' });
  }
});

// ── POST /api/documents/folders – nový priečinok ────────────────────────────
router.post('/folders', requireAuth, async (req, res) => {
  const { name, parent_id, description, sort_order } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Povinné pole: name.' });
  try {
    // Koreňový priečinok môže vytvoriť iba admin
    if (!parent_id) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Iba administrátor môže vytvárať koreňové priečinky.' });
      }
    } else if (!isElevatedUser(req.user)) {
      // Podpriečinok: skontroluj oprávnenie
      const { rows: parentRows } = await query(
        'SELECT parent_id FROM doc_folders WHERE id = $1',
        [parent_id]
      );
      if (!parentRows[0]) {
        return res.status(404).json({ error: 'Nadradený priečinok neexistuje.' });
      }
      if (parentRows[0].parent_id === null) {
        // Rodič je root priečinok – povolené ak má user priradenie k tomuto root priečinku
        const hasAccess = await userHasFolderAccess(req.user.id, parent_id);
        if (!hasAccess) {
          return res.status(403).json({ error: 'Nemáte oprávnenie pre tento priečinok.' });
        }
      } else {
        const allowed = await assertWriteAccess(req, res, parent_id);
        if (!allowed) return;
      }
    }

    const { rows } = await query(`
      INSERT INTO doc_folders (name, parent_id, description, sort_order, created_by)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [name.trim(), parent_id || null, description || null, sort_order || 0, req.user.id]);
    logger.info('FOLDER_CREATE', { userId: req.user.id, username: req.user.username, folderId: rows[0].id, name: rows[0].name, parentId: rows[0].parent_id });
    broadcastDocumentsUpdate('folder_create', { folderId: rows[0].id, parentId: rows[0].parent_id });
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('FOLDER_CREATE_ERROR', { message: err.message });
    res.status(500).json({ error: 'Nepodarilo sa vytvoriť priečinok. Skúste prosím neskôr.' });
  }
});

// ── PATCH /api/documents/folders/:id ────────────────────────────────────────
router.patch('/folders/:id', requireAuth, async (req, res) => {
  const { name, description } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Povinné pole: name.' });
  try {
    const allowed = await assertWriteAccess(req, res, req.params.id);
    if (!allowed) return;
    const { rows } = await query(`
      UPDATE doc_folders SET name=$1, description=$2, updated_at=NOW()
      WHERE id=$3 RETURNING *
    `, [name.trim(), description || null, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Priečinok neexistuje.' });
    logger.info('FOLDER_UPDATE', { userId: req.user.id, username: req.user.username, folderId: Number(req.params.id), name: rows[0].name });
    broadcastDocumentsUpdate('folder_update', { folderId: Number(req.params.id) });
    res.json(rows[0]);
  } catch (err) {
    logger.error('FOLDER_UPDATE_ERROR', { message: err.message });
    res.status(500).json({ error: 'Nepodarilo sa upraviť priečinok. Skúste prosím neskôr.' });
  }
});

// ── DELETE /api/documents/folders/:id (kaskádovo zmaže podpriečinky + súbory)
// Pozn: User nemôže mazať priečinky vôbec (requireEditor), admin/editor iba
router.delete('/folders/:id', requireAuth, requireEditor, async (req, res) => {
  try {
    // Rekurzívne zbierame file_url z celého podstromu (ľubovoľná hĺbka)
    const { rows: files } = await query(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM doc_folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM doc_folders f
         JOIN subtree s ON f.parent_id = s.id
       )
       SELECT df.file_url FROM doc_files df
       JOIN subtree s ON df.folder_id = s.id`,
      [req.params.id]
    );
    await query('DELETE FROM doc_folders WHERE id = $1', [req.params.id]);
    for (const f of files) {
      const fp = urlToUploadPath(f.file_url);
      if (fp) fs.unlink(fp, () => {});
    }
    logger.info('FOLDER_DELETE', { userId: req.user.id, username: req.user.username, folderId: Number(req.params.id), filesDeleted: files.length });
    broadcastDocumentsUpdate('folder_delete', { folderId: Number(req.params.id) });
    res.status(204).end();
  } catch (err) {
    logger.error('FOLDER_DELETE_ERROR', { message: err.message });
    res.status(500).json({ error: 'Nepodarilo sa vymazať priečinok. Skúste prosím neskôr.' });
  }
});

// ── POST /api/documents/folders/:id/upload – nahranie súboru do priečinka ────
router.post('/folders/:id/upload', requireAuth,
  async (req, res, next) => {
    try {
      const allowed = await assertWriteAccess(req, res, req.params.id);
      if (!allowed) return;
      next();
    } catch (err) {
      logger.error('FILE_UPLOAD_ACCESS_ERROR', { message: err.message });
      res.status(500).json({ error: 'Pri nahrávaní súboru došlo k chybe. Skúste neskôr.' });
    }
  },
  (req, res, next) => {
    uploadDoc.single('file')(req, res, (err) => {
      if (err) {
        if (err.message === 'FOLDER_NOT_FOUND') {
          return res.status(404).json({ error: 'Priečinok neexistuje. Vyberte prosím iný.' });
        }
        if (err.message?.includes('Nepodporovaný')) {
          return res.status(400).json({ error: 'Nepodporovaný formát súboru.' });
        }
        logger.error('FILE_UPLOAD_MULTER_ERROR', { message: err.message });
        return res.status(500).json({ error: 'Pri nahrávaní súboru došlo k chybe. Skúste neskôr.' });
      }
      next();
    });
  },
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Súbor nebol vybraný.' });
    const client = await pool.connect();
    try {
      const requestedName = normalizeRequestedFileName(req.body?.fileName, req.file.originalname);
      const overwrite = String(req.body?.overwrite || '').toLowerCase() === 'true';
      const folderId = Number(req.params.id);

      const quotaMb = Number(process.env.USER_DOC_QUOTA_MB || 0);
      if (!isElevatedUser(req.user) && quotaMb > 0) {
        const quotaBytes = Math.floor(quotaMb * 1024 * 1024);
        const usage = await query(
          `SELECT COALESCE(SUM(file_size), 0)::bigint AS used
           FROM doc_files
           WHERE uploaded_by = $1`,
          [req.user.id]
        );
        const used = Number(usage.rows[0]?.used || 0);
        if (used + Number(req.file.size || 0) > quotaBytes) {
          removeUploadedTempFile(req.file.path);
          return res.status(413).json({ error: `Prekročený osobný limit úložiska (${quotaMb} MB).` });
        }
      }

      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`doc:${folderId}:${requestedName.toLowerCase()}`]);

      const { rows: existingRows } = await client.query(
        `SELECT id, name, file_url
         FROM doc_files
         WHERE folder_id = $1 AND LOWER(name) = LOWER($2)
         ORDER BY id DESC
         LIMIT 1`,
        [folderId, requestedName]
      );

      const existing = existingRows[0];
      if (existing && !overwrite) {
        await client.query('ROLLBACK');
        removeUploadedTempFile(req.file.path);
        return res.status(409).json({
          code: 'FILE_EXISTS',
          error: 'Súbor s rovnakým názvom už v priečinku existuje.',
          existingName: existing.name,
          suggestedName: buildSuggestedName(existing.name),
        });
      }

      const relativePath = path.relative(UPLOAD_DIR, req.file.path).split(path.sep).join('/');
      const fileUrl = `/uploads/${relativePath}`;

      let rows;
      let oldPathToDelete = null;
      if (existing && overwrite) {
        oldPathToDelete = urlToUploadPath(existing.file_url);
        ({ rows } = await client.query(
          `UPDATE doc_files
           SET name = $1,
               file_url = $2,
               file_size = $3,
               mime_type = $4,
               uploaded_by = $5,
               updated_at = NOW()
           WHERE id = $6
           RETURNING *`,
          [
            requestedName,
            fileUrl,
            req.file.size,
            req.file.mimetype,
            req.user.id,
            existing.id,
          ]
        ));

        if (!rows[0]) {
          await client.query('ROLLBACK');
          removeUploadedTempFile(req.file.path);
          return res.status(409).json({ error: 'Súbor bol medzitým zmenený iným používateľom. Skúste akciu zopakovať.' });
        }

        await client.query('COMMIT');
        if (oldPathToDelete && oldPathToDelete !== req.file.path) {
          fs.unlink(oldPathToDelete, () => {});
        }
        logger.info('FILE_OVERWRITE', { userId: req.user.id, username: req.user.username, fileId: rows[0].id, name: requestedName, folderId, size: req.file.size });
        broadcastDocumentsUpdate('file_upload', { folderId, fileId: rows[0].id });
      } else {
        ({ rows } = await client.query(
          `INSERT INTO doc_files (folder_id, name, file_url, file_size, mime_type, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [
            req.params.id,
            requestedName,
            fileUrl,
            req.file.size,
            req.file.mimetype,
            req.user.id,
          ]
        ));
        await client.query('COMMIT');
        logger.info('FILE_UPLOAD', { userId: req.user.id, username: req.user.username, fileId: rows[0].id, name: requestedName, folderId, size: req.file.size });
        broadcastDocumentsUpdate('file_upload', { folderId, fileId: rows[0].id });
      }
      res.status(201).json(rows[0]);
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      removeUploadedTempFile(req.file?.path);
      if (err.code === '23505') {
        return res.status(409).json({
          code: 'FILE_EXISTS',
          error: 'Súbor s rovnakým názvom už v priečinku existuje.',
        });
      }
      logger.error('FILE_UPLOAD_DB_ERROR', { message: err.message });
      res.status(500).json({ error: 'Pri nahrávaní súboru došlo k chybe. Skúste neskôr.' });
    } finally {
      client.release();
    }
  }
);

// ── PATCH /api/documents/files/:id – premenovanie súboru ─────────────────────
router.patch('/files/:id', requireAuth, async (req, res) => {
  const newName = normalizeRequestedFileName(req.body?.name, '');
  if (!newName) return res.status(400).json({ error: 'Povinné pole: name.' });
  try {
    const { rows: fileRows } = await query(
      'SELECT id, name, folder_id FROM doc_files WHERE id = $1',
      [req.params.id]
    );
    if (!fileRows[0]) return res.status(404).json({ error: 'Súbor neexistuje.' });

    const folderId = fileRows[0].folder_id;
    const allowed = await assertWriteAccess(req, res, folderId);
    if (!allowed) return;

    const { rows: conflict } = await query(
      'SELECT id FROM doc_files WHERE folder_id = $1 AND LOWER(name) = LOWER($2) AND id != $3',
      [folderId, newName, req.params.id]
    );
    if (conflict[0]) {
      return res.status(409).json({ error: 'Súbor s rovnakým názvom už v priečinku existuje.' });
    }

    const { rows } = await query(
      'UPDATE doc_files SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [newName, req.params.id]
    );
    logger.info('FILE_RENAME', { userId: req.user.id, username: req.user.username, fileId: Number(req.params.id), oldName: fileRows[0].name, newName, folderId });
    broadcastDocumentsUpdate('file_upload', { folderId, fileId: Number(req.params.id) });
    res.json(rows[0]);
  } catch (err) {
    logger.error('FILE_RENAME_ERROR', { message: err.message });
    res.status(500).json({ error: 'Nepodarilo sa premenovať súbor. Skúste prosím neskôr.' });
  }
});

// ── GET /api/documents/files/:id/ticker-usage ─────────────────────────────────
router.get('/files/:id/ticker-usage', requireAuth, async (req, res) => {
  try {
    const { rows: fileRows } = await query('SELECT file_url FROM doc_files WHERE id = $1', [req.params.id]);
    if (!fileRows[0]) return res.status(404).json({ error: 'Súbor neexistuje.' });
    const { rows } = await query(
      `SELECT DISTINCT tm.id, tm.text FROM ticker_attachments ta
       JOIN ticker_messages tm ON tm.id = ta.ticker_id
       WHERE ta.file_url = $1`,
      [fileRows[0].file_url]
    );
    res.json(rows);
  } catch (err) {
    logger.error('FILE_TICKER_USAGE_ERROR', { message: err.message });
    res.status(500).json({ error: 'Chyba pri kontrole referencií.' });
  }
});

// ── GET /api/documents/folders/:id/ticker-usage ───────────────────────────────
router.get('/folders/:id/ticker-usage', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM doc_folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM doc_folders f JOIN subtree s ON f.parent_id = s.id
       )
       SELECT DISTINCT tm.id, tm.text FROM ticker_attachments ta
       JOIN ticker_messages tm ON tm.id = ta.ticker_id
       JOIN doc_files df ON df.file_url = ta.file_url
       JOIN subtree s ON df.folder_id = s.id`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    logger.error('FOLDER_TICKER_USAGE_ERROR', { message: err.message });
    res.status(500).json({ error: 'Chyba pri kontrole referencií.' });
  }
});

// ── DELETE /api/documents/files/:id ──────────────────────────────────────────
router.delete('/files/:id', requireAuth, async (req, res) => {
  try {
    const { rows: fileRows } = await query(
      'SELECT folder_id FROM doc_files WHERE id = $1',
      [req.params.id]
    );
    if (!fileRows[0]) return res.status(404).json({ error: 'Súbor neexistuje.' });

    const folderId = fileRows[0].folder_id;
    const allowed = await assertWriteAccess(req, res, folderId);
    if (!allowed) return;

    const { rows } = await query(
      'DELETE FROM doc_files WHERE id = $1 RETURNING file_url, folder_id',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Súbor už bol vymazaný.' });
    if (rows[0]?.file_url) {
      const fp = urlToUploadPath(rows[0].file_url);
      if (fp) fs.unlink(fp, () => {});
    }
    logger.info('FILE_DELETE', { userId: req.user.id, username: req.user.username, fileId: Number(req.params.id), folderId });
    broadcastDocumentsUpdate('file_delete', { folderId: rows[0]?.folder_id, fileId: Number(req.params.id) });
    res.status(204).end();
  } catch (err) {
    logger.error('FILE_DELETE_ERROR', { message: err.message });
    res.status(500).json({ error: 'Nepodarilo sa vymazať súbor. Skúste prosím neskôr.' });
  }
});

// ── GET /api/documents/search/status – stav Meilisearch ───────────────────
router.get('/search/status', requireAuth, (_req, res) => {
  res.json(getStatus());
});

// ── POST /api/documents/search/reconnect – okamžitý reconnect ──────────────
router.post('/search/reconnect', requireAuth, async (_req, res) => {
  try {
    const ok = await reconnectNow();
    const status = getStatus();
    res.json({
      ok,
      status,
      message: ok
        ? 'Vyhľadávanie dokumentov je dostupné.'
        : 'Meilisearch je nedostupný. Backend skúsi opätovné pripojenie automaticky.',
    });
  } catch (err) {
    logger.error('DOCUMENTS_RECONNECT_ERROR', { message: err.message });
    res.status(500).json({ error: 'Nepodarilo sa skúsiť opätovné pripojenie Meilisearch.' });
  }
});

// ── POST /api/documents/reindex – reindex všetkých dokumentov do Meili ─────
router.post('/reindex', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await query(`
      WITH RECURSIVE folder_paths AS (
        SELECT id, parent_id, name, name::text AS full_path
        FROM doc_folders
        WHERE parent_id IS NULL
        UNION ALL
        SELECT f.id, f.parent_id, f.name, (fp.full_path || ' / ' || f.name)::text AS full_path
        FROM doc_folders f
        JOIN folder_paths fp ON fp.id = f.parent_id
      )
      SELECT
        df.id AS file_id,
        df.folder_id,
        df.name,
        df.mime_type,
        df.file_url,
        COALESCE(fp.full_path, '') AS folder_path
      FROM doc_files df
      LEFT JOIN folder_paths fp ON fp.id = df.folder_id
      ORDER BY df.id
    `);

    // Odošleme odpoveď hneď a samotné indexovanie dobehne na pozadí.
    logger.info('DOCUMENTS_REINDEX', { userId: _req.user?.id, username: _req.user?.username, total: rows.length });
    res.json({ ok: true, total: rows.length });

    setImmediate(async () => {
      for (const row of rows) {
        try {
          const absPath = urlToUploadPath(row.file_url);
          const text = absPath ? await extractText(absPath, row.mime_type) : null;
          await indexDocument({
            fileId: row.file_id,
            folderId: row.folder_id,
            folderPath: row.folder_path,
            name: row.name,
            mimeType: row.mime_type,
            text: text || '',
            fileUrl: row.file_url,
          });
        } catch (err) {
          logger.warn('DOCUMENTS_REINDEX_FILE_WARNING', { fileId: row.file_id, message: err.message });
        }
      }
    });
  } catch (err) {
    logger.error('DOCUMENTS_REINDEX_ERROR', { message: err.message });
    res.status(500).json({ error: 'Nepodarilo sa spustiť reindexovanie dokumentov.' });
  }
});

module.exports = router;
