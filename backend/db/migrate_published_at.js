const { query } = require('./index');

async function migrate() {
  try {
    console.log('Migrácia: Zmena published_at na nullable...');
    
    // Zmena column na nullable
    await query(`
      ALTER TABLE news
      ALTER COLUMN published_at DROP NOT NULL;
    `);
    
    console.log('✓ Migrácia úspešná');
  } catch (err) {
    console.error('✗ Migrácia zlyhala:', err.message);
    process.exit(1);
  }
}

migrate();
