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

function isSameOriginRequest(req) {
  const origin = String(req.headers['origin'] || '');
  const referer = String(req.headers['referer'] || '');
  const host = String(req.headers['x-forwarded-host'] || req.headers['host'] || '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');

  if (!host) return false;

  const allowedHttp = `http://${host}`;
  const allowedHttps = `https://${host}`;
  const allowedCurrent = `${proto}://${host}`;

  if (!origin && !referer) return true;

  return (
    origin === allowedHttp ||
    origin === allowedHttps ||
    origin === allowedCurrent ||
    referer.startsWith(`${allowedHttp}/`) ||
    referer.startsWith(`${allowedHttps}/`) ||
    referer.startsWith(`${allowedCurrent}/`)
  );
}

function resolveSafeUploadPath(uploadRoot, urlPath) {
  const raw = String(urlPath || '');
  if (!raw.startsWith('/uploads/')) return null;

  const rel = decodeURIComponent(raw.slice('/uploads/'.length));
  if (!rel || rel.includes('\\') || rel.includes('..') || rel.startsWith('/')) {
    return null;
  }

  const base = require('path').resolve(uploadRoot);
  const abs = require('path').resolve(base, rel);
  if (abs !== base && !abs.startsWith(`${base}${require('path').sep}`)) {
    return null;
  }

  return abs;
}

module.exports = {
  isSafeUrl,
  normalizeTextInput,
  isSameOriginRequest,
  resolveSafeUploadPath,
};
