/**
 * JWT auth middleware
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'ZMENTE_TOTO_V_PRODUKCII_na_dlhy_nahodny_retazec';

/**
 * Vyžaduje platný JWT (z httpOnly cookie alebo Authorization header).
 * Pri zlyhaní vráti 401.
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.token
    || (req.headers.authorization || '').replace(/^Bearer\s+/, '');

  if (!token) return res.status(401).json({ error: 'Prihlásenie vyžadované.' });

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (_) {
    res.clearCookie('token');
    res.status(401).json({ error: 'Platnosť prihlásenia vypršala. Prihláste sa znova.' });
  }
}

/**
 * Vyžaduje rolu admin alebo editor.
 */
function requireEditor(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Prihlásenie vyžadované.' });
  if (req.user.role !== 'admin' && req.user.role !== 'editor') {
    return res.status(403).json({ error: 'Nedostatočné oprávnenia.' });
  }
  next();
}

/**
 * Vyžaduje rolu admin.
 */
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Prihlásenie vyžadované.' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Vyžaduje sa rola admin.' });
  }
  next();
}

module.exports = { requireAuth, requireEditor, requireAdmin, SECRET };
