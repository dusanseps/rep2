/**
 * /api/upload – nahrávanie obrázkov (multer, uloženie na disk)
 * Max. veľkosť: 5 MB, povolené: jpeg/png/webp/gif
 */
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const { requireAuth, requireEditor } = require('../middleware/auth');

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
router.post('/image', requireAuth, requireEditor, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Žiadny súbor nebol nahraný.' });
  const url = `/uploads/${req.file.filename}`;
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
    if (ALLOWED_FILE_EXT.includes(ext) || ALLOWED_MIME.includes(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('Nepodporovaný formát súboru.'));
  },
});

// POST /api/upload/file – ľubovoľný dokument (50 MB)
router.post('/file', requireAuth, requireEditor, uploadAny.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Žiadny súbor nebol nahraný.' });
  res.status(201).json({
    url:       `/uploads/${req.file.filename}`,
    name:      req.file.originalname,
    size:      req.file.size,
    mime_type: req.file.mimetype,
  });
});

module.exports = router;
exports.uploadAny = uploadAny;
