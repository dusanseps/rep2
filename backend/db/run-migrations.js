const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DB_DIR = __dirname;

function runScript(filename) {
  const full = path.join(DB_DIR, filename);
  const result = spawnSync(process.execPath, [full], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Migration script failed: ${filename}`);
  }
}

function main() {
  const files = fs.readdirSync(DB_DIR)
    .filter((f) => /^migrate_.*\.js$/.test(f))
    .sort();

  if (files.length === 0) {
    console.log('[DB MIGRATIONS] No migration scripts found.');
    return;
  }

  console.log(`[DB MIGRATIONS] Running ${files.length} migration script(s)...`);
  for (const file of files) {
    console.log(`[DB MIGRATIONS] -> ${file}`);
    runScript(file);
  }
  console.log('[DB MIGRATIONS] Completed successfully.');
}

if (require.main === module) {
  try {
    main();
    process.exit(0);
  } catch (err) {
    console.error('[DB MIGRATIONS] Failed:', err.message);
    process.exit(1);
  }
}
