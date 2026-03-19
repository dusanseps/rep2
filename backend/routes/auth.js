/**
 * /api/auth – prihlásenie, odhlásenie, aktuálny používateľ
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { query } = require('../db');
const { requireAuth, SECRET } = require('../middleware/auth');

const router = express.Router();

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   8 * 60 * 60 * 1000, // 8 hodín
};

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Chýba meno alebo heslo.' });
  }

  try {
    const result = await query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username.trim().toLowerCase()]
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Nesprávne meno alebo heslo.' });
    }

    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
      SECRET,
      { expiresIn: '8h' }
    );

    res.cookie('token', token, COOKIE_OPTS);
    res.json({ id: user.id, username: user.username, displayName: user.display_name, role: user.role });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Interná chyba servera.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// GET /api/auth/me – vráti aktuálneho používateľa (overenie tokenu)
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// ── Admin: správa používateľov ────────────────────────────────

const { requireAdmin } = require('../middleware/auth');

// GET /api/auth/users – zoznam všetkých používateľov (len admin)
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const result = await query(
    'SELECT id, username, email, display_name, role, is_active, last_login, created_at FROM users ORDER BY display_name'
  );
  res.json(result.rows);
});

// POST /api/auth/users – vytvorenie používateľa (len admin)
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, email, display_name, password, role = 'user' } = req.body || {};
  if (!username || !password || !display_name) {
    return res.status(400).json({ error: 'Chýbajú povinné polia: username, display_name, password.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (username, email, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, display_name, role`,
      [username.trim().toLowerCase(), email || null, display_name, hash, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Používateľ s týmto menom alebo emailom už existuje.' });
    console.error(err.message);
    res.status(500).json({ error: 'Interná chyba.' });
  }
});

// PATCH /api/auth/users/:id/password – zmena hesla
router.patch('/users/:id/password', requireAuth, async (req, res) => {
  const targetId = parseInt(req.params.id);
  // Admin môže meniť komukoľvek, user len sebe
  if (req.user.role !== 'admin' && req.user.id !== targetId) {
    return res.status(403).json({ error: 'Nedostatočné oprávnenia.' });
  }
  const { password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Heslo musí mať aspoň 8 znakov.' });
  }
  const hash = await bcrypt.hash(password, 10);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, targetId]);
  res.json({ ok: true });
});

// DELETE /api/auth/users/:id – deaktivácia (soft delete – len admin)
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  await query('UPDATE users SET is_active = false WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
