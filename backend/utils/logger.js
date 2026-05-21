'use strict';

/**
 * Winston logger – centrálna konfigurácia logovania
 *
 * Súbory:  backend/logs/app-YYYY-MM-DD.log  (JSON, rotácia denne, 30 dní, max 50 MB)
 * Konzola: iba v development (NODE_ENV !== 'production'), farebný text
 */

const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs   = require('fs');

const LOG_DIR = path.join(__dirname, '..', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

// ── Formát pre súbory: JSON s časovou pečiatkou ──────────────────────────────
const fileFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json()
);

// ── Formát pre konzolu: farebný jedoriadkový text ────────────────────────────
const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ timestamp, level, message, userId, username, ...meta }) => {
    const userStr  = username ? ` [${username}#${userId}]` : '';
    const reserved = new Set(['service', 'stack']);
    const extra    = Object.entries(meta)
      .filter(([k]) => !reserved.has(k))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    return `${timestamp} ${level}:${userStr} ${message}${extra ? '  ' + extra : ''}`;
  })
);

// ── Logger inštancia ─────────────────────────────────────────────────────────
const logger = createLogger({
  level: 'http',
  transports: [
    new DailyRotateFile({
      dirname:      LOG_DIR,
      filename:     'app-%DATE%.log',
      datePattern:  'YYYY-MM-DD',
      zippedArchive: true,
      maxSize:      '50m',
      maxFiles:     '30d',
      format:       fileFormat,
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({ format: consoleFormat }));
}

module.exports = logger;
