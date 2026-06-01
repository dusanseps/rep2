/**
 * /api/upload – nahrávanie obrázkov (multer, uloženie na disk)
 * Max. veľkosť: 5 MB, povolené: jpeg/png/webp/gif
 */
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { isSameOriginRequest, resolveSafeUploadPath } = require('../utils/security');
const logger  = require('../utils/logger');

const router = express.Router();

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'public', 'uploads'),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const hash = crypto.randomBytes(12).toString('hex');
    cb(null, `${Date.now()}-${hash}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Povolené formáty: JPEG, PNG, WebP, GIF.'));
  },
});

// POST /api/upload/image
router.post('/image', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Žiadny súbor nebol nahraný.' });
  const url = `/uploads/${req.file.filename}`;
  logger.info('IMAGE_UPLOAD', { userId: req.user.id, username: req.user.username, filename: req.file.filename, size: req.file.size });
  res.status(201).json({ url });
});

// ── Generický upload akéhokoľvek súboru (max. 50 MB) ────────────────────────
const ALLOWED_FILE_EXT = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.zip', '.rar', '.7z',
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg',
  '.msg', '.eml', '.odt', '.ods', '.odp', '.rtf',
  '.xml', '.json', '.md', '.mpp',
];

const uploadAny = multer({
  storage,
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
    const extAllowed = ALLOWED_FILE_EXT.includes(ext);
    const mimeAllowed = Boolean(mime) && !blockedMime.includes(mime);
    if (extAllowed && mimeAllowed) {
      return cb(null, true);
    }
    cb(new Error('Nepodporovaný formát súboru.'));
  },
});

// POST /api/upload/file – ľubovoľný dokument (50 MB)
router.post('/file', requireAuth, uploadAny.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Žiadny súbor nebol nahraný.' });
  
  logger.info('FILE_UPLOAD_TEMP', { userId: req.user.id, username: req.user.username, filename: req.file.filename, originalName: req.file.originalname, size: req.file.size });
  res.status(201).json({
    url:       `/uploads/${req.file.filename}`,
    name:      req.file.originalname,
    size:      req.file.size,
    mime_type: req.file.mimetype,
  });
});

// POST /api/upload/cleanup – vymazať súbory (keď sa formulár zruší)
router.post('/cleanup', requireAuth, async (req, res) => {
  if (!isSameOriginRequest(req)) {
    return res.status(403).json({ error: 'Zamietnutý cross-origin request.' });
  }

  const { urls } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Žiadne URLs na vymazanie.' });
  }

  const fs = require('fs').promises;
  const uploadRoot = path.join(__dirname, '..', 'public', 'uploads');
  let deleted = 0;
  let failed = 0;

  for (const url of urls.slice(0, 200)) {
    try {
      const filepath = resolveSafeUploadPath(uploadRoot, url);
      if (!filepath) continue;
      await fs.unlink(filepath);
      deleted++;
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      logger.warn('FILE_CLEANUP_FAILED', { message: err.message });
      failed++;
    }
  }

  res.json({ deleted, failed });
});

module.exports = router;
exports.uploadAny = uploadAny;
