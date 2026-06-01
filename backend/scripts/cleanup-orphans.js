// Cleanup Job - Automatic removal of orphaned files
// 
// This job should run periodically (every 15-30 minutes) to clean up files that:
// - Were uploaded but never linked to an entity (pending timeout)
// - Are associated with deleted entities (cascade cleanup)
// 
// Usage: 
//   node scripts/cleanup-orphans.js --run
//   OR add to cron: every 30 minutes run: cd /app && node backend/scripts/cleanup-orphans.js

const fs = require('fs').promises;
const path = require('path');
const { query } = require('../db');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const ORPHAN_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour - files older than this with no entity are orphaned

async function listFilesRecursive(dir, baseDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(abs, baseDir));
    } else {
      files.push(path.relative(baseDir, abs).split(path.sep).join('/'));
    }
  }
  return files;
}

/**
 * Find and remove orphaned files on disk
 * Files are considered orphan if they are not referenced in any attachment table
 */
async function cleanupOrphanedFilesOnDisk() {
  try {
    console.log(`[Cleanup] Starting orphan file cleanup...`);
    
    // Get list of all actual files on disk
    const files = await listFilesRecursive(UPLOAD_DIR);
    console.log(`[Cleanup] Found ${files.length} files on disk to check`);
    
    let deleted = 0;
    let errors = 0;

    for (const relativePath of files) {
      const filePath = path.join(UPLOAD_DIR, relativePath);
      
      try {
        const stats = await fs.stat(filePath);
        
        // Skip if it's a directory (like 'documents/', 'news/', 'ticker/')
        if (stats.isDirectory()) {
          continue;
        }

        // Check if file is referenced in any attachment table
        const isReferenced = await checkIfFileIsReferenced(relativePath);
        
        if (!isReferenced) {
          // File is orphaned - check age
          const ageMs = Date.now() - stats.mtimeMs;
          
          if (ageMs > ORPHAN_TIMEOUT_MS) {
            // Old enough to delete
            await fs.unlink(filePath);
            console.log(`[Cleanup] Deleted orphaned file: ${relativePath} (age: ${Math.round(ageMs / 1000 / 60)} minutes)`);
            deleted++;
          }
        }
      } catch (err) {
        console.warn(`[Cleanup] Error processing file ${relativePath}:`, err.message);
        errors++;
      }
    }

    console.log(`[Cleanup] Cleanup complete. Deleted: ${deleted}, Errors: ${errors}`);
    return { deleted, errors };
  } catch (err) {
    console.error(`[Cleanup] Critical error:`, err.message);
    throw err;
  }
}

/**
 * Check if a file is referenced in any attachment table
 */
async function checkIfFileIsReferenced(relativePath) {
  const fileUrl = `/uploads/${relativePath}`;
  
  try {
    // Check in ticker_attachments
    const tickerCheck = await query(
      'SELECT id FROM ticker_attachments WHERE file_url = $1 LIMIT 1',
      [fileUrl]
    );
    if (tickerCheck.rows.length > 0) return true;

    // Check in news_attachments
    const newsCheck = await query(
      'SELECT id FROM news_attachments WHERE file_url = $1 LIMIT 1',
      [fileUrl]
    );
    if (newsCheck.rows.length > 0) return true;

    // Check in doc_files
    const docCheck = await query(
      'SELECT id FROM doc_files WHERE file_url = $1 LIMIT 1',
      [fileUrl]
    );
    if (docCheck.rows.length > 0) return true;

    // Check if it's a news cover image
    const imageCheck = await query(
      'SELECT id FROM news WHERE banner_image_url = $1 LIMIT 1',
      [fileUrl]
    );
    if (imageCheck.rows.length > 0) return true;

    return false;
  } catch (err) {
    console.warn(`[Cleanup] Error checking reference for ${filename}:`, err.message);
    return true; // Assume referenced if we can't check (safer)
  }
}

/**
 * Clean up deleted entity files
 * Remove files from disk if the entity that owned them was deleted
 */
async function cleanupDeletedEntityFiles() {
  try {
    console.log(`[Cleanup] Checking for deleted entity files...`);
    
    let deleted = 0;

    // Get orphaned ticker files (ticker message deleted but attachment record may remain)
    const { rows: orphanedTickerFiles } = await query(`
      SELECT ta.file_url, ta.id
      FROM ticker_attachments ta
      LEFT JOIN ticker_messages tm ON tm.id = ta.ticker_id
      WHERE tm.id IS NULL
      LIMIT 100
    `);

    for (const row of orphanedTickerFiles) {
      await deleteFileAndRecord(row.file_url, 'ticker_attachments', row.id);
      deleted++;
    }

    // Get orphaned news files
    const { rows: orphanedNewsFiles } = await query(`
      SELECT na.file_url, na.id
      FROM news_attachments na
      LEFT JOIN news n ON n.id = na.news_id
      WHERE n.id IS NULL
      LIMIT 100
    `);

    for (const row of orphanedNewsFiles) {
      await deleteFileAndRecord(row.file_url, 'news_attachments', row.id);
      deleted++;
    }

    console.log(`[Cleanup] Cleaned up ${deleted} deleted entity files`);
    return deleted;
  } catch (err) {
    console.error(`[Cleanup] Error in cleanupDeletedEntityFiles:`, err.message);
    return 0;
  }
}

/**
 * Delete a file from disk and its record from database
 */
async function deleteFileAndRecord(fileUrl, table, id) {
  try {
    // Delete from disk
    if (fileUrl.startsWith('/uploads/')) {
      const filename = fileUrl.replace(/^\/uploads\//, '');
      const filePath = path.join(UPLOAD_DIR, filename);
      
      try {
        await fs.unlink(filePath);
      } catch (err) {
        // File may not exist, that's ok
        if (err.code !== 'ENOENT') {
          console.warn(`[Cleanup] Failed to delete file ${fileUrl}:`, err.message);
        }
      }
    }

    // Delete from database
    if (table === 'ticker_attachments' && id) {
      await query('DELETE FROM ticker_attachments WHERE id = $1', [id]);
    } else if (table === 'news_attachments' && id) {
      await query('DELETE FROM news_attachments WHERE id = $1', [id]);
    }
  } catch (err) {
    console.warn(`[Cleanup] Error deleting record:`, err.message);
  }
}

/**
 * Main cleanup runner
 */
async function runCleanup() {
  console.log(`\n=== Upload Orphan File Cleanup Job ===`);
  console.log(`Started at: ${new Date().toISOString()}`);

  try {
    const diskResult = await cleanupOrphanedFilesOnDisk();
    const deletedResult = await cleanupDeletedEntityFiles();

    console.log(`\nCleanup finished:`);
    console.log(`  - Orphaned files deleted: ${diskResult.deleted}`);
    console.log(`  - Deleted entity files cleaned: ${deletedResult}`);
    console.log(`  - Errors encountered: ${diskResult.errors}`);
    console.log(`\nCompleted at: ${new Date().toISOString()}`);
  } catch (err) {
    console.error(`[CRITICAL] Cleanup failed:`, err.message);
    process.exit(1);
  }
}

// If called directly from CLI
if (require.main === module) {
  runCleanup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runCleanup, cleanupOrphanedFilesOnDisk, cleanupDeletedEntityFiles };
