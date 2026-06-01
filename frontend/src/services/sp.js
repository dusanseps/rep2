/**
 * sp.js – dátová vrstva (vlastný PostgreSQL backend)
 *
 * Volá náš Express backend na /api/*
 * Exportované funkcie majú rovnaké signatúry pre všetky komponenty.
 */

const DAY = 24 * 60 * 60 * 1000;
const API = import.meta.env.VITE_API_BASE || '/api';
import { showErrorToast } from '../components/ui/Toasts.jsx';

// ─── Interný fetch helper ────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const r = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) {
    const body = await r.json().catch((err) => {
      console.warn('[sp apiFetch] Response parse failed:', err.message);
      return {};
    });
    if (r.status === 401) {
      console.warn('[sp apiFetch] Session expired (401), redirecting to login...');
      showErrorToast('Vaša relácia vypršala. Prosím prihláste sa znova.');
      window.location.href = '/';
      // return;
      const e = new Error('AUTH_REDIRECT');
      e.code = 'AUTH_REDIRECT';
      throw e;
    }
    console.error('[sp apiFetch] API error:', body.error || `HTTP ${r.status}`);
    throw new Error(body.error || `API ${r.status}`);
  }
  if (r.status === 204) return null;
  return r.json();
}

// ─── Udalosti ───────────────────────────────────────────────────────────────

export async function fetchEvents(limit = 3) {
  const rows = await apiFetch(`/events?limit=${limit}`);
  return rows.map(r => ({
    id: String(r.id),
    title: r.title,
    start: r.event_start ? new Date(r.event_start) : null,
    end: r.event_end ? new Date(r.event_end) : null,
    allDay: r.all_day,
    location: r.location || '',
  }));
}

// ─── Novinky ────────────────────────────────────────────────────────────────

export async function fetchNews(limit = 3) {
  const rows = await apiFetch(`/news?limit=${limit}`);
  return rows.map(r => ({
    id: String(r.id),
    title: r.title,
    description: r.description || '',
    imageUrl: r.banner_image_url || null,
    author: r.author_name || '',
    publishedAt: r.published_at ? new Date(r.published_at) : null,
    url: `/novinky?view=${r.id}`,
  }));
}

// ─── Ticker ─────────────────────────────────────────────────────────────────

function mapTickerRow(r) {
  let expiresAt = r.expires_at ? Date.parse(r.expires_at) : null;
  const expiresDays = r.expires_days ? Number(r.expires_days) : null;
  return {
    id: String(r.id),
    text: r.text,
    createdAt: Date.parse(r.created_at),
    expiresAt,
    expiresDays,
    author: r.author || '',
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
  };
}

export async function fetchTickerMessages() {
  const rows = await apiFetch('/ticker');
  if (!Array.isArray(rows)) return [];
  return rows.map(mapTickerRow);
}

export async function createTickerMessage({ text, expiresDays, attachments = [] }) {
  await apiFetch('/ticker', {
    method: 'POST',
    body: JSON.stringify({ text, expires_days: expiresDays || null, attachments }),
  });
}

export async function updateTickerMessage(id, { text, expiresDays, attachments = [] }) {
  await apiFetch(`/ticker/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ text, expires_days: expiresDays || null, attachments }),
  });
}

export async function deleteTickerMessage(id) {
  await apiFetch(`/ticker/${id}`, { method: 'DELETE' });
}

// ─── Novinky – CRUD ─────────────────────────────────────────────────────────

function mapNewsRow(r) {
  return {
    id: String(r.id),
    title: r.title,
    description: r.description || '',
    content: r.content || '',
    imageUrl: r.banner_image_url || null,
    author: r.author_name || '',
    isPublished: Boolean(r.is_published),
    publishedAt: r.published_at ? new Date(r.published_at) : null,
    createdAt: r.created_at ? new Date(r.created_at) : null,
    createdById: r.created_by ? String(r.created_by) : null,
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    url: `/novinky?view=${r.id}`,
  };
}

function mapNewsCommentRow(r) {
  return {
    id: String(r.id),
    newsId: String(r.news_id),
    parentCommentId: r.parent_comment_id ? String(r.parent_comment_id) : null,
    content: r.content || '',
    createdById: r.created_by ? String(r.created_by) : null,
    authorName: r.author_name || '',
    createdAt: r.created_at ? new Date(r.created_at) : null,
    editedAt: r.edited_at ? new Date(r.edited_at) : null,
    updatedAt: r.updated_at ? new Date(r.updated_at) : null,
    parentPreview: r.parent_preview || null,
    canEdit: Boolean(r.can_edit),
    canDelete: Boolean(r.can_delete),
  };
}

export async function fetchAllNews() {
  const rows = await apiFetch('/news?limit=200');
  return rows.map(mapNewsRow);
}

export async function fetchNewsById(id) {
  const row = await apiFetch(`/news/${id}`);
  return mapNewsRow(row);
}

export async function createNews({ title, description, content, bannerImageUrl, authorName, isPublished, attachments = [] }) {
  return apiFetch('/news', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description,
      content,
      banner_image_url: bannerImageUrl,
      author_name: authorName,
      is_published: isPublished,
      attachments,
    }),
  });
}

export async function updateNews(id, { title, description, content, bannerImageUrl, authorName, isPublished, attachments = [] }) {
  await apiFetch(`/news/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title,
      description,
      content,
      banner_image_url: bannerImageUrl,
      author_name: authorName,
      is_published: isPublished,
      attachments,
    }),
  });
}

export async function deleteNews(id) {
  await apiFetch(`/news/${id}`, { method: 'DELETE' });
}

export async function fetchNewsComments(newsId) {
  const rows = await apiFetch(`/news/${newsId}/comments`);
  return rows.map(mapNewsCommentRow);
}

export async function createNewsComment(newsId, { content, parentCommentId = null }) {
  const row = await apiFetch(`/news/${newsId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content, parent_comment_id: parentCommentId ? Number(parentCommentId) : null }),
  });
  return mapNewsCommentRow(row);
}

export async function updateNewsComment(newsId, commentId, { content }) {
  const row = await apiFetch(`/news/${newsId}/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
  return mapNewsCommentRow(row);
}

export async function deleteNewsComment(newsId, commentId) {
  await apiFetch(`/news/${newsId}/comments/${commentId}`, { method: 'DELETE' });
}

// ─── Udalosti – CRUD ────────────────────────────────────────────────────────

function mapEventRow(r) {
  return {
    id: String(r.id),
    title: r.title,
    description: r.description || '',
    start: r.event_start ? new Date(r.event_start) : null,
    end: r.event_end ? new Date(r.event_end) : null,
    allDay: r.all_day,
    location: r.location || '',
    createdById: r.created_by ? String(r.created_by) : null,
  };
}

export async function fetchAllEvents() {
  const rows = await apiFetch('/events/all');
  return rows.map(mapEventRow);
}

export async function createEvent({ title, description, start, end, allDay, location }) {
  return apiFetch('/events', {
    method: 'POST',
    body: JSON.stringify({ title, description, event_start: start, event_end: end, all_day: allDay, location }),
  });
}

export async function updateEvent(id, { title, description, start, end, allDay, location }) {
  await apiFetch(`/events/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title, description, event_start: start, event_end: end, all_day: allDay, location }),
  });
}

export async function deleteEvent(id) {
  await apiFetch(`/events/${id}`, { method: 'DELETE' });
}



