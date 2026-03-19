/**
 * auth.js – JWT-based autentifikácia (vlastný backend, bez SharePoint/MSAL)
 *
 * Token je uložený v httpOnly cookie na backende.
 * Frontend ho nikdy priamo nevidí – overenie prebieha cez GET /api/auth/me.
 */

const API = import.meta.env.VITE_API_BASE || '/api';

async function apiFetch(path, opts = {}) {
  const r = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const err  = new Error(body.error || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  if (r.status === 204) return null;
  return r.json();
}

/**
 * Inicializácia – overí platnosť cookie a vráti používateľa (alebo null).
 * Volá sa raz pri štarte aplikácie.
 */
export async function initAuth() {
  try {
    return await apiFetch('/auth/me');
  } catch (err) {
    if (err.status === 401) return null;
    throw err;
  }
}

/**
 * Prihlásenie – pošle username+password, backend nastaví httpOnly cookie.
 * @returns {Promise<{id, username, displayName, role}>}
 */
export async function login(username, password) {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

/**
 * Odhlásenie – backend zmaže cookie.
 */
export async function logout() {
  try { await apiFetch('/auth/logout', { method: 'POST' }); } catch (_) {}
  window.location.href = '/';
}

