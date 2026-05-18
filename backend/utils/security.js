function isSafeUrl(raw, { allowRelative = true, maxLength = 2048 } = {}) {
  if (raw == null) return true;
  const value = String(raw).trim();
  if (!value) return true;
  if (value.length > maxLength) return false;

  if (allowRelative && value.startsWith('/')) {
    // Block protocol-relative URLs like //evil.example
    return !value.startsWith('//');
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_err) {
    return false;
  }
}

function normalizeTextInput(raw, { maxLength = 4000 } = {}) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.length > maxLength) return value.slice(0, maxLength);
  return value;
}

module.exports = {
  isSafeUrl,
  normalizeTextInput,
};
