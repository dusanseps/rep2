/**
 * Shared upload cleanup utility
 * Handles removal of orphaned files when forms are cancelled or closed without saving
 */

const API = import.meta.env.VITE_API_BASE || '/api';

/**
 * Cleanup orphaned files on the server
 * @param {string[]} urls - List of file URLs to delete (e.g., ['/uploads/file1.pdf', '/uploads/file2.jpg'])
 * @param {object} options - Configuration options
 * @param {boolean} options.silent - If true, don't log errors (for background operations)
 * @returns {Promise<{deleted: number, failed: number}>}
 */
export async function cleanupOrphanedFiles(urls, options = {}) {
  const { silent = true } = options;

  if (!Array.isArray(urls) || urls.length === 0) {
    return { deleted: 0, failed: 0 };
  }

  try {
    const response = await fetch(`${API}/upload/cleanup`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });

    if (!response.ok) {
      if (!silent) {
        console.warn('[uploadCleanup] Cleanup request failed:', response.status);
      }
      return { deleted: 0, failed: urls.length };
    }

    const result = await response.json();
    if (!silent && result.deleted > 0) {
      console.log(`[uploadCleanup] Cleaned up ${result.deleted} orphaned files`);
    }
    return result;
  } catch (err) {
    if (!silent) {
      console.warn('[uploadCleanup] Network error:', err.message);
    }
    return { deleted: 0, failed: urls.length };
  }
}

/**
 * Track newly uploaded files in a component
 * Use this to build the list of URLs to clean up
 * @param {Array} attachments - Attachment array from component state
 * @param {Array} originalAttachments - Original attachments before form opened (for comparison)
 * @returns {string[]} - List of newly uploaded URLs
 */
export function getNewlyUploadedUrls(attachments, originalAttachments = []) {
  const newUrls = [];
  const originalUrls = new Set(originalAttachments.map(a => a.url || a.file_url));

  for (const att of attachments) {
    // Only include files that:
    // 1. Are from current upload session (sourceType === 'uploaded-now' or no sourceType)
    // 2. Are new (not in original attachments)
    // 3. Start with /uploads/ (stored on our server)
    const url = att.url || att.file_url;
    if (url && url.startsWith('/uploads/') && !originalUrls.has(url)) {
      const isNewUpload = !att.sourceType || att.sourceType === 'uploaded-now';
      if (isNewUpload) {
        newUrls.push(url);
      }
    }
  }

  return newUrls;
}

/**
 * Get URLs of newly uploaded image files
 * @param {string} currentImageUrl - Current image URL from component state
 * @param {string} originalImageUrl - Original image URL before form opened
 * @returns {string[]} - List of new image URLs (empty if no new image)
 */
export function getNewlyUploadedImageUrls(currentImageUrl, originalImageUrl = '') {
  if (
    currentImageUrl &&
    currentImageUrl !== originalImageUrl &&
    currentImageUrl.startsWith('/uploads/')
  ) {
    return [currentImageUrl];
  }
  return [];
}

/**
 * Execute cleanup on form close
 * This is meant to be called when user closes a form without saving
 * @param {string[]} urls - URLs to cleanup
 * @param {Function} onClose - Callback to execute after cleanup (typically close modal)
 * @param {object} options - Configuration options
 * @returns {Promise<void>}
 */
export async function executeCleanupAndClose(urls, onClose, options = {}) {
  const { silent = true } = options;

  if (urls.length > 0) {
    await cleanupOrphanedFiles(urls, { silent });
  }

  if (onClose && typeof onClose === 'function') {
    onClose();
  }
}

/**
 * Create a cleanup handler for form cancellation
 * Returns a function that can be used directly as a close handler
 * @param {Function} getUrls - Function that returns the URLs to cleanup
 * @param {Function} onClose - Original close handler
 * @param {object} options - Configuration options
 * @returns {Function} - Handler function
 */
export function createCleanupHandler(getUrls, onClose, options = {}) {
  return async () => {
    const urls = getUrls();
    await executeCleanupAndClose(urls, onClose, options);
  };
}
