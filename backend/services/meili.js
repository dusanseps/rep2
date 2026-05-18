/**
 * meili.js – Meilisearch klient pre full-text vyhľadávanie dokumentov
 *
 * Spustenie Meilisearch:
 *   docker-compose up meilisearch -d
 *
 * Premenné prostredia (backend/.env):
 *   MEILI_URL=http://localhost:7700
 *   MEILI_MASTER_KEY=changeme-dev-key
 *
 * Graceful degradation: ak Meilisearch nebeží, dokumentové výsledky sú prázdne.
 */

'use strict';

let MeilisearchCtor = null;
let _meiliImportPromise = null;

const MEILI_URL = process.env.MEILI_URL || 'http://localhost:7700';
const MEILI_KEY = process.env.MEILI_MASTER_KEY || 'changeme-dev-key';
const INDEX_NAME = 'rep_documents';
const RETRY_INTERVAL_MS = Math.max(5_000, Number(process.env.MEILI_RETRY_MS || 30_000));

let _index = null;
let _available = false;
let _connecting = false;
let _retryTimer = null;
let _lastError = null;
let _lastAttemptAt = null;
let _lastSuccessAt = null;

function _clearRetryTimer() {
  if (_retryTimer) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
}

function _scheduleRetry() {
  if (_available || _connecting || _retryTimer) return;
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    _init().catch(() => {});
  }, RETRY_INTERVAL_MS);
}

function _markUnavailable(err) {
  _available = false;
  _index = null;
  _lastError = err ? String(err.message || err) : 'Meilisearch je nedostupný';
  _scheduleRetry();
}

async function _loadMeilisearchCtor() {
  if (MeilisearchCtor) return MeilisearchCtor;
  if (!_meiliImportPromise) {
    _meiliImportPromise = import('meilisearch')
      .then((mod) => mod.Meilisearch || mod.MeiliSearch || mod.default || null)
      .catch((err) => {
        console.warn('[Meilisearch] Import failed, graceful degradation enabled:', err.message);
        return null;
      });
  }
  MeilisearchCtor = await _meiliImportPromise;
  return MeilisearchCtor;
}

async function _init() {
  if (_connecting) return _available;
  _connecting = true;
  _lastAttemptAt = new Date().toISOString();

  const Ctor = await _loadMeilisearchCtor();
  if (!Ctor) {
    console.warn('[Meilisearch] Modul nie je dostupný (ES import failed)');
    _markUnavailable('ES import failed');
    _connecting = false;
    return false;
  }

  try {
    const client = new Ctor({ host: MEILI_URL, apiKey: MEILI_KEY });
    await client.health();

    // Ensure index exists with correct primary key
    await client.createIndex(INDEX_NAME, { primaryKey: 'id' }).catch((err) => {
      const msg = String(err?.errorCode || err?.message || '');
      if (!msg.includes('already_exists') && !msg.includes('already exists')) throw err;
    });
    // Ensure primaryKey is set (in case index was created without it)
    await client.updateIndex(INDEX_NAME, { primaryKey: 'id' }).catch(() => {});

    _index = client.index(INDEX_NAME);
    await _index.updateSettings({
      searchableAttributes: ['name', 'text', 'folderPath'],
      displayedAttributes: ['id', 'fileId', 'folderId', 'folderPath', 'name', 'mimeType', 'text'],
    });

    _available = true;
    _lastError = null;
    _lastSuccessAt = new Date().toISOString();
    _clearRetryTimer();
    console.log('[Meilisearch] Pripojený:', MEILI_URL);
    _connecting = false;
    return true;
  } catch (err) {
    console.warn('[Meilisearch] Nedostupný (full-text search dokumentov vypnutý):', err.message);
    _markUnavailable(err);
    _connecting = false;
    return false;
  }
}

async function indexDocument({ fileId, folderId, folderPath, name, mimeType, text, fileUrl }) {
  if (!_available || !_index) return;
  try {
    await _index.addDocuments([{
      id: `doc_${fileId}`,
      fileId: Number(fileId),
      folderId: Number(folderId),
      folderPath: folderPath || '',
      name: name || '',
      mimeType: mimeType || '',
      text: (text || ''),
      fileUrl: fileUrl || '',
    }]);
  } catch (err) {
    console.warn('[Meilisearch] indexDocument failed:', err.message);
    _markUnavailable(err);
  }
}

async function removeDocument(fileId) {
  if (!_available || !_index) return;
  try {
    await _index.deleteDocument(`doc_${fileId}`);
  } catch (err) {
    console.warn('[Meilisearch] removeDocument failed:', err.message);
    _markUnavailable(err);
  }
}

async function removeDocuments(fileIds) {
  if (!_available || !_index || !fileIds?.length) return;
  try {
    await _index.deleteDocuments(fileIds.map((id) => `doc_${id}`));
  } catch (err) {
    console.warn('[Meilisearch] removeDocuments failed:', err.message);
    _markUnavailable(err);
  }
}

/**
 * Vyhľadá dokumenty v Meilisearch s textovými snippetmi.
 * @param {string} query
 * @param {object} opts
 * @param {number[]|null} opts.accessibleFolderIds - null = admin (všetky), array = filtruj
 * @param {number} opts.limit
 */
async function searchDocuments(query, { accessibleFolderIds = null, limit = 10 } = {}) {
  if (!_available || !_index) return [];
  try {
    const fetchLimit = accessibleFolderIds !== null ? Math.min(limit * 4, 120) : limit;

    const result = await _index.search(query, {
      limit: fetchLimit,
      attributesToHighlight: ['name', 'text'],
      highlightPreTag: '<em class="hl">',
      highlightPostTag: '</em>',
      attributesToCrop: ['text'],
      cropLength: 35,
    });

    let hits = result.hits;
    if (accessibleFolderIds !== null) {
      const allowed = new Set(accessibleFolderIds.map(Number));
      hits = hits.filter((h) => allowed.has(Number(h.folderId)));
    }

    return hits.slice(0, limit).map((hit) => ({
      fileId: Number(hit.fileId),
      folderId: Number(hit.folderId),
      folderPath: hit.folderPath || '',
      name: hit.name || '',
      snippet: hit._formatted?.text || '',
      mimeType: hit.mimeType || '',
      fileUrl: hit.fileUrl || '',
    }));
  } catch (err) {
    console.warn('[Meilisearch] searchDocuments failed:', err.message);
    _markUnavailable(err);
    return [];
  }
}

function isAvailable() {
  return _available;
}

async function reconnectNow() {
  await _init();
  return _available;
}

function getStatus() {
  return {
    available: _available,
    connecting: _connecting,
    retryScheduled: Boolean(_retryTimer),
    retryInMs: _retryTimer ? RETRY_INTERVAL_MS : 0,
    retryIntervalMs: RETRY_INTERVAL_MS,
    lastError: _lastError,
    lastAttemptAt: _lastAttemptAt,
    lastSuccessAt: _lastSuccessAt,
    host: MEILI_URL,
    index: INDEX_NAME,
  };
}

// Non-blocking init
_init();

module.exports = {
  indexDocument,
  removeDocument,
  removeDocuments,
  searchDocuments,
  isAvailable,
  reconnectNow,
  getStatus,
};

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
