/**
 * /api/documents – správa priečinkov a súborov dokumentov
 */
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const fs      = require('fs');
const { query } = require('../db');
const { requireAuth, requireEditor } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const ALLOWED_EXT = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.zip', '.rar', '.7z',
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg',
  '.msg', '.eml', '.odt', '.ods', '.odp', '.rtf', '.xml', '.json', '.md',
];
const docStorage = multer.diskStorage({
  destination: UPLOAD_DIR,
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
    ALLOWED_EXT.includes(ext) ? cb(null, true) : cb(new Error('Nepodporovaný formát.'));
  },
});

// ── GET /api/documents/tree – celý strom priečinkov ─────────────────────────
router.get('/tree', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, parent_id, name, description, sort_order
      FROM doc_folders
      ORDER BY COALESCE(parent_id, 0), sort_order, name
    `);

    // Zostavíme strom v pamäti
    const map = {};
    const roots = [];
    for (const row of rows) {
      map[row.id] = { ...row, children: [] };
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
    console.error(err.message);
    res.status(500).json({ error: 'Nepodarilo sa načítať strom dokumentov.' });
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
    res.status(500).json({ error: 'Chyba.' });
  }
});

// ── POST /api/documents/folders – nový priečinok ────────────────────────────
router.post('/folders', requireAuth, requireEditor, async (req, res) => {
  const { name, parent_id, description, sort_order } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Povinné pole: name.' });
  try {
    const { rows } = await query(`
      INSERT INTO doc_folders (name, parent_id, description, sort_order, created_by)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [name.trim(), parent_id || null, description || null, sort_order || 0, req.user.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Nepodarilo sa vytvoriť priečinok.' });
  }
});

// ── PATCH /api/documents/folders/:id ────────────────────────────────────────
router.patch('/folders/:id', requireAuth, requireEditor, async (req, res) => {
  const { name, description } = req.body || {};
  try {
    const { rows } = await query(`
      UPDATE doc_folders SET name=$1, description=$2, updated_at=NOW()
      WHERE id=$3 RETURNING *
    `, [name, description || null, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Priečinok nenájdený.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Chyba.' });
  }
});

// ── DELETE /api/documents/folders/:id (kaskádovo zmaže podpriečinky + súbory)
router.delete('/folders/:id', requireAuth, requireEditor, async (req, res) => {
  try {
    // Collect all file URLs for cleanup
    const { rows: files } = await query(
      `SELECT f.file_url FROM doc_files f
       JOIN doc_folders fold ON fold.id = f.folder_id
       WHERE fold.id = $1 OR fold.parent_id = $1`,
      [req.params.id]
    );
    await query('DELETE FROM doc_folders WHERE id = $1', [req.params.id]);
    for (const f of files) {
      const fp = path.join(UPLOAD_DIR, path.basename(f.file_url));
      fs.unlink(fp, () => {});
    }
    res.status(204).end();
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Chyba mazania.' });
  }
});

// ── POST /api/documents/folders/:id/upload – nahranie súboru do priečinka ────
router.post('/folders/:id/upload', requireAuth, requireEditor,
  uploadDoc.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Žiadny súbor.' });
    try {
      const { rows } = await query(
        `INSERT INTO doc_files (folder_id, name, file_url, file_size, mime_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          req.params.id,
          req.file.originalname,
          `/uploads/${req.file.filename}`,
          req.file.size,
          req.file.mimetype,
          req.user.id,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: 'Nepodarilo sa uložiť súbor.' });
    }
  }
);

// ── DELETE /api/documents/files/:id ──────────────────────────────────────────
router.delete('/files/:id', requireAuth, requireEditor, async (req, res) => {
  try {
    const { rows } = await query(
      'DELETE FROM doc_files WHERE id = $1 RETURNING file_url',
      [req.params.id]
    );
    if (rows[0]?.file_url) {
      const fp = path.join(UPLOAD_DIR, path.basename(rows[0].file_url));
      fs.unlink(fp, () => {});
    }
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'Chyba mazania súboru.' });
  }
});

module.exports = router;
