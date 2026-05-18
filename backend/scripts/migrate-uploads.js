#!/usr/bin/env node
/**
 * Migration Script - Reorganize Upload Files on Disk
 * 
 * Currently all files are stored flat in /public/uploads/
 * This script reorganizes them into:
 *   /uploads/ticker/:id/filename
 *   /uploads/news/:id/filename
 *   /uploads/documents/ (already organized in DB, keep flat for now)
 * 
 * SAFETY: Creates backup before modifying anything
 * 
 * Usage:
 *   node scripts/migrate-uploads.js --dry-run   # Show what would be moved
 *   node scripts/migrate-uploads.js --execute   # Actually move files
 */

const fs = require('fs').promises;
const path = require('path');
const { query } = require('../db');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const BACKUP_DIR = path.join(__dirname, '..', 'public', `uploads-backup-${Date.now()}`);

/**
 * Reorganize ticker files
 */
async function reorganizeTickerFiles(dryRun = true) {
  console.log(`\n=== Reorganizing Ticker Files ===`);
  console.log(`Dry run: ${dryRun}`);

  try {
    const { rows } = await query(`
      SELECT ta.id, ta.file_url, ta.ticker_id, tm.id as ticker_exists
      FROM ticker_attachments ta
      LEFT JOIN ticker_messages tm ON tm.id = ta.ticker_id
      WHERE ta.file_url LIKE '/uploads/%'
        AND ta.file_url NOT LIKE '/uploads/ticker/%'
      ORDER BY ta.ticker_id
    `);

    console.log(`Found ${rows.length} ticker files to reorganize`);

    let moved = 0;
    let errors = 0;

    for (const att of rows) {
      try {
        if (!att.ticker_exists) {
          console.log(`  ⚠️  Skipping orphaned ticker attachment (ticker deleted): ${att.file_url}`);
          continue;
        }

        const oldPath = path.join(UPLOAD_DIR, att.file_url.replace(/^\/uploads\//, ''));
        const newDir = path.join(UPLOAD_DIR, 'ticker', String(att.ticker_id));
        const filename = path.basename(att.file_url);
        const newPath = path.join(newDir, filename);
        const newUrl = `/uploads/ticker/${att.ticker_id}/${filename}`;

        if (oldPath === newPath) {
          console.log(`  ✓ Already in correct location: ${filename}`);
          continue;
        }

        // Check if file exists at old path
        try {
          await fs.stat(oldPath);
        } catch (statErr) {
          console.log(`  ⚠️  File not found at expected location, skipping: ${att.file_url}`);
          continue;
        }

        if (!dryRun) {
          // Create directory
          await fs.mkdir(newDir, { recursive: true });
          // Move file
          await fs.rename(oldPath, newPath);
          // Update database
          await query('UPDATE ticker_attachments SET file_url = $1 WHERE id = $2', [newUrl, att.id]);
          console.log(`  ✓ Moved: ${filename} → ticker/${att.ticker_id}/`);
        } else {
          console.log(`  → Would move: ${filename} → ticker/${att.ticker_id}/`);
        }
        moved++;
      } catch (err) {
        console.error(`  ✗ Error: ${att.file_url}`, err.message);
        errors++;
      }
    }

    console.log(`Ticker: Moved ${moved}, Errors: ${errors}`);
    return { moved, errors };
  } catch (err) {
    console.error(`[ERROR] Failed to reorganize ticker files:`, err.message);
    throw err;
  }
}

/**
 * Reorganize news files (attachments)
 */
async function reorganizeNewsAttachmentFiles(dryRun = true) {
  console.log(`\n=== Reorganizing News Attachment Files ===`);

  try {
    const { rows } = await query(`
      SELECT na.id, na.file_url, na.news_id, n.id as news_exists
      FROM news_attachments na
      LEFT JOIN news n ON n.id = na.news_id
      WHERE na.file_url LIKE '/uploads/%'
        AND na.file_url NOT LIKE '/uploads/news/%'
      ORDER BY na.news_id
    `);

    console.log(`Found ${rows.length} news attachment files to reorganize`);

    let moved = 0;
    let errors = 0;

    for (const att of rows) {
      try {
        if (!att.news_exists) {
          console.log(`  ⚠️  Skipping orphaned news attachment (news deleted): ${att.file_url}`);
          continue;
        }

        const oldPath = path.join(UPLOAD_DIR, att.file_url.replace(/^\/uploads\//, ''));
        const newDir = path.join(UPLOAD_DIR, 'news', String(att.news_id));
        const filename = path.basename(att.file_url);
        const newPath = path.join(newDir, filename);
        const newUrl = `/uploads/news/${att.news_id}/${filename}`;

        if (oldPath === newPath) {
          console.log(`  ✓ Already in correct location: ${filename}`);
          continue;
        }

        // Check if file exists at old path
        try {
          await fs.stat(oldPath);
        } catch (statErr) {
          console.log(`  ⚠️  File not found at expected location, skipping: ${att.file_url}`);
          continue;
        }

        if (!dryRun) {
          // Create directory
          await fs.mkdir(newDir, { recursive: true });
          // Move file
          await fs.rename(oldPath, newPath);
          // Update database
          await query('UPDATE news_attachments SET file_url = $1 WHERE id = $2', [newUrl, att.id]);
          console.log(`  ✓ Moved: ${filename} → news/${att.news_id}/`);
        } else {
          console.log(`  → Would move: ${filename} → news/${att.news_id}/`);
        }
        moved++;
      } catch (err) {
        console.error(`  ✗ Error: ${att.file_url}`, err.message);
        errors++;
      }
    }

    console.log(`News attachments: Moved ${moved}, Errors: ${errors}`);
    return { moved, errors };
  } catch (err) {
    console.error(`[ERROR] Failed to reorganize news attachment files:`, err.message);
    throw err;
  }
}

/**
 * Reorganize news cover images
 */
async function reorganizeNewsCoverImages(dryRun = true) {
  console.log(`\n=== Reorganizing News Cover Images ===`);

  try {
    const { rows } = await query(`
      SELECT id, banner_image_url
      FROM news
      WHERE banner_image_url LIKE '/uploads/%'
        AND banner_image_url NOT LIKE '/uploads/news/%'
      ORDER BY id
    `);

    console.log(`Found ${rows.length} news cover images to reorganize`);

    let moved = 0;
    let errors = 0;

    for (const news of rows) {
      try {
        const oldPath = path.join(UPLOAD_DIR, news.banner_image_url.replace(/^\/uploads\//, ''));
        const newDir = path.join(UPLOAD_DIR, 'news', String(news.id));
        const filename = path.basename(news.banner_image_url);
        const newPath = path.join(newDir, filename);
        const newUrl = `/uploads/news/${news.id}/${filename}`;

        if (oldPath === newPath) {
          console.log(`  ✓ Already in correct location: ${filename}`);
          continue;
        }

        // Check if file exists at old path
        try {
          await fs.stat(oldPath);
        } catch (statErr) {
          console.log(`  ⚠️  File not found at expected location, skipping: ${news.banner_image_url}`);
          continue;
        }

        if (!dryRun) {
          // Create directory
          await fs.mkdir(newDir, { recursive: true });
          // Move file
          await fs.rename(oldPath, newPath);
          // Update database
          await query('UPDATE news SET banner_image_url = $1 WHERE id = $2', [newUrl, news.id]);
          console.log(`  ✓ Moved: ${filename} → news/${news.id}/`);
        } else {
          console.log(`  → Would move: ${filename} → news/${news.id}/`);
        }
        moved++;
      } catch (err) {
        console.error(`  ✗ Error: ${news.banner_image_url}`, err.message);
        errors++;
      }
    }

    console.log(`News cover images: Moved ${moved}, Errors: ${errors}`);
    return { moved, errors };
  } catch (err) {
    console.error(`[ERROR] Failed to reorganize news cover images:`, err.message);
    throw err;
  }
}

/**
 * Create backup of uploads directory
 */
async function createBackup() {
  try {
    console.log(`\n=== Creating Backup ===`);
    console.log(`Backup directory: ${BACKUP_DIR}`);
    
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    
    const files = await fs.readdir(UPLOAD_DIR);
    let backed = 0;

    for (const file of files) {
      const src = path.join(UPLOAD_DIR, file);
      const dst = path.join(BACKUP_DIR, file);
      
      const stats = await fs.stat(src);
      if (stats.isFile()) {
        await fs.copyFile(src, dst);
        backed++;
      }
    }

    console.log(`Backed up ${backed} files`);
    return true;
  } catch (err) {
    console.error(`[ERROR] Backup failed:`, err.message);
    throw err;
  }
}

/**
 * Main migration runner
 */
async function runMigration() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--execute');
  const skipBackup = args.includes('--skip-backup');

  console.log(`
╔═══════════════════════════════════════════════════════╗
║ Upload Files Migration - Reorganize Disk Structure   ║
╚═══════════════════════════════════════════════════════╝
  `);

  console.log(`Current directory: ${UPLOAD_DIR}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'EXECUTE (changes will be made)'}`);

  if (dryRun) {
    console.log(`\n⚠️  DRY RUN - No changes will be made. Add --execute to perform migration.`);
  } else {
    console.log(`\n⚠️  EXECUTE MODE - Changes will be made. Backup will be created first.`);
  }

  try {
    let stats = { ticker: {}, newsAttachments: {}, newsImages: {} };

    if (!dryRun && !skipBackup) {
      await createBackup();
    }

    stats.ticker = await reorganizeTickerFiles(dryRun);
    stats.newsAttachments = await reorganizeNewsAttachmentFiles(dryRun);
    stats.newsImages = await reorganizeNewsCoverImages(dryRun);

    console.log(`
╔═══════════════════════════════════════════════════════╗
║ Migration Complete                                   ║
╚═══════════════════════════════════════════════════════╝
    `);

    console.log(`Summary:`);
    console.log(`  Ticker files:      ${stats.ticker.moved || 0} moved, ${stats.ticker.errors || 0} errors`);
    console.log(`  News attachments:  ${stats.newsAttachments.moved || 0} moved, ${stats.newsAttachments.errors || 0} errors`);
    console.log(`  News cover images: ${stats.newsImages.moved || 0} moved, ${stats.newsImages.errors || 0} errors`);

    if (!dryRun && !skipBackup) {
      console.log(`\n✅ Backup saved to: ${BACKUP_DIR}`);
    }

    if (dryRun) {
      console.log(`\n→ To execute migration, run: node scripts/migrate-uploads.js --execute`);
    }
  } catch (err) {
    console.error(`\n[CRITICAL] Migration failed:`, err.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runMigration };
