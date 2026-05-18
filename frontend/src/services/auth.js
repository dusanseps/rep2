/**
 * auth.js – JWT-based autentifikácia (vlastný backend, bez SharePoint/MSAL)
 *
 * Token je uložený v httpOnly cookie na backende.
 * Frontend ho nikdy priamo nevidí – overenie prebieha cez GET /api/auth/me.
 */

const API = import.meta.env.VITE_API_BASE || '/api';
import { showErrorToast } from '../components/ui/Toasts.jsx';

async function apiFetch(path, opts = {}) {
  const r = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) {
    const body = await r.json().catch((err) => {
      console.warn('[auth apiFetch] Response parse failed:', err.message);
      return {};
    });
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
    console.error('[auth initAuth] Failed to verify session:', err.message);
    showErrorToast('Nepodarilo sa overiť prihlásenie.');
    return null;
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
  try { await apiFetch('/auth/logout', { method: 'POST' }); } catch (err) {
    console.warn('[auth logout] Failed to notify backend:', err.message);
    showErrorToast('Odhlásenie sa nepodarilo dokončiť.');
  }
  window.location.href = '/';
}

/**
 * LDAP vyhladavanie pouzivatelov v Active Directory (len pre admin endpoint).
 */
export async function searchAdUsers(searchQuery) {
  const q = String(searchQuery || '').trim();
  if (q.length < 2) return [];

  const data = await apiFetch('/auth/users/search', {
    method: 'POST',
    body: JSON.stringify({ searchQuery: q }),
  });

  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchRootFolders() {
  const rows = await apiFetch('/auth/folders/root');
  return Array.isArray(rows) ? rows : [];
}

export async function fetchUsers() {
  const rows = await apiFetch('/auth/users');
  return Array.isArray(rows) ? rows : [];
}

export async function fetchUserFolderPermissions(username) {
  const safeUsername = encodeURIComponent(String(username || '').trim());
  return apiFetch(`/auth/users/${safeUsername}/folder-permissions`);
}

export async function saveUserFolderPermissions({ username, displayName, email, assignments, readAccess }) {
  const safeUsername = encodeURIComponent(String(username || '').trim());
  return apiFetch(`/auth/users/${safeUsername}/folder-permissions`, {
    method: 'PUT',
    body: JSON.stringify({ displayName, email, assignments, readAccess: readAccess === true }),
  });
}

