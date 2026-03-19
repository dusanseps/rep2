/**
 * teams.js – odosielanie notifikácií do MS Teams cez Incoming Webhook
 *
 * Nastavenie:
 *  1. V Teams kanáli: Správa kanála → Konektory → Incoming Webhook → Konfigurovať
 *  2. Skopíruj webhook URL do backend/.env ako TEAMS_WEBHOOK_URL=https://...
 *
 * Ak TEAMS_WEBHOOK_URL nie je nastavený, notifikácie sa ticho preskočia.
 */

const WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL;

/**
 * Odošle MessageCard do Teams kanála.
 * Chyby sa iba logujú – nikdy nespadne hlavná požiadavka.
 *
 * @param {object} opts
 * @param {'news'|'event'} opts.type
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {string} [opts.author]
 * @param {string} [opts.date]       – formátovaný dátum udalosti
 * @param {string} [opts.location]
 */
async function notifyTeams({ type, title, description, author, date, location }) {
  if (!WEBHOOK_URL) return;

  const isNews  = type === 'news';
  const color   = isNews ? '0078D4' : '5C2D91';
  const icon    = isNews ? '📰' : '📅';
  const section = isNews ? 'Novinky' : 'Udalosti';

  const facts = [];
  if (author)   facts.push({ name: 'Autor',    value: author });
  if (date)     facts.push({ name: 'Dátum',    value: date });
  if (location) facts.push({ name: 'Miesto',   value: location });

  const card = {
    '@type':      'MessageCard',
    '@context':   'https://schema.org/extensions',
    themeColor:   color,
    summary:      title,
    sections: [{
      activityTitle:    `${icon} **${title}**`,
      activitySubtitle: `REPRESENTATIVE · ${section}`,
      activityText:     description || '',
      facts,
    }],
    potentialAction: [{
      '@type': 'OpenUri',
      name:    'Otvoriť REPRESENTATIVE',
      targets: [{ os: 'default', uri: process.env.APP_URL || 'http://localhost:3300' }],
    }],
  };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(card),
    });
    if (!res.ok) {
      console.warn(`[Teams] Webhook vrátil ${res.status}: ${await res.text().catch(() => '')}`);
    }
  } catch (err) {
    console.warn('[Teams] Webhook zlyhal:', err.message);
  }
}

module.exports = { notifyTeams };
