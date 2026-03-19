/**
 * seed.js – vytvorí prvého admin používateľa a ukážkové dáta
 *
 * Spustenie:
 *   node ./db/seed.js
 *
 * Premenné prostredia (alebo .env):
 *   ADMIN_USERNAME  (default: admin)
 *   ADMIN_PASSWORD  (default: Representative2026)
 *   ADMIN_EMAIL     (default: admin@sepssk.sk)
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, pool } = require('./index');

async function seed() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'Representative2026';
  const email    = process.env.ADMIN_EMAIL    || 'admin@sepssk.sk';
  const hash     = await bcrypt.hash(password, 10);

  // Admin
  await query(`
    INSERT INTO users (username, email, display_name, password_hash, role)
    VALUES ($1, $2, $3, $4, 'admin')
    ON CONFLICT (username) DO NOTHING
  `, [username, email, 'Administrátor', hash]);
  console.log(`✓ Admin: ${username} / ${password}`);

  // Ukážkové udalosti
  await query(`
    INSERT INTO events (title, event_start, event_end, all_day, location)
    VALUES
      ('WG AIM Physical Meeting in Rome', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', true, 'Rím, Taliansko'),
      ('Market Committee', NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days', true, ''),
      ('Valné zhromaždenie ENTSO-E', NOW() + INTERVAL '11 days', NOW() + INTERVAL '11 days', true, 'Brusel'),
      ('Správna rada ENTSO-E', NOW() + INTERVAL '30 days', NOW() + INTERVAL '31 days', true, 'Brusel')
    ON CONFLICT DO NOTHING
  `);
  console.log('✓ Udalosti');

  // Ukážkové novinky
  await query(`
    INSERT INTO news (title, description, author_name, is_published, published_at)
    VALUES
      ('Voľne prístupné výstupy z inovatívnych projektov FINGRID',
       'Fingrid ako fínsky prevádzkovateľ prenosovej sústavy predstavuje kvalitatívnu špičku medzi európskymi TSO operátormi.',
       'Grafnák Peter', true, NOW() - INTERVAL '3 days'),
      ('Predstavenie FINGRID na rokovaní RDIC pracovnej skupiny WG: Future of energy systems',
       'Fingrid ako fínsky prevádzkovateľ prenosovej sústavy predstavuje kvalitatívnu špičku medzi európskymi TSO operátormi.',
       'Grafnák Peter', true, NOW() - INTERVAL '3 days'),
      ('Pozvánka na Cross-Committee Workshop on the AI Roadmap for TSO Operations',
       'Predseda Výboru pre výskum, vývoj a inovácie RDIC, a koordinátorka pracovnej skupiny RDI…',
       'Grafnák Peter', true, NOW() - INTERVAL '3 days')
    ON CONFLICT DO NOTHING
  `);
  console.log('✓ Novinky');

  // Ukážkové ticker správy
  await query(`
    INSERT INTO ticker_messages (text, expires_at, expires_days)
    VALUES
      ('Vitajte v REPRESENTATIVE portáli SEPS', NOW() + INTERVAL '7 days', 7),
      ('WG AIM Physical Meeting in Rome – 17. – 18. marca 2026', NOW() + INTERVAL '5 days', 5),
      ('Nové dokumenty ENTSO-E dostupné v sekcii Dokumenty', NOW() + INTERVAL '14 days', 14)
    ON CONFLICT DO NOTHING
  `);
  console.log('✓ Ticker správy');
  console.log('\nSeed dokončený.');
}

seed()
  .catch(err => { console.error('Seed zlyhal:', err.message); process.exit(1); })
  .finally(() => pool.end());
