const express = require('express');
const os = require('os');
const { query, pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/health', requireAuth, async (_req, res) => {
  const started = Date.now();
  try {
    await query('SELECT 1');
    return res.json({
      ok: true,
      service: 'representative-backend',
      uptimeSec: Math.round(process.uptime()),
      db: 'up',
      responseMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  } catch (_err) {
    return res.status(503).json({
      ok: false,
      service: 'representative-backend',
      db: 'down',
      responseMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  }
});

router.get('/metrics', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const dbNow = await query('SELECT NOW() AS now');
    const memory = process.memoryUsage();
    return res.json({
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      host: os.hostname(),
      cpuCount: os.cpus().length,
      loadAvg: os.loadavg(),
      memory,
      dbPool: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      },
      dbNow: dbNow.rows[0]?.now,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
