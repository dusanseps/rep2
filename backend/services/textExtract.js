/**
 * textExtract.js – extrakcia textu zo súborov pre full-text indexovanie
 *
 * Podporované formáty:
 *   PDF  → pdf-parse
 *   DOCX → mammoth
 *   TXT, MD, CSV, JSON, XML → priame čítanie (UTF-8)
 *   Ostatné → null (súbor sa indexuje len podľa názvu a priečinka)
 *
 * Inštalácia závislostí:
 *   cd backend && npm install pdf-parse mammoth
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const MAX_CHARS = 2_000_000; // 2 MB text limit

async function extractText(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();

  try {
    // ── PDF ──────────────────────────────────────────────────────────────────
    if (ext === '.pdf' || mimeType === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(filePath);
      const data = await pdfParse(buf);
      return (data.text || '').slice(0, MAX_CHARS);
    }

    // ── DOCX ─────────────────────────────────────────────────────────────────
    if (
      ext === '.docx' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return (result.value || '').slice(0, MAX_CHARS);
    }

    // ── Plain text ────────────────────────────────────────────────────────────
    if (['.txt', '.md', '.csv', '.json', '.xml', '.rtf'].includes(ext)) {
      return fs.readFileSync(filePath, { encoding: 'utf8' }).slice(0, MAX_CHARS);
    }

    // Unsupported format – index by name/folder only
    return null;
  } catch (err) {
    console.warn(`[textExtract] ${path.basename(filePath)}: ${err.message}`);
    return null;
  }
}

module.exports = { extractText };
