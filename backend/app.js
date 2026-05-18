/**
 * Backend – Express server pre REPRESENTATIVE aplikáciu
 * Databáza: PostgreSQL (user: rep_test)
 * Auth: JWT v httpOnly cookie
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express    = require('express');
const path       = require('path');
const logger     = require('morgan');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const authRouter      = require('./routes/auth');
const eventsRouter    = require('./routes/events');
const newsRouter      = require('./routes/news');
const tickerRouter    = require('./routes/ticker');
const uploadRouter    = require('./routes/upload');
const documentsRouter = require('./routes/documents');
const searchRouter = require('./routes/search');
const { requireAuth } = require('./middleware/auth');

const app = express();

app.use(logger('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
}));

/* ── CSRF ochrana – overenie Origin/Referer pre write endpointy ─ */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use('/api', (req, res, next) => {
  if (!WRITE_METHODS.has(req.method)) return next();
  const origin  = req.headers['origin']  || '';
  const referer = req.headers['referer'] || '';
  const host    = req.headers['host']    || '';
  const allowed = `http://${host}`;
  const allowedS = `https://${host}`;
  const ok =
    origin  === allowed  || origin  === allowedS  ||
    referer.startsWith(allowed + '/') || referer.startsWith(allowedS + '/') ||
    // pre vývoj: ak nie je origin ani referer, povolíme (curl, Postman)
    (!origin && !referer);
  if (!ok) {
    return res.status(403).json({ error: 'Zamietnutý cross-origin request.' });
  }
  next();
});

/* ── API routes ─────────────────────────────────────────────── */
app.use('/api/auth',      authRouter);
app.use('/api/events',    eventsRouter);
app.use('/api/news',      newsRouter);
app.use('/api/ticker',    tickerRouter);
app.use('/api/upload',    uploadRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/search', searchRouter);

/* ── Statické uploads – chránené autentifikáciou ───────────── */
app.use('/uploads', requireAuth, express.static(path.join(__dirname, 'public', 'uploads')));

/* ── Statičké súbory frontendu – IBA v produční (že dist existuje) ──── */
if (process.env.NODE_ENV === 'production') {
  const DIST = path.join(__dirname, '..', 'frontend', 'dist');
  app.use(express.static(DIST));
  app.get('*', (req, res) => {
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

/* ── Error handler ──────────────────────────────────────────── */
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message });
});

module.exports = app;
