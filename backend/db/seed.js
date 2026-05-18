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
  const email = process.env.ADMIN_EMAIL || 'admin@sepssk.sk';
  const hash = await bcrypt.hash(password, 10);

  const user_username = process.env.USER_USERNAME || 'user';
  const user_password = process.env.USER_PASSWORD || 'CommonUser2026';
  const user_email = process.env.USER_EMAIL || 'user@sepssk.sk';
  const user_hash = await bcrypt.hash(user_password, 10);

  // Admin
  await query(`
    INSERT INTO users (username, email, display_name, password_hash, role)
    VALUES ($1, $2, $3, $4, 'admin')
    ON CONFLICT (username) DO NOTHING
  `, [username, email, 'Administrátor', hash]);
  console.log(`✓ Admin: ${username} / ${password}`);

  // Bežný užívateľ  
  await query(`
    INSERT INTO users (username, email, display_name, password_hash, role)
    VALUES ($1, $2, $3, $4, 'user')
    ON CONFLICT (username) DO NOTHING
  `, [user_username, user_email, 'Bežný užívateľ', user_hash]);
  console.log(`✓ User: ${user_username} / ${user_password}`);

  // Pridelenie prístupu usera – nájdi user ID a root folder ID, potom vlož permission
  const userResult = await query(
    'SELECT id FROM users WHERE lower(username) = lower($1) AND role = \'user\' LIMIT 1',
    [user_username]
  );
  const userId = userResult.rows[0]?.id;

  const rootFolderResult = await query(
    'SELECT id FROM doc_folders WHERE parent_id IS NULL ORDER BY sort_order, id LIMIT 1'
  );
  const rootFolderId = rootFolderResult.rows[0]?.id;

  if (userId && rootFolderId) {
    const insertPermission = await query(
      `INSERT INTO user_folder_permissions (user_id, root_folder_id, assigned_by)
       VALUES ($1, $2, $1)
       ON CONFLICT (user_id, root_folder_id) DO NOTHING`,
      [userId, rootFolderId]
    );
    
    if (insertPermission.rowCount > 0) {
      console.log(`✓ User folder permission: ${user_username} -> root folder ${rootFolderId}`);
    }
  } else {
    console.log('! User folder permission preskočené (chýba user alebo root folder)');
  }

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
