/**
 * /api/auth – prihlásenie, odhlásenie, aktuálny používateľ
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const rateLimit = require('express-rate-limit');
const { query, pool } = require('../db');
const { requireAuth, requireAdmin, SECRET } = require('../middleware/auth');
const { searchAdUsers } = require('../services/adSearch');
const {
  registerPermissionClient,
  unregisterPermissionClient,
  broadcastPermissionUpdate,
} = require('../services/permissionEvents');

const router = express.Router();

function isTrueLike(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 't' || normalized === 'yes';
  }
  return false;
}

async function ensureLocalUser(dbClient, { username, displayName, email }) {
  const uname = String(username || '').trim().toLowerCase();
  if (!uname) throw new Error('Username je povinný.');

  const existing = await dbClient.query(
    'SELECT id FROM users WHERE lower(username) = lower($1) LIMIT 1',
    [uname]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const randomPassword = crypto.randomBytes(24).toString('hex');
  const hash = await bcrypt.hash(randomPassword, 10);
  const safeDisplay = String(displayName || uname).trim() || uname;

  const inserted = await dbClient.query(
    `INSERT INTO users (username, email, display_name, password_hash, role)
     VALUES ($1, $2, $3, $4, 'user')
     RETURNING id`,
    [uname, email || null, safeDisplay, hash]
  );
  return inserted.rows[0].id;
}

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   8 * 60 * 60 * 1000, // 8 hodín
};

// Rate limiting pre login: max 10 pokusov za 15 minút z jednej IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Príliš veľa neúspešných pokusov. Skúste znova o 15 minút.' },
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
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

    if (user.role === 'user') {
      const hasReadAccess = isTrueLike(user.read_access);
      if (!hasReadAccess) {
        const accessCheck = await query(
          'SELECT 1 FROM user_folder_permissions WHERE user_id = $1 LIMIT 1',
          [user.id]
        );

        if (accessCheck.rowCount === 0) {
          return res.status(403).json({
            error: 'Nemáte pridelený prístup do žiadneho root priečinka. Kontaktujte administrátora.'
          });
        }
      }
    }

    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        readAccess: isTrueLike(user.read_access),
      },
      SECRET,
      { expiresIn: '8h' }
    );

    res.cookie('token', token, COOKIE_OPTS);
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      readAccess: isTrueLike(user.read_access),
    });
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

// SSE /api/auth/permissions/subscribe - zmeny opravneni pre aktualneho usera
router.get('/permissions/subscribe', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  registerPermissionClient(req.user.id, res);
  res.write(':connected\n\n');

  const keepAliveInterval = setInterval(() => {
    try {
      res.write(':\n\n');
    } catch (_err) {
      clearInterval(keepAliveInterval);
      unregisterPermissionClient(req.user.id, res);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAliveInterval);
    unregisterPermissionClient(req.user.id, res);
  });
});

// ── Admin: správa používateľov ────────────────────────────────

// GET /api/auth/users – zoznam všetkých používateľov (len admin)
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const result = await query(
    'SELECT id, username, email, display_name, role, read_access, is_active, last_login, created_at FROM users ORDER BY display_name'
  );
  res.json(result.rows);
});

// POST /api/auth/users/search - LDAP vyhladavanie pouzivatelov (len admin)
router.post('/users/search', requireAuth, requireAdmin, async (req, res) => {
  const searchQuery = String(req.body?.searchQuery || '').trim();

  if (searchQuery.length < 2) {
    return res.status(400).json({ error: 'Vyhladavanie vyzaduje aspon 2 znaky.' });
  }

  try {
    const items = await searchAdUsers(searchQuery);
    return res.json({ items });
  } catch (err) {
    console.error('LDAP search error:', err.message);
    const isConfig = err.message.includes('konfiguracia');
    return res.status(isConfig ? 500 : 502).json({ error: err.message });
  }
});

// GET /api/auth/folders/root – root priečinky (parent_id IS NULL)
router.get('/folders/root', requireAuth, requireAdmin, async (_req, res) => {
  const result = await query(
    `SELECT id, name
     FROM doc_folders
     WHERE parent_id IS NULL
     ORDER BY sort_order, name`
  );
  return res.json(result.rows);
});

// GET /api/auth/users/:username/folder-permissions – priradenia usera k root priečinkom
router.get('/users/:username/folder-permissions', requireAuth, requireAdmin, async (req, res) => {
  const username = String(req.params.username || '').trim().toLowerCase();
  if (!username) return res.status(400).json({ error: 'Chýba username.' });

  const userResult = await query(
    `SELECT id, username, role, read_access
     FROM users
     WHERE lower(username) = lower($1)
     LIMIT 1`,
    [username]
  );

  const localUser = userResult.rows[0] || null;
  if (!localUser) {
    return res.json({ localUser: null, assignments: [] });
  }

  const perms = await query(
    `SELECT p.root_folder_id
     FROM user_folder_permissions p
     WHERE p.user_id = $1
     ORDER BY p.root_folder_id`,
    [localUser.id]
  );

  return res.json({
    localUser,
    readAccess: Boolean(localUser?.read_access),
    assignments: perms.rows.map((r) => ({
      rootFolderId: r.root_folder_id,
    })),
  });
});

// PUT /api/auth/users/:username/folder-permissions – uloženie priradení usera k root priečinkom
router.put('/users/:username/folder-permissions', requireAuth, requireAdmin, async (req, res) => {
  const username = String(req.params.username || '').trim().toLowerCase();
  const displayName = String(req.body?.displayName || '').trim();
  const email = String(req.body?.email || '').trim() || null;
  const readAccess = isTrueLike(req.body?.readAccess);
  const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];

  if (!username) return res.status(400).json({ error: 'Chýba username.' });

  // Podporujeme vstup ako [{ rootFolderId }] aj [rootFolderId].
  const selected = [...new Set(
    assignments
      .map((row) => Number.isInteger(row) ? row : row?.rootFolderId)
      .filter((id) => Number.isInteger(id) && id > 0)
  )];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userId = await ensureLocalUser(client, { username, displayName, email });

    await client.query('UPDATE users SET read_access = $1 WHERE id = $2', [readAccess, userId]);

    if (selected.length === 0) {
      await client.query('DELETE FROM user_folder_permissions WHERE user_id = $1', [userId]);
    } else {
      await client.query(
        `DELETE FROM user_folder_permissions
         WHERE user_id = $1
           AND NOT (root_folder_id = ANY($2::int[]))`,
        [userId, selected]
      );

      for (const rootFolderId of selected) {
        await client.query(
          `INSERT INTO user_folder_permissions (user_id, root_folder_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, root_folder_id)
           DO UPDATE
             SET assigned_by = EXCLUDED.assigned_by,
                 updated_at = NOW()`,
          [userId, rootFolderId, req.user.id]
        );
      }
    }

    await client.query('COMMIT');

    const mustLogout = !readAccess && selected.length === 0;
    broadcastPermissionUpdate(userId, {
      userId,
      readAccess,
      assignmentsCount: selected.length,
      mustLogout,
    });

    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    if (String(err.message || '').includes('root folders')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Save user-folder-permissions error:', err.message);
    return res.status(500).json({ error: 'Nepodarilo sa uložiť priradenia.' });
  } finally {
    client.release();
  }
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
