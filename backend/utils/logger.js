'use strict';

/**
 * Winston logger – centrálna konfigurácia logovania
 * Konzola: iba v development (NODE_ENV !== 'production'), farebný text
 */

const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs   = require('fs');

const LOG_DIR  = path.resolve(__dirname, '..', process.env.LOG_DIR);
const LOG_FILE = path.join(LOG_DIR, `${process.env.LOG_FILENAME}.log`);
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
    new transports.File({
      filename: LOG_FILE,
      format:   fileFormat,
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({ format: consoleFormat }));
}

module.exports = logger;
