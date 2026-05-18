/**
 * Text formatting utilities
 */

const TEXT_MAX_LENGTH = 12;

/**
 * Skráti text na max počet znakov s elipsou
 * @param {string} value - Text na skrátenie
 * @param {number} max - Maximálna dĺžka (default 12)
 * @returns {string} Skrátený text s "..." alebo pôvodný ak je kratší
 */
export function shortBadgeText(value, max = TEXT_MAX_LENGTH) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
