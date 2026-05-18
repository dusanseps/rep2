const { query } = require('./index');

async function migrate() {
  try {
    console.log('Migracia: Pridanie users.read_access...');

    await query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS read_access BOOLEAN NOT NULL DEFAULT false;
    `);

    console.log('✓ Migracia uspesna');
  } catch (err) {
    console.error('✗ Migracia zlyhala:', err.message);
    process.exit(1);
  }
}

migrate();
