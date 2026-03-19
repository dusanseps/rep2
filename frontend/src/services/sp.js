/**
 * sp.js – dátová vrstva (vlastný PostgreSQL backend)
 *
 * Volá náš Express backend na /api/*
 * Exportované funkcie majú rovnaké signatúry pre všetky komponenty.
 */

const DAY = 24 * 60 * 60 * 1000;
const API = import.meta.env.VITE_API_BASE || '/api';

// ─── Interný fetch helper ────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const r = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    if (r.status === 401) { window.location.href = '/'; }
    throw new Error(body.error || `API ${r.status}`);
  }
  if (r.status === 204) return null;
  return r.json();
}

// ─── Udalosti ───────────────────────────────────────────────────────────────

export async function fetchEvents(limit = 3) {
  const rows = await apiFetch(`/events?limit=${limit}`);
  return rows.map(r => ({
    id:       String(r.id),
    title:    r.title,
    start:    r.event_start ? new Date(r.event_start) : null,
    end:      r.event_end   ? new Date(r.event_end)   : null,
    allDay:   r.all_day,
    location: r.location || '',
  }));
}

// ─── Novinky ────────────────────────────────────────────────────────────────

export async function fetchNews(limit = 3) {
  const rows = await apiFetch(`/news?limit=${limit}`);
  return rows.map(r => ({
    id:          String(r.id),
    title:       r.title,
    description: r.description || '',
    imageUrl:    r.banner_image_url || null,
    author:      r.author_name || '',
    publishedAt: r.published_at ? new Date(r.published_at) : null,
    url:         `/news/${r.id}`,
  }));
}

// ─── Ticker ─────────────────────────────────────────────────────────────────

function mapTickerRow(r) {
  let expiresAt   = r.expires_at  ? Date.parse(r.expires_at)  : null;
  const expiresDays = r.expires_days ? Number(r.expires_days) : null;
  return {
    id:          String(r.id),
    text:        r.text,
    link:        r.link_url || '',
    createdAt:   Date.parse(r.created_at),
    expiresAt,
    expiresDays,
    author:      r.author || '',
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
  };
}

export async function fetchTickerMessages() {
  const rows = await apiFetch('/ticker');
  return rows.map(mapTickerRow);
}

export async function createTickerMessage({ text, link, expiresDays, attachments = [] }) {
  await apiFetch('/ticker', {
    method: 'POST',
    body: JSON.stringify({ text, link_url: link || null, expires_days: expiresDays || null, attachments }),
  });
}

export async function updateTickerMessage(id, { text, link, expiresDays, attachments = [] }) {
  await apiFetch(`/ticker/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ text, link_url: link || null, expires_days: expiresDays || null, attachments }),
  });
}

export async function deleteTickerMessage(id) {
  await apiFetch(`/ticker/${id}`, { method: 'DELETE' });
}

// ─── Novinky – CRUD ─────────────────────────────────────────────────────────

function mapNewsRow(r) {
  return {
    id:          String(r.id),
    title:       r.title,
    description: r.description || '',
    content:     r.content || '',
    imageUrl:    r.banner_image_url || null,
    author:      r.author_name || '',
    publishedAt: r.published_at ? new Date(r.published_at) : null,
    url:         `/novinky/${r.id}`,
  };
}

export async function fetchAllNews() {
  const rows = await apiFetch('/news?limit=200');
  return rows.map(mapNewsRow);
}

export async function createNews({ title, description, content, bannerImageUrl, authorName, isPublished }) {
  return apiFetch('/news', {
    method: 'POST',
    body: JSON.stringify({ title, description, content, banner_image_url: bannerImageUrl, author_name: authorName, is_published: isPublished }),
  });
}

export async function updateNews(id, { title, description, content, bannerImageUrl, authorName, isPublished }) {
  await apiFetch(`/news/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title, description, content, banner_image_url: bannerImageUrl, author_name: authorName, is_published: isPublished }),
  });
}

export async function deleteNews(id) {
  await apiFetch(`/news/${id}`, { method: 'DELETE' });
}

// ─── Udalosti – CRUD ────────────────────────────────────────────────────────

function mapEventRow(r) {
  return {
    id:          String(r.id),
    title:       r.title,
    description: r.description || '',
    start:       r.event_start ? new Date(r.event_start) : null,
    end:         r.event_end   ? new Date(r.event_end)   : null,
    allDay:      r.all_day,
    location:    r.location || '',
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



