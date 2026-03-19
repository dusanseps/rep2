/**
 * PostgreSQL pool – singleton pre celý backend
 * Konfigurácia cez environment premenné (.env)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'representative',
  user:     process.env.DB_USER     || 'rep_test',
  password: process.env.DB_PASSWORD || '',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

module.exports = {
  pool,
  /** Skratka pre jednoduché dotazy */
  query: (text, params) => pool.query(text, params),
};
