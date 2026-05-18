/**
 * adSearch.js - vyhladavanie pouzivatelov v Active Directory cez LDAP.
 */

const { Client } = require('ldapts');
const ldapEscape = require('ldap-escape');

function getCfg() {
  return {
    url: process.env.LDAP_URL,
    bindDN: process.env.LDAP_BIND_DN,
    bindPassword: process.env.LDAP_BIND_PASSWORD,
    baseDN: process.env.AD_BASE_DN,
    timeoutMs: Number(process.env.LDAP_TIMEOUT_MS || 8000),
  };
}

function assertCfg(cfg) {
  if (!cfg.url || !cfg.bindDN || !cfg.bindPassword || !cfg.baseDN) {
    throw new Error('LDAP konfiguracia nie je uplna. Skontrolujte AD_* premenne.');
  }
}

function pickFirst(v) {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function mapEntry(entry) {
  return {
    dn: pickFirst(entry.dn),
    username: pickFirst(entry.sAMAccountName),
    displayName: pickFirst(entry.displayName) || pickFirst(entry.cn),
    email: pickFirst(entry.mail),
    givenName: pickFirst(entry.givenName),
    surname: pickFirst(entry.sn),
    department: pickFirst(entry.department),
  };
}

function buildFilter(rawQuery) {
  const safe = ldapEscape.filter(rawQuery);
  return `(&` +
    `(objectCategory=person)` +
    `(objectClass=user)` +
    `(|` +
      `(cn=*${safe}*)` +
      `(sn=*${safe}*)` +
      `(givenName=*${safe}*)` +
      `(sAMAccountName=*${safe}*)` +
      `(mail=*${safe}*)` +
    `)` +
  `)`;
}

async function searchAdUsers(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (q.length < 2) return [];

  const cfg = getCfg();
  assertCfg(cfg);

  const client = new Client({
    url: cfg.url,
    timeout: cfg.timeoutMs,
    connectTimeout: cfg.timeoutMs,
  });

  try {
    await client.bind(cfg.bindDN, cfg.bindPassword);

    const { searchEntries } = await client.search(cfg.baseDN, {
      scope: 'sub',
      filter: buildFilter(q),
      attributes: [
        'dn',
        'cn',
        'displayName',
        'givenName',
        'sn',
        'mail',
        'sAMAccountName',
        'department',
      ],
      paged: true,
    });

    return searchEntries
      .map(mapEntry)
      .filter((u) => u.username || u.displayName || u.email)
      .sort((a, b) => (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '', 'sk'));
  } finally {
    await client.unbind().catch((err) => {
      console.warn('[LDAP unbind failed]', err.message);
    });
  }
}

module.exports = { searchAdUsers };
