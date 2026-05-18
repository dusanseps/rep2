const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const FORBIDDEN_CHARS = /[<>:"|?*\\]/;

export function normalizeFileName(name) {
  return String(name || '')
    .replace(/\//g, '')
    .replace(/\\+/g, '')
    .replace(/\0/g, '')
    .trim()
    .replace(/\.+$/, '')
    .replace(/\s+$/, '');
}

export function validateFileName(name) {
  const n = normalizeFileName(name);
  if (!n) return 'Názov súboru nesmie byť prázdny.';
  if (FORBIDDEN_CHARS.test(n)) return 'Názov obsahuje nepovolené znaky (< > : " | ? *).';
  const namePart = n.split('.')[0].toUpperCase();
  if (RESERVED_NAMES.test(namePart)) return `Názov „${namePart}" je rezervovaný systémom a nemôže byť použitý.`;
  if (n.length > 255) return 'Názov súboru je príliš dlhý (max. 255 znakov).';
  return null;
}

function splitBaseExt(name, keepExtension = true) {
  const idx = keepExtension ? name.lastIndexOf('.') : -1;
  const hasExt = keepExtension && idx > 0 && idx < name.length - 1;
  return {
    base: hasExt ? name.slice(0, idx) : name,
    ext: hasExt ? name.slice(idx) : '',
  };
}

function parseRootAndSuffix(base) {
  const m = String(base || '').match(/^(.*?)(?:\s*\((\d+)\))$/);
  if (!m) return { root: String(base || '').trimEnd(), suffix: null };
  return { root: m[1].trimEnd(), suffix: Number(m[2]) };
}

export function buildSuggestedName(originalName) {
  const safeName = normalizeFileName(originalName);
  if (!safeName) return 'subor';

  const { base, ext } = splitBaseExt(safeName, true);
  const parsed = parseRootAndSuffix(base);
  const root = parsed.root || base;
  const nextSuffix = parsed.suffix == null ? 1 : parsed.suffix + 1;
  return `${root} (${nextSuffix})${ext}`;
}
