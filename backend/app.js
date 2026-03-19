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

const authRouter      = require('./routes/auth');
const eventsRouter    = require('./routes/events');
const newsRouter      = require('./routes/news');
const tickerRouter    = require('./routes/ticker');
const uploadRouter    = require('./routes/upload');
const documentsRouter = require('./routes/documents');

const app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(cookieParser());

/* ── API routes ─────────────────────────────────────────────── */
app.use('/api/auth',      authRouter);
app.use('/api/events',    eventsRouter);
app.use('/api/news',      newsRouter);
app.use('/api/ticker',    tickerRouter);
app.use('/api/upload',    uploadRouter);
app.use('/api/documents', documentsRouter);

/* ── Statické uploads (obrázky) ────────────────────────────── */
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

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
